// A microcontroller in the circuit: the PIC16F84A (core, assembler and HEX reader in pic.js) wired to the simulator's pins.
//
// Time. The CPU runs at its own pace: one instruction cycle is 4 / fosc. Rather than make the analogue engine stop at every
// instruction, the chip plans ahead: from the state it has committed, it executes up to `window` instructions (with the pin
// levels as they are now), recording a checkpoint every few instructions and at every change of what it drives on its pins.
// The next event it reports to the engine is the first of those changes (or the end of the plan), so output edges land exactly
// and quiet stretches (a delay loop) cost no analogue steps. When the engine accepts a step the chip commits up to that time
// from the nearest checkpoint; if an input crossed its threshold (the engine bisects to that instant), the edge is handed to
// the core (interrupt flags, Timer0 clock) and the plan is redone from there.
//
// Pins (node order): MCLR_N, RA0-RA4, RB0-RB7. No power pins, like the logic ICs. Outputs drive through `ro`; RA4 is open-drain;
// RB inputs have a weak pull-up when the program enables it (RBPU = 0); MCLR_N low holds the chip in reset.

class PicMcu extends Element {
    static PINS = ["MCLR_N", "RA0", "RA1", "RA2", "RA3", "RA4", "RB0", "RB1", "RB2", "RB3", "RB4", "RB5", "RB6", "RB7"];

    // the program a part carries: assembly source if there is any, else Intel HEX, else an empty (erased) memory
    static program({ src = "", hex = "" } = {}) {
        if (String(src).trim()) {
            const a = PicAsm.assemble(src);
            if (a.errors.length) throw new Error(`assembly error, line ${a.errors[0].line}: ${a.errors[0].message}${a.errors.length > 1 ? ` (and ${a.errors.length - 1} more)` : ""}`);
            return { words: a.words, config: a.config, eeprom: a.eeprom, listing: a.listing, symbols: a.symbols, from: "asm" };
        }
        if (String(hex).trim()) {
            const h = PicHex.parse(hex);
            if (h.errors.length) throw new Error(`HEX file: ${h.errors[0]}`);
            return { words: h.words, config: h.config, eeprom: h.eeprom, listing: null, symbols: null, from: "hex" };
        }
        return { words: new Uint16Array(PicCore.PROG_WORDS).fill(0x3FFF), config: 0x3FFB, eeprom: new Uint8Array(64), listing: null, symbols: null, from: "none" };
    }

    constructor(name, nodes, { vcc = 5, ro = 50, clock = 4e6, src = "", hex = "", window = 2048 } = {}) {
        super(name, nodes);
        this.vcc = vcc; this.ro = ro;
        this.clock = clock > 0 ? clock : 4e6;
        this.tcy = 4 / this.clock;
        this.prog = PicMcu.program({ src, hex });
        this.core = new PicCore();
        this.core.load(this.prog.words, this.prog.config, this.prog.eeprom);
        this.window = window;                    // instructions planned ahead (1 while single-stepping)
        this.hasEvents = true;
        this.schedules = true;                   // tells the engine to land on nextEvent()
        this.nonlinear = false;
        this.bps = new Set();
        this.breakHit = false;
        this.passBp = -1;
        this.held = false;                       // MCLR_N is low
        this.cpuT = 0;                           // the time the committed state is at
        this.plan = null;
        this.levels = { a: 0, b: 0, mclr: 1 };   // logic levels at the last accept
        this.drive = this.core.driven();         // what is driven on the pins now
    }

    // ---- the pins as the circuit sees them
    sample(ctx) {
        let a = 0, b = 0;
        for (let i = 0; i < 5; i++) if (ctx.v(this.n[1 + i]) > this.vcc / 2) a |= 1 << i;
        for (let i = 0; i < 8; i++) if (ctx.v(this.n[6 + i]) > this.vcc / 2) b |= 1 << i;
        return { a, b, mclr: ctx.v(this.n[0]) > this.vcc / 2 ? 1 : 0 };
    }

    stamp(ctx) {
        const s = ctx.sys, G = 1 / this.ro, gpu = 1e-6, gw = 1 / 20e3;
        // MCLR_N: a weak pull-up, like any active-low input of the logic ICs
        s.add(this.n[0], this.n[0], gpu); s.rhs(this.n[0], gpu * this.vcc);
        const pull = this.core.weakPullups;
        const pin = (node, d, weakUp) => {
            if (d === "in") {
                if (weakUp) { s.add(node, node, gw); s.rhs(node, gw * this.vcc); } else s.addG(node, -1, gpu);
            } else { s.add(node, node, G); s.rhs(node, d ? G * this.vcc : 0); }
        };
        this.drive.a.forEach((d, i) => pin(this.n[1 + i], d, false));
        this.drive.b.forEach((d, i) => pin(this.n[6 + i], d, pull));
    }

    stampAC(ac) {
        // held at their DC levels: a driven pin is a resistance to its rail
        const add = (node, d) => { if (d !== "in") ac.addY(node, -1, 1 / this.ro, 0); };
        this.drive.a.forEach((d, i) => add(this.n[1 + i], d)); this.drive.b.forEach((d, i) => add(this.n[6 + i], d));
    }

    current() { return 0; }

    // ---- planning and committing
    sig() { const s = this.core.sfr; return (s.trisA | (s.latchA << 5) | (s.trisB << 10) | (s.latchB << 18)) * 2 + (s.option >> 7); }

    // execute from the committed state: record checkpoints, stop at `window` instructions, at a breakpoint, or at `limit` seconds
    makePlan(limit = Infinity) {
        const core = this.core, tcy = this.tcy;
        const plan = { cps: [], endT: this.cpuT, stopped: null };
        const cp = (t, ev = false) => { plan.cps.push({ t, snap: core.snapshot(), drive: this.drive, ev }); };
        let sig = this.sig(), n = 0, pass = this.passBp;       // pass: a breakpoint address to run through once (the one just stopped at)
        this.drive = core.driven();
        cp(this.cpuT);
        let t = this.cpuT;
        while (n < this.window && t < limit) {
            if (this.held) { t = Math.min(limit, t + this.window * tcy); core.advance(t - plan.endT, 0); plan.endT = t; break; }
            if (this.bps.size && this.bps.has(core.pc) && core.pc !== pass) { plan.stopped = "break"; break; }
            pass = -1;
            const c = core.step();
            let dt;
            if (c === 0) {                                                  // asleep: nothing runs until something wakes it; time just passes
                dt = Math.min(limit, t + this.window * tcy) - t;
                core.advance(dt, 0);
                t += dt; plan.endT = t; n = this.window;
                break;
            }
            dt = c * tcy;
            core.advance(dt, c);
            t += dt; n++; plan.endT = t;
            const s2 = this.sig();
            if (s2 !== sig) { sig = s2; this.drive = core.driven(); cp(t, true); }
            else if ((n & 63) === 0) cp(t);
        }
        cp(plan.endT);
        this.drive = plan.cps[0].drive;
        this.plan = plan;
        // leave the core where the plan started: the committed state is checkpoint 0
        core.restore(plan.cps[0].snap);
        return plan;
    }

    // the first future change of what is driven (or the end of the plan)
    nextEvent() {
        const p = this.plan;
        if (!p || this.held) return p ? p.endT : Infinity;
        for (const c of p.cps) if (c.ev && c.t > this.cpuT + 1e-15) return c.t;
        return p.endT > this.cpuT + 1e-15 ? p.endT : Infinity;
    }

    // bring the committed state to time T from the nearest checkpoint, running forward instruction by instruction
    commitTo(T) {
        const p = this.plan, core = this.core, tcy = this.tcy;
        if (!p) return;
        let best = null;
        for (const c of p.cps) if (c.t <= T + 1e-15) best = c; else break;
        if (!best) best = p.cps[0];
        core.restore(best.snap); this.cpuT = best.t; this.drive = best.drive;
        // forward from the checkpoint to T (an instruction whose end would pass T, and would change a pin, is left for later)
        const nextChange = (() => { for (const c of p.cps) if (c.ev && c.t > best.t + 1e-15) return c.t; return Infinity; })();
        let guard = 0;
        while (this.cpuT + tcy * 0.001 < T && this.cpuT < p.endT - 1e-15 && guard++ < 4096) {
            if (this.held) { core.advance(Math.min(T, p.endT) - this.cpuT, 0); this.cpuT = Math.min(T, p.endT); break; }
            if (nextChange - this.cpuT <= 2 * tcy + 1e-15 && nextChange > T + 1e-15) break;
            if (this.bps.size && this.bps.has(core.pc) && core.pc !== this.passBp && this.cpuT > best.t) break;
            const c = core.step();
            if (c === 0) { const dt = Math.min(T, p.endT) - this.cpuT; core.advance(dt, 0); this.cpuT += dt; break; }
            core.advance(c * tcy, c); this.cpuT += c * tcy;
        }
        this.drive = core.driven();
    }

    initState(ctx) {
        const core = this.core;
        core.load(this.prog.words, this.prog.config, this.prog.eeprom);       // power-on reset with a fresh EEPROM image
        this.levels = this.sample(ctx);
        core.pins.a = this.levels.a; core.pins.b = this.levels.b;
        this.held = !this.levels.mclr;
        this.cpuT = 0; this.breakHit = false; this.passBp = -1; this.plan = null;
        this.makePlan();
    }

    // an input crossed a threshold since the last accept (the engine then bisects to that instant)
    wouldFlip(ctx) {
        const L = this.sample(ctx), old = this.levels, s = this.core.sfr;
        if (L.mclr !== old.mclr) return true;
        const inA = s.trisA & 0x1F, inB = s.trisB;
        return ((L.a ^ old.a) & inA) !== 0 || ((L.b ^ old.b) & inB) !== 0;
    }

    accept(ctx) {
        const T = ctx.time, core = this.core;
        this.commitTo(T);
        const L = this.sample(ctx), old = this.levels;
        let replan = false;
        if (L.mclr !== old.mclr) {
            if (!L.mclr) { this.held = true; core.reset(false); }
            else if (this.held) { this.held = false; core.reset(false); }
            replan = true;
        }
        if (L.a !== core.pins.a || L.b !== core.pins.b) {
            core.pinsChanged(L.a, L.b);
            replan = true;
        }
        this.levels = L;
        if (this.passBp >= 0 && core.pc !== this.passBp) this.passBp = -1;           // the chip has moved on from the breakpoint it was let through
        const p = this.plan;
        if (this.bps.size && this.bps.has(core.pc) && core.pc !== this.passBp && !this.held) this.breakHit = true;
        if (replan || !p || T >= p.endT - 1e-15) this.makePlan();
        else {
            // keep the plan; drop the checkpoints already passed (keeping the one the state came from)
            while (p.cps.length > 2 && p.cps[1].t <= this.cpuT + 1e-15) p.cps.shift();
            if (p.cps[0].t > this.cpuT + 1e-15) this.makePlan();
        }
    }
}

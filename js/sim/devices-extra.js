// Additional parts: JFET, coupled-inductor transformer, relay, fuse, SCR / TRIAC,
// voltage regulator and flip-flops. Loaded after devices.js (they build on its elements).

// ------------------------------------------------------------------- JFET

// Shichman-Hodges JFET (SPICE level 1). nodes: [G, D, S]; pol +1 N-channel, -1 P-channel.
// p: vto in SPICE's convention (negative = depletion mode for BOTH polarities; the device
// flips voltages for the P-channel part),
// beta, lambda, rd, rs, is (gate junction), cgs, cgd.
class JFET extends MOSFET {
    constructor(name, nodes, polarity, p = {}) {
        super(name, nodes, polarity, {});
        this.p = Object.assign({ vto: -2, beta: 1e-3, lambda: 0, rd: 0, rs: 0, is: 1e-14, cgs: 0, cgd: 0 }, p);
        delete this.p.bodyDiode;
    }

    bind(circuit) {
        super.bind(circuit);
        const [g, d, s] = this.nodeNames;
        const jd = { is: this.p.is, n: 1, rs: 0 };
        // the gate forms a pn junction with the channel (anode at the gate for an N-channel part)
        const di = this.p.rd > 0 ? `${this.name}#d` : d, si = this.p.rs > 0 ? `${this.name}#s` : s;
        const pairs = this.pol > 0 ? [[g, si, "gs"], [g, di, "gd"]] : [[si, g, "gs"], [di, g, "gd"]];
        for (const [a, b, tag] of pairs) circuit.add(new Diode(`${this.name}.${tag}`, [a, b], jd));
    }

    fwd(vgs, vds) {
        const { vto, beta, lambda } = this.p;
        const vgst = vgs - vto;
        if (vgst <= 0) return { id: 0, gm: 0, gds: 0 };
        const lam = 1 + lambda * vds;
        if (vds < vgst) {
            const core = vds * (2 * vgst - vds);
            return {
                id: beta * core * lam,
                gm: 2 * beta * vds * lam,
                gds: 2 * beta * (vgst - vds) * lam + beta * core * lambda
            };
        }
        return {
            id: beta * vgst * vgst * lam,
            gm: 2 * beta * vgst * lam,
            gds: beta * vgst * vgst * lambda
        };
    }
}


// ------------------------------------------------------------ transformer

// Two magnetically coupled inductors (SPICE "K"). nodes: [P1, P2, S1, S2].
// l1 is the primary inductance, ratio = N2 / N1 (so l2 = l1 * ratio^2), k the coupling.
// rp / rs are winding resistances. A DC voltage across a winding drives it like a short,
// exactly as an ideal inductor does.
class Transformer extends Element {
    constructor(name, nodes, { l1 = 1, ratio = 1, k = 0.999, rp = 0, rs = 0 } = {}) {
        super(name, nodes);
        this.l1 = l1;
        this.l2 = l1 * ratio * ratio;
        this.m = k * Math.sqrt(this.l1 * this.l2);
        this.rp = rp;
        this.rs = rs;
        this.branches = 2;
        this.i1 = 0; this.i2 = 0; this.v1 = 0; this.v2 = 0;
    }

    bind(circuit) {
        super.bind(circuit);
        const [p1, , s1] = this.nodeNames;
        this.pa = this.rp > 0 ? circuit.internalNode(`${this.name}#p`) : this.n[0];
        this.sa = this.rs > 0 ? circuit.internalNode(`${this.name}#s`) : this.n[2];
        if (this.rp > 0) circuit.add(new Resistor(`${this.name}.rp`, [p1, `${this.name}#p`], { r: this.rp }));
        if (this.rs > 0) circuit.add(new Resistor(`${this.name}.rs`, [s1, `${this.name}#s`], { r: this.rs }));
    }

    stamp(ctx) {
        const s = ctx.sys;
        const a = this.pa, b = this.n[1], c = this.sa, d = this.n[3];
        const b1 = this.br, b2 = this.br + 1;
        s.add(a, b1, 1); s.add(b, b1, -1);
        s.add(c, b2, 1); s.add(d, b2, -1);

        if (ctx.mode === "tran") {
            const trap = ctx.method === "trap";
            const f = (trap ? 2 : 1) / ctx.dt;
            const r11 = f * this.l1, r22 = f * this.l2, r12 = f * this.m;
            s.add(b1, a, 1); s.add(b1, b, -1); s.add(b1, b1, -r11); s.add(b1, b2, -r12);
            s.rhs(b1, -r11 * this.i1 - r12 * this.i2 - (trap ? this.v1 : 0));
            s.add(b2, c, 1); s.add(b2, d, -1); s.add(b2, b2, -r22); s.add(b2, b1, -r12);
            s.rhs(b2, -r22 * this.i2 - r12 * this.i1 - (trap ? this.v2 : 0));
        } else if (ctx.uic) {
            s.add(b1, b1, 1);
            s.add(b2, b2, 1);
        } else {
            s.add(b1, a, 1); s.add(b1, b, -1);
            s.add(b2, c, 1); s.add(b2, d, -1);
        }
    }

    stampAC(ac, omega) {
        const a = this.pa, b = this.n[1], c = this.sa, d = this.n[3];
        const b1 = this.br, b2 = this.br + 1;
        ac.add(a, b1, 1); ac.add(b, b1, -1);
        ac.add(c, b2, 1); ac.add(d, b2, -1);
        ac.add(b1, a, 1); ac.add(b1, b, -1);
        ac.add(b1, b1, 0, -omega * this.l1); ac.add(b1, b2, 0, -omega * this.m);
        ac.add(b2, c, 1); ac.add(b2, d, -1);
        ac.add(b2, b2, 0, -omega * this.l2); ac.add(b2, b1, 0, -omega * this.m);
    }

    initState(ctx) {
        this.i1 = ctx.uic ? 0 : ctx.x[this.br];
        this.i2 = ctx.uic ? 0 : ctx.x[this.br + 1];
        this.v1 = ctx.uic ? 0 : ctx.v(this.pa) - ctx.v(this.n[1]);
        this.v2 = ctx.uic ? 0 : ctx.v(this.sa) - ctx.v(this.n[3]);
    }

    accept(ctx) {
        this.i1 = ctx.x[this.br];
        this.i2 = ctx.x[this.br + 1];
        this.v1 = ctx.v(this.pa) - ctx.v(this.n[1]);
        this.v2 = ctx.v(this.sa) - ctx.v(this.n[3]);
    }

    current(x) { return x[this.br]; }
}


// ------------------------------------------------------------------ relay

// Coil (resistance + inductance) and a normally-open contact. nodes: [COIL+, COIL-, C1, C2].
// The contact closes when the coil current reaches `pull` and opens below `drop`.
class Relay extends Element {
    constructor(name, nodes, { rcoil = 100, lcoil = 50e-3, pull = 0.05, drop = 0.02, ron = 0.05, roff = 1e9 } = {}) {
        super(name, nodes);
        this.rcoil = rcoil;
        this.lcoil = lcoil;
        this.pull = pull;
        this.drop = drop;
        this.ron = ron;
        this.roff = roff;
        this.closed = false;
    }

    bind(circuit) {
        super.bind(circuit);
        const [cp, cn, c1, c2] = this.nodeNames;
        const mid = `${this.name}#m`;
        circuit.add(new Resistor(`${this.name}.r`, [cp, mid], { r: this.rcoil }));
        this.coil = circuit.add(new Inductor(`${this.name}.l`, [mid, cn], { l: this.lcoil }));
        this.contact = circuit.add(new Switch(`${this.name}.s`, [c1, c2], { closed: false, ron: this.ron, roff: this.roff }));
    }

    update(i) {
        const a = Math.abs(i);
        if (!this.closed && a >= this.pull) this.closed = true;
        else if (this.closed && a <= this.drop) this.closed = false;
        this.contact.closed = this.closed;
    }

    initState(ctx) { this.update(ctx.x[this.coil.br]); }
    accept(ctx) { this.update(ctx.x[this.coil.br]); }
    current(x) { return x[this.coil.br]; }
}


// ------------------------------------------------------------------- fuse

// A small resistance that opens for good once I^2 t exceeds its rating (rating^2 * tm).
class Fuse extends Element {
    constructor(name, nodes, { rating = 1, r = 0.01, tm = 0.02 } = {}) {
        super(name, nodes);
        this.rating = rating;
        this.r = r;
        this.limit = rating * rating * tm;
        this.blown = false;
        this.energy = 0;
    }

    get g() { return 1 / (this.blown ? 1e9 : this.r); }
    stamp(ctx) { ctx.sys.addG(this.n[0], this.n[1], this.g); }
    stampAC(ac) { ac.addY(this.n[0], this.n[1], this.g, 0); }
    initState() { this.blown = false; this.energy = 0; }

    accept(ctx) {
        if (this.blown || ctx.mode !== "tran") return;
        const i = (ctx.v(this.n[0]) - ctx.v(this.n[1])) * this.g;
        this.energy += i * i * ctx.dt;
        if (this.energy > this.limit) this.blown = true;
    }

    current(x) {
        const v = (i) => (i < 0 ? 0 : x[i]);
        return (v(this.n[0]) - v(this.n[1])) * this.g;
    }
}


// ------------------------------------------------------- SCR and TRIAC

// Latching thyristor. SCR nodes: [A, K, G]; TRIAC nodes: [MT1, MT2, G] (conducts either way).
// A gate current above igt turns it on while forward biased; it stays on until the current
// falls below the holding current. On-state: vf + i * ron.
class Thyristor extends Element {
    constructor(name, nodes, { triac = false, igt = 5e-3, ih = 10e-3, vf = 1.0, ron = 0.05, rg = 100 } = {}) {
        super(name, nodes);
        this.triac = triac;
        this.igt = igt;
        this.ih = ih;
        this.vf = vf;
        this.ron = ron;
        this.rg = rg;
        this.on = false;
        this.dir = 1;
        this.hasEvents = true;
    }

    // SCR: anode A = nodes[0], cathode K = nodes[1]. TRIAC: conduction runs MT2 -> MT1 for dir +1.
    ends() { return this.triac ? [this.n[1], this.n[0]] : [this.n[0], this.n[1]]; }
    ref() { return this.triac ? this.n[0] : this.n[1]; }

    stamp(ctx) {
        const [hi, lo] = this.ends();
        const s = ctx.sys;
        s.addG(this.n[2], this.ref(), 1 / this.rg);
        if (this.on) {
            const g = 1 / this.ron, vt = this.dir * this.vf;
            s.addG(hi, lo, g);
            s.rhs(hi, g * vt);
            s.rhs(lo, -g * vt);
        } else {
            s.addG(hi, lo, 1e-9);
        }
    }

    stampAC(ac) {
        const [hi, lo] = this.ends();
        ac.addY(this.n[2], this.ref(), 1 / this.rg, 0);
        ac.addY(hi, lo, this.on ? 1 / this.ron : 1e-9, 0);
    }

    nextState(ctx) {
        const [hi, lo] = this.ends();
        const vak = ctx.v(hi) - ctx.v(lo);
        const ig = (ctx.v(this.n[2]) - ctx.v(this.ref())) / this.rg;
        if (this.on) {
            const i = (vak - this.dir * this.vf) / this.ron * this.dir;
            return i < this.ih ? { on: false, dir: this.dir } : { on: true, dir: this.dir };
        }
        const fwd = this.triac ? Math.abs(vak) > this.vf : vak > this.vf;
        const trig = this.triac ? Math.abs(ig) > this.igt : ig > this.igt;
        return fwd && trig ? { on: true, dir: vak < 0 ? -1 : 1 } : { on: false, dir: this.dir };
    }

    wouldFlip(ctx) { return this.nextState(ctx).on !== this.on; }
    initState(ctx) { this.on = false; this.accept(ctx); }
    accept(ctx) { const n = this.nextState(ctx); this.on = n.on; this.dir = n.dir; }

    current(x) {
        const v = (i) => (i < 0 ? 0 : x[i]);
        if (!this.on) return 0;
        const [hi, lo] = this.ends();
        return (v(hi) - v(lo) - this.dir * this.vf) / this.ron;
    }
}


// ------------------------------------------------------ voltage regulator

// Three-terminal series regulator. nodes: [IN, OUT, GND]; the GND pin is the reference
// (for an LM317 it is the ADJ pin and vout is the 1.25 V reference). vout < 0 models a
// negative regulator (7905). Below vout + dropout the output follows the input down.
class Regulator extends NonlinearElement {
    constructor(name, nodes, { vout = 5, dropout = 2, ro = 0.05, iq = 5e-3, ilim = 1.5 } = {}) { // ilim is informational
        super(name, nodes);
        this.vout = vout;
        this.dropout = dropout;
        this.ro = ro;
        this.iq = iq;
        this.ilim = ilim;
    }

    // smooth min of (a, b): 0.5 (a + b - sqrt((a - b)^2 + eps^2))
    static softmin(a, b, eps = 0.05) {
        const r = Math.sqrt((a - b) * (a - b) + eps * eps);
        return { v: 0.5 * (a + b - r), da: 0.5 * (1 - (a - b) / r), db: 0.5 * (1 + (a - b) / r) };
    }

    stamp(ctx) {
        const [vi, vo, vg] = this.n;
        const s = ctx.sys;
        const neg = this.vout < 0;
        const vin = ctx.v(vi) - ctx.v(vg), vout = ctx.v(vo) - ctx.v(vg);

        // headroom-limited target relative to the reference pin
        const x = neg ? -vin - this.dropout : vin - this.dropout;
        const m = Regulator.softmin(Math.abs(this.vout), x);
        const rel = neg ? -m.v : m.v;
        const dRelDin = m.db; // d(rel)/d(vin) is db for either polarity (the two sign flips cancel)
        const G = 1 / this.ro;

        // current delivered into OUT from the pass element (IN -> OUT). There is no hard current
        // limit: a saturating characteristic stalls Newton's method from a cold start.
        const i = G * (rel - vout), di = 1;

        // linearise i(vin, vout, vgnd-relative): i depends on (vi, vo, vg) through vin = vi - vg, vout = vo - vg
        const dI_dvin = di * G * dRelDin, dI_dvout = -di * G;
        const cols = [vi, vo, vg];
        const J = [dI_dvin, dI_dvout, -(dI_dvin + dI_dvout)];
        const v0 = [ctx.v(vi), ctx.v(vo), ctx.v(vg)];
        const ieq = i - (J[0] * v0[0] + J[1] * v0[1] + J[2] * v0[2]);

        // OUT receives i; IN gives i up; the quiescent current iq runs IN -> GND
        for (let k = 0; k < 3; k++) {
            s.add(vo, cols[k], -J[k]);
            s.add(vi, cols[k], J[k]);
        }
        s.rhs(vo, ieq);
        s.rhs(vi, -ieq - this.iq);
        s.rhs(vg, this.iq);
        s.addG(vo, vg, ctx.gmin);

        this.keepForAC(cols, [
            [J[0], J[1], J[2]],
            [-J[0], -J[1], -J[2]],
            [0, 0, 0]
        ]);
        this.iNow = i;
    }

    stampAC(ac) { this.stampACJacobian(ac); }
    current() { return this.iNow || 0; }
}


// -------------------------------------------- current-controlled current source

// Output current gain * I(control) * tanh(v_out / vsat): a transistor-like output that saturates
// near 0 V instead of pushing a load below ground. The control is a voltage source whose branch
// current is the input (used for the optocoupler: a 0 V ammeter in series with its LED).
// nodes: [OUT+, OUT-]; current flows from OUT+ through the device to OUT-.
class CCCS extends NonlinearElement {
    constructor(name, nodes, { ctrl, gain = 1, vsat = 0.3 } = {}) {
        super(name, nodes);
        this.ctrlName = ctrl;
        this.gain = gain;
        this.vsat = vsat;
        this.th = 0;
        this.iOut = 0;
    }

    bind(circuit) {
        super.bind(circuit);
        this.ctrl = circuit.elements.find(e => e.name === this.ctrlName);
        if (!this.ctrl || !this.ctrl.branches) throw new Error(`${this.name}: control source ${this.ctrlName} not found`);
    }

    stamp(ctx) {
        const [a, b] = this.n;
        const br = this.ctrl.br;
        const iin = ctx.x ? ctx.x[br] : 0;
        const vo = ctx.v(a) - ctx.v(b);
        const th = Math.tanh(vo / this.vsat);
        const dth = (1 - th * th) / this.vsat;
        const k = this.gain;
        const i = k * iin * th;
        // i(iin, va, vb) linearised: columns br (control current), a, b
        const dI_br = k * th, dI_va = k * iin * dth, dI_vb = -dI_va;
        const ieq = i - (dI_br * iin + dI_va * ctx.v(a) + dI_vb * ctx.v(b));
        const s = ctx.sys;
        // current leaves node a and enters node b
        s.add(a, br, dI_br); s.add(a, a, dI_va); s.add(a, b, dI_vb);
        s.add(b, br, -dI_br); s.add(b, a, -dI_va); s.add(b, b, -dI_vb);
        s.rhs(a, -ieq); s.rhs(b, ieq);
        this.th = th; this.iOut = i;
        this.dI = [dI_br, dI_va, dI_vb];
    }

    stampAC(ac) {
        if (!this.dI) return;
        const [a, b] = this.n, br = this.ctrl.br;
        const [dBr, dA, dB] = this.dI;
        ac.add(a, br, dBr); ac.add(a, a, dA); ac.add(a, b, dB);
        ac.add(b, br, -dBr); ac.add(b, a, -dA); ac.add(b, b, -dB);
    }

    current() { return this.iOut; }
}


// ------------------------------------------------------------- digital ICs

// A 74xx / 4000-series chip from js/sim/logic-ics.js. Pins are sampled against vcc / 2, the chip's pure
// state machine is stepped when the engine accepts a time point, and the outputs are driven through ro
// toward 0 or vcc (or left floating for a three-state "Z"). Like the flip-flop it reports an event when
// anything would change, so the engine lands exactly on the clock edge before the new outputs appear.
// Inputs left open read as the chip's pull direction (see LogicIC.pullsUp). nodes follow LogicIC.pins(spec).
class DigitalIC extends Element {
    constructor(name, nodes, spec, { vcc = 5, ro = 50 } = {}) {
        super(name, nodes);
        this.spec = spec;
        this.pins = LogicIC.pins(spec);
        this.vcc = vcc;
        this.ro = ro;
        // nonlinear only so DC analyses iterate: with no clock the outputs follow the inputs, and the
        // solver has to settle that fixed point. Transient runs use the event-driven state instead.
        this.nonlinear = true;
        this.hasEvents = true;
        this.dcOut = null;
        // power-up outputs (inputs at their open-circuit levels) so the operating point already drives them
        const open = {};
        spec.left.forEach(pin => { open[pin] = LogicIC.pullsUp(spec, pin) ? 1 : 0; });
        const r = spec.step(spec.init(), open, open);
        this.st = r.st;
        this.out = r.out;
        this.prev = open;
    }

    levels(ctx) {
        const v = {};
        this.spec.left.forEach((pin, i) => { v[pin] = ctx.v(this.n[i]) > this.vcc / 2 ? 1 : 0; });
        return v;
    }

    stamp(ctx) {
        const s = ctx.sys, G = 1 / this.ro, gpu = 1e-6;
        const nl = this.spec.left.length;
        this.spec.left.forEach((pin, i) => {
            const node = this.n[i];
            if (LogicIC.pullsUp(this.spec, pin)) { s.add(node, node, gpu); s.rhs(node, gpu * this.vcc); }   // open input floats high
            else s.addG(node, -1, gpu);
        });
        let out = this.out;
        if (ctx.mode !== "tran") {
            const v = this.levels(ctx);
            out = this.spec.step(this.st, v, v).out;
            if (this.dcOut && JSON.stringify(out) !== JSON.stringify(this.dcOut)) ctx.noncon = true;   // keep iterating until it settles
            this.dcOut = out;
        }
        this.spec.right.forEach((pin, i) => {
            const lvl = out[pin];
            if (lvl === "Z" || lvl === undefined) return;
            const node = this.n[nl + i];
            s.add(node, node, G);
            s.rhs(node, G * (lvl ? this.vcc : 0));
        });
    }

    beginSolve() { this.dcOut = null; }

    // in AC the chip is a set of fixed levels: its outputs hold their node, inputs draw nothing
    stampAC(ac) {
        const nl = this.spec.left.length;
        this.spec.right.forEach((pin, i) => { if (this.out[pin] !== "Z") ac.addY(this.n[nl + i], -1, 1 / this.ro, 0); });
    }

    evaluate(ctx) { return this.spec.step(this.st, this.levels(ctx), this.prev); }

    wouldFlip(ctx) {
        const r = this.evaluate(ctx);
        return JSON.stringify(r.out) !== JSON.stringify(this.out) || JSON.stringify(r.st) !== JSON.stringify(this.st);
    }

    initState(ctx) {
        this.st = this.spec.init();
        const v = this.levels(ctx);
        this.prev = v;                                   // no edges at power-up
        const r = this.spec.step(this.st, v, v);
        this.st = r.st; this.out = r.out;
    }

    accept(ctx) {
        const r = this.evaluate(ctx);
        this.st = r.st; this.out = r.out;
        this.prev = this.levels(ctx);
    }
}


// ------------------------------------------------------------ flip-flops

// Edge-triggered flip-flop with asynchronous set / reset (active high).
// nodes: [D (or J), K, CLK, Q, QN, SET, RST]; kind "D", "T" or "JK". Floating inputs read low.
// The state changes on a rising clock edge; the engine bisects to the exact crossing.
class FlipFlop extends Element {
    constructor(name, nodes, kind = "D", { vcc = 5, ro = 50 } = {}) {
        super(name, nodes);
        this.kind = kind;
        this.vcc = vcc;
        this.ro = ro;
        this.q = 0;
        this.clkHigh = false;
        this.nonlinear = false;
        this.hasEvents = true;
    }

    high(ctx, node) { return ctx.v(node) > this.vcc / 2; }

    stamp(ctx) {
        const [dN, kN, clk, q, qn, set, rst] = this.n;
        const s = ctx.sys;
        const G = 1 / this.ro;
        for (const [node, target] of [[q, this.q], [qn, 1 - this.q]]) {
            s.add(node, node, G);
            s.rhs(node, G * target * this.vcc);
        }
        // floating inputs read low
        for (const node of [dN, kN, clk, set, rst]) s.addG(node, -1, 1e-6);
    }

    nextState(ctx) {
        const [dN, kN, clk, , , set, rst] = this.n;
        if (this.high(ctx, rst)) return 0;
        if (this.high(ctx, set)) return 1;
        const rising = !this.clkHigh && this.high(ctx, clk);
        if (!rising) return this.q;
        const d = this.high(ctx, dN) ? 1 : 0;
        if (this.kind === "T") return d ? 1 - this.q : this.q;
        if (this.kind === "JK") {
            const k = this.high(ctx, kN) ? 1 : 0;
            if (d && k) return 1 - this.q;
            if (d) return 1;
            if (k) return 0;
            return this.q;
        }
        return d;
    }

    wouldFlip(ctx) { return this.nextState(ctx) !== this.q; }

    initState(ctx) {
        this.q = 0;
        this.clkHigh = this.high(ctx, this.n[2]);
        this.q = this.high(ctx, this.n[5]) ? 1 : 0;
    }

    accept(ctx) {
        this.q = this.nextState(ctx);
        this.clkHigh = this.high(ctx, this.n[2]);
    }
}

// SPICE-style simulation engine: operating point, DC sweep, transient and AC.
//
//   const c = new SimCircuit();
//   c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.dc(5) }));
//   c.add(new Resistor("R1", ["in", "out"], { r: 1000 }));
//   c.add(new Diode("D1", ["out", "0"], simModel("D", "1N4148").params));
//   const sim = new SimEngine(c);
//   sim.operatingPoint().nodeVoltages   // { in: 5, out: 0.64, ... }
//
// Nonlinear circuits are solved by Newton-Raphson with SPICE-style junction
// limiting, falling back to gmin stepping and then source stepping.

class SimCircuit {
    constructor() {
        this.nodeIndex = new Map();
        this.names = [];
        this.elements = [];
        this.size = 0;
        this.nodeCount = 0;
        this.nonlinear = false;
    }

    node(name) {
        name = String(name);
        if (name === "0" || name.toLowerCase() === "gnd") return -1;
        if (!this.nodeIndex.has(name)) {
            this.nodeIndex.set(name, this.names.length);
            this.names.push(name);
        }
        return this.nodeIndex.get(name);
    }

    internalNode(label) {
        return this.node(label);
    }

    add(element) {
        this.elements.push(element);
        element.bind(this);
        return element;
    }

    finalize() {
        let n = this.names.length;
        this.nodeCount = n;
        for (const el of this.elements) {
            if (el.branches) { el.br = n; n += el.branches; }
        }
        this.size = n;
        this.nonlinear = this.elements.some(e => e.nonlinear);
        return this;
    }

    isInternal(name) { return name.includes("#"); }
}

class SimEngine {
    constructor(circuit, options = {}) {
        this.c = circuit.finalize();
        this.opt = Object.assign({
            reltol: 1e-3, vntol: 1e-6, abstol: 1e-12, maxIter: 100, gmin: SIM.GMIN, temp: 27
        }, options);
        if (this.opt.temp !== 27) {
            for (const el of this.c.elements) if (el.setTemperature) el.setTemperature(this.opt.temp);
        }
        this.sys = createSystem(this.c.size);
        this.lastOp = null;
    }

    // ---------------------------------------------------------------- helpers

    makeCtx(mode) {
        const ctx = {
            sys: this.sys, x: new Float64Array(this.c.size), mode,
            time: 0, dt: 0, method: "be", gmin: this.opt.gmin, srcScale: 1,
            uic: false, noncon: false
        };
        ctx.v = (i) => (i < 0 ? 0 : ctx.x[i]);
        return ctx;
    }

    describeIndex(i) {
        if (i < this.c.nodeCount) return `node "${this.c.names[i]}"`;
        const el = this.c.elements.find(e => e.branches && i >= e.br && i < e.br + e.branches);
        return el ? `the branch of ${el.name}` : "the circuit";
    }

    converged(x, xn) {
        const n = this.c.nodeCount;
        const { reltol, vntol, abstol } = this.opt;
        for (let i = 0; i < xn.length; i++) {
            const tol = (i < n ? vntol : abstol) + reltol * Math.max(Math.abs(x[i]), Math.abs(xn[i]));
            if (Math.abs(xn[i] - x[i]) > tol) return false;
        }
        return true;
    }

    // Newton-Raphson on the current ctx settings. Returns { ok, x, iters }.
    newton(ctx, xStart, maxIter = this.opt.maxIter) {
        const c = this.c, n = c.nodeCount, sys = this.sys;
        ctx.x = Float64Array.from(xStart);
        for (const el of c.elements) el.beginSolve(ctx);

        for (let iter = 1; iter <= maxIter; iter++) {
            ctx.noncon = false;
            sys.clear();
            for (let i = 0; i < n; i++) sys.add(i, i, ctx.gmin);
            for (const el of c.elements) el.stamp(ctx);
            if (ctx.nodeIC) {
                // .ic: pin these nodes while finding the initial state (a stiff source to ground)
                for (const [idx, v] of ctx.nodeIC) { sys.add(idx, idx, 1e3); sys.rhs(idx, 1e3 * v); }
            }

            let xn;
            try {
                xn = sys.solve();
            } catch (e) {
                if (e instanceof SingularMatrixError) {
                    throw new Error(`The circuit equations are singular near ${this.describeIndex(e.index)}. ` +
                        `Check for a floating node, a missing ground, or voltage sources forming a loop.`);
                }
                throw e;
            }
            if (!xn.every(Number.isFinite)) return { ok: false, x: ctx.x, iters: iter };

            if (!c.nonlinear) {
                ctx.x = xn;
                return { ok: true, x: xn, iters: iter };
            }

            const done = iter > 1 && !ctx.noncon && this.converged(ctx.x, xn);
            if (done) {
                ctx.x = xn;
                return { ok: true, x: xn, iters: iter };
            }

            ctx.x = xn;
        }
        return { ok: false, x: ctx.x, iters: maxIter };
    }

    snapshot(x) {
        const c = this.c;
        const nodeVoltages = { "0": 0 };
        c.names.forEach((name, i) => { if (!c.isInternal(name)) nodeVoltages[name] = x[i]; });
        const currents = {}, sourceCurrents = {};
        for (const el of c.elements) {
            if (el.name.includes(".")) continue;
            const i = el.current(x);
            currents[el.name] = i;
            if (el instanceof VoltageSource) sourceCurrents[el.name] = i;
        }
        return { nodeVoltages, currents, sourceCurrents };
    }

    // ------------------------------------------------------------ operating point

    // nodeIC: { nodeName: volts } applied only to the initial solve of a UIC transient
    operatingPoint({ uic = false, nodeIC = null } = {}) {
        const c = this.c;
        const ctx = this.makeCtx("op");
        ctx.uic = uic;
        if (uic && nodeIC) {
            ctx.nodeIC = Object.entries(nodeIC).map(([n, v]) => [c.node(n), v]).filter(([i]) => i >= 0);
            // capacitors without their own IC start at the voltage the .ic nodes imply
            const v0 = (i) => { const hit = ctx.nodeIC.find(([k]) => k === i); return hit ? hit[1] : 0; };
            for (const el of c.elements) if (el instanceof Capacitor) el.icDefault = v0(el.n[0]) - v0(el.n[1]);
        }
        const zero = new Float64Array(c.size);

        let r = this.newton(ctx, zero);
        let method = "newton";

        if (!r.ok) {
            // gmin stepping: start heavily damped, relax toward the real circuit
            let x = zero, ok = true;
            for (const g of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10, 1e-11, 1e-12]) {
                ctx.gmin = Math.max(g, this.opt.gmin);
                const s = this.newton(ctx, x, 60);
                if (!s.ok) { ok = false; break; }
                x = s.x;
            }
            ctx.gmin = this.opt.gmin;
            if (ok) { r = { ok: true, x, iters: 0 }; method = "gmin-stepping"; }
        }

        if (!r.ok) {
            // source stepping: ramp every independent source from 0 to full value
            let x = zero, ok = true;
            ctx.gmin = this.opt.gmin;
            for (let k = 1; k <= 25; k++) {
                ctx.srcScale = k / 25;
                const s = this.newton(ctx, x, 80);
                if (!s.ok) { ok = false; break; }
                x = s.x;
            }
            ctx.srcScale = 1;
            if (ok) { r = { ok: true, x, iters: 0 }; method = "source-stepping"; }
        }

        if (!r.ok) {
            throw new Error("DC operating point did not converge. Check bias networks, feedback and supply connections.");
        }

        // one clean stamp at the solution refreshes each device's small-signal data
        ctx.x = r.x;
        this.sys.clear();
        for (const el of c.elements) { el.beginSolve(ctx); el.stamp(ctx); }

        this.lastOp = { x: r.x, ctx };
        return Object.assign({ x: r.x, method, iterations: r.iters }, this.snapshot(r.x));
    }

    // ------------------------------------------------------------------ DC sweep

    // Sweep an independent source and record the node voltages at each point.
    dcSweep(sourceName, start, stop, step, progress = null) {
        const src = this.c.elements.find(e => e.name === sourceName &&
            (e instanceof VoltageSource || e instanceof CurrentSource));
        if (!src) throw new Error(`DC sweep: no source named ${sourceName}`);

        const original = src.wave;
        const ctx = this.makeCtx("op");
        const out = { sweep: [], nodeHistories: {}, currentHistories: {} };
        this.c.names.forEach(n => { if (!this.c.isInternal(n)) out.nodeHistories[n] = []; });
        this.c.elements.forEach(e => { if (!e.name.includes(".")) out.currentHistories[e.name] = []; });

        let x = new Float64Array(this.c.size);
        const count = Math.floor(Math.abs((stop - start) / step) + 1e-9);
        try {
            for (let k = 0; k <= count; k++) {
                if (progress && k % 8 === 0) progress(k / (count || 1));
                const v = start + k * step * Math.sign(stop - start || 1);
                src.wave = Waveform.dc(v);
                let r = this.newton(ctx, x);
                if (!r.ok) {
                    ctx.gmin = 1e-6;
                    r = this.newton(ctx, x, 80);
                    ctx.gmin = this.opt.gmin;
                    if (r.ok) r = this.newton(ctx, r.x);
                }
                if (!r.ok) throw new Error(`DC sweep did not converge at ${sourceName} = ${v}`);
                x = r.x;
                out.sweep.push(v);
                this.c.names.forEach((n, i) => { if (!this.c.isInternal(n)) out.nodeHistories[n].push(x[i]); });
                this.c.elements.forEach(e => { if (!e.name.includes(".")) out.currentHistories[e.name].push(e.current(x)); });
            }
        } finally {
            src.wave = original;
        }
        return out;
    }

    // ----------------------------------------------------------------- transient

    // Predictor-based local error estimate: how far the new solution is from a straight-line
    // extrapolation of the last two. > 1 means the step was too coarse for the waveform.
    lteRatio(xn, x1, x2, h, h1, tol) {
        if (!x2 || !(h1 > 0)) return 0;
        let worst = 0;
        for (let i = 0; i < this.c.nodeCount; i++) {
            const xp = x1[i] + (x1[i] - x2[i]) * (h / h1);
            const scale = tol * Math.max(Math.abs(xn[i]), Math.abs(x1[i])) + 1e-4;
            worst = Math.max(worst, Math.abs(xn[i] - xp) / scale);
        }
        return worst;
    }

    // tStep is the largest step; with adaptive on, the engine shortens it where the waveform
    // bends sharply and lands exactly on source edges and on comparator crossings.
    transient(opts = {}) {
        const run = new TransientRun(this, opts);
        while (!run.done) run.step();
        return run.result;
    }

    // Resumable version for live simulation: call run.step() repeatedly, read run.x / run.t.
    beginTransient(opts = {}) {
        return new TransientRun(this, Object.assign({ tStop: 20, record: false }, opts));
    }

    // ------------------------------------------------------------------------ AC

    ac({ fStart = 10, fStop = 1e6, pointsPerDecade = 20, progress = null } = {}) {
        const c = this.c;
        const op = this.operatingPoint();

        // Only sources with an AC magnitude excite the circuit. If none are marked,
        // treat each source as a unit-style stimulus using its DC value (legacy behaviour).
        const sources = c.elements.filter(e => e instanceof VoltageSource);
        const anyAc = sources.some(s => s.acMag > 0) || c.elements.some(e => e instanceof CurrentSource && e.acMag > 0);
        sources.forEach(s => { s.acActive = anyAc ? s.acMag > 0 : true; s._acFallback = !anyAc; });

        const stamper = new ComplexStamper(c.size);
        const n = c.nodeCount;
        const results = [];

        const decades = Math.log10(fStop / fStart);
        const count = Math.max(1, Math.round(decades * pointsPerDecade));

        for (let k = 0; k <= count; k++) {
            if (progress && k % 8 === 0) progress(k / count);
            const f = fStart * Math.pow(10, (k / count) * decades);
            const w = 2 * Math.PI * f;

            stamper.clear();
            for (let i = 0; i < n; i++) stamper.add(i, i, this.opt.gmin, 0);
            for (const el of c.elements) {
                el.stampAC(stamper, w);
                if (el instanceof VoltageSource && el._acFallback) {
                    // re-stamp the stimulus using the DC value as the magnitude
                    stamper.rhs(el.br, el.wave.dc, 0);
                }
            }

            let sol;
            try {
                sol = stamper.solve();
            } catch (e) {
                if (e instanceof SingularMatrixError) {
                    throw new Error(`AC matrix is singular near ${this.describeIndex(e.index % c.size)}.`);
                }
                throw e;
            }

            const nodeVoltages = { "0": new Complex(0, 0) };
            c.names.forEach((name, i) => {
                if (!c.isInternal(name)) nodeVoltages[name] = new Complex(sol.re[i], sol.im[i]);
            });

            const V = (i) => (i < 0 ? new Complex(0, 0) : new Complex(sol.re[i], sol.im[i]));
            const sourceCurrents = {};
            for (const el of c.elements) {
                if (el.name.includes(".")) continue;
                if (el instanceof VoltageSource || el instanceof Inductor) {
                    sourceCurrents[el.name] = V(el.br);
                } else if (el instanceof Resistor) {
                    sourceCurrents[el.name] = V(el.n[0]).sub(V(el.n[1])).mul(new Complex(1 / el.r, 0));
                } else if (el instanceof Capacitor) {
                    sourceCurrents[el.name] = V(el.n[0]).sub(V(el.n[1])).mul(new Complex(0, w * el.c));
                }
            }

            results.push({ frequency: f, nodeVoltages, sourceCurrents });
        }
        return results;
    }
}


// One transient analysis in progress. step() advances by one accepted time step.
class TransientRun {
    constructor(engine, { tStop = 0.01, tStep = 1e-5, method = "trap", uic = true, adaptive = true, lteTol = 0.02, nodeIC = null, record = true } = {}) {
        this.engine = engine;
        const c = engine.c;
        this.c = c;
        this.tStop = tStop;
        this.tStep = tStep;
        this.method = method;
        this.adaptive = adaptive;
        this.lteTol = lteTol;
        this.record = record;

        const op = engine.operatingPoint({ uic, nodeIC });
        this.x = op.x;

        this.ctx = engine.makeCtx("tran");
        this.ctx.x = this.x;
        this.ctx.uic = uic;
        for (const el of c.elements) el.initState(this.ctx);

        this.result = { timePoints: [0], nodeHistories: {}, currentHistories: {}, steps: 0, rejected: 0, events: 0 };
        if (record) {
            c.names.forEach(n => { if (!c.isInternal(n)) this.result.nodeHistories[n] = []; });
            c.elements.forEach(e => { if (!e.name.includes(".")) this.result.currentHistories[e.name] = []; });
            this.log();
        }

        this.breaks = [...new Set(c.elements.flatMap(e => e.breakpoints(tStop)))]
            .filter(t => t > 0 && t <= tStop).sort((a, b) => a - b);
        this.evEls = c.elements.filter(e => e.hasEvents);
        this.bi = 0;
        this.tEps = tStop * 1e-12;
        this.hMin = tStep * 1e-8;
        this.t = 0;
        this.afterBreak = true;
        this.dampSteps = 0;
        this.hNext = tStep;
        this.xPrev = null;
        this.hPrev = 0;
    }

    get done() { return this.t >= this.tStop - this.tEps; }

    log() {
        const { c, result, x } = this;
        c.names.forEach((n, i) => { if (!c.isInternal(n)) result.nodeHistories[n].push(x[i]); });
        c.elements.forEach(e => { if (!e.name.includes(".")) result.currentHistories[e.name].push(e.current(x)); });
    }

    // current voltage of a node / current through an element, for live displays
    voltage(node) {
        if (node === "0") return 0;
        const i = this.c.nodeIndex.get(String(node));
        return i === undefined ? 0 : this.x[i];
    }

    current(name) {
        const el = this.c.elements.find(e => e.name === name);
        return el ? el.current(this.x) : 0;
    }

    solve(hh, meth) {
        const ctx = this.ctx;
        ctx.mode = "tran";
        ctx.time = this.t + hh;
        ctx.dt = hh;
        ctx.method = meth;
        return this.engine.newton(ctx, this.x, 40);
    }

    flips(sol) {
        this.ctx.x = sol.x;
        return this.evEls.some(e => e.wouldFlip(this.ctx));
    }

    step() {
        const { engine, c, ctx, result, tEps, hMin, tStep } = this;
        let h = Math.min(this.hNext, this.tStop - this.t);
        while (this.bi < this.breaks.length && this.breaks[this.bi] <= this.t + tEps) this.bi++;
        let hitsBreak = false;
        if (this.bi < this.breaks.length && this.t + h >= this.breaks[this.bi] - tEps) {
            h = this.breaks[this.bi] - this.t;
            hitsBreak = true;
        }

        let r = null, shrink = 0, lteTries = 0, ratio = 0;
        for (;;) {
            r = this.solve(h, (this.afterBreak || shrink > 0 || lteTries > 0 || this.dampSteps > 0) ? "be" : this.method);
            if (!r.ok) {
                result.rejected++;
                h /= 4;
                hitsBreak = false;
                shrink++;
                if (h < hMin) {
                    throw new Error(`Transient analysis failed to converge at t = ${(this.t * 1e3).toPrecision(4)} ms (time step too small).`);
                }
                continue;
            }
            if (this.adaptive && !this.afterBreak && this.xPrev) {
                ratio = engine.lteRatio(r.x, this.x, this.xPrev, h, this.hPrev, this.lteTol);
                if (ratio > 1 && lteTries < 8 && h > tStep * 1e-3) {
                    h *= Math.max(0.2, 0.85 / Math.sqrt(ratio));
                    hitsBreak = false;
                    lteTries++;
                    result.rejected++;
                    continue;
                }
            }
            break;
        }

        // a comparator would change state during this step: find the crossing by bisection
        let hitEvent = false;
        if (this.evEls.length && this.flips(r)) {
            let lo = 0, hi = h;
            for (let it = 0; it < 12; it++) {
                const mid = (lo + hi) / 2;
                const rm = this.solve(mid, "be");
                if (!rm.ok) break;
                if (this.flips(rm)) hi = mid; else lo = mid;
            }
            h = hi;
            r = this.solve(h, "be"); // refresh companion state for the step that is accepted
            hitEvent = true;
            hitsBreak = false;
            result.events++;
        }

        // repeated error rejections mean the trapezoidal rule is ringing around a kink (a diode
        // switching off against an inductor); backward Euler damps that, so use it for a while
        if (lteTries >= 2) this.dampSteps = 12;
        else if (this.dampSteps > 0) this.dampSteps--;

        this.xPrev = this.x;
        this.hPrev = h;
        this.x = r.x;
        ctx.x = this.x;
        ctx.time = this.t + h;
        ctx.dt = h;
        for (const el of c.elements) el.accept(ctx);
        this.t += h;
        result.steps++;
        if (this.record) {
            result.timePoints.push(this.t);
            this.log();
        }

        this.afterBreak = hitsBreak || hitEvent;
        if (this.afterBreak) this.xPrev = null;
        // grow back toward the nominal step, faster when the waveform is smooth
        this.hNext = Math.min(tStep, h * (ratio < 0.3 ? 2 : 1.4));
        return h;
    }
}

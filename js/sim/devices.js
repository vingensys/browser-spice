// SPICE device models for the engine in engine.js.
//
// Every element stamps into a real MNA system:  A x = b,
//   x = [ node voltages ..., branch currents ... ].
// Sign convention: KCL rows sum the current LEAVING a node, so a device whose
// terminal current is I(V) contributes the Newton companion
//   J * v = J * v0 - I(v0)    ->  A += J,  b -= (I(v0) - J * v0).
//
// ctx = { sys, x, mode: "op" | "tran", time, dt, method: "be" | "trap",
//         gmin, srcScale, uic, noncon, v(i) }

const SIM = {
    K_OVER_Q: 8.617333262e-5,  // Boltzmann / charge (V per kelvin)
    VT: 8.617333262e-5 * 300.15, // kT/q at 27 C
    GMIN: 1e-12,
    Q: 1.602176634e-19,       // electron charge (C)
    K: 1.380649e-23,          // Boltzmann constant (J/K)
    EXP_MAX: 80
};

const safeExp = (x) => Math.exp(Math.min(x, SIM.EXP_MAX));

// SPICE3 pn-junction voltage limiter: stops Newton from jumping a forward-biased
// junction thousands of thermal voltages in one iteration.
function pnjlim(vnew, vold, vt, vcrit) {
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
        if (vold > 0) {
            const arg = 1 + (vnew - vold) / vt;
            vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
        } else {
            vnew = vt * Math.log(vnew / vt);
        }
    }
    return vnew;
}

// SPICE3 fetlim: limits gate-source voltage steps around the threshold.
function fetlim(vnew, vold, vto) {
    const vtsthi = Math.abs(2 * (vold - vto)) + 2;
    const vtstlo = vtsthi / 2 + 2;
    const vtox = vto + 3.5;
    const delv = vnew - vold;

    if (vold >= vto) {
        if (vold >= vtox) {
            if (delv <= 0) {
                if (vnew >= vtox) {
                    if (-delv > vtstlo) vnew = vold - vtstlo;
                } else {
                    vnew = Math.max(vnew, vto + 2);
                }
            } else if (delv >= vtsthi) {
                vnew = vold + vtsthi;
            }
        } else if (delv <= 0) {
            vnew = Math.max(vnew, vto - 0.5);
        } else {
            vnew = Math.min(vnew, vto + 4);
        }
    } else if (delv <= 0) {
        if (-delv > vtsthi) vnew = vold - vtsthi;
    } else {
        const vtemp = vto + 0.5;
        if (vnew <= vtemp) {
            if (delv > vtstlo) vnew = vold + vtstlo;
        } else {
            vnew = vtemp;
        }
    }
    return vnew;
}


// Junction depletion capacitance with the SPICE forward-bias linearisation
function depletionCap(v, cj0, vj, m, fc) {
    if (!(cj0 > 0)) return 0;
    if (v < fc * vj) return cj0 / Math.pow(1 - v / vj, m);
    return (cj0 / Math.pow(1 - fc, 1 + m)) * (1 - fc * (1 + m) + (m * v) / vj);
}

// Charge stored in the depletion capacitance (integral of depletionCap), so the
// transient solver can conserve charge instead of integrating C(v) dv/dt.
function depletionCharge(v, cj0, vj, m, fc) {
    if (!(cj0 > 0)) return 0;
    const vf = fc * vj;
    const base = (x) => (Math.abs(1 - m) < 1e-9
        ? -cj0 * vj * Math.log(1 - x / vj)
        : (cj0 * vj / (1 - m)) * (1 - Math.pow(1 - x / vj, 1 - m)));
    if (v < vf) return base(v);
    const f2 = Math.pow(1 - fc, 1 + m);
    return base(vf) + (cj0 / f2) * ((1 - fc * (1 + m)) * (v - vf) + (m / (2 * vj)) * (v * v - vf * vf));
}

// Add a nonlinear terminal-current linearisation: J is the Jacobian over `nodes`
// and Ieq the constant part of the companion current into each node.
function stampNonlinear(sys, nodes, J, Ieq) {
    for (let k = 0; k < nodes.length; k++) {
        for (let j = 0; j < nodes.length; j++) sys.add(nodes[k], nodes[j], J[k][j]);
        sys.rhs(nodes[k], -Ieq[k]);
    }
}


// ------------------------------------------------------------------ waveforms

const Waveform = {
    dc(v) {
        return { dc: v, at: () => v, breakpoints: () => [] };
    },

    sin({ offset = 0, amp = 1, freq = 1000, delay = 0, damp = 0, phase = 0 }) {
        const ph = (phase * Math.PI) / 180;
        return {
            dc: offset,
            at: (t) => {
                if (t < delay) return offset + amp * Math.sin(ph);
                const tt = t - delay;
                return offset + amp * Math.exp(-damp * tt) * Math.sin(2 * Math.PI * freq * tt + ph);
            },
            breakpoints: () => (delay > 0 ? [delay] : [])
        };
    },

    pulse({ v1 = 0, v2 = 5, delay = 0, rise = 1e-9, fall = 1e-9, width = 1e-3, period = 2e-3 }) {
        rise = Math.max(rise, 1e-12);
        fall = Math.max(fall, 1e-12);
        return {
            dc: v1,
            at: (t) => {
                if (t < delay) return v1;
                let tt = t - delay;
                if (period > 0) tt %= period;
                if (tt < rise) return v1 + (v2 - v1) * (tt / rise);
                if (tt < rise + width) return v2;
                if (tt < rise + width + fall) return v2 + (v1 - v2) * ((tt - rise - width) / fall);
                return v1;
            },
            breakpoints: (tStop) => {
                const pts = [];
                const per = period > 0 ? period : Infinity;
                for (let k = 0; delay + k * per <= tStop && k < 100000; k++) {
                    const base = delay + k * per;
                    pts.push(base, base + rise, base + rise + width, base + rise + width + fall);
                    if (!isFinite(per)) break;
                }
                return pts;
            }
        };
    },

    // SPICE EXP(v1 v2 td1 tau1 td2 tau2): exponential rise toward v2, then fall back toward v1
    exp({ v1 = 0, v2 = 5, td1 = 0, tau1 = 1e-3, td2 = 5e-3, tau2 = 1e-3 }) {
        tau1 = Math.max(tau1, 1e-12);
        tau2 = Math.max(tau2, 1e-12);
        return {
            dc: v1,
            at: (t) => {
                if (t < td1) return v1;
                let v = v1 + (v2 - v1) * (1 - Math.exp(-(t - td1) / tau1));
                if (t >= td2) v += (v1 - v2) * (1 - Math.exp(-(t - td2) / tau2));
                return v;
            },
            breakpoints: () => [td1, td2]
        };
    },

    // SPICE SFFM(vo va fc mdi fs): single-frequency FM
    sffm({ vo = 0, va = 1, fc = 10e3, mdi = 5, fs = 1e3 }) {
        return {
            dc: vo,
            at: (t) => vo + va * Math.sin(2 * Math.PI * fc * t + mdi * Math.sin(2 * Math.PI * fs * t)),
            breakpoints: () => []
        };
    },

    pwl(points) {
        const pts = points.slice().sort((a, b) => a[0] - b[0]);
        return {
            dc: pts.length ? pts[0][1] : 0,
            at: (t) => {
                if (!pts.length) return 0;
                if (t <= pts[0][0]) return pts[0][1];
                for (let i = 1; i < pts.length; i++) {
                    if (t <= pts[i][0]) {
                        const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
                        return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
                    }
                }
                return pts[pts.length - 1][1];
            },
            breakpoints: () => pts.map(p => p[0])
        };
    }
};


// ------------------------------------------------------------------- base

class Element {
    constructor(name, nodeNames) {
        this.name = name;
        this.nodeNames = nodeNames;
        this.n = [];
        this.branches = 0;
        this.br = -1;
        this.nonlinear = false;
    }

    bind(circuit) { this.n = this.nodeNames.map(nm => circuit.node(nm)); }
    beginSolve(ctx) { }
    stamp(ctx) { }
    stampAC(ac, omega) { }
    initState(ctx) { }
    accept(ctx) { }
    current(x) { return 0; }
    breakpoints(tStop) { return []; }
    // current-noise sources at the present operating point: [{ p, n, psd, label }], psd in A^2/Hz (null: noiseless)
    noiseSources(kT) { return []; }
}


// -------------------------------------------------------------- passive

class Resistor extends Element {
    constructor(name, nodes, { r }) {
        super(name, nodes);
        if (!(r > 0)) throw new Error(`${name}: resistance must be positive`);
        this.r = r;
    }
    stamp(ctx) { ctx.sys.addG(this.n[0], this.n[1], 1 / this.r); }
    stampAC(ac) { ac.addY(this.n[0], this.n[1], 1 / this.r, 0); }
    noiseSources(kT) { return [{ p: this.n[0], n: this.n[1], psd: 4 * kT / this.r, label: "thermal" }]; }
    current(x) { return (this.v(x, 0) - this.v(x, 1)) / this.r; }
    v(x, k) { return this.n[k] < 0 ? 0 : x[this.n[k]]; }
}

class Capacitor extends Element {
    // ic: explicit initial voltage. Without one a UIC start uses icDefault, which the engine
    // sets from any .ic node voltages (and is 0 otherwise), as SPICE does.
    constructor(name, nodes, { c, ic }) {
        super(name, nodes);
        this.c = c;
        this.ic = ic;
        this.icDefault = 0;
        this.vPrev = 0;
        this.iPrev = 0;
        this.geq = 0;
        this.ieq = 0;
    }

    stamp(ctx) {
        const [a, b] = this.n;
        if (ctx.mode === "tran") {
            const trap = ctx.method === "trap";
            this.geq = (trap ? 2 : 1) * this.c / ctx.dt;
            this.ieq = this.geq * this.vPrev + (trap ? this.iPrev : 0);
            ctx.sys.addG(a, b, this.geq);
            ctx.sys.rhs(a, this.ieq);
            ctx.sys.rhs(b, -this.ieq);
        } else if (ctx.uic) {
            // hold the node pair at the initial condition (a stiff voltage source)
            const g = 1e6;
            const v0 = this.ic !== undefined ? this.ic : this.icDefault;
            ctx.sys.addG(a, b, g);
            ctx.sys.rhs(a, g * v0);
            ctx.sys.rhs(b, -g * v0);
        }
    }

    stampAC(ac, omega) { ac.addY(this.n[0], this.n[1], 0, omega * this.c); }

    initState(ctx) {
        this.vPrev = ctx.uic ? (this.ic !== undefined ? this.ic : this.icDefault) : ctx.v(this.n[0]) - ctx.v(this.n[1]);
        this.iPrev = 0;
    }

    accept(ctx) {
        const v = ctx.v(this.n[0]) - ctx.v(this.n[1]);
        this.iPrev = this.geq * v - this.ieq;
        this.vPrev = v;
    }

    current() { return this.iPrev; }
}

class Inductor extends Element {
    constructor(name, nodes, { l, ic = 0 }) {
        super(name, nodes);
        this.l = l;
        this.ic = ic;
        this.branches = 1;
        this.iPrev = 0;
        this.vPrev = 0;
    }

    stamp(ctx) {
        const [a, b] = this.n;
        const br = this.br;
        const s = ctx.sys;
        s.add(a, br, 1);
        s.add(b, br, -1);

        if (ctx.mode === "tran") {
            const trap = ctx.method === "trap";
            const req = (trap ? 2 : 1) * this.l / ctx.dt;
            s.add(br, a, 1);
            s.add(br, b, -1);
            s.add(br, br, -req);
            s.rhs(br, -req * this.iPrev - (trap ? this.vPrev : 0));
        } else if (ctx.uic) {
            s.add(br, br, 1);
            s.rhs(br, this.ic);
        } else {
            // a DC short, with a nano-ohm of resistance so that loops of inductors and voltage sources (whose
            // currents are undetermined) stay solvable, as they do in SPICE
            s.add(br, a, 1);
            s.add(br, b, -1);
            s.add(br, br, -1e-9);
        }
    }

    stampAC(ac, omega) {
        const [a, b] = this.n;
        const br = this.br;
        ac.add(a, br, 1);
        ac.add(b, br, -1);
        ac.add(br, a, 1);
        ac.add(br, b, -1);
        ac.add(br, br, 0, -omega * this.l);
    }

    initState(ctx) {
        this.iPrev = ctx.uic ? this.ic : ctx.x[this.br];
        this.vPrev = ctx.uic ? 0 : ctx.v(this.n[0]) - ctx.v(this.n[1]);
    }

    accept(ctx) {
        this.iPrev = ctx.x[this.br];
        this.vPrev = ctx.v(this.n[0]) - ctx.v(this.n[1]);
    }

    current(x) { return x[this.br]; }
}


// -------------------------------------------------------------- sources

class VoltageSource extends Element {
    // wave: a Waveform; acMag/acPhase (deg) define the small-signal stimulus
    constructor(name, nodes, { wave, acMag = 0, acPhase = 0 }) {
        super(name, nodes);
        this.wave = wave;
        this.acMag = acMag;
        this.acPhase = acPhase;
        this.branches = 1;
        this.acActive = true;
    }

    value(ctx) {
        const v = ctx.mode === "tran" ? this.wave.at(ctx.time) : this.wave.dc;
        return v * (ctx.srcScale === undefined ? 1 : ctx.srcScale);
    }

    stamp(ctx) {
        const [a, b] = this.n;
        const br = this.br;
        ctx.sys.add(a, br, 1);
        ctx.sys.add(b, br, -1);
        ctx.sys.add(br, a, 1);
        ctx.sys.add(br, b, -1);
        ctx.sys.rhs(br, this.value(ctx));
    }

    stampAC(ac) {
        const [a, b] = this.n;
        const br = this.br;
        ac.add(a, br, 1);
        ac.add(b, br, -1);
        ac.add(br, a, 1);
        ac.add(br, b, -1);
        if (this.acActive) {
            const ph = (this.acPhase * Math.PI) / 180;
            ac.rhs(br, this.acMag * Math.cos(ph), this.acMag * Math.sin(ph));
        }
    }

    current(x) { return x[this.br]; }
    breakpoints(tStop) { return this.wave.breakpoints(tStop); }
}

class CurrentSource extends Element {
    // current flows from nodes[0] through the source to nodes[1]
    constructor(name, nodes, { wave, acMag = 0, acPhase = 0 }) {
        super(name, nodes);
        this.wave = wave;
        this.acMag = acMag;
        this.acPhase = acPhase;
        this.last = 0;
    }

    stamp(ctx) {
        const i = (ctx.mode === "tran" ? this.wave.at(ctx.time) : this.wave.dc) *
            (ctx.srcScale === undefined ? 1 : ctx.srcScale);
        this.last = i;
        ctx.sys.rhs(this.n[0], -i);
        ctx.sys.rhs(this.n[1], i);
    }

    stampAC(ac) {
        if (!this.acMag) return;
        const ph = (this.acPhase * Math.PI) / 180;
        const re = this.acMag * Math.cos(ph), im = this.acMag * Math.sin(ph);
        ac.rhs(this.n[0], -re, -im);
        ac.rhs(this.n[1], re, im);
    }

    current() { return this.last; }
    breakpoints(tStop) { return this.wave.breakpoints(tStop); }
}

// Ideal switch: a resistor that is ron when closed and roff when open. The state is a
// plain property, so the UI (or a script) can flip it between runs or during one.
class Switch extends Element {
    constructor(name, nodes, { closed = false, ron = 1e-3, roff = 1e9 } = {}) {
        super(name, nodes);
        this.closed = closed;
        this.ron = ron;
        this.roff = roff;
    }

    get g() { return 1 / (this.closed ? this.ron : this.roff); }
    stamp(ctx) { ctx.sys.addG(this.n[0], this.n[1], this.g); }
    stampAC(ac) { ac.addY(this.n[0], this.n[1], this.g, 0); }
    current(x) {
        const v = (i) => (i < 0 ? 0 : x[i]);
        return (v(this.n[0]) - v(this.n[1])) * this.g;
    }
}


// ------------------------------------------------ controlled sources (E / G)

class VCVS extends Element {
    // nodes: [out+, out-, ctrl+, ctrl-]; v(out) = gain * v(ctrl)
    constructor(name, nodes, { gain }) {
        super(name, nodes);
        this.gain = gain;
        this.branches = 1;
    }

    stampAny(add) {
        const [p, n, cp, cn] = this.n;
        const br = this.br;
        add(p, br, 1);
        add(n, br, -1);
        add(br, p, 1);
        add(br, n, -1);
        add(br, cp, -this.gain);
        add(br, cn, this.gain);
    }

    stamp(ctx) { this.stampAny((i, j, v) => ctx.sys.add(i, j, v)); }
    stampAC(ac) { this.stampAny((i, j, v) => ac.add(i, j, v, 0)); }
    current(x) { return x[this.br]; }
}

class VCCS extends Element {
    // nodes: [out+, out-, ctrl+, ctrl-]; current out+ -> out- = gm * v(ctrl)
    constructor(name, nodes, { gm }) {
        super(name, nodes);
        this.gm = gm;
        this.last = 0;
    }

    stampAny(add) {
        const [p, n, cp, cn] = this.n;
        add(p, cp, this.gm);
        add(p, cn, -this.gm);
        add(n, cp, -this.gm);
        add(n, cn, this.gm);
    }

    stamp(ctx) {
        this.stampAny((i, j, v) => ctx.sys.add(i, j, v));
        this.last = this.gm * (ctx.v(this.n[2]) - ctx.v(this.n[3]));
    }
    stampAC(ac) { this.stampAny((i, j, v) => ac.add(i, j, v, 0)); }
    current() { return this.last; }
}


// ------------------------------------------------------------ nonlinear base

// Shared handling for junction-style devices: stores the Jacobian from the last
// stamp so AC analysis can reuse the converged operating point.
class NonlinearElement extends Element {
    constructor(name, nodes) {
        super(name, nodes);
        this.nonlinear = true;
        this.acNodes = null;
        this.acJ = null;
    }

    keepForAC(nodes, J) {
        this.acNodes = nodes;
        this.acJ = J.map(row => row.slice());
    }

    stampACJacobian(ac) {
        if (!this.acJ) return;
        for (let k = 0; k < this.acNodes.length; k++) {
            for (let j = 0; j < this.acNodes.length; j++) {
                ac.add(this.acNodes[k], this.acNodes[j], this.acJ[k][j], 0);
            }
        }
    }
}


// -------------------------------------------------------------------- diode

class Diode extends NonlinearElement {
    // p: is, n, rs, bv, ibv, nbv, cjo, vj, m, fc, tt
    constructor(name, nodes, p = {}) {
        super(name, nodes);
        this.p = Object.assign({
            is: 1e-14, n: 1, rs: 0, bv: Infinity, ibv: 1e-3, nbv: 1,
            cjo: 0, vj: 0.7, m: 0.5, fc: 0.5, tt: 0, eg: 1.11, xti: 3, kf: 0, af: 1
        }, p);
        this.p0 = this.p;
        this.setTemperature(27);
        this.vd = 0;
        this.qPrev = 0;
        this.iPrev = 0;
        this.kk = 0;
        this.trap = false;
        this.hasCap = false;
        this.id = 0;
        this.gd = 0;
    }

    // SPICE temperature scaling of the saturation current and thermal voltage
    setTemperature(tC, tnomC = 27) {
        const T = tC + 273.15, Tn = tnomC + 273.15;
        this.vt = SIM.K_OVER_Q * T;
        const { n, eg = 1.11, xti = 3 } = this.p0;
        const ratio = T / Tn;
        const factlog = (ratio - 1) * eg / (n * this.vt) + (xti / n) * Math.log(ratio);
        this.p = Object.assign({}, this.p0, { is: this.p0.is * Math.exp(factlog) });
        this.vte = this.p.n * this.vt;
        this.vcrit = this.vte * Math.log(this.vte / (Math.SQRT2 * this.p.is));
        this.vcritBV = isFinite(this.p.bv)
            ? this.p.nbv * this.vt * Math.log(this.p.nbv * this.vt / (Math.SQRT2 * this.p.ibv))
            : Infinity;
    }

    bind(circuit) {
        super.bind(circuit);
        // internal anode node when there is series resistance
        this.ai = this.p.rs > 0 ? circuit.internalNode(`${this.name}#a`) : this.n[0];
        // a junction with no capacitance of its own gets a femtofarad, as simulators with a cmin option do: a node held only by
        // diode leakage (a floating transformer secondary between conductions) is otherwise a flat, exponential equation on
        // which Newton can cycle at any step size
        if (!(this.p.cjo > 0) && !(this.p.tt > 0)) circuit.add(new Capacitor(`${this.name}.cmin`, [this.p.rs > 0 ? `${this.name}#a` : this.nodeNames[0], this.nodeNames[1]], { c: 1e-15 }));
    }

    beginSolve(ctx) {
        this.vd = ctx.v(this.ai) - ctx.v(this.n[1]);
    }

    eval(vd) {
        const { is, bv, ibv, nbv } = this.p;
        let id, gd;
        if (vd >= -5 * this.vte) {
            const e = safeExp(vd / this.vte);
            id = is * (e - 1);
            gd = (is * e) / this.vte;
        } else {
            id = -is;
            gd = 0;
        }
        if (isFinite(bv)) {
            const vtb = nbv * this.vt;
            const arg = -(vd + bv) / vtb;
            if (arg > -30) {
                const e = safeExp(arg);
                id -= ibv * e;
                gd += (ibv * e) / vtb;
            }
        }
        return { id, gd };
    }

    limit(vnew) {
        let v = pnjlim(vnew, this.vd, this.vte, this.vcrit);
        if (isFinite(this.p.bv) && v < -this.p.bv + 10 * this.p.nbv * this.vt) {
            const vtb = this.p.nbv * this.vt;
            let t = -(v + this.p.bv);
            const told = -(this.vd + this.p.bv);
            t = pnjlim(t, told, vtb, this.vcritBV);
            v = -(t + this.p.bv);
        }
        return v;
    }

    junctionCap(vd, gd) {
        const { cjo, vj, m, fc, tt } = this.p;
        return depletionCap(vd, cjo, vj, m, fc) + tt * gd;
    }

    // stored charge: depletion + diffusion (transit time * forward current)
    charge(vd) {
        const { cjo, vj, m, fc, tt, is } = this.p;
        let q = depletionCharge(vd, cjo, vj, m, fc);
        if (tt > 0) q += tt * is * (safeExp(vd / this.vte) - 1);
        return q;
    }

    stamp(ctx) {
        const a = this.n[0], k = this.n[1], ai = this.ai;
        const s = ctx.sys;

        if (this.p.rs > 0) s.addG(a, ai, 1 / this.p.rs);

        const vdRaw = ctx.v(ai) - ctx.v(k);
        const vd = this.limit(vdRaw);
        if (Math.abs(vd - vdRaw) > 1e-12) ctx.noncon = true;
        this.vd = vd;

        const { id, gd } = this.eval(vd);
        const g = gd + ctx.gmin;
        const ieq = id - gd * vd;
        this.id = id;
        this.gd = g;

        s.addG(ai, k, g);
        s.rhs(ai, -ieq);
        s.rhs(k, ieq);

        this.hasCap = this.p.cjo > 0 || this.p.tt > 0;
        if (ctx.mode === "tran" && this.hasCap) {
            const trap = ctx.method === "trap";
            const kk = (trap ? 2 : 1) / ctx.dt;
            const gdf = (this.p.is * safeExp(vd / this.vte)) / this.vte;
            const c = this.junctionCap(vd, gdf);
            const i0 = kk * (this.charge(vd) - this.qPrev) - (trap ? this.iPrev : 0);
            const geq = kk * c;
            const ieqc = i0 - geq * vd;
            this.kk = kk;
            this.trap = trap;
            s.addG(ai, k, geq);
            s.rhs(ai, -ieqc);
            s.rhs(k, ieqc);
        }

        this.keepForAC([ai, k], [[g, -g], [-g, g]]);
    }

    noiseSources(kT) {
        const out = [{ p: this.ai, n: this.n[1], psd: 2 * SIM.Q * Math.abs(this.id), label: "shot" }];
        if (this.p.kf > 0) out.push({ p: this.ai, n: this.n[1], psd: 0, flicker: this.p.kf * Math.pow(Math.abs(this.id), this.p.af === undefined ? 1 : this.p.af), label: "flicker" });
        if (this.p.rs > 0) out.push({ p: this.n[0], n: this.ai, psd: 4 * kT / this.p.rs, label: "rs thermal" });
        return out;
    }

    stampAC(ac, omega) {
        if (this.p.rs > 0) ac.addY(this.n[0], this.ai, 1 / this.p.rs, 0);
        const g = this.gd || SIM.GMIN;
        const c = this.junctionCap(this.vd, Math.max(0, g - SIM.GMIN));
        ac.addY(this.ai, this.n[1], g, omega * c);
    }

    initState(ctx) {
        this.vd = ctx.v(this.ai) - ctx.v(this.n[1]);
        this.qPrev = this.charge(this.vd);
        this.iPrev = 0;
    }

    accept(ctx) {
        if (!this.hasCap) return;
        const v = ctx.v(this.ai) - ctx.v(this.n[1]);
        const q = this.charge(v);
        this.iPrev = this.kk * (q - this.qPrev) - (this.trap ? this.iPrev : 0);
        this.qPrev = q;
    }

    current(x) {
        const v = (this.ai < 0 ? 0 : x[this.ai]) - (this.n[1] < 0 ? 0 : x[this.n[1]]);
        return this.eval(v).id + SIM.GMIN * v;
    }
}


// --------------------------------------------------------------------- BJT

class BJT extends NonlinearElement {
    // nodes: [B, C, E]; polarity +1 NPN, -1 PNP
    // p: is, bf, br, nf, nr, vaf, var, ikf, ikr, ise, ne, isc, nc, rb, rc, re, cje, vje, mje, cjc, vjc, mjc, tf, tr, fc
    // (Gummel-Poon: forward / reverse Early voltage, high-injection knees, B-E / B-C leakage, series resistances)
    constructor(name, nodes, polarity, p = {}) {
        super(name, nodes);
        this.pol = polarity;
        this.p = Object.assign({
            is: 1e-16, bf: 100, br: 1, nf: 1, nr: 1, vaf: 0, var: 0, ikf: 0, ikr: 0, ise: 0, ne: 1.5, isc: 0, nc: 2, rb: 0, rc: 0, re: 0,
            cje: 0, vje: 0.75, mje: 0.33, cjc: 0, vjc: 0.75, mjc: 0.33, tf: 0, tr: 0, fc: 0.5,
            eg: 1.11, xti: 3, xtb: 0, kf: 0, af: 1, xtf: 0, vtf: 0, itf: 0, irb: 0
        }, p);
        if (this.p.rbm === undefined || this.p.rbm > this.p.rb) this.p.rbm = this.p.rb;       // RBM defaults to RB (no bias dependence)
        this.p0 = this.p;
        this.qbLast = 1; this.ibLast = 0;
        this.setTemperature(27);
        this.vbe = 0;
        this.vbc = 0;
        this.ic = 0;
        this.ib = 0;
        this.hasCaps = this.p.cje > 0 || this.p.cjc > 0 || this.p.tf > 0 || this.p.tr > 0;
        // charge state for the B-E and B-C capacitances (NPN-equivalent coordinates)
        this.cs = [
            { qPrev: 0, iPrev: 0, kk: 0, trap: false },
            { qPrev: 0, iPrev: 0, kk: 0, trap: false }
        ];
    }

    bind(circuit) {
        super.bind(circuit);
        const p = this.p0;
        // series resistances sit between the pin and an internal node
        this.nn = [
            p.rb > 0 ? circuit.internalNode(`${this.name}#b`) : this.n[0],
            p.rc > 0 ? circuit.internalNode(`${this.name}#c`) : this.n[1],
            p.re > 0 ? circuit.internalNode(`${this.name}#e`) : this.n[2]
        ];
    }

    setTemperature(tC, tnomC = 27) {
        const T = tC + 273.15, Tn = tnomC + 273.15;
        const vt = SIM.K_OVER_Q * T;
        const { eg, xti, xtb } = this.p0;
        const ratio = T / Tn, ratlog = Math.log(ratio);
        const factor = Math.exp((ratio - 1) * eg / vt + xti * ratlog);
        const bfactor = Math.exp(ratlog * xtb);
        this.p = Object.assign({}, this.p0, {
            is: this.p0.is * factor, bf: this.p0.bf * bfactor, br: this.p0.br * bfactor,
            ise: this.p0.ise * Math.exp((ratio - 1) * eg / (this.p0.ne * vt) + (xti / this.p0.ne) * ratlog) / bfactor,
            isc: this.p0.isc * Math.exp((ratio - 1) * eg / (this.p0.nc * vt) + (xti / this.p0.nc) * ratlog) / bfactor
        });
        this.vte = this.p.ne * vt;
        this.vtc = this.p.nc * vt;
        this.vtf = this.p.nf * vt;
        this.vtr = this.p.nr * vt;
        this.vcritF = this.vtf * Math.log(this.vtf / (Math.SQRT2 * this.p.is));
        this.vcritR = this.vtr * Math.log(this.vtr / (Math.SQRT2 * this.p.is));
    }

    beginSolve(ctx) {
        const [b, c, e] = this.nn;
        this.vbe = this.pol * (ctx.v(b) - ctx.v(e));
        this.vbc = this.pol * (ctx.v(b) - ctx.v(c));
    }

    // currents and derivatives for the NPN-equivalent device (Gummel-Poon, as in SPICE3 / ngspice)
    eval(vbe, vbc) {
        const { is, bf, br, vaf, var: vr, ikf, ikr, ise, isc } = this.p;
        const ef = safeExp(vbe / this.vtf), er = safeExp(vbc / this.vtr);
        const cbe = is * (ef - 1), cbc = is * (er - 1);
        const gbe = (is * ef) / this.vtf, gbc = (is * er) / this.vtr;
        let cben = 0, gben = 0, cbcn = 0, gbcn = 0;
        if (ise > 0) { const e2 = safeExp(vbe / this.vte); cben = ise * (e2 - 1); gben = (ise * e2) / this.vte; }
        if (isc > 0) { const e2 = safeExp(vbc / this.vtc); cbcn = isc * (e2 - 1); gbcn = (isc * e2) / this.vtc; }

        // base charge: Early effect (q1) and high injection (q2)
        const ivaf = vaf > 0 ? 1 / vaf : 0, ivar = vr > 0 ? 1 / vr : 0;
        let d1 = 1 - vbc * ivaf - vbe * ivar, dq1be, dq1bc, q1;
        if (d1 < 0.1) { d1 = 0.1; q1 = 10; dq1be = 0; dq1bc = 0; }
        else { q1 = 1 / d1; dq1be = q1 * q1 * ivar; dq1bc = q1 * q1 * ivaf; }
        const ikfi = ikf > 0 ? 1 / ikf : 0, ikri = ikr > 0 ? 1 / ikr : 0;
        const q2 = cbe * ikfi + cbc * ikri, dq2be = gbe * ikfi, dq2bc = gbc * ikri;
        const root = Math.sqrt(1 + 4 * Math.max(q2, 0));
        const qb = (q1 * (1 + root)) / 2;
        const dqbe = (q1 * dq2be) / root + (dq1be * (1 + root)) / 2, dqbc = (q1 * dq2bc) / root + (dq1bc * (1 + root)) / 2;

        const ic = (cbe - cbc) / qb - cbc / br - cbcn;
        const ib = cbe / bf + cben + cbc / br + cbcn;
        return {
            ic, ib, gF: gbe, gR: gbc, qb, cbe, dqbe, dqbc,
            dIc_dbe: (gbe - ((cbe - cbc) * dqbe) / qb) / qb,
            dIc_dbc: (-gbc - ((cbe - cbc) * dqbc) / qb) / qb - gbc / br - gbcn,
            dIb_dbe: gbe / bf + gben,
            dIb_dbc: gbc / br + gbcn
        };
    }

    // B-E and B-C stored charge (NPN-equivalent coordinates), capacitance dQ/dV and, for B-E, the transcapacitance
    // dQbe/dVbc: depletion + diffusion (transit time * junction current). The transit time grows with bias as in
    // SPICE3 / ngspice: TF * (1 + XTF * exp(Vbc / 1.44 VTF) * (If / (If + ITF))^2), and the charge is scaled by qb.
    charges(vbe, vbc, m) {
        const { cje, vje, mje, cjc, vjc, mjc, tf, tr, fc, is, xtf, vtf, itf } = this.p;
        const iF = is * (safeExp(vbe / this.vtf) - 1);
        const iR = is * (safeExp(vbc / this.vtr) - 1);
        let argtf = 0, arg2 = 0, arg3 = 0;
        if (tf > 0 && vbe > 0 && xtf) {
            argtf = xtf;
            const vinv = vtf ? 1 / (1.44 * vtf) : 0;
            if (vtf) argtf *= safeExp(vbc * vinv);
            arg2 = argtf;
            if (itf) { const t = iF / (iF + itf); argtf *= t * t; arg2 = argtf * (3 - 2 * t); }
            arg3 = iF * argtf * vinv;
        }
        const iFmod = (iF * (1 + argtf)) / m.qb;
        return [
            { q: depletionCharge(vbe, cje, vje, mje, fc) + tf * iFmod,
              c: depletionCap(vbe, cje, vje, mje, fc) + (tf * (m.gF * (1 + arg2) - iFmod * m.dqbe)) / m.qb,
              cx: (tf * (arg3 - iFmod * m.dqbc)) / m.qb },
            { q: depletionCharge(vbc, cjc, vjc, mjc, fc) + tr * iR, c: depletionCap(vbc, cjc, vjc, mjc, fc) + tr * m.gR, cx: 0 }
        ];
    }

    // base resistance with current crowding (IRB) and the base-charge dependence (RB - RBM modulated by 1/qb), as in
    // SPICE3: it follows the previous iteration's base current and qb
    baseResistance() {
        const { rb, rbm, irb } = this.p;
        if (!(rb > 0)) return 0;
        const rpr = rbm, rpi = rb - rbm;
        if (rpi <= 0) return rb;
        if (!(irb > 0)) return rpr + rpi / this.qbLast;
        const x = Math.max(Math.abs(this.ibLast) / irb, 1e-9);
        const z = (-1 + Math.sqrt(1 + 14.59025 * x)) / (2.4317 * Math.sqrt(x)), t = Math.tan(z);
        return rpr + (3 * rpi * (t - z)) / (z * t * t);
    }

    capacitances(vbe, vbc, m) {
        return this.charges(vbe, vbc, m).map(x => x.c);
    }

    stamp(ctx) {
        const [b, c, e] = this.nn;
        const p = this.pol;
        const rp = this.p;
        if (rp.rb > 0) { this.rbb = this.baseResistance(); ctx.sys.addG(this.n[0], b, 1 / this.rbb); }
        if (rp.rc > 0) ctx.sys.addG(this.n[1], c, 1 / rp.rc);
        if (rp.re > 0) ctx.sys.addG(this.n[2], e, 1 / rp.re);

        const rawBE = p * (ctx.v(b) - ctx.v(e));
        const rawBC = p * (ctx.v(b) - ctx.v(c));
        const vbe = pnjlim(rawBE, this.vbe, this.vtf, this.vcritF);
        const vbc = pnjlim(rawBC, this.vbc, this.vtr, this.vcritR);
        if (Math.abs(vbe - rawBE) > 1e-12 || Math.abs(vbc - rawBC) > 1e-12) ctx.noncon = true;
        this.vbe = vbe;
        this.vbc = vbc;

        const m = this.eval(vbe, vbc);
        this.ic = p * m.ic;
        this.ib = p * m.ib;
        this.qbLast = m.qb; this.ibLast = m.ib;

        // terminal order: B, C, E.  Derivatives w.r.t. (vbe, vbc) -> node voltages.
        const dB = [m.dIb_dbe, m.dIb_dbc];
        const dC = [m.dIc_dbe, m.dIc_dbc];
        const dE = [-(m.dIc_dbe + m.dIb_dbe), -(m.dIc_dbc + m.dIb_dbc)];
        const rows = [dB, dC, dE];
        const cur = [m.ib, m.ic, -(m.ic + m.ib)];

        const J = [], Ieq = [];
        for (let k = 0; k < 3; k++) {
            const [a1, a2] = rows[k];
            // node voltage derivatives: vbe = vb - ve, vbc = vb - vc
            J.push([a1 + a2, -a2, -a1]);
            Ieq.push(p * (cur[k] - a1 * vbe - a2 * vbc));
        }
        // add gmin across the junctions for robustness
        const g = ctx.gmin;
        J[0][0] += 2 * g; J[0][1] -= g; J[0][2] -= g;
        J[1][0] -= g; J[1][1] += g;
        J[2][0] -= g; J[2][2] += g;

        stampNonlinear(ctx.sys, [b, c, e], J, Ieq);
        this.keepForAC([b, c, e], J);

        if (this.hasCaps && ctx.mode === "tran") {
            const trap = ctx.method === "trap";
            const kk = (trap ? 2 : 1) / ctx.dt;
            const ch = this.charges(vbe, vbc, m);
            [[b, e, vbe], [b, c, vbc]].forEach(([n1, n2, vnpn], i) => {
                const st = this.cs[i];
                const geq = kk * ch[i].c, gx = kk * ch[i].cx;
                // current in NPN coordinates; terminal current flips sign for PNP
                const iAct = p * (kk * (ch[i].q - st.qPrev) - (trap ? st.iPrev : 0));
                let ieqc = iAct - geq * (p * vnpn);
                ctx.sys.addG(n1, n2, geq);
                if (gx) {                                   // dQbe / dVbc: a current b -> e driven by V(b) - V(c)
                    ieqc -= p * gx * vbc;
                    ctx.sys.add(b, b, gx); ctx.sys.add(b, c, -gx); ctx.sys.add(e, b, -gx); ctx.sys.add(e, c, gx);
                }
                ctx.sys.rhs(n1, -ieqc);
                ctx.sys.rhs(n2, ieqc);
                st.kk = kk;
                st.trap = trap;
            });
        }
    }

    noiseSources(kT) {
        const [b, c, e] = this.nn, rp = this.p;
        const out = [{ p: c, n: e, psd: 2 * SIM.Q * Math.abs(this.ic), label: "collector shot" }, { p: b, n: e, psd: 2 * SIM.Q * Math.abs(this.ib), label: "base shot" }];
        if (rp.kf > 0) out.push({ p: b, n: e, psd: 0, flicker: rp.kf * Math.pow(Math.abs(this.ib), rp.af === undefined ? 1 : rp.af), label: "flicker" });
        if (rp.rb > 0) out.push({ p: this.n[0], n: b, psd: 4 * kT / (this.rbb || rp.rb), label: "rb thermal" });
        if (rp.rc > 0) out.push({ p: this.n[1], n: c, psd: 4 * kT / rp.rc, label: "rc thermal" });
        if (rp.re > 0) out.push({ p: this.n[2], n: e, psd: 4 * kT / rp.re, label: "re thermal" });
        return out;
    }

    stampAC(ac, omega) {
        const rp = this.p;
        if (rp.rb > 0) ac.addY(this.n[0], this.nn[0], 1 / (this.rbb || rp.rb), 0);
        if (rp.rc > 0) ac.addY(this.n[1], this.nn[1], 1 / rp.rc, 0);
        if (rp.re > 0) ac.addY(this.n[2], this.nn[2], 1 / rp.re, 0);
        this.stampACJacobian(ac);
        if (!this.hasCaps) return;
        const [b, c, e] = this.nn;
        const m = this.eval(this.vbe, this.vbc);
        const ch = this.charges(this.vbe, this.vbc, m);
        ac.addY(b, e, 0, omega * ch[0].c);
        ac.addY(b, c, 0, omega * ch[1].c);
        // the transit charge also depends on vbc (Early effect, XTF / VTF): a transcapacitance
        if (this.p.tf > 0) {
            const cx = ch[0].cx;
            if (cx) { ac.add(b, b, 0, omega * cx); ac.add(b, c, 0, -omega * cx); ac.add(e, b, 0, -omega * cx); ac.add(e, c, 0, omega * cx); }
        }
    }

    npnVoltages(ctx) {
        const [b, c, e] = this.nn;
        return [this.pol * (ctx.v(b) - ctx.v(e)), this.pol * (ctx.v(b) - ctx.v(c))];
    }

    initState(ctx) {
        if (!this.hasCaps) return;
        const [vbe, vbc] = this.npnVoltages(ctx);
        const ch = this.charges(vbe, vbc, this.eval(vbe, vbc));
        this.cs.forEach((st, i) => { st.qPrev = ch[i].q; st.iPrev = 0; });
    }

    accept(ctx) {
        if (!this.hasCaps) return;
        const [vbe, vbc] = this.npnVoltages(ctx);
        const ch = this.charges(vbe, vbc, this.eval(vbe, vbc));
        this.cs.forEach((st, i) => {
            st.iPrev = st.kk * (ch[i].q - st.qPrev) - (st.trap ? st.iPrev : 0);
            st.qPrev = ch[i].q;
        });
    }

    current(x) {
        const v = (i) => (i < 0 ? 0 : x[i]);
        const m = this.eval(this.pol * (v(this.nn[0]) - v(this.nn[2])), this.pol * (v(this.nn[0]) - v(this.nn[1])));
        return this.pol * m.ic; // collector current
    }
}


// ------------------------------------------------------------------ MOSFET

class MOSFET extends NonlinearElement {
    // nodes: [G, D, S] or [G, D, S, B]; polarity +1 NMOS, -1 PMOS. SPICE level 1:
    // p: vto (threshold of the NMOS-equivalent device, so it is negative for depletion types), beta (kp*W/L), lambda,
    //    gamma, phi (body effect), rd, rs, isb (bulk junction saturation current), pb, cbd, cbs, cj, cjsw, mj, mjsw, fc,
    //    cgso, cgdo, cgbo (overlap, per metre of W / L), tox (> 0 switches the Meyer gate capacitances on), w, l, ad, as, pd, ps
    constructor(name, nodes, polarity, p = {}) {
        super(name, nodes);
        this.pol = polarity;
        this.p = Object.assign({
            vto: 2, beta: 0.02, lambda: 0.01, rd: 0, rs: 0, gamma: 0, phi: 0.6, isb: 0, pb: 0.8, cbd: 0, cbs: 0, cj: 0, cjsw: 0, mj: 0.5, mjsw: 0.33, fc: 0.5,
            cgso: 0, cgdo: 0, cgbo: 0, tox: 0, w: 1e-4, l: 1e-4, ad: 0, as: 0, pd: 0, ps: 0
        }, p);
        this.vgs = 0;
        this.id = 0;
        this.von = this.p.vto;
        this.vbsj = 0; this.vbdj = 0;
        this.cs = {};
    }

    bind(circuit) {
        super.bind(circuit);
        const [g, d, s] = this.nodeNames;
        const p = this.p;
        // series drain / source resistance sits between the pin and an internal node
        this.di = p.rd > 0 ? circuit.internalNode(`${this.name}#d`) : this.n[1];
        this.si = p.rs > 0 ? circuit.internalNode(`${this.name}#s`) : this.n[2];
        this.nb = this.nodeNames.length > 3 ? this.n[3] : this.n[2];       // an unwired body is tied to the source
        if (p.bodyDiode) {
            const pins = this.pol > 0 ? [s, d] : [d, s];
            circuit.add(new Diode(`${this.name}.bd`, pins, p.bodyDiode));
        }
        if (p.cgs > 0) circuit.add(new Capacitor(`${this.name}.cgs`, [g, s], { c: p.cgs }));
        if (p.cgd > 0) circuit.add(new Capacitor(`${this.name}.cgd`, [g, d], { c: p.cgd }));
        // constant overlap capacitances
        this.covGS = p.cgso * p.w; this.covGD = p.cgdo * p.w; this.covGB = p.cgbo * p.l;
        this.cox = p.tox > 0 ? (3.9 * 8.854187817e-12 / p.tox) * p.w * p.l : 0;
        // junction capacitance: the zero-bias value given directly, else area and sidewall terms (own grading exponents)
        this.cjbs = p.cbs > 0 ? p.cbs : p.cj * p.as; this.cjbd = p.cbd > 0 ? p.cbd : p.cj * p.ad;
        this.cswbs = p.cbs > 0 ? 0 : p.cjsw * p.ps; this.cswbd = p.cbd > 0 ? 0 : p.cjsw * p.pd;
        this.hasCaps = this.covGS > 0 || this.covGD > 0 || this.covGB > 0 || this.cox > 0 || this.cjbs > 0 || this.cjbd > 0 || this.cswbs > 0 || this.cswbd > 0;
        this.vt = SIM.VT;
        this.vcrit = this.vt * Math.log(this.vt / (Math.SQRT2 * Math.max(p.isb, 1e-30)));
    }

    setTemperature(tC) {
        this.vt = SIM.K_OVER_Q * (tC + 273.15);
        this.vcrit = this.vt * Math.log(this.vt / (Math.SQRT2 * Math.max(this.p.isb, 1e-30)));
    }

    // NMOS-equivalent voltages at the internal terminals
    volts(ctx) {
        const p = this.pol, g = this.n[0], d = this.di, s = this.si, b = this.nb;
        return { vgs: p * (ctx.v(g) - ctx.v(s)), vds: p * (ctx.v(d) - ctx.v(s)), vbs: p * (ctx.v(b) - ctx.v(s)), vbd: p * (ctx.v(b) - ctx.v(d)) };
    }

    beginSolve(ctx) {
        const v = this.volts(ctx);
        this.vgs = v.vgs;
        this.vbsj = v.vbs; this.vbdj = v.vbd;
    }

    // forward-mode level-1 current for vgs, vds >= 0, vbs: id, gm, gds, gmbs (and the threshold)
    fwd(vgs, vds, vbs) {
        const { vto, beta, lambda, gamma, phi } = this.p;
        let sarg, dsarg = 0;
        if (gamma > 0) {
            if (vbs <= 0) { sarg = Math.sqrt(Math.max(phi - vbs, 1e-12)); } else { const sp = Math.sqrt(phi); sarg = sp / (1 + 0.5 * vbs / phi); }
        } else sarg = Math.sqrt(phi);
        const von = vto - gamma * Math.sqrt(phi) + gamma * sarg;
        const vgst = vgs - von;
        if (vgst <= 0) return { id: 0, gm: 0, gds: 0, gmbs: 0, von };
        const arg = gamma > 0 ? gamma / (2 * sarg) : 0;            // as in SPICE3, the same for forward and reverse body bias
        const betap = beta * (1 + lambda * vds);
        let id, gm, gds;
        if (vgst <= vds) {
            id = (betap * vgst * vgst) / 2; gm = betap * vgst; gds = (lambda * beta * vgst * vgst) / 2;
        } else {
            id = betap * vds * (vgst - vds / 2); gm = betap * vds; gds = betap * (vgst - vds) + lambda * beta * vds * (vgst - vds / 2);
        }
        return { id, gm, gds, gmbs: gm * arg, von, vdsat: Math.max(vgst, 0) };
    }

    // drain current valid for either sign of vds (source/drain swap); returns the current into the drain terminal and
    // its derivatives with respect to vg, vd, vs, vb (NMOS-equivalent volts)
    eval(vgs, vds, vbs) {
        if (vds >= 0) {
            const f = this.fwd(vgs, vds, vbs);
            const gb = f.gmbs || 0, von = f.von === undefined ? this.p.vto : f.von;
            return { id: f.id, dg: f.gm, dd: f.gds, ds: -(f.gm + f.gds + gb), db: gb, von, vdsat: f.vdsat || 0, rev: false };
        }
        // reversed: the drain acts as the source. vgs' = vgd, vbs' = vbd, vds' = -vds
        const f = this.fwd(vgs - vds, -vds, vbs - vds);
        const gb = f.gmbs || 0, von = f.von === undefined ? this.p.vto : f.von;
        return { id: -f.id, dg: -f.gm, dd: f.gm + f.gds + gb, ds: -f.gds, db: -gb, von, vdsat: f.vdsat || 0, rev: true };
    }

    stamp(ctx) {
        const g = this.n[0], d = this.di, s = this.si, b = this.nb;
        const p = this.pol, par = this.p;
        if (par.rd > 0) ctx.sys.addG(this.n[1], d, 1 / par.rd);
        if (par.rs > 0) ctx.sys.addG(this.n[2], s, 1 / par.rs);

        const v = this.volts(ctx);
        let { vgs, vds, vbs } = v;
        const vgsLim = fetlim(vgs, this.vgs, this.von);
        if (Math.abs(vgsLim - vgs) > 1e-12) ctx.noncon = true;
        vgs = vgsLim;
        this.vgs = vgs;

        const m = this.eval(vgs, vds, vbs);
        this.von = m.von; this.last = m; this.acVolts = { vgs, vds, vbs, vbd: v.vbd };
        this.id = p * m.id;

        // Id flows into D and out of S. Derivatives are the same in actual and equivalent coordinates.
        const nodes = [g, d, s, b];
        const row = [m.dg, m.dd, m.ds, m.db];
        const J = [[0, 0, 0, 0], row, row.map(x => -x), [0, 0, 0, 0]];
        const vn = nodes.map(n => ctx.v(n));
        const ieqD = p * m.id - row.reduce((acc, x, k) => acc + x * vn[k], 0);
        stampNonlinear(ctx.sys, nodes, J, [0, ieqD, -ieqD, 0]);
        ctx.sys.addG(d, s, ctx.gmin);
        ctx.sys.addG(g, s, ctx.gmin);
        this.keepForAC(nodes, J);

        // bulk junctions (source-bulk and drain-bulk diodes)
        if (par.isb > 0) {
            for (const [key, n2, vRaw] of [["bs", s, v.vbs], ["bd", d, v.vbd]]) {
                const vOld = key === "bs" ? this.vbsj : this.vbdj;
                const vj = pnjlim(vRaw, vOld, this.vt, this.vcrit);
                if (Math.abs(vj - vRaw) > 1e-12) ctx.noncon = true;
                if (key === "bs") this.vbsj = vj; else this.vbdj = vj;
                const e = safeExp(vj / this.vt), i0 = par.isb * (e - 1), gj = (par.isb * e) / this.vt + ctx.gmin;
                const iAct = p * (i0 + ctx.gmin * vj);
                const ieq = iAct - gj * (p * vj);            // linearised about the (limited) junction voltage, as in the diode model
                ctx.sys.addG(b, n2, gj);
                ctx.sys.rhs(b, -ieq); ctx.sys.rhs(n2, ieq);
                this[`ij${key}`] = i0; this[`gj${key}`] = gj - ctx.gmin;
            }
        }

        // charge storage
        if (this.hasCaps && ctx.mode === "tran") {
            const trap = ctx.method === "trap", kk = (trap ? 2 : 1) / ctx.dt;
            for (const cp of this.capList(v, m)) {
                const st = this.cs[cp.key] || (this.cs[cp.key] = { qPrev: 0, iPrev: 0, vPrev: 0, init: false });
                if (!st.init) { st.qPrev = cp.q; st.vPrev = cp.ve; st.init = true; }
                const q = cp.inc ? st.qPrev + cp.c * (cp.ve - st.vPrev) : cp.q;
                const geq = kk * cp.c;
                const iAct = p * (kk * (q - st.qPrev) - (trap ? st.iPrev : 0));
                const ieqc = iAct - geq * (ctx.v(cp.a) - ctx.v(cp.b));
                ctx.sys.addG(cp.a, cp.b, geq);
                ctx.sys.rhs(cp.a, -ieqc); ctx.sys.rhs(cp.b, ieqc);
                st.kk = kk; st.trap = trap;
            }
        }
    }

    // the capacitors at the given operating voltages: { key, a, b (nodes), ve (equivalent-coordinate voltage), c, q, inc }
    capList(v, m) {
        const out = [], par = this.p, g = this.n[0];
        const add = (key, a, b, ve, c, q, inc = false) => { if (c > 0 || q) out.push({ key, a, b, ve, c, q, inc }); };
        if (this.covGS > 0) add("ogs", g, this.si, v.vgs, this.covGS, this.covGS * v.vgs);
        if (this.covGD > 0) add("ogd", g, this.di, v.vgs - v.vds, this.covGD, this.covGD * (v.vgs - v.vds));
        if (this.covGB > 0) add("ogb", g, this.nb, v.vgs - v.vbs, this.covGB, this.covGB * (v.vgs - v.vbs));
        if (this.cjbs > 0) add("jbs", this.nb, this.si, v.vbs, depletionCap(v.vbs, this.cjbs, par.pb, par.mj, par.fc), depletionCharge(v.vbs, this.cjbs, par.pb, par.mj, par.fc));
        if (this.cjbd > 0) add("jbd", this.nb, this.di, v.vbd, depletionCap(v.vbd, this.cjbd, par.pb, par.mj, par.fc), depletionCharge(v.vbd, this.cjbd, par.pb, par.mj, par.fc));
        if (this.cswbs > 0) add("jsbs", this.nb, this.si, v.vbs, depletionCap(v.vbs, this.cswbs, par.pb, par.mjsw, par.fc), depletionCharge(v.vbs, this.cswbs, par.pb, par.mjsw, par.fc));
        if (this.cswbd > 0) add("jsbd", this.nb, this.di, v.vbd, depletionCap(v.vbd, this.cswbd, par.pb, par.mjsw, par.fc), depletionCharge(v.vbd, this.cswbd, par.pb, par.mjsw, par.fc));
        if (this.cox > 0) {
            const mc = this.meyer(v, m);
            add("mgs", g, this.si, v.vgs, mc.cgs, 0, true);
            add("mgd", g, this.di, v.vgs - v.vds, mc.cgd, 0, true);
            add("mgb", g, this.nb, v.vgs - v.vbs, mc.cgb, 0, true);
        }
        return out;
    }

    // Meyer gate capacitances (SPICE3 DEVqmeyer), in the orientation of the present operating mode
    meyer(v, m) {
        const phi = this.p.phi, cox = this.cox, rev = m.rev;
        const vgs = rev ? v.vgs - v.vds : v.vgs, vds = Math.abs(v.vds), von = m.von;
        const vgst = vgs - von, vdsat = Math.max(vgst, 0);
        let cgs = 0, cgd = 0, cgb = 0;
        if (vgst <= -phi) cgb = cox / 2;
        else if (vgst <= -phi / 2) cgb = (-vgst * cox) / (2 * phi);
        else if (vgst <= 0) { cgb = (-vgst * cox) / (2 * phi); cgs = (vgst * cox) / (1.5 * phi) + cox / 3; }
        else if (vdsat <= vds) cgs = cox / 3;
        else {
            const vddif = 2 * vdsat - vds, vddif1 = vdsat - vds, vddif2 = vddif * vddif;
            cgd = (cox * (1 - (vdsat * vdsat) / vddif2)) / 3;
            cgs = (cox * (1 - (vddif1 * vddif1) / vddif2)) / 3;
        }
        // the SPICE3 formulas give half of each capacitance (the simulator adds the two halves of old and new state)
        cgs *= 2; cgd *= 2; cgb *= 2;
        return rev ? { cgs: cgd, cgd: cgs, cgb } : { cgs, cgd, cgb };
    }

    initState(ctx) {
        this.cs = {};
        if (!this.hasCaps) return;
        const v = this.volts(ctx), m = this.eval(v.vgs, v.vds, v.vbs);
        for (const cp of this.capList(v, m)) this.cs[cp.key] = { qPrev: cp.q, iPrev: 0, vPrev: cp.ve, init: true, kk: 0, trap: false };
    }

    accept(ctx) {
        if (!this.hasCaps) return;
        const v = this.volts(ctx), m = this.eval(v.vgs, v.vds, v.vbs);
        for (const cp of this.capList(v, m)) {
            const st = this.cs[cp.key];
            if (!st) continue;
            const q = cp.inc ? st.qPrev + cp.c * (cp.ve - st.vPrev) : cp.q;
            st.iPrev = (st.kk || 0) * (q - st.qPrev) - (st.trap ? st.iPrev : 0);
            st.qPrev = q; st.vPrev = cp.ve;
        }
    }

    // channel thermal noise 4kT * 2/3 * gm between the internal drain and source
    noiseSources(kT) {
        const gm = this.acJ ? Math.abs(this.acJ[1][0]) : 0;
        const out = [{ p: this.di, n: this.si, psd: 4 * kT * (2 / 3) * gm, label: "channel thermal" }];
        if (this.p.rd > 0) out.push({ p: this.n[1], n: this.di, psd: 4 * kT / this.p.rd, label: "rd thermal" });
        if (this.p.rs > 0) out.push({ p: this.n[2], n: this.si, psd: 4 * kT / this.p.rs, label: "rs thermal" });
        return out;
    }

    stampAC(ac, omega) {
        const par = this.p;
        // series drain / source resistance is part of the small-signal circuit too
        if (par.rd > 0) ac.addY(this.n[1], this.di, 1 / par.rd, 0);
        if (par.rs > 0) ac.addY(this.n[2], this.si, 1 / par.rs, 0);
        this.stampACJacobian(ac);
        if (par.isb > 0) {
            ac.addY(this.nb, this.si, this.gjbs || 0, 0);
            ac.addY(this.nb, this.di, this.gjbd || 0, 0);
        }
        if (this.hasCaps && this.acVolts) {
            const m = this.last || this.eval(this.acVolts.vgs, this.acVolts.vds, this.acVolts.vbs);
            for (const cp of this.capList(this.acVolts, m)) ac.addY(cp.a, cp.b, 0, omega * cp.c);
        }
    }

    current(x) {
        const v = (i) => (i < 0 ? 0 : x[i]);
        const p = this.pol;
        return p * this.eval(p * (v(this.n[0]) - v(this.si)), p * (v(this.di) - v(this.si)), p * (v(this.nb) - v(this.si))).id;
    }
}


// ------------------------------------------------------------ behavioural

// Output driven through ro toward a target voltage; used by op-amp and gates.
// A first-order lag (tau) is applied in transient analysis via the BE factor.
class BehavioralDriver extends NonlinearElement {
    constructor(name, nodes, ro, tau) {
        super(name, nodes);
        this.ro = ro;
        this.tau = tau;
        this.vf = 0;       // filtered target at last accepted step
        this.vtEff = 0;
    }

    lagFactor(ctx) {
        if (ctx.mode !== "tran" || !(this.tau > 0)) return 1;
        return ctx.dt / (this.tau + ctx.dt);
    }

    // subclasses implement target(v) -> { vt, dvt: [d/dv_k...] } over this.inNodes
    drive(ctx, outNode, inNodes, vt, dvt) {
        const k = this.lagFactor(ctx);
        const vtEff = k * vt + (1 - k) * this.vf;
        this.vtEff = vtEff;
        const G = 1 / this.ro;

        const nodes = [...inNodes, outNode];
        const row = [...dvt.map(d => -G * k * d), G];
        const v0 = nodes.map(n => ctx.v(n));
        const cur = G * (v0[v0.length - 1] - vtEff);
        let jv = 0;
        for (let i = 0; i < row.length; i++) jv += row[i] * v0[i];
        const ieq = cur - jv;

        for (let i = 0; i < nodes.length; i++) ctx.sys.add(outNode, nodes[i], row[i]);
        ctx.sys.rhs(outNode, -ieq);

        const J = nodes.map(() => nodes.map(() => 0));
        J[nodes.length - 1] = row;
        this.keepForAC(nodes, J);
    }

    // p.ic seeds the lagged output (like .ic): needed to kick off ring oscillators,
    // whose DC solution is the unstable all-mid-rail equilibrium.
    // UIC means a true zero start: the lagged output begins at 0 (or p.ic) instead of its DC value
    initState(ctx) {
        this.vf = this.p && this.p.ic !== undefined ? this.p.ic : (ctx.uic ? 0 : this.vtEff);
    }
    accept() { this.vf = this.vtEff; }
}

class OpAmp extends BehavioralDriver {
    // nodes: [IN-, IN+, OUT]; p: gain, vp, vn, drop, ro, rin, gbw
    //
    // Single dominant pole BEFORE the output clamp, as in a real op-amp (and in the
    // exported macromodel): a = lag(gain * vd), then out = clamp(a) to the rails.
    // Clamping first would cap the slew rate at rail / tau.
    constructor(name, nodes, p = {}) {
        const q = Object.assign({ gain: 2e5, vp: 15, vn: -15, drop: 1.5, ro: 75, rin: 2e6, gbw: 1e6 }, p);
        super(name, nodes, q.ro, q.gain / (2 * Math.PI * q.gbw));
        this.p = q;
        this.pole = 2 * Math.PI * q.gbw / q.gain;
        this.aPrev = 0;
        this.aNow = 0;
    }

    lagFactor() { return 1; } // the lag is applied to `a`, not to the clamped output

    stepFactor(ctx) {
        if (ctx.mode !== "tran" || !(this.tau > 0)) return 1;
        return ctx.dt / (this.tau + ctx.dt);
    }

    stamp(ctx) {
        const [inN, inP, out] = this.n;
        const { gain, vp, vn, drop, rin } = this.p;
        ctx.sys.addG(inN, inP, 1 / rin);

        const hi = vp - drop, lo = vn + drop;
        const mid = (hi + lo) / 2, half = (hi - lo) / 2;
        const vd = ctx.v(inP) - ctx.v(inN);

        const k = this.stepFactor(ctx);
        const a = (1 - k) * this.aPrev + k * gain * vd;
        const th = Math.tanh(a / half);
        const vt = mid + half * th;
        const dvt = k * gain * (1 - th * th);

        this.aNow = a;
        this.drive(ctx, out, [inN, inP], vt, [-dvt, dvt]);
    }

    stampAC(ac, omega) {
        const [inN, inP, out] = this.n;
        ac.addY(inN, inP, 1 / this.p.rin, 0);
        const G = 1 / this.ro;
        const dvt = this.acJ ? -this.acJ[2][1] / G : 0; // small-signal gain from the OP
        // single pole: A(jw) = A0 / (1 + jw/wp)
        const den = 1 + (omega / this.pole) * (omega / this.pole);
        const re = dvt / den, im = -dvt * (omega / this.pole) / den;
        ac.add(out, out, G, 0);
        ac.add(out, inP, -G * re, -G * im);
        ac.add(out, inN, G * re, G * im);
    }

    initState(ctx) { this.aPrev = ctx.uic ? 0 : this.aNow; }
    accept() { this.aPrev = this.aNow; }
    current() { return 0; }
}

class LogicGate extends BehavioralDriver {
    // nodes: [A, (B), Y]; kind AND OR NOT NAND NOR XOR XNOR BUF; p: vcc, vlow, ro, tpd
    constructor(name, nodes, kind, p = {}) {
        const q = Object.assign({ vcc: 5, vlow: 0, ro: 50, tpd: 10e-9 }, p);
        super(name, nodes, q.ro, q.tpd);
        this.kind = kind;
        this.p = q;
    }

    stamp(ctx) {
        const inNodes = this.n.slice(0, -1);
        const out = this.n[this.n.length - 1];
        const { vcc, vlow } = this.p;
        const vth = (vcc + vlow) / 2;
        const vs = (vcc - vlow) / 20;

        const s = inNodes.map(nd => 1 / (1 + safeExp(-(ctx.v(nd) - vth) / vs)));
        const ds = s.map(x => (x * (1 - x)) / vs);

        let f, df;
        const a = s[0], b = s.length > 1 ? s[1] : 0;
        switch (this.kind) {
            case "AND": f = a * b; df = [b, a]; break;
            case "NAND": f = 1 - a * b; df = [-b, -a]; break;
            case "OR": f = 1 - (1 - a) * (1 - b); df = [1 - b, 1 - a]; break;
            case "NOR": f = (1 - a) * (1 - b); df = [-(1 - b), -(1 - a)]; break;
            case "XOR": f = a + b - 2 * a * b; df = [1 - 2 * b, 1 - 2 * a]; break;
            case "XNOR": f = 1 - (a + b - 2 * a * b); df = [-(1 - 2 * b), -(1 - 2 * a)]; break;
            case "BUF": f = a; df = [1]; break;
            default: f = 1 - a; df = [-1]; break; // NOT
        }
        const span = vcc - vlow;
        const vt = vlow + span * f;
        const dvt = inNodes.map((_, i) => span * df[i] * ds[i]);

        this.drive(ctx, out, inNodes, vt, dvt);
    }

    stampAC(ac) { this.stampACJacobian(ac); }
}


// -------------------------------------------------------------------- 555

class Timer555 extends Element {
    // nodes: [GND, TRIG, OUT, RESET, VCC, DISCH, THRES, CTRL]
    constructor(name, nodes, p = {}) {
        super(name, nodes);
        this.p = Object.assign({ rdiv: 5000, rout: 10, rdis: 10, dropHigh: 1.7, lowOut: 0.1 }, p);
        this.q = 0;
        this.nonlinear = false;
        this.hasEvents = true;
    }

    bind(circuit) {
        super.bind(circuit);
        this.ta = circuit.internalNode(`${this.name}#a`); // 2/3 Vcc tap (CTRL)
        this.tb = circuit.internalNode(`${this.name}#b`); // 1/3 Vcc tap
    }

    stamp(ctx) {
        const [gnd, trig, out, reset, vcc, disch, thres, ctrl] = this.n;
        const s = ctx.sys;
        const r = this.p.rdiv;

        s.addG(vcc, this.ta, 1 / r);
        s.addG(this.ta, this.tb, 1 / r);
        s.addG(this.tb, gnd, 1 / r);
        s.addG(ctrl, this.ta, 1 / 1e-3); // CTRL pin is the 2/3 tap (tiny series R)

        const vsup = ctx.v(vcc) - ctx.v(gnd);
        const target = this.q ? ctx.v(gnd) + Math.max(0, vsup - this.p.dropHigh) : ctx.v(gnd) + this.p.lowOut;
        const G = 1 / this.p.rout;
        s.add(out, out, G);
        s.rhs(out, G * target);

        // RESET floats high if left open (it is active low)
        s.addG(reset, vcc, 1 / 100e3);

        // discharge transistor conducts while the latch output is low
        if (!this.q) s.addG(disch, gnd, 1 / this.p.rdis);
    }

    // latch state the comparators call for at the present node voltages
    nextState(ctx) {
        const [gnd, trig, , reset, , , thres] = this.n;
        const v = (n) => ctx.v(n) - ctx.v(gnd);
        if (v(reset) < 0.7 || v(thres) > v(this.ta)) return 0;
        if (v(trig) < v(this.tb)) return 1;
        return this.q;
    }

    // the engine uses this to find the exact crossing time instead of reacting a step late
    wouldFlip(ctx) { return this.nextState(ctx) !== this.q; }

    latch(ctx) { this.q = this.nextState(ctx); }

    initState(ctx) { this.q = 0; this.latch(ctx); }
    accept(ctx) { this.latch(ctx); }
}

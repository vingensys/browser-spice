// Engine tests: node tests/sim.test.js
// Loads the browser scripts into one scope and checks the solver against
// closed-form / independently computed results.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = [
    "js/utils/complex.js", "js/utils/units.js",
    "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js",
    "js/sim/spice-parser.js", "js/sim/model-library.js"
];
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
const S = new Function(src + `
return { SimCircuit, SimEngine, Resistor, Capacitor, Inductor, VoltageSource, CurrentSource,
         Diode, BJT, MOSFET, OpAmp, LogicGate, Timer555, Waveform, SIM, simModel, simModelCard, Complex,
         JFET, Transformer, Relay, Fuse, Thyristor, Regulator, FlipFlop, CCCS, DigitalIC, LOGIC_ICS, Switch, BSource, Expr, SPARSE_THRESHOLD, DenseSystem, SparseSystem, SingularMatrixError, SpiceParser, SimModelLibrary, SIM_MODELS };`)();
if (process.env.SPARSE) S.SPARSE_THRESHOLD.n = 0; // force the sparse solver for every circuit

const { SimCircuit, SimEngine, Resistor, Capacitor, Inductor, VoltageSource, CurrentSource,
    Diode, BJT, MOSFET, OpAmp, LogicGate, Timer555, Waveform, SIM, simModel, simModelCard,
    JFET, Transformer, Relay, Fuse, Thyristor, Regulator, FlipFlop, CCCS, DigitalIC, LOGIC_ICS } = S;

const { BSource, Expr, SpiceParser } = S;
S.__src_subckt = fs.readFileSync(path.join(root, 'js/cad/subckt-library.js'), 'utf8');
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        failed++;
        failures.push(name);
        console.log(`  FAIL ${name}\n       ${e.message}`);
    }
}
const near = (a, b, tol, what = "") => {
    if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} expected ${b} +/- ${tol}, got ${a}`);
};
const rel = (a, b, r, what = "") => near(a, b, Math.abs(b) * r, what);

const vdc = (v) => ({ wave: Waveform.dc(v) });
function build(fn) {
    const c = new SimCircuit();
    fn(c);
    return new SimEngine(c);
}

// -------------------------------------------------------------- linear

console.log("linear algebra");

test("sparse LU matches dense LU on random MNA-like systems (zero diagonals included)", () => {
    const { DenseSystem, SparseSystem } = S;
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (const n of [5, 17, 60, 150]) {
        const d = new DenseSystem(n), sp = new SparseSystem(n);
        for (let i = 0; i < n; i++) {
            const v = 1 + 10 * rnd();
            d.add(i, i, v); sp.add(i, i, v);
            for (let k = 0; k < 3; k++) {
                const j = Math.floor(rnd() * n), w = rnd() - 0.5;
                if (j === i) continue;
                d.add(i, j, w); sp.add(i, j, w);
            }
            const b = rnd() * 4 - 2;
            d.rhs(i, b); sp.rhs(i, b);
        }
        // a voltage-source-style row/column pair with a zero diagonal
        const a = 0, br = n - 1;
        for (const sys of [d, sp]) { sys.add(a, br, 1); sys.add(br, a, 1); }
        const xd = d.solve(), xs = sp.solve();
        for (let i = 0; i < n; i++) near(xs[i], xd[i], 1e-8 * (1 + Math.abs(xd[i])), `n=${n} x[${i}]`);
    }
});

test("sparse LU reports a singular matrix", () => {
    const sp = new S.SparseSystem(3);
    sp.add(0, 0, 1); sp.add(1, 1, 1); // row / column 2 empty
    let hit = false;
    try { sp.solve(); } catch (e) { hit = e instanceof S.SingularMatrixError; }
    if (!hit) throw new Error("no SingularMatrixError");
});

console.log("linear circuits");

test("resistor divider", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(10)));
        c.add(new Resistor("R1", ["in", "out"], { r: 1000 }));
        c.add(new Resistor("R2", ["out", "0"], { r: 3000 }));
    });
    const op = e.operatingPoint();
    near(op.nodeVoltages.out, 7.5, 1e-6);
    near(op.sourceCurrents.V1, -10 / 4000, 1e-9, "source current");
});

test("inductor is a DC short, capacitor is open", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["a", "0"], vdc(6)));
        c.add(new Inductor("L1", ["a", "b"], { l: 1e-3 }));
        c.add(new Resistor("R1", ["b", "0"], { r: 100 }));
        c.add(new Capacitor("C1", ["b", "c"], { c: 1e-6 }));
        c.add(new Resistor("R2", ["c", "0"], { r: 100 }));
    });
    const op = e.operatingPoint();
    near(op.nodeVoltages.b, 6, 1e-6);
    near(op.nodeVoltages.c, 0, 1e-6);
});

test("singular circuit gives a readable error", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["a", "0"], vdc(5)));
        c.add(new VoltageSource("V2", ["a", "0"], vdc(3)));
    });
    let msg = "";
    try { e.operatingPoint(); } catch (err) { msg = err.message; }
    if (!/singular/i.test(msg)) throw new Error("got: " + msg);
});

// ------------------------------------------------------------- semiconductors

console.log("diodes");

function diodeRef(vs, r, p) {
    // independent bisection on  (vs - vd)/r = Is(exp(vd/(n Vt)) - 1), ignoring Rs
    let lo = 0, hi = vs;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        const f = (vs - mid) / r - p.is * (Math.exp(mid / (p.n * SIM.VT)) - 1);
        if (f > 0) lo = mid; else hi = mid;
    }
    return lo;
}

test("diode + resistor matches the Shockley equation", () => {
    const p = { is: 1e-14, n: 1 };
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(5)));
        c.add(new Resistor("R1", ["in", "d"], { r: 1000 }));
        c.add(new Diode("D1", ["d", "0"], p));
    });
    const op = e.operatingPoint();
    near(op.nodeVoltages.d, diodeRef(5, 1000, p), 1e-4, "Vd");
});

test("1N4148 with series resistance conducts about 4 mA from 5 V / 1k", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(5)));
        c.add(new Resistor("R1", ["in", "d"], { r: 1000 }));
        c.add(new Diode("D1", ["d", "0"], simModel("D", "1N4148").params));
    });
    const op = e.operatingPoint();
    const i = op.currents.R1;
    if (i < 3.9e-3 || i > 4.5e-3) throw new Error("I(R1) = " + i);
    if (op.nodeVoltages.d < 0.55 || op.nodeVoltages.d > 0.85) throw new Error("Vd = " + op.nodeVoltages.d);
});

test("reverse-biased diode blocks", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(-5)));
        c.add(new Resistor("R1", ["in", "d"], { r: 1000 }));
        c.add(new Diode("D1", ["d", "0"], simModel("D", "1N4148").params));
    });
    const op = e.operatingPoint();
    near(op.nodeVoltages.d, -5, 1e-3);
});

test("zener regulator holds its breakdown voltage", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(12)));
        c.add(new Resistor("R1", ["in", "out"], { r: 470 }));
        c.add(new Diode("Z1", ["0", "out"], simModel("DZ", "5V1").params));
    });
    const op = e.operatingPoint();
    near(op.nodeVoltages.out, 5.1, 0.35, "Vz");
});

test("LED current-limiting resistor gives ~10 mA", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(5)));
        c.add(new Resistor("R1", ["in", "a"], { r: 330 }));
        c.add(new Diode("LED1", ["a", "0"], simModel("LED", "RED").params));
    });
    const op = e.operatingPoint();
    const i = op.currents.R1;
    if (i < 8e-3 || i > 11e-3) throw new Error("I = " + i);
    near(5 - op.nodeVoltages.a - 0, i * 330, 1e-6, "ohm");
    if (op.nodeVoltages.a < 1.6 || op.nodeVoltages.a > 2.2) throw new Error("Vf = " + op.nodeVoltages.a);
});

console.log("bipolar transistors");

test("NPN in the active region: Ic ~ BF * Ib", () => {
    const m = simModel("BJT_NPN", "2N2222").params;
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(12)));
        c.add(new Resistor("RB", ["vcc", "b"], { r: 1e6 }));
        c.add(new Resistor("RC", ["vcc", "c"], { r: 1000 }));
        c.add(new BJT("Q1", ["b", "c", "0"], 1, m));
    });
    const op = e.operatingPoint();
    const ib = (12 - op.nodeVoltages.b) / 1e6;
    const ic = (12 - op.nodeVoltages.c) / 1000;
    near(op.nodeVoltages.b, 0.62, 0.1, "Vbe");
    rel(ic / ib, m.bf * (1 - (op.nodeVoltages.b - op.nodeVoltages.c) / m.vaf), 0.05, "beta");
});

test("NPN saturates with heavy base drive", () => {
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(5)));
        c.add(new Resistor("RB", ["vcc", "b"], { r: 1000 }));
        c.add(new Resistor("RC", ["vcc", "c"], { r: 1000 }));
        c.add(new BJT("Q1", ["b", "c", "0"], 1, simModel("BJT_NPN", "2N2222").params));
    });
    const op = e.operatingPoint();
    if (op.nodeVoltages.c > 0.3) throw new Error("Vce(sat) = " + op.nodeVoltages.c);
});

test("PNP high-side switch", () => {
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(5)));
        c.add(new Resistor("RB", ["b", "0"], { r: 2200 }));
        c.add(new Resistor("RE", ["vcc", "e"], { r: 100 }));
        c.add(new BJT("Q1", ["b", "0x", "e"].map((n, i) => (i === 1 ? "load" : n)), -1, simModel("BJT_PNP", "2N3906").params));
        c.add(new Resistor("RL", ["load", "0"], { r: 470 }));
    });
    const op = e.operatingPoint();
    if (!(op.nodeVoltages.load > 1)) throw new Error("load = " + op.nodeVoltages.load);
});

test("common-emitter bias point is stable under temperature-free Newton from zero", () => {
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(12)));
        c.add(new Resistor("R1", ["vcc", "b"], { r: 47000 }));
        c.add(new Resistor("R2", ["b", "0"], { r: 10000 }));
        c.add(new Resistor("RC", ["vcc", "c"], { r: 2200 }));
        c.add(new Resistor("RE", ["e", "0"], { r: 470 }));
        c.add(new BJT("Q1", ["b", "c", "e"], 1, simModel("BJT_NPN", "2N3904").params));
    });
    const op = e.operatingPoint();
    const ve = op.nodeVoltages.e, vb = op.nodeVoltages.b;
    near(vb - ve, 0.66, 0.1, "Vbe");
    const ic = (12 - op.nodeVoltages.c) / 2200;
    near(ic, ve / 470, ic * 0.05, "Ic ~ Ie");
});

console.log("MOSFETs");

function mosRef(vgs, vdd, rd, p) {
    // bisection on Id(vds) = (vdd - vds)/rd
    let lo = 0, hi = vdd;
    const id = (vds) => {
        const vov = vgs - p.vto, lam = 1 + p.lambda * vds;
        if (vov <= 0) return 0;
        if (vds < vov) return p.beta * (vov * vds - vds * vds / 2) * lam;
        return p.beta / 2 * vov * vov * lam;
    };
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (id(mid) - (vdd - mid) / rd < 0) lo = mid; else hi = mid;
    }
    return lo;
}

test("NMOS switch in triode", () => {
    const p = simModel("NMOS", "2N7000").params;
    const e = build(c => {
        c.add(new VoltageSource("VDD", ["vdd", "0"], vdc(5)));
        c.add(new VoltageSource("VG", ["g", "0"], vdc(5)));
        c.add(new Resistor("RD", ["vdd", "d"], { r: 100 }));
        c.add(new MOSFET("M1", ["g", "d", "0"], 1, p));
    });
    const op = e.operatingPoint();
    near(op.nodeVoltages.d, mosRef(5, 5, 100, p), 1e-3, "Vds");
});

test("NMOS off below threshold", () => {
    const e = build(c => {
        c.add(new VoltageSource("VDD", ["vdd", "0"], vdc(5)));
        c.add(new VoltageSource("VG", ["g", "0"], vdc(1)));
        c.add(new Resistor("RD", ["vdd", "d"], { r: 100 }));
        c.add(new MOSFET("M1", ["g", "d", "0"], 1, simModel("NMOS", "2N7000").params));
    });
    near(e.operatingPoint().nodeVoltages.d, 5, 1e-3);
});

test("NMOS in saturation (current source load)", () => {
    const p = simModel("NMOS", "2N7000").params;
    const e = build(c => {
        c.add(new VoltageSource("VDD", ["vdd", "0"], vdc(10)));
        c.add(new VoltageSource("VG", ["g", "0"], vdc(3)));
        c.add(new Resistor("RD", ["vdd", "d"], { r: 1000 }));
        c.add(new MOSFET("M1", ["g", "d", "0"], 1, p));
    });
    const op = e.operatingPoint();
    near(op.nodeVoltages.d, mosRef(3, 10, 1000, p), 1e-3, "Vd");
});

test("PMOS high-side switch", () => {
    const p = simModel("PMOS", "BS250").params;
    const e = build(c => {
        c.add(new VoltageSource("VDD", ["vdd", "0"], vdc(5)));
        c.add(new VoltageSource("VG", ["g", "0"], vdc(0)));
        c.add(new MOSFET("M1", ["g", "load", "vdd"], -1, p));
        c.add(new Resistor("RL", ["load", "0"], { r: 100 }));
    });
    const op = e.operatingPoint();
    // Rds(on) ~ 1/(beta*(Vgs-Vt)) ~ 22 ohm into a 100 ohm load -> ~4 V
    near(op.nodeVoltages.load, 4, 0.3, "load");
});

console.log("op-amps and logic");

test("inverting amplifier gain = -Rf/Rin", () => {
    const e = build(c => {
        c.add(new VoltageSource("VIN", ["in", "0"], vdc(0.5)));
        c.add(new Resistor("R1", ["in", "n"], { r: 1000 }));
        c.add(new Resistor("RF", ["n", "out"], { r: 10000 }));
        c.add(new OpAmp("U1", ["n", "0", "out"], simModel("OPAMP", "LM741").params));
    });
    const op = e.operatingPoint();
    near(op.nodeVoltages.out, -5, 0.01, "Vout");
});

test("non-inverting amplifier gain = 1 + Rf/Rg", () => {
    const e = build(c => {
        c.add(new VoltageSource("VIN", ["in", "0"], vdc(1)));
        c.add(new Resistor("RF", ["out", "n"], { r: 9000 }));
        c.add(new Resistor("RG", ["n", "0"], { r: 1000 }));
        c.add(new OpAmp("U1", ["n", "in", "out"], simModel("OPAMP", "LM741").params));
    });
    near(e.operatingPoint().nodeVoltages.out, 10, 0.01);
});

test("comparator saturates to the supply rails", () => {
    const mk = (vin) => build(c => {
        c.add(new VoltageSource("VIN", ["in", "0"], vdc(vin)));
        c.add(new OpAmp("U1", ["0", "in", "out"], simModel("OPAMP", "LM741").params));
        c.add(new Resistor("RL", ["out", "0"], { r: 10000 }));
    }).operatingPoint().nodeVoltages.out;
    if (mk(0.1) < 12) throw new Error("high: " + mk(0.1));
    if (mk(-0.1) > -12) throw new Error("low: " + mk(-0.1));
});

test("logic gates follow their truth tables", () => {
    const table = {
        AND: [0, 0, 0, 1], NAND: [1, 1, 1, 0], OR: [0, 1, 1, 1], NOR: [1, 0, 0, 0], XOR: [0, 1, 1, 0]
    };
    for (const [kind, expect] of Object.entries(table)) {
        for (let i = 0; i < 4; i++) {
            const a = i & 1 ? 5 : 0, b = i & 2 ? 5 : 0;
            const e = build(c => {
                c.add(new VoltageSource("VA", ["a", "0"], vdc(a)));
                c.add(new VoltageSource("VB", ["b", "0"], vdc(b)));
                c.add(new LogicGate("G1", ["a", "b", "y"], kind));
                c.add(new Resistor("RL", ["y", "0"], { r: 100000 }));
            });
            const y = e.operatingPoint().nodeVoltages.y;
            const got = y > 2.5 ? 1 : 0;
            if (got !== expect[(a ? 1 : 0) + (b ? 2 : 0)]) throw new Error(`${kind}(${a},${b}) = ${y}`);
        }
    }
    const e = build(c => {
        c.add(new VoltageSource("VA", ["a", "0"], vdc(0)));
        c.add(new LogicGate("G1", ["a", "y"], "NOT"));
    });
    if (e.operatingPoint().nodeVoltages.y < 4.5) throw new Error("NOT(0)");
});

// ---------------------------------------------------------------- transient

console.log("transient");

test("RC charging follows 1 - exp(-t/RC)", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(5)));
        c.add(new Resistor("R1", ["in", "out"], { r: 1000 }));
        c.add(new Capacitor("C1", ["out", "0"], { c: 1e-6 }));
    });
    const r = e.transient({ tStop: 5e-3, tStep: 2e-5, uic: true });
    let worst = 0;
    r.timePoints.forEach((t, i) => {
        worst = Math.max(worst, Math.abs(r.nodeHistories.out[i] - 5 * (1 - Math.exp(-t / 1e-3))));
    });
    if (worst > 0.02) throw new Error("max error " + worst);
});

test("RL current rise follows 1 - exp(-t R/L)", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(10)));
        c.add(new Resistor("R1", ["in", "x"], { r: 100 }));
        c.add(new Inductor("L1", ["x", "0"], { l: 0.1 }));
    });
    const r = e.transient({ tStop: 5e-3, tStep: 2e-5 });
    const tau = 0.1 / 100;
    const k = r.timePoints.length - 1;
    near(r.currentHistories.L1[k], 0.1 * (1 - Math.exp(-r.timePoints[k] / tau)), 2e-3);
});

test("LC tank rings at 1/(2 pi sqrt(LC)) with little loss (trapezoidal)", () => {
    const L = 1e-3, C = 1e-6;
    const e = build(c => {
        c.add(new Capacitor("C1", ["x", "0"], { c: C, ic: 5 }));
        c.add(new Inductor("L1", ["x", "0"], { l: L, ic: 0 }));
    });
    const r = e.transient({ tStop: 1e-3, tStep: 2e-7, uic: true, method: "trap" });
    const v = r.nodeHistories.x;
    let crossings = [];
    for (let i = 1; i < v.length; i++) {
        if (v[i - 1] > 0 && v[i] <= 0) crossings.push(r.timePoints[i]);
    }
    const period = crossings[1] - crossings[0];
    rel(1 / period, 1 / (2 * Math.PI * Math.sqrt(L * C)), 0.01, "frequency");
    const peak = Math.max(...v.slice(Math.floor(v.length / 2)));
    if (peak < 4.7) throw new Error("amplitude decayed to " + peak);
});

test("half-wave rectifier with filter capacitor", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.sin({ amp: 10, freq: 100 }) }));
        c.add(new Diode("D1", ["in", "out"], simModel("D", "1N4007").params));
        c.add(new Resistor("RL", ["out", "0"], { r: 1000 }));
        c.add(new Capacitor("C1", ["out", "0"], { c: 100e-6 }));
    });
    const r = e.transient({ tStop: 0.06, tStep: 1e-4, uic: true });
    const v = r.nodeHistories.out;
    const tail = v.slice(Math.floor(v.length * 0.6));
    const peak = Math.max(...tail), low = Math.min(...tail);
    if (peak < 9.0 || peak > 9.7) throw new Error("peak " + peak);
    if (low < 7.0) throw new Error("ripple too deep: " + low);
    if (low > peak - 0.3) throw new Error("no ripple at all?");
});

test("pulse source hits its breakpoints", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.pulse({ v1: 0, v2: 5, delay: 1e-4, rise: 1e-6, fall: 1e-6, width: 5e-4, period: 1e-3 }) }));
        c.add(new Resistor("R1", ["in", "0"], { r: 1000 }));
    });
    const r = e.transient({ tStop: 2e-3, tStep: 5e-5, uic: true });
    const hasPlateau = r.nodeHistories.in.some(v => Math.abs(v - 5) < 1e-6);
    if (!hasPlateau) throw new Error("never reached 5 V");
    near(r.nodeHistories.in[r.nodeHistories.in.length - 1], 0, 5.01, "end");
});

test("NMOS low-side switch driven by a pulse", () => {
    const e = build(c => {
        c.add(new VoltageSource("VDD", ["vdd", "0"], vdc(5)));
        c.add(new VoltageSource("VG", ["g", "0"], { wave: Waveform.pulse({ v1: 0, v2: 5, delay: 1e-4, rise: 1e-6, fall: 1e-6, width: 3e-4, period: 1e-3 }) }));
        c.add(new Resistor("RD", ["vdd", "d"], { r: 100 }));
        c.add(new MOSFET("M1", ["g", "d", "0"], 1, simModel("NMOS", "2N7000").params));
    });
    const r = e.transient({ tStop: 1e-3, tStep: 1e-5, uic: true });
    const vd = r.nodeHistories.d;
    if (Math.max(...vd) < 4.9) throw new Error("never turned off");
    if (Math.min(...vd) > 1.2) throw new Error("never turned on: " + Math.min(...vd));
});

test("555 astable oscillates near 1.44 / ((R1 + 2 R2) C)", () => {
    const R1 = 1000, R2 = 10000, C = 0.1e-6;
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(5)));
        c.add(new Resistor("RA", ["vcc", "dis"], { r: R1 }));
        c.add(new Resistor("RB", ["dis", "thr"], { r: R2 }));
        c.add(new Capacitor("CT", ["thr", "0"], { c: C }));
        // GND TRIG OUT RESET VCC DISCH THRES CTRL
        c.add(new Timer555("U1", ["0", "thr", "out", "vcc", "vcc", "dis", "thr", "ctl"]));
        c.add(new Capacitor("CC", ["ctl", "0"], { c: 10e-9 }));
        c.add(new Resistor("RL", ["out", "0"], { r: 10000 }));
    });
    const r = e.transient({ tStop: 0.01, tStep: 5e-6, uic: true });
    const out = r.nodeHistories.out;
    const rising = [];
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 2.5 && out[i] >= 2.5) rising.push(r.timePoints[i]);
    if (rising.length < 4) throw new Error("only " + rising.length + " rising edges");
    const period = (rising[rising.length - 1] - rising[1]) / (rising.length - 2);
    rel(1 / period, 1.44 / ((R1 + 2 * R2) * C), 0.08, "frequency");
});

// ------------------------------------------------------------------------ AC

console.log("AC");

test("RC low-pass is -3 dB at the corner and rolls off at -20 dB/decade", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.dc(0), acMag: 1 }));
        c.add(new Resistor("R1", ["in", "out"], { r: 1000 }));
        c.add(new Capacitor("C1", ["out", "0"], { c: 159.155e-9 }));
    });
    const r = e.ac({ fStart: 10, fStop: 1e5, pointsPerDecade: 20 });
    const mag = (f) => {
        const p = r.reduce((best, x) => (Math.abs(Math.log(x.frequency / f)) < Math.abs(Math.log(best.frequency / f)) ? x : best));
        return p.nodeVoltages.out.magnitude();
    };
    near(mag(1000), Math.SQRT1_2, 0.02, "corner");
    near(mag(10000) / mag(100000), 10, 0.5, "slope");
});

test("legacy behaviour: DC source drives the sweep when no AC source exists", () => {
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(2)));
        c.add(new Resistor("R1", ["in", "out"], { r: 1000 }));
        c.add(new Resistor("R2", ["out", "0"], { r: 1000 }));
    });
    const r = e.ac({ fStart: 100, fStop: 1000, pointsPerDecade: 2 });
    near(r[0].nodeVoltages.out.magnitude(), 1, 1e-6);
});

test("common-emitter amplifier small-signal gain ~ -gm * Rc", () => {
    const m = simModel("BJT_NPN", "2N3904").params;
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(12)));
        c.add(new VoltageSource("VIN", ["in", "0"], { wave: Waveform.dc(0), acMag: 1 }));
        c.add(new Capacitor("CIN", ["in", "b"], { c: 10e-6 }));
        c.add(new Resistor("R1", ["vcc", "b"], { r: 47000 }));
        c.add(new Resistor("R2", ["b", "0"], { r: 10000 }));
        c.add(new Resistor("RC", ["vcc", "c"], { r: 2200 }));
        c.add(new Resistor("RE", ["e", "0"], { r: 470 }));
        c.add(new Capacitor("CE", ["e", "0"], { c: 100e-6 }));
        c.add(new BJT("Q1", ["b", "c", "e"], 1, m));
    });
    const op = e.operatingPoint();
    const ic = (12 - op.nodeVoltages.c) / 2200;
    const gm = ic / SIM.VT;
    const r = e.ac({ fStart: 1000, fStop: 10000, pointsPerDecade: 1 });
    const gain = r[0].nodeVoltages.c.magnitude();
    // loaded by Rc, ro and the bias divider seen at the base: expect within 25 %
    rel(gain, gm * 2200, 0.25, "gain");
});

test("op-amp inverting amplifier AC response rolls off at GBW / gain", () => {
    const e = build(c => {
        c.add(new VoltageSource("VIN", ["in", "0"], { wave: Waveform.dc(0), acMag: 1 }));
        c.add(new Resistor("R1", ["in", "n"], { r: 1000 }));
        c.add(new Resistor("RF", ["n", "out"], { r: 10000 }));
        c.add(new OpAmp("U1", ["n", "0", "out"], simModel("OPAMP", "LM741").params));
    });
    const r = e.ac({ fStart: 10, fStop: 1e7, pointsPerDecade: 10 });
    near(r[0].nodeVoltages.out.magnitude(), 10, 0.1, "midband gain");
    const f3db = r.find(x => x.nodeVoltages.out.magnitude() < 10 / Math.SQRT2).frequency;
    // closed-loop gain 10 -> bandwidth ~ GBW / (1 + Rf/R1) = 1e6 / 11
    rel(f3db, 1e6 / 11, 0.25, "bandwidth");
});

// ------------------------------------------------------------- convergence

console.log("convergence / robustness");

test("long diode chain converges (needs limiting / stepping)", () => {
    const p = simModel("D", "1N4007").params;
    const e = build(c => {
        c.add(new VoltageSource("V1", ["n0", "0"], vdc(20)));
        c.add(new Resistor("R1", ["n0", "n1"], { r: 100 }));
        for (let i = 1; i <= 12; i++) c.add(new Diode(`D${i}`, [`n${i}`, i === 12 ? "0" : `n${i + 1}`], p));
    });
    const op = e.operatingPoint();
    if (!(op.nodeVoltages.n1 > 6 && op.nodeVoltages.n1 < 12)) throw new Error("n1 = " + op.nodeVoltages.n1);
});

test("positive-feedback latch (two cross-coupled NPN) finds a stable point", () => {
    const m = simModel("BJT_NPN", "2N2222").params;
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(5)));
        c.add(new Resistor("RC1", ["vcc", "c1"], { r: 1000 }));
        c.add(new Resistor("RC2", ["vcc", "c2"], { r: 1000 }));
        c.add(new Resistor("RB1", ["c2", "b1"], { r: 10000 }));
        c.add(new Resistor("RB2", ["c1", "b2"], { r: 10000 }));
        c.add(new BJT("Q1", ["b1", "c1", "0"], 1, m));
        c.add(new BJT("Q2", ["b2", "c2", "0"], 1, m));
    });
    const op = e.operatingPoint();
    if (!isFinite(op.nodeVoltages.c1)) throw new Error("NaN");
});

test("model cards export standard SPICE syntax", () => {
    const d = simModelCard("D", "1N4148");
    if (!/^\.model 1N4148 D\(IS=.*BV=100/.test(d)) throw new Error(d);
    const q = simModelCard("BJT_NPN", "2N2222");
    if (!/NPN\(IS=.*BF=255\.9/.test(q)) throw new Error(q);
});

console.log("demanding circuits");

test("CMOS inverter transfer curve switches near Vdd/2", () => {
    const n = { vto: 1.0, beta: 0.02, lambda: 0.02 }, pm = { vto: 1.0, beta: 0.02, lambda: 0.02 };
    const e = build(c => {
        c.add(new VoltageSource("VDD", ["vdd", "0"], vdc(5)));
        c.add(new VoltageSource("VIN", ["in", "0"], vdc(0)));
        c.add(new MOSFET("MP", ["in", "out", "vdd"], -1, pm));
        c.add(new MOSFET("MN", ["in", "out", "0"], 1, n));
        c.add(new Resistor("RL", ["out", "0"], { r: 1e9 }));
    });
    const sw = e.dcSweep("VIN", 0, 5, 0.1);
    const out = sw.nodeHistories.out;
    if (out[0] < 4.9) throw new Error("Vout(0) = " + out[0]);
    if (out[out.length - 1] > 0.1) throw new Error("Vout(5) = " + out[out.length - 1]);
    const k = out.findIndex(v => v < 2.5);
    near(sw.sweep[k], 2.5, 0.2, "switching point");
});

test("bridge rectifier output ~ Vpk - 2 diode drops", () => {
    const p = simModel("D", "1N4007").params;
    const e = build(c => {
        c.add(new VoltageSource("V1", ["a", "b"], { wave: Waveform.sin({ amp: 12, freq: 50 }) }));
        c.add(new Resistor("RG1", ["b", "0"], { r: 1e6 }));
        c.add(new Diode("D1", ["a", "p"], p));
        c.add(new Diode("D2", ["b", "p"], p));
        c.add(new Diode("D3", ["n", "a"], p));
        c.add(new Diode("D4", ["n", "b"], p));
        c.add(new Resistor("RL", ["p", "n"], { r: 500 }));
        c.add(new Capacitor("C1", ["p", "n"], { c: 470e-6 }));
        c.add(new Resistor("RN", ["n", "0"], { r: 1e6 }));
    });
    const r = e.transient({ tStop: 0.08, tStep: 1e-4, uic: true });
    const v = r.nodeHistories.p.map((x, i) => x - r.nodeHistories.n[i]);
    const peak = Math.max(...v.slice(Math.floor(v.length / 2)));
    if (peak < 9.8 || peak > 11.2) throw new Error("peak " + peak);
});

test("boost converter settles near Vin / (1 - D) minus switch and diode drops", () => {
    const e = build(c => {
        c.add(new VoltageSource("VIN", ["in", "0"], vdc(5)));
        c.add(new Inductor("L1", ["in", "sw"], { l: 100e-6 }));
        c.add(new VoltageSource("VG", ["g", "0"], { wave: Waveform.pulse({ v1: 0, v2: 10, delay: 0, rise: 20e-9, fall: 20e-9, width: 10e-6, period: 20e-6 }) }));
        c.add(new MOSFET("M1", ["g", "sw", "0"], 1, simModel("NMOS", "IRF540").params));
        c.add(new Diode("D1", ["sw", "out"], simModel("D", "1N5819").params));
        c.add(new Capacitor("C1", ["out", "0"], { c: 100e-6 }));
        c.add(new Resistor("RL", ["out", "0"], { r: 50 }));
    });
    const r = e.transient({ tStop: 20e-3, tStep: 1e-6, uic: true });
    const v = r.nodeHistories.out;
    const tail = v.slice(Math.floor(v.length * 0.9));
    const avg = tail.reduce((a, b) => a + b, 0) / tail.length;
    if (avg < 9.2 || avg > 10.1) throw new Error("Vout = " + avg);
    const ripple = Math.max(...tail) - Math.min(...tail);
    if (ripple > 0.5) throw new Error("ripple " + ripple);
});

test("BJT astable multivibrator oscillates", () => {
    const m = simModel("BJT_NPN", "2N2222").params;
    const R = 10000, C = 10e-9;
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(5)));
        c.add(new Resistor("RC1", ["vcc", "c1"], { r: 1000 }));
        c.add(new Resistor("RC2", ["vcc", "c2"], { r: 1000 }));
        c.add(new Resistor("RB1", ["vcc", "b1"], { r: R }));
        c.add(new Resistor("RB2", ["vcc", "b2"], { r: R }));
        c.add(new Capacitor("C1", ["c1", "b2"], { c: C, ic: 0 }));
        c.add(new Capacitor("C2", ["c2", "b1"], { c: C, ic: 1 }));
        c.add(new BJT("Q1", ["b1", "c1", "0"], 1, m));
        c.add(new BJT("Q2", ["b2", "c2", "0"], 1, m));
    });
    const r = e.transient({ tStop: 8e-3, tStep: 2e-6, uic: true });
    const v = r.nodeHistories.c1;
    let edges = 0;
    for (let i = 1; i < v.length; i++) if (v[i - 1] < 2.5 && v[i] >= 2.5) edges++;
    if (edges < 4) throw new Error("only " + edges + " cycles");
    const rise = [];
    for (let i = 1; i < v.length; i++) if (v[i - 1] < 2.5 && v[i] >= 2.5) rise.push(r.timePoints[i]);
    const period = (rise[rise.length - 1] - rise[1]) / (rise.length - 2);
    rel(1 / period, 1 / (1.386 * R * C), 0.15, "frequency");
});

test("op-amp Schmitt trigger shows hysteresis in a DC sweep", () => {
    const e = build(c => {
        c.add(new VoltageSource("VIN", ["in", "0"], vdc(0)));
        c.add(new Resistor("R1", ["out", "p"], { r: 10000 }));
        c.add(new Resistor("R2", ["p", "0"], { r: 10000 }));
        c.add(new OpAmp("U1", ["in", "p", "out"], simModel("OPAMP", "LM741").params));
    });
    const up = e.dcSweep("VIN", -10, 10, 0.5).nodeHistories.out;
    const down = e.dcSweep("VIN", 10, -10, 0.5).nodeHistories.out;
    if (up.length !== down.length) throw new Error("length");
    // at Vin = 0 the output depends on history -> the two sweeps disagree there
    const k = 20;
    if (Math.sign(up[k]) === Math.sign(down[down.length - 1 - k])) {
        throw new Error("no hysteresis: " + up[k] + " vs " + down[down.length - 1 - k]);
    }
});

test("op-amp integrator ramps linearly", () => {
    const e = build(c => {
        c.add(new VoltageSource("VIN", ["in", "0"], { wave: Waveform.pwl([[0, 0], [1e-6, -1], [10e-3, -1]]) }));
        c.add(new Resistor("R1", ["in", "n"], { r: 10000 }));
        c.add(new Capacitor("C1", ["n", "out"], { c: 100e-9, ic: 0 }));
        c.add(new Resistor("RP", ["n", "out"], { r: 100e6 }));
        c.add(new OpAmp("U1", ["n", "0", "out"], simModel("OPAMP", "TL072").params));
    });
    const r = e.transient({ tStop: 5e-3, tStep: 1e-5, uic: true });
    const k = r.timePoints.length - 1;
    // dVout/dt = -Vin/(RC) = 1000 V/s  ->  5 V after 5 ms
    near(r.nodeHistories.out[k], 5, 0.4, "Vout");
});

test("op-amp follows a 1 kHz sine in transient (pole sits before the clamp)", () => {
    const e = build(c => {
        c.add(new VoltageSource("VIN", ["in", "0"], { wave: Waveform.sin({ amp: 0.5, freq: 1000 }) }));
        c.add(new Resistor("R1", ["in", "n"], { r: 1000 }));
        c.add(new Resistor("RF", ["n", "out"], { r: 10000 }));
        c.add(new OpAmp("U1", ["n", "0", "out"], simModel("OPAMP", "LM741").params));
    });
    const r = e.transient({ tStop: 4e-3, tStep: 5e-6, uic: false });
    const out = r.nodeHistories.out.slice(Math.floor(r.nodeHistories.out.length / 2));
    near(Math.max(...out), 5, 0.3, "peak");
    near(Math.min(...out), -5, 0.3, "trough");
});

test("555 frequency is accurate to ~1 % even with a coarse step (event localisation)", () => {
    const R1 = 1000, R2 = 10000, C = 0.1e-6;
    const e = build(c => {
        c.add(new VoltageSource("VCC", ["vcc", "0"], vdc(5)));
        c.add(new Resistor("RA", ["vcc", "dis"], { r: R1 }));
        c.add(new Resistor("RB", ["dis", "thr"], { r: R2 }));
        c.add(new Capacitor("CT", ["thr", "0"], { c: C }));
        c.add(new Timer555("U1", ["0", "thr", "out", "vcc", "vcc", "dis", "thr", "ctl"]));
        c.add(new Capacitor("CC", ["ctl", "0"], { c: 10e-9 }));
        c.add(new Resistor("RL", ["out", "0"], { r: 10000 }));
    });
    const r = e.transient({ tStop: 0.02, tStep: 10e-6, uic: true });
    const rising = [];
    r.nodeHistories.out.forEach((v, i) => { if (i && r.nodeHistories.out[i - 1] < 2.5 && v >= 2.5) rising.push(r.timePoints[i]); });
    const f = (rising.length - 2) / (rising[rising.length - 1] - rising[1]);
    // the ideal 555 gives 1.44/((R1+2R2)C); the 1.7 V output drop and CTRL cap shift it slightly
    rel(f, 1.44 / ((R1 + 2 * R2) * C), 0.025, "frequency");
    if (r.events < 6) throw new Error("expected comparator events, got " + r.events);
});

test("ring of three NOT gates oscillates (gate delay model)", () => {
    const e = build(c => {
        for (let i = 0; i < 3; i++) {
            c.add(new LogicGate(`G${i}`, [`n${i}`, `n${(i + 1) % 3}`], "NOT", { tpd: 20e-9, ic: i === 0 ? 0 : undefined }));
        }
        c.add(new Resistor("RK", ["n0", "0"], { r: 1e9 }));
    });
    const r = e.transient({ tStop: 2e-6, tStep: 2e-9, uic: true });
    const v = r.nodeHistories.n0;
    let edges = 0;
    for (let i = 1; i < v.length; i++) if (v[i - 1] < 2.5 && v[i] >= 2.5) edges++;
    if (edges < 3) throw new Error("only " + edges + " edges");
});

console.log("interop");

test("a vendor .lib file adds selectable models that simulate", () => {
    const { SimModelLibrary, SIM_MODELS } = S;
    const r = SimModelLibrary.importText(`vendor models
.model VND4148 D(IS=5n N=1.9 RS=0.9 CJO=3p)
.model VNPN NPN(IS=3e-15 BF=300 VAF=90)
.model VZ5V6 D(IS=1e-14 BV=5.6 IBV=20m RS=6)
.model WEIRD LTRA(R=1)
.end`);
    if (!SIM_MODELS.D.VND4148 || !SIM_MODELS.BJT_NPN.VNPN) throw new Error("models not registered: " + r.added);
    if (!SIM_MODELS.DZ.VZ5V6) throw new Error("zener-like diode should also be offered as a zener");
    if (r.skipped.length !== 1) throw new Error("unsupported model type should be reported, got " + r.skipped);
    const e = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(5)));
        c.add(new Resistor("R1", ["in", "d"], { r: 1000 }));
        c.add(new Diode("D1", ["d", "0"], simModel("D", "VND4148").params));
    });
    const vd = e.operatingPoint().nodeVoltages.d;
    if (vd < 0.5 || vd > 1.0) throw new Error("Vd = " + vd);
    if (!/^\.model VND4148 D\(IS=5e-9/.test(simModelCard("D", "VND4148"))) throw new Error(simModelCard("D", "VND4148"));
});


console.log("added parts");

test("JFET: Idss and pinch-off", () => {
    const run = (vg) => build(c => {
        c.add(new VoltageSource("V1", ["vdd", "0"], vdc(12)));
        c.add(new VoltageSource("VG", ["g", "0"], vdc(vg)));
        c.add(new Resistor("RD", ["vdd", "d"], { r: 1000 }));
        c.add(new JFET("J1", ["g", "d", "0"], 1, { vto: -2, beta: 1.25e-3, lambda: 0 }));
    }).operatingPoint().nodeVoltages.d;
    near(run(0), 12 - 5, 0.02, "Id = Idss = 5 mA");
    near(run(-1), 12 - 1.25, 0.02, "Id = beta (Vgs - Vp)^2 at Vgs = -1");
    near(run(-2.5), 12, 0.01, "pinched off");
});

test("P-channel JFET mirrors the N-channel one", () => {
    const d = build(c => {
        c.add(new VoltageSource("V1", ["vss", "0"], vdc(-12)));
        c.add(new Resistor("RD", ["vss", "d"], { r: 1000 }));
        c.add(new JFET("J1", ["0", "d", "0"], -1, { vto: -2, beta: 1.25e-3, lambda: 0 }));
    }).operatingPoint().nodeVoltages.d;
    near(d, -7, 0.02);
});

test("transformer: 1:2 step-up passes 2x in AC and transient, and blocks DC", () => {
    const mk = () => build(c => {
        c.add(new VoltageSource("V1", ["p", "0"], { wave: Waveform.sin({ amp: 1, freq: 1000 }), acMag: 1 }));
        c.add(new Transformer("T1", ["p", "0", "s", "0"], { l1: 1, ratio: 2, k: 0.9999, rp: 1 }));
        c.add(new Resistor("RL", ["s", "0"], { r: 20000 }));
    });
    const ac = mk().ac({ fStart: 1000, fStop: 1000, pointsPerDecade: 1 })[0];
    near(ac.nodeVoltages.s.magnitude(), 2, 0.05, "AC gain");
    const tr = mk().transient({ tStop: 4e-3, tStep: 2e-6 });
    const v = tr.nodeHistories.s;
    near(Math.max(...v.slice(v.length >> 1)), 2, 0.06, "transient peak");
    const dc = build(c => {
        c.add(new VoltageSource("V1", ["p", "0"], vdc(5)));
        c.add(new Resistor("R1", ["p", "a"], { r: 100 }));
        c.add(new Transformer("T1", ["a", "0", "s", "0"], { l1: 1, ratio: 1 }));
        c.add(new Resistor("RL", ["s", "0"], { r: 1000 }));
    }).operatingPoint();
    near(dc.nodeVoltages.s, 0, 1e-6, "no DC on the secondary");
    near(dc.nodeVoltages.a, 0, 1e-6, "primary is a DC short");
});

test("relay closes above the pull-in current and opens below drop-out", () => {
    const sim = (v) => {
        const c = new SimCircuit();
        c.add(new VoltageSource("VC", ["cp", "0"], { wave: Waveform.pwl([[0, 0], [1e-3, 0], [1.001e-3, v], [20e-3, v]]) }));
        c.add(new VoltageSource("VL", ["l", "0"], vdc(5)));
        c.add(new Relay("K1", ["cp", "0", "l", "out"], { rcoil: 400, lcoil: 0.05, pull: 22e-3, drop: 3e-3 }));
        c.add(new Resistor("RL", ["out", "0"], { r: 100 }));
        const r = new SimEngine(c).transient({ tStop: 20e-3, tStep: 20e-6 });
        return r.nodeHistories.out[r.nodeHistories.out.length - 1];
    };
    near(sim(12), 5 * 100 / 100.05, 0.01, "energised: contact conducts");
    near(sim(5), 0, 0.001, "5 V is below pull-in (12.5 mA)");
});

test("fuse blows once I2t is exceeded", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], vdc(10)));
    c.add(new Fuse("F1", ["in", "out"], { rating: 1, r: 0.01, tm: 0.02 }));
    c.add(new Resistor("RL", ["out", "0"], { r: 5 }));
    const r = new SimEngine(c).transient({ tStop: 30e-3, tStep: 50e-6 });
    const v = r.nodeHistories.out;
    near(v[10], 10, 0.1, "conducts first");
    near(v[v.length - 1], 0, 0.01, "open after the I2t limit");
});

test("SCR latches on a gate pulse and releases when the current drops", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.pwl([[0, 10], [5e-3, 10], [5.001e-3, 0], [8e-3, 0]]) }));
    c.add(new Resistor("RL", ["in", "a"], { r: 100 }));
    c.add(new Thyristor("Q1", ["a", "0", "g"], { igt: 5e-3, ih: 10e-3, vf: 1, ron: 0.05, rg: 100 }));
    c.add(new VoltageSource("VG", ["gs", "0"], { wave: Waveform.pulse({ v1: 0, v2: 3, delay: 1e-3, rise: 1e-6, fall: 1e-6, width: 0.5e-3, period: 0 }) }));
    c.add(new Resistor("RG", ["gs", "g"], { r: 100 }));
    const r = new SimEngine(c).transient({ tStop: 8e-3, tStep: 10e-6 });
    const at = (t) => r.nodeHistories.a[r.timePoints.findIndex(x => x >= t)];
    near(at(0.5e-3), 10, 0.1, "off before the gate pulse");
    near(at(3e-3), 1.0, 0.2, "latched on after the pulse ended");
    near(at(7e-3), 0, 0.05, "released after the supply dropped");
});

test("regulator holds its output and drops out below vout + dropout", () => {
    const out = (vin) => build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(vin)));
        c.add(new Regulator("U1", ["in", "out", "0"], simModel("REG", "7805").params));
        c.add(new Resistor("RL", ["out", "0"], { r: 100 }));
    }).operatingPoint().nodeVoltages.out;
    near(out(12), 5, 0.02, "regulating");
    near(out(20), 5, 0.02, "line regulation");
    near(out(6), 4, 0.1, "dropout");
    const neg = build(c => {
        c.add(new VoltageSource("V1", ["in", "0"], vdc(-12)));
        c.add(new Regulator("U1", ["in", "out", "0"], simModel("REG", "7905").params));
        c.add(new Resistor("RL", ["out", "0"], { r: 100 }));
    }).operatingPoint().nodeVoltages.out;
    near(neg, -5, 0.02, "negative regulator");
});

test("D flip-flop wired as a toggle divides the clock by two", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("VCK", ["ck", "0"], { wave: Waveform.pulse({ v1: 0, v2: 5, delay: 0.5e-3, rise: 1e-6, fall: 1e-6, width: 0.4e-3, period: 1e-3 }) }));
    c.add(new FlipFlop("U1", ["qn", "0", "ck", "q", "qn", "0", "0"], "D", { vcc: 5 }));
    const r = new SimEngine(c).transient({ tStop: 3.2e-3, tStep: 20e-6 });
    const at = (t) => r.nodeHistories.q[r.timePoints.findIndex(x => x >= t)];
    near(at(1.0e-3), 5, 0.3); near(at(2.0e-3), 0, 0.3); near(at(3.0e-3), 5, 0.3);
});

test("JK and T flip-flops, set and reset", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("VCK", ["ck", "0"], { wave: Waveform.pulse({ v1: 0, v2: 5, delay: 0.5e-3, rise: 1e-6, fall: 1e-6, width: 0.4e-3, period: 1e-3 }) }));
    c.add(new VoltageSource("VH", ["hi", "0"], vdc(5)));
    c.add(new FlipFlop("T1", ["hi", "0", "ck", "q", "qn", "0", "rst"], "T", { vcc: 5 }));
    c.add(new VoltageSource("VR", ["rst", "0"], { wave: Waveform.pwl([[0, 0], [2.2e-3, 0], [2.201e-3, 5], [4e-3, 5]]) }));
    const r = new SimEngine(c).transient({ tStop: 3.5e-3, tStep: 20e-6 });
    const at = (t) => r.nodeHistories.q[r.timePoints.findIndex(x => x >= t)];
    near(at(1.0e-3), 5, 0.3, "toggled high");
    near(at(2.0e-3), 0, 0.3, "toggled low");
    near(at(2.4e-3), 0, 0.3, "reset");
    near(at(3.0e-3), 0, 0.3, "stays reset against the edge at 2.5 ms");
});

test("SPICE import: J cards, K coupling, EXP and SFFM sources", () => {
    const { SpiceParser } = S;
    const deck = SpiceParser.parse(`jfet amp
VDD vdd 0 12
RD vdd d 1k
J1 d 0 0 NJ
.model NJ NJF(VTO=-2 BETA=1.25m LAMBDA=0)
.op
.end`);
    const { circuit } = SpiceParser.build(deck);
    near(new SimEngine(circuit).operatingPoint().nodeVoltages.d, 7, 0.02, "JFET deck");
    const k = SpiceParser.parse(`coupled
V1 p 0 SIN(0 1 1k)
R1 p a 1
L1 a 0 1
L2 s 0 4
K1 L1 L2 0.9999
RL s 0 20k
.end`);
    const kb = SpiceParser.build(k);
    if (!kb.circuit.elements.some(e => e instanceof Transformer)) throw new Error("K card was not turned into a transformer");
    const tr = new SimEngine(kb.circuit).transient({ tStop: 4e-3, tStep: 2e-6 });
    const v = tr.nodeHistories.s;
    near(Math.max(...v.slice(v.length >> 1)), 2, 0.1, "turns ratio from L2/L1");
    const w = SpiceParser.parse("src\nV1 a 0 EXP(0 5 1m 1m 5m 2m)\nV2 b 0 SFFM(0 1 1k 2 100)\nR1 a 0 1k\nR2 b 0 1k\n.end");
    const wb = SpiceParser.build(w);
    const r = new SimEngine(wb.circuit).transient({ tStop: 3e-3, tStep: 5e-6 });
    const i = r.timePoints.findIndex(x => x >= 2e-3);
    near(r.nodeHistories.a[i], 5 * (1 - Math.exp(-1)), 0.02, "EXP");
});

test("vendor JFET models import as JFET parts", () => {
    const { SimModelLibrary, SIM_MODELS } = S;
    const r = SimModelLibrary.importText("m\n.model VJ NJF(VTO=-1.5 BETA=2m)\n.model VP PJF(VTO=-2 BETA=1m)\n.end");
    if (!SIM_MODELS.JFET_N.VJ || !SIM_MODELS.JFET_P.VP) throw new Error(JSON.stringify(r));
    if (!/^\.model VJ NJF\(VTO=-1\.5/.test(S.simModelCard("JFET_N", "VJ"))) throw new Error(S.simModelCard("JFET_N", "VJ"));
});

test("current-controlled current source: optocoupler transfer and saturation", () => {
    const run = (rload) => {
        const c = new SimCircuit();
        c.add(new VoltageSource("V1", ["in", "0"], vdc(5)));
        c.add(new Resistor("R1", ["in", "a"], { r: 1000 }));
        c.add(new VoltageSource("VS", ["a", "m"], vdc(0)));              // ammeter in series with the LED
        c.add(new Diode("D1", ["m", "0"], simModel("LED", "RED").params));
        c.add(new VoltageSource("V2", ["vcc", "0"], vdc(5)));
        c.add(new Resistor("RL", ["vcc", "out"], { r: rload }));
        c.add(new CCCS("F1", ["out", "0"], { ctrl: "VS", gain: 1.0, vsat: 0.3 }));
        const op = new SimEngine(c).operatingPoint();
        return { vout: op.nodeVoltages.out, iled: (5 - op.nodeVoltages.m - op.nodeVoltages.a + op.nodeVoltages.a) };
    };
    // 3.2 mA LED current x CTR 1 = 3.2 mA through 470 ohm -> 5 - 1.5 V
    const lin = run(470);
    near(lin.vout, 5 - 0.0032 * 470, 0.15, "linear region");
    const sat = run(10000);
    if (!(sat.vout >= -0.01 && sat.vout < 0.15)) throw new Error("saturated output should sit near 0 V, got " + sat.vout);
});

test("digital ICs in the analog engine: 74161 counter, ripple BCD, shift register, decoder (DC and transient)", () => {
    const clock = (f, v = 5) => ({ wave: Waveform.pulse({ v1: 0, v2: v, delay: 0.25 / f, rise: 1e-9, fall: 1e-9, width: 0.5 / f, period: 1 / f }) });
    const level = (x) => (x > 2.5 ? 1 : 0);
    const nibble = (r, names, t) => names.reduce((a, n, i) => a | (level(r.nodeHistories[n][r.timePoints.findIndex(x => x >= t)]) << i), 0);

    // 74161 counting a 1 kHz clock: rising edges at 0.25, 1.25, 2.25 ms ...
    const c = new SimCircuit();
    c.add(new VoltageSource("CK", ["ck", "0"], clock(1000)));
    c.add(new DigitalIC("U1", ["0", "0", "0", "0", "ck", "hi", "hi", "hi", "hi", "qa", "qb", "qc", "qd", "rco"], LOGIC_ICS["74161"], { vcc: 5 }));
    c.add(new VoltageSource("VH", ["hi", "0"], vdc(5)));
    const r = new SimEngine(c).transient({ tStop: 20.5e-3, tStep: 20e-6 });
    const q = (t) => nibble(r, ["qa", "qb", "qc", "qd"], t);
    if (q(0.1e-3) !== 0) throw new Error("starts at 0: " + q(0.1e-3));
    for (const [t, n] of [[0.6e-3, 1], [2.6e-3, 3], [9.6e-3, 10], [15.6e-3, 0], [16.6e-3, 1]]) {
        if (q(t) !== n) throw new Error(`count at ${t * 1e3} ms: expected ${n}, got ${q(t)}`);
    }

    // ripple BCD: 7490 with QA wired to CKB counts to 9 and wraps
    const d = new SimCircuit();
    d.add(new VoltageSource("CK", ["ck", "0"], clock(1000)));
    d.add(new DigitalIC("U1", ["ck", "qa", "0", "0", "0", "0", "qa", "qb", "qc", "qd"], LOGIC_ICS["7490"], { vcc: 5 }));
    const rd = new SimEngine(d).transient({ tStop: 12.5e-3, tStep: 20e-6 });
    const bcd = (t) => nibble(rd, ["qa", "qb", "qc", "qd"], t);
    // 7490 counts on the FALLING edge of CKA: falls at 0.75, 1.75 ...
    for (const [t, n] of [[0.9e-3, 1], [4.9e-3, 5], [8.9e-3, 9], [9.9e-3, 0], [10.9e-3, 1]]) {
        if (bcd(t) !== n) throw new Error(`BCD at ${t * 1e3} ms: expected ${n}, got ${bcd(t)}`);
    }

    // 74164 shifts a serial pattern in: data 1,0,1,1 sampled on the rising edges
    const sr = new SimCircuit();
    sr.add(new VoltageSource("CK", ["ck", "0"], clock(1000)));
    sr.add(new VoltageSource("DA", ["da", "0"], { wave: Waveform.pwl([[0, 5], [1.0e-3, 5], [1.001e-3, 0], [2.0e-3, 0], [2.001e-3, 5], [4.0e-3, 5], [4.001e-3, 0], [8e-3, 0]]) }));
    sr.add(new VoltageSource("VH", ["hi", "0"], vdc(5)));
    sr.add(new DigitalIC("U1", ["da", "hi", "ck", "hi", "qa", "qb", "qc", "qd", "qe", "qf", "qg", "qh"], LOGIC_ICS["74164"], { vcc: 5 }));
    const rs = new SimEngine(sr).transient({ tStop: 5e-3, tStep: 20e-6 });
    const reg = nibble(rs, ["qa", "qb", "qc", "qd"], 4.2e-3);
    // rising edges at 0.25 (D=1), 1.25 (D=0), 2.25 (D=1), 3.25 (D=1): QA = newest, so QA..QD = 1,1,0,1
    if (reg !== 0b1011) throw new Error("shift register holds " + reg.toString(2));

    // combinational: a 3-to-8 decoder from DC sources, in the operating point
    const dec = new SimCircuit();
    for (const [n, v] of [["a", 5], ["b", 0], ["c", 5], ["g", 5]]) dec.add(new VoltageSource("V" + n, [n, "0"], vdc(v)));
    const pins = ["a", "b", "c", "g", "0", "0", ...Array.from({ length: 8 }, (_, i) => "y" + i)];
    dec.add(new DigitalIC("U1", pins, LOGIC_ICS["74138"], { vcc: 5 }));
    const op = new SimEngine(dec).operatingPoint().nodeVoltages;
    const low = Array.from({ length: 8 }, (_, i) => i).filter(i => op["y" + i] < 1);
    if (low.join() !== "5") throw new Error("decoder output low: " + low.join() + " " + JSON.stringify(op));
});

test("EXP and SFFM waveforms", () => {
    const e = Waveform.exp({ v1: 0, v2: 5, td1: 1e-3, tau1: 1e-3, td2: 5e-3, tau2: 2e-3 });
    near(e.at(0.5e-3), 0, 1e-12); rel(e.at(2e-3), 5 * (1 - Math.exp(-1)), 1e-9);
    rel(e.at(5e-3), 5 * (1 - Math.exp(-4)), 1e-9);
    near(e.at(7e-3), 5 * (1 - Math.exp(-6)) - 5 * (1 - Math.exp(-1)), 1e-9, "decay");
    const f = Waveform.sffm({ vo: 1, va: 2, fc: 1000, mdi: 3, fs: 100 });
    near(f.at(0.25e-3), 1 + 2 * Math.sin(2 * Math.PI * 1000 * 0.25e-3 + 3 * Math.sin(2 * Math.PI * 100 * 0.25e-3)), 1e-12);
});


console.log("behavioural (B) sources and expressions");

test("expressions: operators, precedence, functions, ternary and SPICE suffixes", () => {
    const ev = (t, vals = [], time = 0) => Expr.compile(t).eval(vals, time);
    near(ev("2+3*4"), 14, 1e-12); near(ev("(2+3)*4"), 20, 1e-12); near(ev("-2^2"), -4, 1e-12, "unary minus binds looser than ^"); near(ev("2^3^2"), 64, 1e-12, "^ chains group to the left, as in ngspice"); near(ev("2^-1"), 0.5, 1e-12); near(ev("-2^2"), -4, 1e-12); near(ev("log(10)"), Math.LN10, 1e-12, "log is the natural log");
    near(ev("10k*1.5"), 15000, 1e-9); near(ev("2meg/4"), 5e5, 1e-6); near(ev("3u*1e6"), 3, 1e-12);
    near(ev("sin(pi/2)+cos(0)"), 2, 1e-12); near(ev("max(3,min(9,5))"), 5, 1e-12); near(ev("limit(7,0,5)"), 5, 1e-12);
    near(ev("1<2 && 3>2 ? 10 : 20"), 10, 1e-12); near(ev("!0 + (2==2)"), 2, 1e-12); near(ev("if(0,1,2)"), 2, 1e-12);
    near(ev("time*1k", [], 0.002), 2, 1e-12); near(ev("pwr(-2,2)"), -4, 1e-12); near(ev("u(-1)+u(2)+uramp(-3)+uramp(3)"), 4, 1e-12);
    if (!Number.isFinite(ev("1/0")) || !Number.isFinite(ev("ln(0)")) || !Number.isFinite(ev("sqrt(-1)")) || !Number.isFinite(ev("exp(1e4)"))) throw new Error("non-finite results escape");
});
test("expressions: the ngspice form rewrites limit() and if() and flags the functions ngspice lacks", () => {
    const a = Expr.toSpice("limit(v(a)*2, -3, 3) + 1"), b = Expr.toSpice("if(v(a)>1, limit(v(b),0,1), atan2(1,2))");
    if (a.text !== "max(min(-3,3),min(max(-3,3),v(a)*2)) + 1" || a.unsupported.length) throw new Error(a.text);
    if (!/^\(\(v\(a\)>1\)\?\(max\(min\(0,1\),min\(max\(0,1\),v\(b\)\)\)\):\(atan2\(1,2\)\)\)$/.test(b.text) || b.unsupported.join() !== "atan2") throw new Error(b.text + " " + b.unsupported);
    const e1 = Expr.compile("limit(v(a)*2,-3,3)").eval([2]), e2 = Expr.compile(a.text).eval([2]);
    near(e1 + 1, e2, 1e-12);
});
test("expressions: variables are collected once and evaluated from the value list", () => {
    const e = Expr.compile("v(a,b)*2 + v(a,b) + v(c) + i(vx)");
    if (e.vars.length !== 3 || e.vars[0].type !== "v" || e.vars[0].b !== "b" || e.vars[2].name !== "vx") throw new Error(JSON.stringify(e.vars));
    near(e.eval([1, 10, 100]), 3 + 10 + 100, 1e-12);
});
test("expressions: errors say what is wrong", () => {
    for (const [t, re] of [["2+", /ends too soon/], ["foo(1)", /unknown function/], ["bar", /unknown name/], ["sin(1,2)", /takes 1 argument/], ["(1+2", /expected "\)"/], ["1 $ 2", /unexpected/], ["v()", /node names|expected/]]) {
        let msg = ""; try { Expr.compile(t); } catch (e) { msg = e.message; }
        if (!re.test(msg)) throw new Error(`${t}: ${msg}`);
    }
});
test("B voltage source: V = 3*v(in) is an ideal gain of 3", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], vdc(1.5))); c.add(new Resistor("R1", ["in", "0"], { r: 1000 }));
    c.add(new BSource("B1", ["out", "0"], { mode: "V", expr: "3*v(in)" })); c.add(new Resistor("R2", ["out", "0"], { r: 1000 }));
    const op = new SimEngine(c).operatingPoint();
    near(op.nodeVoltages.out, 4.5, 1e-6); near(op.currents.B1, 4.5e-3 * (op.currents.B1 < 0 ? -1 : 1), 1e-6, "branch current");
});
test("B current source with a nonlinear (square-law) expression converges", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["a", "0"], vdc(2)));
    c.add(new BSource("B1", ["0", "x"], { mode: "I", expr: "v(a)*v(a)/1k" })); c.add(new Resistor("R1", ["x", "0"], { r: 500 }));
    near(new SimEngine(c).operatingPoint().nodeVoltages.x, 2, 1e-6);          // 4 mA * 500
});
test("B source feedback: a nonlinear expression of its own output (x = 1 - x^3 / 3 -> Newton)", () => {
    const c = new SimCircuit();
    c.add(new BSource("B1", ["x", "0"], { mode: "V", expr: "1 - v(x)^3/3" }));
    const x = new SimEngine(c).operatingPoint().nodeVoltages.x;
    near(x + x * x * x / 3, 1, 1e-6);
});
test("B source reads the current of a voltage source with i(name)", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], vdc(5))); c.add(new Resistor("R1", ["in", "0"], { r: 1000 }));
    c.add(new BSource("B1", ["out", "0"], { mode: "V", expr: "abs(i(v1))*1000" })); c.add(new Resistor("R2", ["out", "0"], { r: 1e4 }));
    near(new SimEngine(c).operatingPoint().nodeVoltages.out, 5, 1e-5);
});
test("B source uses time in a transient run", () => {
    const c = new SimCircuit();
    c.add(new BSource("B1", ["o", "0"], { mode: "V", expr: "sin(2*pi*1k*time)" })); c.add(new Resistor("R1", ["o", "0"], { r: 1000 }));
    const r = new SimEngine(c).transient({ tStop: 1e-3, tStep: 1e-6 });
    const at = (t) => { const k = r.timePoints.findIndex(x => x >= t); return r.nodeHistories.o[k]; };
    near(at(0.25e-3), 1, 5e-3); near(at(0.75e-3), -1, 5e-3);
});
test("B source in AC analysis behaves as its small-signal gain", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.dc(0), acMag: 1 })); c.add(new Resistor("R1", ["in", "0"], { r: 1000 }));
    c.add(new BSource("B1", ["out", "0"], { mode: "V", expr: "3*v(in)" })); c.add(new Resistor("R2", ["out", "0"], { r: 1000 }));
    const r = new SimEngine(c).ac({ fStart: 100, fStop: 1000, pointsPerDecade: 2 });
    near(r[0].nodeVoltages.out.magnitude(), 3, 1e-6);
    const d = new SimCircuit();     // a tanh clipper at its operating point has gain 2/1.5 * (1 - tanh^2); at 0 V: 1.3333
    d.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.dc(0), acMag: 1 })); d.add(new Resistor("R1", ["in", "0"], { r: 1000 }));
    d.add(new BSource("B1", ["out", "0"], { mode: "V", expr: "2*tanh(v(in)/1.5)" })); d.add(new Resistor("R2", ["out", "0"], { r: 1000 }));
    near(new SimEngine(d).ac({ fStart: 100, fStop: 1000, pointsPerDecade: 2 })[0].nodeVoltages.out.magnitude(), 4 / 3, 1e-4);
});
test("SPICE decks: B cards parse (V= and I=, spaces around =), and inside a subcircuit the names are prefixed", () => {
    const deck = SpiceParser.parse("t\nV1 in 0 2\nB1 out 0 V = 3*V(in)\nR1 out 0 1k\n.end");
    const { circuit, warnings } = SpiceParser.build(deck);
    if (warnings.length) throw new Error(warnings.join(";"));
    near(new SimEngine(circuit).operatingPoint().nodeVoltages.out, 6, 1e-6);
    const sub = SpiceParser.parse("t\n.subckt amp i o\nB1 o 0 V=2*v(i)\n.ends\nV1 in 0 1.5\nX1 in out amp\nR1 out 0 1k\n.end");
    const r = SpiceParser.build(sub);
    near(new SimEngine(r.circuit).operatingPoint().nodeVoltages.out, 3, 1e-6);
    const bad = SpiceParser.build(SpiceParser.parse("t\nV1 in 0 1\nB1 out 0 V=foo(2)\nR1 out 0 1k\n.end"));
    if (!bad.warnings.some(w => /unknown function/.test(w))) throw new Error("a bad expression should warn: " + bad.warnings);
});


console.log("noise analysis");

test("noise: two 1k resistors in a divider give the thermal noise of 500 ohms", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.dc(0), acMag: 1 })); c.add(new Resistor("R1", ["in", "out"], { r: 1000 })); c.add(new Resistor("R2", ["out", "0"], { r: 1000 }));
    const r = new SimEngine(c).noise({ out: ["out"], input: "V1", fStart: 10, fStop: 1000, pointsPerDecade: 2 });
    const kT = S.SIM.K * 300.15;
    near(r[0].onoise, Math.sqrt(4 * kT * 500), 1e-12, "output noise density");
    near(r[0].gain, 0.5, 1e-9, "gain input to output"); near(r[0].inoise, Math.sqrt(4 * kT * 500) / 0.5, 1e-12, "input referred");
    rel(r[0].parts["R1 thermal"], 4 * kT * 1000 * 0.25, 1e-6, "each resistor contributes through its own transfer"); rel(r[0].parts["R2 thermal"], r[0].parts["R1 thermal"], 1e-6);
});
test("noise: the integrated noise of an RC low-pass is sqrt(kT/C), independent of R", () => {
    for (const R of [1e3, 1e5]) {
        const C = 1e-9, c = new SimCircuit();
        c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.dc(0), acMag: 1 })); c.add(new Resistor("R1", ["in", "out"], { r: R })); c.add(new Capacitor("C1", ["out", "0"], { c: C }));
        const r = new SimEngine(c).noise({ out: ["out"], fStart: 1e-1, fStop: 1e10, pointsPerDecade: 60 });
        let p = 0;
        for (let i = 1; i < r.length; i++) p += 0.5 * (r[i].onoise ** 2 + r[i - 1].onoise ** 2) * (r[i].frequency - r[i - 1].frequency);
        rel(Math.sqrt(p), Math.sqrt(S.SIM.K * 300.15 / C), 0.01, `R=${R}`);
    }
});
test("noise: a forward-biased diode adds shot noise 2qI", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], vdc(5))); c.add(new Resistor("R1", ["in", "a"], { r: 1000 })); c.add(new Diode("D1", ["a", "0"], { is: 1e-14 }));
    const eng = new SimEngine(c), r = eng.noise({ out: ["a"], fStart: 100, fStop: 1000, pointsPerDecade: 1 });
    const id = c.elements.find(e => e.name === "D1").id, rd = S.SIM.VT / id;       // small-signal resistance
    const rp = 1 / (1 / 1000 + 1 / rd);
    rel(r[0].parts["D1 shot"], 2 * S.SIM.Q * id * rp * rp, 0.02);
    rel(r[0].parts["R1 thermal"], (4 * S.SIM.K * 300.15 / 1000) * rp * rp, 0.02);
});
test("noise: a noise-free circuit and a ground output are reported sensibly", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], { wave: Waveform.dc(1), acMag: 1 })); c.add(new Resistor("R1", ["in", "0"], { r: 1000 }));
    let msg = ""; try { new SimEngine(c).noise({ out: ["0"] }); } catch (e) { msg = e.message; }
    if (!/other than ground/.test(msg)) throw new Error(msg);
});
test("noise: the temperature changes the thermal noise as the square root of absolute temperature", () => {
    const mk = (T) => { const c = new SimCircuit(); c.add(new Resistor("R1", ["a", "0"], { r: 1000 })); c.add(new CurrentSource("I1", ["0", "a"], { wave: Waveform.dc(0), acMag: 1 })); return new SimEngine(c, { temp: T }).noise({ out: ["a"], fStart: 10, fStop: 100, pointsPerDecade: 1 })[0].onoise; };
    near(mk(127) / mk(27), Math.sqrt(400.15 / 300.15), 1e-9);
});


console.log("transfer function");
test("tf: a resistive divider driven by a voltage source", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], vdc(1))); c.add(new Resistor("R1", ["in", "out"], { r: 1000 })); c.add(new Resistor("R2", ["out", "0"], { r: 3000 }));
    const r = new SimEngine(c).tf({ out: ["out"], input: "V1" });
    near(r.gain, 0.75, 1e-9); near(r.rin, 4000, 1e-3); near(r.rout, 750, 1e-3);
});
test("tf: a current source input gives a transresistance", () => {
    const c = new SimCircuit();
    c.add(new CurrentSource("I1", ["0", "a"], vdc(1e-3))); c.add(new Resistor("R1", ["a", "0"], { r: 2000 })); c.add(new Resistor("R2", ["a", "out"], { r: 500 })); c.add(new Resistor("R3", ["out", "0"], { r: 500 }));
    const r = new SimEngine(c).tf({ out: ["out"], input: "I1" });
    near(r.rin, 1 / (1 / 2000 + 1 / 1000), 1e-3, "input resistance = R1 || (R2 + R3)");
    near(r.gain, r.rin * 0.5, 1e-3, "transresistance = Rin * divider");
});
test("tf: an input that draws no current has infinite input resistance; a bad source is refused", () => {
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["in", "0"], vdc(1))); c.add(new Resistor("R0", ["in", "0"], { r: 100 }));
    c.add(new BSource("B1", ["out", "0"], { mode: "V", expr: "2*v(in)" })); c.add(new Resistor("R2", ["out", "0"], { r: 1000 }));
    const eng = new SimEngine(c), r = eng.tf({ out: ["out"], input: "V1" });
    near(r.gain, 2, 1e-6); near(r.rout, 0, 1e-3);
    let msg = ""; try { eng.tf({ out: ["out"], input: "R0" }); } catch (e) { msg = e.message; }
    if (!/not a voltage or current source/.test(msg)) throw new Error(msg);
});


console.log("subcircuit parts");
const LIB = `* op-amp macromodel library
.model DCLAMP D(IS=1e-14)
.subckt gainstage in out PARAMS: g=2
Gm 0 a in 0 1m
Rp a 0 {1k}
Bo out 0 V = 10*v(a)
.ends gainstage
.subckt OAMP inp inn out
Rin inp inn 1Meg
Gm 0 a inp inn 1m
Rp a 0 100Meg
Cp a 0 1.59n
Bout b 0 V = limit(v(a), -13, 13)
Ro b out 75
D1 a 0 DCLAMP
X1 inp aux gainstage
.ends OAMP
`;
test("subcircuit parts: extraction keeps ports, nested subcircuits and the models a block uses", () => {
    const SubcktLibrary = new Function("SpiceParser", "PartLib", "logicICGeometry", S.__src_subckt + "\nreturn SubcktLibrary;")(S.SpiceParser, { add() { } }, () => ({ symbol: {} }));
    const defs = SubcktLibrary.extract(LIB);
    if (defs.length !== 2) throw new Error("expected 2 blocks, got " + defs.length);
    const oamp = defs.find(d => d.name === "OAMP");
    if (oamp.ports.join() !== "inp,inn,out") throw new Error(oamp.ports.join());
    if (!/\.subckt gainstage/i.test(oamp.text)) throw new Error("the nested subcircuit travels with its user");
    if (oamp.models.length !== 1 || !/DCLAMP/.test(oamp.models[0])) throw new Error(JSON.stringify(oamp.models));
    if (defs.find(d => d.name === "gainstage").ports.join() !== "in,out") throw new Error("PARAMS: must end the port list");
});
test("subcircuit parts: an expanded instance simulates like the written-out circuit", () => {
    const SubcktLibrary = new Function("SpiceParser", "PartLib", "logicICGeometry", S.__src_subckt + "\nreturn SubcktLibrary;")(S.SpiceParser, { add() { } }, () => ({ symbol: {} }));
    const def = SubcktLibrary.extract(LIB).find(d => d.name === "OAMP");
    const c = new SimCircuit();
    c.add(new VoltageSource("V1", ["a", "0"], vdc(0.001))); c.add(new Resistor("R1", ["a", "m"], { r: 1000 })); c.add(new Resistor("R2", ["m", "o"], { r: 100000 }));
    c.add(new Resistor("RP", ["p", "0"], { r: 1 })); c.add(new Resistor("RL", ["o", "0"], { r: 10000 }));
    S.SpiceParser.addSubckt(c, def, ["p", "m", "o"], "U1", []);
    const op = new SimEngine(c).operatingPoint().nodeVoltages;
    rel(op.o, -0.1, 0.01, "inverting gain of -100 at 1 mV");     // open-loop gain 1e5 / 1.0 makes it ideal
    if (!Object.keys(op).some(k => k.toLowerCase().startsWith("u1."))) throw new Error("inner nodes are prefixed with the instance name");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
    console.log("failed: " + failures.join("; "));
    process.exit(1);
}

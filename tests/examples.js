// Runs every built-in example through its intended analysis and checks the physics.
// In the running app:  (0, eval)(await (await fetch('tests/examples.js')).text()); exampleTests();

window.exampleTests = function () {
    const results = [];
    const check = (name, fn) => {
        try { fn(); results.push({ name, pass: true }); }
        catch (e) { results.push({ name, pass: false, error: e.message }); }
    };
    const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: expected ${b} +/- ${tol}, got ${a}`); };

    const load = (id) => {
        loadExampleById(editor, id);
        const blocked = editor.wires.filter(w => w.blocked).length;
        if (blocked) throw new Error(`${blocked} unroutable wire(s)`);
        const info = NetlistExtractor.extract(editor);
        if (info.warnings.length) throw new Error("warnings: " + info.warnings.join("; "));
        return { info, sim: new SimEngine(info.circuit) };
    };
    const nodeOf = (info, name, pin) => info.getTerminalNodeName(editor.components.find(c => c.name === name), pin);
    const tail = (arr, frac) => arr.slice(Math.floor(arr.length * (1 - frac)));
    const risingEdges = (t, v, level) => {
        const out = [];
        for (let i = 1; i < v.length; i++) if (v[i - 1] < level && v[i] >= level) out.push(t[i]);
        return out;
    };

    check("rc-ladder: series capacitors settle to a charge-sharing divider", () => {
        const { info, sim } = load("rc-ladder");
        const r = sim.transient({ tStop: 0.2, tStep: 2e-4, uic: true });
        const v = r.nodeHistories[nodeOf(info, "C2", "1")];
        // no DC path between the caps: V(c2) = 10 * C1 / (C1 + C2)
        near(v[v.length - 1], 10 * 10 / (10 + 4.7), 0.1, "V(c2)");
    });

    check("half-wave: peak output ~ Vpk - diode drop with ripple", () => {
        const { info, sim } = load("half-wave");
        const r = sim.transient({ tStop: 0.06, tStep: 1e-4, uic: true });
        const t = tail(r.nodeHistories[nodeOf(info, "D1", "2")], 0.4);
        const peak = Math.max(...t), low = Math.min(...t);
        if (peak < 9 || peak > 9.8) throw new Error("peak " + peak);
        if (peak - low < 0.2 || peak - low > 2.5) throw new Error("ripple " + (peak - low));
    });

    check("led: about 10 mA", () => {
        const { sim } = load("led");
        const i = sim.operatingPoint().currents.R1;
        near(i, 0.0097, 0.002, "I(R1)");
    });

    check("zener: load held near 5.1 V", () => {
        const { info, sim } = load("zener");
        const op = sim.operatingPoint();
        near(op.nodeVoltages[nodeOf(info, "R2", "1")], 5.1, 0.4, "V(load)");
    });

    check("ce-amp: biased in the active region and amplifies with inversion", () => {
        const { info, sim } = load("ce-amp");
        const op = sim.operatingPoint();
        const vc = op.nodeVoltages[nodeOf(info, "Q1", "C")];
        if (vc < 4 || vc > 11) throw new Error("collector bias " + vc);
        const r = sim.transient({ tStop: 0.006, tStep: 5e-6, uic: false });
        const out = tail(r.nodeHistories[nodeOf(info, "Q1", "C")], 0.3);
        const inp = tail(r.nodeHistories[nodeOf(info, "C1", "1")], 0.3);
        const gain = (Math.max(...out) - Math.min(...out)) / (Math.max(...inp) - Math.min(...inp));
        if (gain < 30) throw new Error("gain " + gain);
        // inverted: output peaks while the input is at its minimum
        const iMax = out.indexOf(Math.max(...out)), iMinIn = inp.indexOf(Math.min(...inp));
        const period = 1 / 1000 / 5e-6; // samples per cycle
        const d = Math.abs(iMax - iMinIn) % period;
        if (Math.min(d, period - d) > period * 0.15) throw new Error("not inverted");
    });

    check("inverting-opamp: gain of -10", () => {
        const { info, sim } = load("inverting-opamp");
        const r = sim.transient({ tStop: 0.004, tStep: 5e-6, uic: false });
        const out = tail(r.nodeHistories[nodeOf(info, "U1", "OUT")], 0.4);
        near(Math.max(...out), 5, 0.4, "positive peak");
        near(Math.min(...out), -5, 0.4, "negative peak");
    });

    check("555-astable: ~690 Hz at the output", () => {
        const { info, sim } = load("555-astable");
        const r = sim.transient({ tStop: 0.02, tStep: 5e-6, uic: true });
        const edges = risingEdges(r.timePoints, r.nodeHistories[nodeOf(info, "U1", "OUT")], 2.5);
        if (edges.length < 8) throw new Error("only " + edges.length + " edges");
        const f = (edges.length - 2) / (edges[edges.length - 1] - edges[1]);
        near(f, 1.44 / ((1000 + 20000) * 100e-9), 70, "frequency");
    });

    check("diode-iv: sweep shows the exponential knee", () => {
        const { sim } = load("diode-iv");
        const r = sim.dcSweep("V1", 0, 1, 0.01);
        const i = r.currentHistories.D1;
        const at = (v) => i[Math.round(v / 0.01)];
        if (at(0.3) > 1e-5) throw new Error("conducting too early: " + at(0.3));
        if (at(0.9) < 5e-3) throw new Error("not conducting at 0.9 V: " + at(0.9));
        if (!(at(0.8) > at(0.7) && at(0.7) > at(0.6))) throw new Error("not monotonic");
    });

    check("pot-divider: wiper at 25 % loaded by the switch", () => {
        const { info, sim } = load("pot-divider");
        const w = sim.operatingPoint().nodeVoltages[nodeOf(info, "RV1", "W")];
        // 2.5 kΩ above the wiper to 10 V, 7.5 kΩ below it in parallel with the 10 kΩ load (4.286 kΩ)
        near(w, 10 * 4.2857 / (2.5 + 4.2857), 0.05, "wiper (switch closed)");
        const sw = editor.components.find(c => c.type === "SW"); sw.closed = false;
        const w2 = new SimEngine(NetlistExtractor.extract(editor).circuit).operatingPoint().nodeVoltages[nodeOf(info, "RV1", "W")];
        near(w2, 7.5, 0.01, "wiper (switch open)");
    });

    check("initial-condition flag: capacitor discharges from its IC and round-trips to .ic", () => {
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        const b = new ExampleBuilder(editor);
        const c = b.part("C", 300, 200, { rot: 90, value: "1 µF" });
        const r = b.part("R", 440, 200, { rot: 90, value: "1 kΩ" });
        const ic = b.part("NODEIC", 300, 60, { value: "3 V" });
        const g = b.part("GND", 370, 340);
        b.wire(c, "1", r, "1"); b.wire(c, "2", g, "1"); b.wire(r, "2", g, "1"); b.wire(ic, "1", c, "1");
        b.finish();
        const info = NetlistExtractor.extract(editor);
        const net = nodeOf(info, "C1", "1");
        near(info.nodeIC[net], 3, 1e-9, ".ic value");
        const r2 = new SimEngine(info.circuit).transient({ tStop: 3e-3, tStep: 2e-5, uic: true, nodeIC: info.nodeIC });
        const v = r2.nodeHistories[net];
        near(v[0], 3, 0.01, "V(0)");
        const k = r2.timePoints.findIndex(t => t >= 1e-3);
        near(v[k], 3 * Math.exp(-1), 0.05, "V(1 ms)");
        if (!/\.ic v\(1\)=3/.test(NetlistExtractor.toSpice(info.elements, { analysis: ".tran 20u 3m uic" }))) throw new Error("no .ic line in the export");
    });

    check("boost: steps 5 V up to ~9.7 V", () => {
        const { info, sim } = load("boost");
        const r = sim.transient({ tStop: 0.02, tStep: 1e-6, uic: true });
        const t = tail(r.nodeHistories[nodeOf(info, "D1", "2")], 0.1);
        const avg = t.reduce((a, b) => a + b, 0) / t.length;
        near(avg, 9.7, 0.6, "Vout");
    });

    check("psu: bridge + reservoir + 7805 give a steady 5 V", () => {
        const { info, sim } = load("psu");
        const r = sim.transient({ tStop: 0.08, tStep: 1e-4, uic: true });
        const out = tail(r.nodeHistories[nodeOf(info, "U1", "OUT")], 0.4);
        near(Math.min(...out), 5, 0.05, "Vout min"); near(Math.max(...out), 5, 0.05, "Vout max");
        const un = tail(r.nodeHistories[nodeOf(info, "C1", "1")], 0.4);
        if (Math.min(...un) < 9) throw new Error("reservoir dips to " + Math.min(...un) + " V; the regulator would drop out");
    });

    check("jfet-amp: biased in saturation, inverts and amplifies", () => {
        const { info, sim } = load("jfet-amp");
        const op = sim.operatingPoint();
        const vd = op.nodeVoltages[nodeOf(info, "Q1", "D")];
        if (vd < 4 || vd > 14) throw new Error("drain at " + vd);
        const ac = sim.ac({ fStart: 1000, fStop: 1000, pointsPerDecade: 1 })[0];
        const gain = ac.nodeVoltages[nodeOf(info, "Q1", "D")].magnitude() / ac.nodeVoltages[nodeOf(info, "Q1", "G")].magnitude();
        if (gain < 5) throw new Error("gain " + gain);
        near(Math.abs(ac.nodeVoltages[nodeOf(info, "Q1", "D")].phaseDegrees()), 180, 5, "phase");
    });

    check("relay-driver: the lamp lights only while the input is high", () => {
        const { info, sim } = load("relay-driver");
        const r = sim.transient({ tStop: 0.08, tStep: 5e-5, uic: true });
        const lamp = r.nodeHistories[nodeOf(info, "LP1", "1")];
        const at = (t) => lamp[r.timePoints.findIndex(x => x >= t)];
        near(at(2e-3), 0, 0.1, "off before the pulse"); near(at(25e-3), 12, 0.3, "on during the pulse");
        near(at(50e-3), 0, 0.1, "off after the pulse");
    });

    check("scr-lamp: fires after the gate pulse and latches for the rest of the half-cycle", () => {
        const { info, sim } = load("scr-lamp");
        const r = sim.transient({ tStop: 0.06, tStep: 5e-5, uic: true });
        const v = r.nodeHistories[nodeOf(info, "LP1", "2")];
        const at = (t) => v[r.timePoints.findIndex(x => x >= t)];
        if (at(2e-3) < 10) throw new Error("should be blocking before the gate pulse: " + at(2e-3));
        near(at(5e-3), 1.1, 0.4, "latched on"); near(at(8e-3), 1.1, 0.4, "still on");
        if (at(16e-3) > -10) throw new Error("should follow the negative half-cycle: " + at(16e-3));
    });

    check("ripple-counter: each stage halves the frequency", () => {
        const { info, sim } = load("ripple-counter");
        const r = sim.transient({ tStop: 0.02, tStep: 1e-5, uic: true });
        const edges = [1, 2, 3].map(i => risingEdges(r.timePoints, r.nodeHistories[nodeOf(info, "U" + i, "Q")], 2.5).length);
        near(edges[0], 10, 1, "Q0 edges in 20 ms (500 Hz)"); near(edges[1], 5, 1, "Q1"); near(edges[2], 2.5, 1, "Q2");
    });

    check("counter-7seg: the 74161 counts the clock and the 7447 shows the digit", () => {
        const { info, sim } = load("counter-7seg");
        const r = sim.transient({ tStop: 0.5, tStep: 1e-3, uic: true });
        const q = (t) => ["QA", "QB", "QC", "QD"].reduce((a, n, i) => a | ((r.nodeHistories[nodeOf(info, "U1", n)][r.timePoints.findIndex(x => x >= t)] > 2.5 ? 1 : 0) << i), 0);
        // 10 Hz square clock, high first: rising edges at 0, 100, 200 ... ms
        near(q(0.05), 1, 0, "after the first edge"); near(q(0.15), 2, 0, "after 2"); near(q(0.35), 4, 0, "after 4"); near(q(0.45), 5, 0, "after 5");
        // the displayed segments after five counts: a, c, d, f, g lit (a "5")
        const seg = (n, t) => r.nodeHistories[nodeOf(info, "U2", n)][r.timePoints.findIndex(x => x >= t)] < 2.5;   // active low: low = lit
        const lit = "abcdefg".split("").filter(n => seg(n, 0.45)).join("");
        if (lit !== "acdfg") throw new Error("display shows segments " + lit);
    });

    check("shift-register: a single 1 marches along the 74164 outputs", () => {
        const { info, sim } = load("shift-register");
        const r = sim.transient({ tStop: 1.0, tStep: 1e-3, uic: true });
        const at = (n, t) => r.nodeHistories[nodeOf(info, "U1", n)][r.timePoints.findIndex(x => x >= t)] > 2.5;
        // clock edges at 0, 100, 200 ... ms; the data pulse is high 20-120 ms, so only the edge at 100 ms samples a 1
        const hot = (t) => "ABCDEFGH".split("").filter(c => at("Q" + c, t)).join("");
        if (hot(0.05) !== "") throw new Error("nothing yet: " + hot(0.05));
        if (hot(0.15) !== "A") throw new Error("after the edge at 100 ms: " + hot(0.15));
        if (hot(0.25) !== "B" || hot(0.55) !== "E") throw new Error("the 1 marches one place per edge: " + hot(0.25) + " / " + hot(0.55));
    });

    // ngspice (WASM) backend vs the built-in engine on the 555 oscillator
    const pending = (async () => {
        try {
            const { info, sim } = load("555-astable");
            const out = nodeOf(info, "U1", "OUT");
            const mine = sim.transient({ tStop: 0.02, tStep: 5e-6, uic: true });
            const raw = await NgspiceBackend.run(NetlistExtractor.toSpice(info.elements, { analysis: ".tran 5u 20m uic" }));
            const ng = NgspiceBackend.toTransient(raw, info);
            const freq = (t, v) => { const e = risingEdges(t, v, 2.5); return (e.length - 2) / (e[e.length - 1] - e[1]); };
            const fm = freq(mine.timePoints, mine.nodeHistories[out]);
            const fn = freq(ng.timePoints, ng.nodeHistories[out]);
            near(fn / fm, 1, 0.08, "ngspice / built-in frequency ratio");
            results.push({ name: "555: ngspice macro and built-in engine agree on frequency", pass: true });
        } catch (e) {
            results.push({ name: "555: ngspice macro and built-in engine agree on frequency", pass: false, error: e.message });
        }
    })();

    return pending.then(() => {
        const failed = results.filter(r => !r.pass);
        return { total: results.length, failed: failed.length, failures: failed };
    });
};

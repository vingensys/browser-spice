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
        const vc = op.nodeVoltages[nodeOf(info, "BJT_NPN1", "C")];
        if (vc < 4 || vc > 11) throw new Error("collector bias " + vc);
        const r = sim.transient({ tStop: 0.006, tStep: 5e-6, uic: false });
        const out = tail(r.nodeHistories[nodeOf(info, "BJT_NPN1", "C")], 0.3);
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
        const out = tail(r.nodeHistories[nodeOf(info, "OPAMP1", "OUT")], 0.4);
        near(Math.max(...out), 5, 0.4, "positive peak");
        near(Math.min(...out), -5, 0.4, "negative peak");
    });

    check("555-astable: ~690 Hz at the output", () => {
        const { info, sim } = load("555-astable");
        const r = sim.transient({ tStop: 0.02, tStep: 5e-6, uic: true });
        const edges = risingEdges(r.timePoints, r.nodeHistories[nodeOf(info, "IC5551", "OUT")], 2.5);
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
        const w = sim.operatingPoint().nodeVoltages[nodeOf(info, "POT1", "W")];
        // 2.5 kΩ above the wiper to 10 V, 7.5 kΩ below it in parallel with the 10 kΩ load (4.286 kΩ)
        near(w, 10 * 4.2857 / (2.5 + 4.2857), 0.05, "wiper (switch closed)");
        const sw = editor.components.find(c => c.type === "SW"); sw.closed = false;
        const w2 = new SimEngine(NetlistExtractor.extract(editor).circuit).operatingPoint().nodeVoltages[nodeOf(info, "POT1", "W")];
        near(w2, 7.5, 0.01, "wiper (switch open)");
    });

    check("boost: steps 5 V up to ~9.7 V", () => {
        const { info, sim } = load("boost");
        const r = sim.transient({ tStop: 0.02, tStep: 1e-6, uic: true });
        const t = tail(r.nodeHistories[nodeOf(info, "D1", "2")], 0.1);
        const avg = t.reduce((a, b) => a + b, 0) / t.length;
        near(avg, 9.7, 0.6, "Vout");
    });

    // ngspice (WASM) backend vs the built-in engine on the 555 oscillator
    const pending = (async () => {
        try {
            const { info, sim } = load("555-astable");
            const out = nodeOf(info, "IC5551", "OUT");
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

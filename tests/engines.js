// Built-in engine vs ngspice-WASM on the same schematics, through the real exporter.
//   (0, eval)(await (await fetch('tests/engines.js')).text()); await engineTests();
// Every example plus a circuit that uses each newer part (current source, VCVS, VCCS,
// switch, potentiometer, PWL source, logic gates).

window.engineTests = async function () {
    const results = [];
    const interp = (xs, ys, x) => {
        let lo = 0, hi = xs.length - 1;
        if (x <= xs[0]) return ys[0];
        if (x >= xs[hi]) return ys[hi];
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
        const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
        return ys[lo] + f * (ys[hi] - ys[lo]);
    };

    const compare = async (id, build, tran, tol = { op: 0.01, tran: 0.04 }, opts = {}) => {
        try {
            build();
            const info = NetlistExtractor.extract(editor);
            const mine = new SimEngine(info.circuit);
            const opMine = mine.operatingPoint();
            const opNg = NgspiceBackend.toOperatingPoint(await NgspiceBackend.run(NetlistExtractor.toSpice(info.elements, { analysis: ".op" })), info);
            let worstOp = 0;
            const span = Math.max(1, ...Object.values(opNg.nodeVoltages).map(Math.abs));
            for (const [n, v] of Object.entries(opNg.nodeVoltages)) {
                if (opts.skipOp || opMine.nodeVoltages[n] === undefined) continue;
                worstOp = Math.max(worstOp, Math.abs(opMine.nodeVoltages[n] - v) / span);
            }
            let worstTran = 0;
            if (tran) {
                const uic = opts.uic !== false;
                const rMine = new SimEngine(NetlistExtractor.extract(editor).circuit).transient({ tStop: tran.tStop, tStep: tran.tStep, uic });
                const rNg = NgspiceBackend.toTransient(await NgspiceBackend.run(
                    NetlistExtractor.toSpice(info.elements, { analysis: `.tran ${tran.tStep} ${tran.tStop}${uic ? " uic" : ""}` })), info);
                for (const n of Object.keys(rNg.nodeHistories)) {
                    if (!rMine.nodeHistories[n]) continue; // ngspice-internal subcircuit nodes
                    const ys = rNg.nodeHistories[n];
                    const range = Math.max(Math.max(...ys) - Math.min(...ys), 0.05 * Math.max(...ys.map(Math.abs)), 1e-3);
                    let acc = 0;
                    rNg.timePoints.forEach((t, i) => { const d = interp(rMine.timePoints, rMine.nodeHistories[n], t) - ys[i]; acc += d * d; });
                    worstTran = Math.max(worstTran, Math.sqrt(acc / rNg.timePoints.length) / range);
                }
            }
            const pass = worstOp <= tol.op && worstTran <= tol.tran;
            results.push({ id, pass, op: +(worstOp * 100).toFixed(3), tran: tran ? +(worstTran * 100).toFixed(3) : null });
        } catch (e) {
            results.push({ id, pass: false, error: e.message });
        }
    };

    // per-example settings: tolerance, whether to start from the DC solution, ngspice OP is unreliable
    const SPECIAL = {
        "rc-ladder": { opts: { skipOp: true } },                         // floating node between series caps
        "ce-amp": { opts: { uic: false } },                              // bias circuit: start from the operating point
        "inverting-opamp": { opts: { uic: false } },
        "555-astable": { tol: { op: 0.05, tran: 0.6 }, opts: { skipOp: true } }, // bistable: no unique DC state; periods differ ~1-2 %
        "boost": { tol: { op: 0.01, tran: 0.2 } }                        // switching ripple is phase sensitive
    };
    for (const ex of EXAMPLES) {
        if (ex.id === "diode-iv") continue; // swept, not transient
        const tStop = Units.parseSI(ex.settings.tStop || "0"), tStep = Units.parseSI(ex.settings.tStep || "0");
        const sp = SPECIAL[ex.id] || {};
        await compare(ex.id, () => loadExampleById(editor, ex.id), tStop ? { tStop, tStep } : null, sp.tol, sp.opts);
    }

    // every newer part in one schematic
    await compare("new-parts", () => {
        loadExampleById(editor, "rc-ladder");
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        const b = new ExampleBuilder(editor);
        const v = b.part("V", 100, 300, { rot: 270, sourceType: "PWL", pwl: "0 0 1m 5 2m 5 3m 0", dcVoltage: 0 });
        const e = b.part("E", 280, 240, { value: "2" });
        const r1 = b.part("R", 440, 340, { rot: 90, value: "1 kΩ" });
        const g = b.part("G", 600, 240, { value: "2 mS" });
        const r2 = b.part("R", 760, 340, { rot: 90, value: "2 kΩ" });
        const p = b.part("POT", 440, 100, { value: "10 kΩ", position: 0.3 });
        const i = b.part("I", 900, 300, { rot: 270, sourceType: "DC", dcVoltage: 0.0005, value: "500 µA" });
        const sw = b.part("SW", 620, 100, { closed: true, value: "closed" });
        const g0 = b.part("GND", 440, 520);
        b.wire(v, "2", e, "C+"); b.wire(e, "C-", g0, "1"); b.wire(e, "O+", r1, "1"); b.wire(e, "O-", g0, "1");
        b.wire(r1, "2", g0, "1"); b.wire(r1, "1", g, "C+"); b.wire(g, "C-", g0, "1");
        b.wire(g, "O+", r2, "1"); b.wire(g, "O-", g0, "1"); b.wire(r2, "2", g0, "1");
        b.wire(v, "1", g0, "1"); b.wire(r1, "1", p, "A"); b.wire(p, "B", g0, "1"); b.wire(p, "W", sw, "1");
        b.wire(sw, "2", r2, "1"); b.wire(i, "2", r2, "1"); b.wire(i, "1", g0, "1");
        b.vprobe(r1, "1", "a"); b.vprobe(r2, "1", "b");
        b.finish();
    }, { tStop: 3.5e-3, tStep: 10e-6 });

    // logic gates driven by pulses (built-in smooth gates vs the exported u() expressions)
    await compare("gates", () => {
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        const b = new ExampleBuilder(editor);
        const va = b.part("V", 100, 200, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 5, delay: 0, rise: 1e-9, fall: 1e-9, width: 100e-6, period: 200e-6 } });
        const vb = b.part("V", 100, 420, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 5, delay: 0, rise: 1e-9, fall: 1e-9, width: 50e-6, period: 100e-6 } });
        const nand = b.part("NAND", 340, 300, { vcc: "5" });
        const inv = b.part("NOT", 560, 300, { vcc: "5" });
        const rl = b.part("R", 760, 380, { rot: 90, value: "100 kΩ" });
        const g = b.part("GND", 400, 520);
        b.wire(va, "2", nand, "A"); b.wire(vb, "2", nand, "B"); b.wire(nand, "Y", inv, "A");
        b.wire(inv, "Y", rl, "1"); b.wire(rl, "2", g, "1"); b.wire(va, "1", g, "1"); b.wire(vb, "1", g, "1");
        b.vprobe(nand, "Y", "nand"); b.vprobe(inv, "Y", "and");
        b.finish();
    }, { tStop: 400e-6, tStep: 0.5e-6 }, { op: 0.02, tran: 0.3 }); // levels agree; the built-in gate has a 10 ns propagation delay at each edge

    const failed = results.filter(r => !r.pass);
    return { total: results.length, failed: failed.length, failures: failed, results };
};

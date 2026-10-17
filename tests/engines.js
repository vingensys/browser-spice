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
            const opNg = NgspiceBackend.toOperatingPoint(await NgspiceBackend.run(NetlistExtractor.toSpice(info.elements, { analysis: ".op", options: opts.exportOptions })), info);
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
                    NetlistExtractor.toSpice(info.elements, { analysis: `.tran ${tran.tStep} ${tran.tStop}${uic ? " uic" : ""}`, options: opts.exportOptions })), info);
                for (const n of Object.keys(rNg.nodeHistories)) {
                    if (!rMine.nodeHistories[n]) continue; // ngspice-internal subcircuit nodes
                    const ys = rNg.nodeHistories[n];
                    const range = Math.max(Math.max(...ys) - Math.min(...ys), 0.05 * Math.max(...ys.map(Math.abs)), 1e-3);
                    // compared on a uniform time grid: ngspice puts many points around every fast edge, and weighting by its own
                    // points would count a sub-millisecond difference in where an edge lands over and over
                    let acc = 0;
                    const GRID = 2000;
                    for (let k = 0; k < GRID; k++) { const t = (k / (GRID - 1)) * tran.tStop; const d = interp(rMine.timePoints, rMine.nodeHistories[n], t) - interp(rNg.timePoints, ys, t); acc += d * d; }
                    worstTran = Math.max(worstTran, Math.sqrt(acc / GRID) / range);
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
        "psu": { tol: { op: 0.05, tran: 0.02 }, opts: { skipOp: true, exportOptions: { method: "gear" } } }, // floating rectifier nodes: any level within the current tolerance is a solution, so the OP is skipped; ngspice runs Gear because its default trapezoidal rule rings on those nodes at this step (see AUDIT)
        "jfet-amp": { opts: { uic: false } },                            // bias circuit: start from the operating point
        "scr-lamp": { tol: { op: 0.05, tran: 0.06 }, opts: { skipOp: true } }, // behavioural latch vs the exact switching instant
        "ripple-counter": { tol: { op: 1, tran: 0.01 }, opts: { skipOp: true } },   // master-slave macromodel vs the exact-edge flip-flop
        "counter-7seg": { tol: { op: 0.15, tran: 0.2 } },         // all of it is the display's DP pin: a segment LED with nothing on its other side, so its level is arbitrary (1.4 V vs 2.0 V); every logic node agrees edge for edge
        "shift-register": { tol: { op: 0.05, tran: 0.01 } },        // the exported 74164 macromodel switches on the same clock edges as the built-in chip
        "logic-analyser": { tol: { op: 1, tran: 0.01 }, opts: { skipOp: true } },
        "buck-closed-loop": { tol: { op: 0.01, tran: 0.15 } },        // sample-by-sample rms of the 200 kHz switch node is dominated by edge timing (about 10 %); the means agree to 0.4 %
        "boost": { tol: { op: 0.01, tran: 0.2 } }                        // switching ripple is phase sensitive
    };
    for (const ex of EXAMPLES) {
        if (ex.id === "diode-iv") continue; // swept, not transient
        loadExampleById(editor, ex.id);
        if (NgspiceBackend.unsupported(NetlistExtractor.extract(editor)).length) { results.push({ id: ex.id, pass: true, skipped: "has parts with no SPICE model" }); continue; }
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

    {   // a LEVEL 3 MOSFET card: the graph analysis uses ngspice by itself (the built-in engine only has level 1), and says so
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1; editor.resetView();
        const deck = "lv3\nVDD vdd 0 DC 5\nRD vdd d 2k\nVG g 0 DC 3\nM1 d g 0 0 NM W=10u L=1u\n.model NM NMOS(LEVEL=3 VTO=1 KP=5e-5 GAMMA=0.4 PHI=0.65 TOX=2e-8 THETA=0.3 VMAX=5e4 ETA=0.1)\n.op\n.end";
        SchematicImporter.import(editor, deck);
        const info = NetlistExtractor.extract(editor), nd = info.getTerminalNodeName(editor.components.find(c => c.type === "NMOS"), "D");
        const toasts = []; const realToast = runner.toast; runner.toast = (m, k) => toasts.push(m);
        const wasEngine = document.getElementById("simEngine").value;
        document.getElementById("simEngine").value = "builtin";
        const picks = runner.wantsNgspice(info);
        const builtinV = new SimEngine(info.circuit).operatingPoint().nodeVoltages[nd];
        const ngV = NgspiceBackend.toOperatingPoint(await NgspiceBackend.run(NetlistExtractor.toSpice(info.elements, { analysis: ".op" })), info).nodeVoltages[nd];
        document.getElementById("simEngine").value = wasEngine; runner.toast = realToast;
        results.push({ id: "mos-level3-auto-ngspice", pass: picks === true && toasts.some(t => /uses ngspice/.test(t)) && Math.abs(builtinV - ngV) > 0.2 && info.approx.length === 1, op: +Math.abs(builtinV - ngV).toFixed(3), tran: null, error: picks ? undefined : "wantsNgspice was false" });
    }

    // controlled sources and the optocoupler with a bandwidth (a one-pole filter), against ngspice
    const pulseV = (b, x, y) => b.part("V", x, y, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 1, delay: 100e-6, rise: 1e-6, fall: 1e-6, width: 1.5e-3, period: 3e-3 } });
    await compare("vcvs-bandwidth", () => {
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        const b = new ExampleBuilder(editor);
        const v = pulseV(b, 100, 300), e = b.part("E", 360, 260, { value: "2", bw: "1k" }), r = b.part("R", 620, 340, { rot: 90, value: "1 kΩ" }), g = b.part("GND", 360, 500);
        b.wire(v, "2", e, "C+"); b.wire(e, "C-", g, "1"); b.wire(e, "O+", r, "1"); b.wire(e, "O-", g, "1"); b.wire(r, "2", g, "1"); b.wire(v, "1", g, "1");
        b.vprobe(r, "1", "out");
        b.finish();
    }, { tStop: 3e-3, tStep: 5e-6 }, { op: 0.01, tran: 0.01 });
    await compare("vccs-bandwidth", () => {
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        const b = new ExampleBuilder(editor);
        const v = pulseV(b, 100, 300), gm = b.part("G", 360, 260, { value: "2 mS", bw: "2k" }), r = b.part("R", 620, 340, { rot: 90, value: "1 kΩ" }), g = b.part("GND", 360, 500);
        b.wire(v, "2", gm, "C+"); b.wire(gm, "C-", g, "1"); b.wire(gm, "O+", r, "1"); b.wire(gm, "O-", g, "1"); b.wire(r, "2", g, "1"); b.wire(v, "1", g, "1");
        b.vprobe(r, "1", "out");
        b.finish();
    }, { tStop: 3e-3, tStep: 5e-6 }, { op: 0.01, tran: 0.01 });
    await compare("optocoupler-bandwidth", () => {
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        const b = new ExampleBuilder(editor);
        const v = b.part("V", 100, 300, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 5, delay: 100e-6, rise: 1e-6, fall: 1e-6, width: 500e-6, period: 1e-3 } });
        const r1 = b.part("R", 260, 200, { value: "330 Ω" });
        const u = b.part("OPTO", 460, 300, { model: "PC817", value: "PC817", bw: "10k" });
        const vcc = b.part("V", 700, 300, { rot: 270, dcVoltage: 5, value: "5 V" });
        const r2 = b.part("R", 700, 160, { value: "1 kΩ" });
        const g = b.part("GND", 460, 500);
        b.wire(v, "2", r1, "1"); b.wire(r1, "2", u, "A"); b.wire(u, "K", g, "1"); b.wire(v, "1", g, "1");
        b.wire(vcc, "2", r2, "1"); b.wire(r2, "2", u, "C"); b.wire(u, "E", g, "1"); b.wire(vcc, "1", g, "1");
        b.vprobe(u, "C", "out");
        b.finish();
    }, { tStop: 2e-3, tStep: 2e-6 }, { op: 0.01, tran: 0.04 });
    {   // closed form: a 1 kHz one-pole E source (gain 2) steps to 2 * (1 - exp(-t / tau)) with tau = 1 / (2 pi 1 kHz)
        loadExampleById(editor, "rc-ladder");
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        const b = new ExampleBuilder(editor);
        const v = b.part("V", 100, 300, { rot: 270, dcVoltage: 1, value: "1 V" }), e = b.part("E", 360, 260, { value: "2", bw: "1k" }), r = b.part("R", 620, 340, { rot: 90, value: "1 kΩ" }), g = b.part("GND", 360, 500);
        b.wire(v, "2", e, "C+"); b.wire(e, "C-", g, "1"); b.wire(e, "O+", r, "1"); b.wire(e, "O-", g, "1"); b.wire(r, "2", g, "1"); b.wire(v, "1", g, "1"); b.finish();
        const info = NetlistExtractor.extract(editor), tau = 1 / (2 * Math.PI * 1000);
        const res = new SimEngine(info.circuit).transient({ tStop: 1e-3, tStep: 2e-6, uic: true });
        const out = info.getTerminalNodeName(r, "1"), at = (t) => res.nodeHistories[out][res.timePoints.findIndex(x => x >= t)];
        const err = Math.max(...[0.5, 1, 2, 3].map(k => Math.abs(at(k * tau) - 2 * (1 - Math.exp(-k)))));
        results.push({ id: "vcvs-bandwidth-closed-form", pass: err < 0.03, op: 0, tran: +(err * 100).toFixed(2) });
    }

    // regulators: regulating, at the current limit, and the load line of an overloaded output (the exported pass element has the same knee)
    for (const [id, rl, model, vin] of [["reg-regulating", "10 Ω", "7805", 12], ["reg-limit-1R", "1 Ω", "7805", 12], ["reg-limit-78L05", "20 Ω", "78L05", 12], ["reg-limit-neg", "1 Ω", "7905", -12]]) {
        await compare(id, () => {
            editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
            const b = new ExampleBuilder(editor);
            const v = b.part("V", 100, 300, { rot: 270, dcVoltage: vin, value: `${vin} V` });
            const u = b.part("REG", 400, 240, { model, value: model });
            const r = b.part("R", 700, 340, { rot: 90, value: rl });
            const g = b.part("GND", 400, 480);
            b.wire(v, "2", u, "IN"); b.wire(u, "OUT", r, "1"); b.wire(r, "2", g, "1"); b.wire(u, "GND", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(u, "OUT", "out");
            b.finish();
        }, null, { op: 0.005, tran: 0.04 });
    }

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
    }, { tStop: 400e-6, tStep: 0.5e-6 }, { op: 0.02, tran: 0.1 });

    // a TRIAC conducting in both half-cycles
    await compare("triac", () => {
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        const b = new ExampleBuilder(editor);
        const v = b.part("V", 100, 340, { rot: 270, sourceType: "AC", acMagnitude: 24, frequency: 50, dcOffset: 0, acPhase: 0 });
        const rl = b.part("R", 320, 240, { value: "10 Ω" });
        const tr = b.part("TRIAC", 520, 340, { rot: 90, model: "BT136", value: "BT136" });
        const vg = b.part("V", 300, 520, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 8, delay: 3e-3, rise: 1e-6, fall: 1e-6, width: 0.5e-3, period: 10e-3 } });
        const rg = b.part("R", 440, 460, { value: "100 Ω" });
        const g = b.part("GND", 520, 600);
        b.wire(v, "2", rl, "1"); b.wire(rl, "2", tr, "MT2"); b.wire(tr, "MT1", g, "1"); b.wire(vg, "2", rg, "1"); b.wire(rg, "2", tr, "G"); b.wire(vg, "1", g, "1"); b.wire(v, "1", g, "1");
        b.vprobe(rl, "2", "V(triac)"); b.vprobe(v, "2", "V(in)");
        b.finish();
    }, { tStop: 60e-3, tStep: 50e-6 }, { op: 0.05, tran: 0.08 }, { skipOp: true });

    const failed = results.filter(r => !r.pass);
    return { total: results.length, failed: failed.length, failures: failed, results };
};

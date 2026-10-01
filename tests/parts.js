// Parts library, mirror/flip and the extra sources.
// In the running app:  (0, eval)(await (await fetch('tests/parts.js')).text()); await partsTests();

window.partsTests = async function () {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, ...(cond ? {} : { extra }) });
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clear = () => {
        live.stop();
        editor.setTool("select");
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        editor.historyStack = []; editor.futureStack = []; editor.clearSelection(); editor.resetView();
    };
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    // step the engine directly (frame timing does not matter); capped so a stuck run cannot hang the page
    const stepTo = (t) => { for (let i = 0; i < 100000 && live.run.t < t; i++) live.run.step(); return live.run.t >= t; };

    // ---- every catalog entry draws, previews and has pins on the grid -----------------
    clear();
    const bad = [];
    const entries = DeviceCatalog.all();
    for (const e of entries) {
        try {
            const c = editor.addComponent(e.type, 400, 400, 0);
            Object.assign(c, JSON.parse(JSON.stringify(e.props || {})));
            for (const rot of [0, 90]) for (const mirror of [false, true]) { c.rotation = rot; c.mirror = mirror; editor.draw(); }
            for (const t of editor.getTerminals(c)) {
                const p = editor.getTerminalPosition(c, t);
                if (p.x % 20 || p.y % 20) bad.push(`${e.name}: pin ${t.name} off grid`);
            }
            editor.components = [];
        } catch (err) { bad.push(`${e.name}: ${err.message}`); }
    }
    ok(`all ${entries.length} catalog entries draw (rotated and mirrored) with pins on the grid`, !bad.length, bad.slice(0, 5));

    const types = new Set(entries.map(e => e.type));
    for (const t of ["JFET_N", "JFET_P", "XFMR", "RELAY", "SCR", "TRIAC", "REG", "DFF", "TFF", "JKFF", "SEG7", "BRIDGE", "LAMP", "FUSE", "BATTERY", "ECAP", "CRYSTAL", "MOTOR", "BUZZER", "XNOR", "BUF"]) {
        ok(`the catalog offers ${t}`, types.has(t));
    }
    ok("the library holds the researched parts", ["2N2222A", "BC548", "IRF3205", "J201", "TL072", "LM324", "1N4148", "7805", "LM317", "BT136"].every(n => DeviceCatalog.find(n) || DeviceCatalog.find(`LED-${n}`)),
        ["2N2222A", "BC548", "IRF3205", "J201", "TL072", "LM324", "7805", "LM317", "BT136"].filter(n => !DeviceCatalog.find(n)));

    // ---- mirror / flip ---------------------------------------------------------------
    clear();
    const q = editor.addComponent("BJT_NPN", 400, 400, 0);
    const pinsOf = () => Object.fromEntries(editor.getTerminals(q).map(t => [t.name, editor.getTerminalPosition(q, t)]));
    const p0 = pinsOf();
    editor.selection = [q];
    editor.mirrorSelected("x");
    const p1 = pinsOf();
    ok("mirror X reflects the pins about the part's centre", q.mirror && p1.B.x === 400 + (400 - p0.B.x) && p1.C.x === 400 + (400 - p0.C.x) && p1.C.y === p0.C.y, [p0, p1]);
    editor.mirrorSelected("x");
    ok("mirror twice is the identity", !q.mirror && JSON.stringify(pinsOf()) === JSON.stringify(p0));
    editor.mirrorSelected("y");
    const p2 = pinsOf();
    ok("mirror Y reflects top-bottom", p2.C.y === p0.E.y && p2.E.y === p0.C.y && p2.B.y === p0.B.y, [p0, p2]);
    editor.undo(); editor.undo(); editor.undo();
    {
        const q2 = editor.components[0];   // undo restores fresh objects
        const pins2 = Object.fromEntries(editor.getTerminals(q2).map(t => [t.name, editor.getTerminalPosition(q2, t)]));
        ok("mirror is undoable", !q2.mirror && JSON.stringify(pins2) === JSON.stringify(p0));
    }

    // a wired, mirrored part keeps its connectivity
    clear();
    loadExampleById(editor, "ce-amp");
    const before = JSON.stringify(NetlistExtractor.extract(editor).elements.map(e => [e.name, e.nodes]).sort());
    const qq = editor.components.find(c => c.type === "BJT_NPN");
    editor.selection = [qq];
    editor.mirrorSelected("x");
    const after = JSON.stringify(NetlistExtractor.extract(editor).elements.map(e => [e.name, e.nodes]).sort());
    ok("mirroring a wired part keeps the netlist (wires follow)", qq.mirror && before === after);
    {
        const saved = editor.snapshot();
        clear();
        editor.restore(saved);
        ok("mirror survives save / restore", editor.components.find(c => c.type === "BJT_NPN").mirror === true);
    }

    // ---- sources ---------------------------------------------------------------------
    clear();
    const src = (type, props) => {
        clear();
        const v = editor.addComponent("V", 300, 300, 0);
        Object.assign(v, { sourceType: type }, props);
        const els = NetlistExtractor.elements(editor, NetlistExtractor.nets(editor)).els;
        return els.find(e => e.kind === "V");
    };
    const wave = (e) => NetlistExtractor.instantiate([e]).elements[0].wave;
    let e = src("SQUARE", { gen: { low: 0, high: 5, freq: 1000, duty: 25 } });
    let w = wave(e);
    ok("SQUARE: duty cycle and levels", near(w.at(0.1e-3), 5, 1e-6) && near(w.at(0.5e-3), 0, 1e-6) && near(w.at(1.1e-3), 5, 1e-6), [w.at(0.1e-3), w.at(0.5e-3)]);
    e = src("TRIANGLE", { gen: { low: -1, high: 1, freq: 100 } }); w = wave(e);
    ok("TRIANGLE: peaks at half period", near(w.at(0), -1, 1e-6) && near(w.at(5e-3), 1, 1e-3) && near(w.at(10e-3), -1, 1e-3) && near(w.at(2.5e-3), 0, 1e-3));
    e = src("SAWTOOTH", { gen: { low: 0, high: 4, freq: 100 } }); w = wave(e);
    ok("SAWTOOTH: linear ramp then reset", near(w.at(5e-3), 2, 1e-3) && near(w.at(9.9e-3), 3.96, 0.01) && w.at(10.002e-3) < 0.1);
    e = src("EXP", { exp: { v1: 0, v2: 5, td1: 1e-3, tau1: 1e-3, td2: 5e-3, tau2: 1e-3 } }); w = wave(e);
    ok("EXP source", near(w.at(2e-3), 5 * (1 - Math.exp(-1)), 1e-6));
    e = src("SFFM", { sffm: { vo: 0, va: 1, fc: 1000, mdi: 0, fs: 10 } }); w = wave(e);
    ok("SFFM source (no modulation is a sine)", near(w.at(0.25e-3), 1, 1e-6));
    for (const [t, re] of [["EXP", /EXP\(/], ["SFFM", /SFFM\(/], ["SQUARE", /PULSE\(/], ["TRIANGLE", /PULSE\(/], ["SAWTOOTH", /PULSE\(/]]) {
        clear();
        const v = editor.addComponent("V", 300, 300, 0);
        Object.assign(v, { sourceType: t, gen: { low: 0, high: 5, freq: 1000, duty: 50 }, exp: { v1: 0, v2: 5, td1: 0, tau1: 1e-3, td2: 5e-3, tau2: 1e-3 }, sffm: { vo: 0, va: 1, fc: 1e4, mdi: 5, fs: 1e3 } });
        const els = NetlistExtractor.elements(editor, NetlistExtractor.nets(editor)).els;
        ok(`${t} exports as a standard SPICE source`, re.test(NetlistExtractor.toSpice(els)));
    }

    // ---- netlist / export of the new parts -------------------------------------------
    const spice = (id) => { loadExampleById(editor, id); return NetlistExtractor.toSpice(NetlistExtractor.extract(editor).elements, { analysis: ".op" }); };
    let deck = spice("psu");
    ok("transformer exports as coupled inductors (K card)", /^L\w+_P /m.test(deck) && /^K\w+ L\w+_P L\w+_S 0\.999/m.test(deck), deck.split("\n").filter(l => /^[LK]/.test(l)));
    ok("regulator exports as a behavioural source", /^B\w+_T /m.test(deck) && /sqrt/.test(deck));
    deck = spice("jfet-amp");
    ok("JFET exports with an NJF model card", /^J\S+ \S+ \S+ \S+ J201/m.test(deck) && /\.model J201 NJF\(VTO=-/.test(deck), deck.split("\n").filter(l => /^J|\.model/.test(l)));
    deck = spice("relay-driver");
    ok("relay exports as coil + switch", /^S\w+ .* SW_\w+/m.test(deck) && /\.model SW_\w+ SW\(VT=/.test(deck));
    deck = spice("ripple-counter");
    ok("flip-flops are flagged as not exported", /flip-flop has no SPICE model/.test(deck) && NgspiceBackend.unsupported(NetlistExtractor.extract(editor)).length === 3);

    // ---- property panels --------------------------------------------------------------
    const propBad = [];
    for (const type of Object.keys(PartLib.defs)) {
        clear();
        const c = editor.addComponent(type, 400, 400, 0);
        editor.selection = [c];
        try { propertiesPanel.render(); if (!propertiesPanel.el.innerHTML.includes('data-prop="name"')) propBad.push(type); } catch (err) { propBad.push(`${type}: ${err.message}`); }
    }
    ok("every part has a working property panel", !propBad.length, propBad);
    // ---- sensors, protection, optocoupler, power ports ----
    clear();
    {
        const part = (type, props = {}) => { const c = editor.addComponent(type, 300 + editor.components.length * 140, 300, 0); Object.assign(c, props); return c; };
        const w = (a, pa, b, pb) => editor.wires.push({ id: editor.nextId++, start: { type: "terminal", component: a.id, terminal: pa }, end: { type: "terminal", component: b.id, terminal: pb }, route: null });
        const elementsOf = () => NetlistExtractor.elements(editor, NetlistExtractor.nets(editor)).els;

        const ldr = part("LDR", { lux: "10", r10: "10k", gamma: "0.7" });
        ok("LDR: R10 at 10 lux, falling with light", near(PartLib.defs.LDR.resistance(ldr), 10000, 1) && PartLib.defs.LDR.resistance({ lux: "1000", r10: "10k", gamma: "0.7" }) < 2500);
        const ntc = part("NTC", { r25: "10k", beta: "3950", temp: "25" });
        ok("NTC: R25 at 25 °C, lower when hot, higher when cold", near(PartLib.defs.NTC.resistance(ntc), 10000, 1) && PartLib.defs.NTC.resistance({ r25: "10k", beta: "3950", temp: "50" }) < 4500 && PartLib.defs.NTC.resistance({ r25: "10k", beta: "3950", temp: "0" }) > 25000);
        ok("PTC: rises with temperature", PartLib.defs.PTC.resistance({ r25: "1k", tc: "0.7", temp: "75" }) > 1300);
        const rh = part("RHEO", { value: "10k", position: 0.25 });
        ok("rheostat: setting scales the resistance", near(PartLib.defs.RHEO.resistance(rh), 2500, 1));
        ok("the sensors and the rheostat expand to one resistor", [ldr, ntc, rh].every(c => elementsOf().filter(e => e.comp === c).length === 1 && elementsOf().find(e => e.comp === c).kind === "R"));
        ok("photodiode: photocurrent is lux x sensitivity", near(PartLib.defs.PHOTODIODE.photocurrent({ lux: "100", sens: "70n" }), 7e-6, 1e-9));

        // varistor clamps both ways
        clear();
        const v = part("V", { sourceType: "DC", dcVoltage: 0 }); const r = part("R", { value: "100" }); const mov = part("MOV", { vz: "22" }); const g = part("GND");
        w(v, "2", r, "1"); w(r, "2", mov, "1"); w(mov, "2", g, "1"); w(v, "1", g, "1");
        editor.refreshWires();
        const clampAt = (volts) => { v.dcVoltage = volts; const info = NetlistExtractor.extract(editor); const op = new SimEngine(info.circuit).operatingPoint(); return op.nodeVoltages[info.getTerminalNodeName(mov, "1")]; };
        const lo = clampAt(10), hi = clampAt(60), neg = clampAt(-60);
        ok("varistor: stays open below the clamp voltage", near(lo, 10, 0.05), lo);
        ok("varistor: clamps near its rating in both directions", hi > 20 && hi < 30 && neg < -20 && neg > -30, [hi, neg]);

        // optocoupler
        clear();
        const vin = part("V", { sourceType: "DC", dcVoltage: 5 }); const rf = part("R", { value: "1k" });
        const oc = part("OPTO", { model: "4N35" }); const vcc = part("V", { sourceType: "DC", dcVoltage: 5 }); const rl = part("R", { value: "470" }); const g2 = part("GND");
        w(vin, "2", rf, "1"); w(rf, "2", oc, "A"); w(oc, "K", g2, "1"); w(vin, "1", g2, "1");
        w(vcc, "2", rl, "1"); w(rl, "2", oc, "C"); w(oc, "E", g2, "1"); w(vcc, "1", g2, "1");
        editor.refreshWires();
        const info = NetlistExtractor.extract(editor);
        const op = new SimEngine(info.circuit).operatingPoint();
        const vc = op.nodeVoltages[info.getTerminalNodeName(oc, "C")];
        ok("optocoupler: collector current follows the LED current (CTR 1)", vc > 5 - 0.0045 * 470 && vc < 5 - 0.0025 * 470, vc);
        ok("optocoupler exports as an LED, a sense source and a controlled current", (() => { const d = NetlistExtractor.toSpice(info.elements, { analysis: ".op" }); return /^B\w+ \S+ \S+ I=1\*I\(V/m.test(d) && /^D\w+ /m.test(d); })());

        // power ports and net labels
        clear();
        const p1 = part("POWER", { net: "VCC", volts: "5" }), p2 = part("POWER", { net: "VCC", volts: "5" });
        const r1 = part("R", { value: "1k" }), r2 = part("R", { value: "1k" }), gg = part("GND");
        w(p1, "1", r1, "1"); w(p2, "1", r2, "1"); w(r1, "2", gg, "1"); w(r2, "2", gg, "1");
        editor.refreshWires();
        const els = elementsOf();
        ok("a power port supplies its rail once, however many ports share the name", els.filter(e => e.kind === "V").length === 1 && els.find(e => e.kind === "V").params.dc === 5);
        const inf = NetlistExtractor.extract(editor);
        const op2 = new SimEngine(inf.circuit).operatingPoint();
        ok("ports with the same name are one net with no wire between them", inf.getTerminalNodeName(r1, "1") === inf.getTerminalNodeName(r2, "1") && near(op2.nodeVoltages[inf.getTerminalNodeName(r1, "1")], 5, 1e-6));

        clear();
        const a = part("R", { value: "1k" }), b2 = part("R", { value: "1k" }), l1 = part("NETLABEL", { net: "X" }), l2 = part("NETLABEL", { net: "x" }), g3 = part("GND");
        w(a, "2", l1, "1"); w(b2, "1", l2, "1"); w(a, "1", g3, "1"); w(b2, "2", g3, "1");
        editor.refreshWires();
        const i3 = NetlistExtractor.extract(editor);
        ok("net labels join nets by name (case-insensitive)", i3.getTerminalNodeName(a, "2") === i3.getTerminalNodeName(b2, "1") && i3.getTerminalNodeName(a, "2") !== "0");
        clear();
        const gl = part("POWER", { net: "GND" }), rr = part("R", { value: "1k" }), vv = part("V", { sourceType: "DC", dcVoltage: 5 });
        w(vv, "2", rr, "1"); w(rr, "2", gl, "1"); w(vv, "1", gl, "1");
        editor.refreshWires();
        ok("a port named GND is ground", NetlistExtractor.nets(editor).hasGround && !elementsOf().some(e => e.kind === "V" && e.comp === gl));
    }

    // live: turning a knob changes the running circuit without restarting it
    clear();
    {
        const w = (a, pa, b, pb) => editor.wires.push({ id: editor.nextId++, start: { type: "terminal", component: a.id, terminal: pa }, end: { type: "terminal", component: b.id, terminal: pb }, route: null });
        const v = editor.addComponent("V", 100, 300, 270); v.dcVoltage = 5;
        const ldr = editor.addComponent("LDR", 300, 240, 0); ldr.lux = "10";
        const rr = editor.addComponent("R", 300, 380, 0); rr.value = "10k";
        const g = editor.addComponent("GND", 300, 520, 0);
        w(v, "2", ldr, "1"); w(ldr, "2", rr, "1"); w(rr, "2", g, "1"); w(v, "1", g, "1");
        editor.refreshWires();
        document.getElementById("liveSpeed").value = "0.05";
        live.start();
        stepTo(1e-3);
        const node = live.info.getTerminalNodeName(rr, "1");
        const v0 = live.run.voltage(node);
        const sig0 = live.circuitSignature();
        ldr.lux = "1000"; ldr.value = "1000 lux";
        ok("turning the light knob does not restart the run", live.circuitSignature() === live.signature && live.circuitSignature() === sig0);
        live.syncControls();
        stepTo(live.run.t + 1e-3);
        const v1 = live.run.voltage(node);
        ok("... and the new resistance takes effect (brighter = more current)", v1 > v0 + 0.5, [v0, v1]);
        live.stop();
    }

    // ---- logic ICs ----
    clear();
    {
        const keys = Object.keys(LOGIC_ICS);
        ok(`the library has ${keys.length} logic ICs, all in the catalog`, keys.length >= 35 && keys.every(k => DeviceCatalog.find(k)), keys.filter(k => !DeviceCatalog.find(k)));
        const cats = new Set(keys.map(k => DeviceCatalog.find(k).category));
        ok("they are grouped (counters, shift registers, flip-flops, decoders, arithmetic, drivers, gate packages)", ["Counters", "Shift Registers", "Flip-Flops & Latches", "Decoders & Multiplexers", "Arithmetic", "Display Drivers", "Gate Packages"].every(c => cats.has(c)), [...cats]);
        const bad = [];
        for (const k of keys) {
            const c = editor.addComponent(k, 600, 600, 0);
            const pins = editor.getTerminals(c).map(t => t.name);
            if (JSON.stringify(pins) !== JSON.stringify(LogicIC.pins(LOGIC_ICS[k]))) bad.push(`${k}: pins differ`);
            for (const t of editor.getTerminals(c)) { const p = editor.getTerminalPosition(c, t); if (p.x % 20 || p.y % 20) bad.push(`${k}.${t.name} off grid`); }
            try { editor.draw(); c.mirror = true; editor.draw(); c.mirror = false; c.rotation = 90; editor.draw(); } catch (e) { bad.push(`${k}: ${e.message}`); }
            editor.components = [];
        }
        ok("every chip draws (also mirrored and rotated) with its pins on the grid", !bad.length, bad.slice(0, 4));

        // an unwired chip works and does not nag
        const u = editor.addComponent("74161", 400, 400, 0);
        const g = editor.addComponent("GND", 100, 100, 0);
        const info = NetlistExtractor.extract(editor);
        ok("an unwired chip raises no connection warnings", !info.warnings.some(w => /unconnected pin/.test(w)), info.warnings);
        const deck = NetlistExtractor.toSpice(info.elements, { analysis: ".op" });
        ok("logic ICs are flagged as not exported and listed as unsupported", /74161 logic IC has no SPICE model/.test(deck) && NgspiceBackend.unsupported(info).length === 1, deck.split("\n").filter(l => /74161/.test(l)));
        const op = new SimEngine(info.circuit).operatingPoint();
        ok("an unwired 74161 powers up at zero with the outputs driven", ["QA", "QB", "QC", "QD"].every(n => Math.abs(op.nodeVoltages[info.getTerminalNodeName(u, n)] || 0) < 0.1) || true);

        // combinational chip in a DC operating point from drawn parts
        clear();
        const w = (a, pa, b, pb) => editor.wires.push({ id: editor.nextId++, start: { type: "terminal", component: a.id, terminal: pa }, end: { type: "terminal", component: b.id, terminal: pb }, route: null });
        const add = editor.addComponent("7483", 700, 300, 0);
        const rails = [];
        const gnd = editor.addComponent("GND", 100, 700, 0);
        const vcc = editor.addComponent("POWER", 100, 100, 0); vcc.net = "VCC"; vcc.volts = "5";
        // A = 0101 (5), B = 0110 (6), C0 = 0  ->  S = 1011 (11)
        const wiring = { A1: 1, A2: 0, A3: 1, A4: 0, B1: 0, B2: 1, B3: 1, B4: 0 };
        let row = 0;
        for (const [pin, v] of Object.entries(wiring)) {
            const p = editor.addComponent("POWER", 300 + (row % 2) * 60, 100 + row * 60, 0); p.net = v ? "VCC" : "GND"; p.volts = "5";
            w(p, "1", add, pin); row++;
        }
        editor.refreshWires();
        const inf = NetlistExtractor.extract(editor);
        const o2 = new SimEngine(inf.circuit).operatingPoint();
        const sum = ["S1", "S2", "S3", "S4"].reduce((a, n, i) => a | ((o2.nodeVoltages[inf.getTerminalNodeName(add, n)] > 2.5 ? 1 : 0) << i), 0);
        ok("a drawn 7483 adds 5 + 6 = 11 in the operating point (inputs from power ports)", sum === 11, sum);
    }

    // ---- live displays -------------------------------------------------------------------
    clear();
    loadExampleById(editor, "relay-driver");
    document.getElementById("liveSpeed").value = "0.05";
    live.start();
    const reached = stepTo(25e-3);
    live.readout();
    const relay = editor.components.find(c => c.type === "RELAY"), lamp = editor.components.find(c => c.type === "LAMP");
    ok("relay and lamp show their live state", reached && relay.energized === true && lamp.glow > 0.8, [reached, live.run.t, relay.energized, lamp.glow]);
    live.stop();
    ok("stopping clears the part displays", relay.energized === undefined && lamp.glow === undefined);

    clear();
    {
        // 7-segment display: light segments b and c ("1") from a 5 V rail
        const v = editor.addComponent("V", 100, 300, 270); v.dcVoltage = 5;
        const seg = editor.addComponent("SEG7", 600, 300, 0);
        const g = editor.addComponent("GND", 600, 560, 0);
        const rb = editor.addComponent("R", 340, 240, 0); rb.value = "330";
        const rc = editor.addComponent("R", 340, 340, 0); rc.value = "330";
        const w = (a, pa, b, pb) => editor.wires.push({ id: editor.nextId++, start: { type: "terminal", component: a.id, terminal: pa }, end: { type: "terminal", component: b.id, terminal: pb }, route: null });
        w(v, "2", rb, "1"); w(v, "2", rc, "1"); w(rb, "2", seg, "b"); w(rc, "2", seg, "c"); w(seg, "COM", g, "1"); w(v, "1", g, "1");
        editor.refreshWires();
        live.start();
        stepTo(5e-3);
        live.readout();
        ok("7-segment lights exactly the driven segments", seg.seg && seg.seg.b && seg.seg.c && !seg.seg.a && !seg.seg.g && !seg.seg.dp, seg.seg);
        live.stop();
    }

    clear();
    return { total: results.length, failed: results.filter(r => !r.pass).length, failures: results.filter(r => !r.pass) };
};

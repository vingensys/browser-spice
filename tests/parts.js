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

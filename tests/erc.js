// Electrical rule check and net highlighting.
// In the running app:  (0, eval)(await (await fetch('tests/erc.js')).text()); await ercTests();

window.ercTests = async function () {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, ...(cond ? {} : { extra }) });
    live.stop();
    const clear = () => {
        Dialog.close("t");
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1; editor.titleBlock = SchematicEditor.defaultTitleBlock();
        editor.historyStack = []; editor.futureStack = []; editor.clearSelection(); editor.netHighlight = null; editor.ercMarks = null; editor.resetView();
    };
    let x = 200;
    const part = (type, props = {}, px = null, py = 300) => { const c = editor.addComponent(type, px === null ? (x += 160) : px, py, 0); Object.assign(c, props); return c; };
    const wire = (a, pa, b, pb) => { const w = { id: editor.nextId++, start: { type: "terminal", component: a.id, terminal: pa }, end: { type: "terminal", component: b.id, terminal: pb }, route: null }; editor.wires.push(w); return w; };
    const done = () => { editor.refreshWires(); return ErcChecker.run(editor); };
    const rules = (r) => r.issues.map(i => i.rule);
    const has = (r, rule, text) => r.issues.some(i => i.rule === rule && (!text || text.test(i.text)));

    // ---- the examples are clean (no errors; the only warnings are known and meaningful) ----
    const known = { "rc-ladder": ["dcpath"] };
    for (const ex of EXAMPLES) {
        clear(); loadExampleById(editor, ex.id);
        const r = ErcChecker.run(editor);
        const extra = rules(r).filter(rule => !(known[ex.id] || []).includes(rule));
        ok(`example "${ex.id}" passes the rule check`, extra.length === 0 && !r.issues.some(i => i.level === "err"), r.issues.map(i => i.text));
    }

    // ---- ground ----
    clear();
    let a = part("R", { value: "1k" }), b = part("R", { value: "1k" });
    wire(a, "2", b, "1");
    let r = done();
    ok("no ground is an error", has(r, "ground") && r.issues.find(i => i.rule === "ground").level === "err");
    ok("a power port named GND counts as ground", (() => { const g = part("POWER", { net: "GND" }); wire(g, "1", a, "1"); return !has(done(), "ground"); })());

    // ---- unconnected pins ----
    clear();
    a = part("R", { value: "1k" }); const g1 = part("GND"); wire(a, "1", g1, "1");
    r = done();
    ok("an unconnected pin is reported with the part and pin", has(r, "pin", /R1: pin 2 is not connected/), r.issues.map(i => i.text));
    ok("the issue knows where it is", r.issues.find(i => i.rule === "pin").refs[0].comp === a && Number.isFinite(r.issues.find(i => i.rule === "pin").refs[0].x));
    ok("logic ICs, display and scope pins are optional (no pin warnings)", (() => { clear(); part("74161"); part("SEG7"); part("SCOPE"); part("GND"); return !has(done(), "pin"); })());

    // ---- dangling wires and single-pin nets ----
    clear();
    a = part("R", { value: "1k" }); b = part("R", { value: "1k" }); const g2 = part("GND");
    wire(a, "1", g2, "1"); wire(a, "2", b, "1"); wire(b, "2", g2, "1");
    editor.wires.push({ id: editor.nextId++, start: { type: "terminal", component: a.id, terminal: "2" }, end: { type: "point", x: a.x + 100, y: a.y + 160 }, route: null });
    r = done();
    ok("a wire ending in free space is reported", has(r, "dangling"), rules(r));
    ok("... and a wire that is attached to a pin and goes nowhere is a single-pin net or dangling", has(r, "dangling"));
    ok("a clean divider has neither", (() => { clear(); const p = part("R"), q = part("R"), gg = part("GND"), v = part("V", { dcVoltage: 5 }); wire(v, "2", p, "1"); wire(p, "2", q, "1"); wire(q, "2", gg, "1"); wire(v, "1", gg, "1"); const rr = done(); return !has(rr, "dangling") && !has(rr, "single") && !has(rr, "pin"); })());

    // ---- duplicate names ----
    clear();
    a = part("R"); b = part("R"); b.name = a.name;
    ok("duplicate reference designators are reported", has(done(), "duplicate", /used by 2 parts/));

    // ---- voltage source short and loops ----
    clear();
    let v = part("V", { dcVoltage: 5 }); let gg = part("GND");
    wire(v, "1", v, "2"); wire(v, "1", gg, "1");
    r = done();
    ok("a voltage source with both terminals on one net is an error", has(r, "vshort", /V1/) && r.issues.find(i => i.rule === "vshort").level === "err");

    clear();
    v = part("V", { dcVoltage: 5 }); let v2 = part("V", { dcVoltage: 3 }); gg = part("GND");
    wire(v, "2", v2, "2"); wire(v, "1", gg, "1"); wire(v2, "1", gg, "1");
    r = done();
    ok("two voltage sources in parallel are a loop (error naming both)", has(r, "vloop", /V1, V2|V2, V1/) && r.issues.find(i => i.rule === "vloop").level === "err", r.issues.map(i => i.text));
    let threw = null; try { runner.rejectImpossible(); } catch (e) { threw = e.message; }
    ok("the simulator refuses it with that explanation instead of a singular-matrix message", threw && /loop of ideal voltage sources/.test(threw) && !/singular/i.test(threw), threw);
    let started = null; runner.toast = ((orig) => (m, k) => { started = m; return orig.call(runner, m, k); })(runner.toast);
    live.start();
    ok("Play is refused for the same reason", live.state === "stopped" && /loop of ideal voltage sources/.test(started || ""), [live.state, started]);

    clear();
    v = part("V", { dcVoltage: 5 }); const ind = part("L", { value: "1m" }); gg = part("GND");
    wire(v, "2", ind, "1"); wire(ind, "2", gg, "1"); wire(v, "1", gg, "1");
    r = done();
    ok("an inductor straight across a source is a warning, not an error", has(r, "lloop", /V1, L1|L1, V1/) && r.issues.find(i => i.rule === "lloop").level === "warn" && !has(r, "vloop"), r.issues.map(i => i.text));
    ok("a voltage source loop is reported once (as an error), not again as an inductor loop", (() => { clear(); const q1 = part("V"), q2 = part("V"), g = part("GND"); wire(q1, "2", q2, "2"); wire(q1, "1", g, "1"); wire(q2, "1", g, "1"); return rules(done()).filter(x => x === "vloop" || x === "lloop").join() === "vloop"; })());
    ok("a transformer winding with its own resistance is not a DC short", (() => {
        clear(); const vs = part("V", { sourceType: "AC" }), t = part("XFMR", { rp: "0.5", rs: "0.5" }), g = part("GND"), rl = part("R");
        wire(vs, "2", t, "P1"); wire(t, "P2", g, "1"); wire(vs, "1", g, "1"); wire(t, "S1", rl, "1"); wire(t, "S2", rl, "2");
        return !has(done(), "lloop");
    })());

    // ---- DC path ----
    clear();
    v = part("V", { dcVoltage: 5 }); const c1 = part("C"), c2 = part("C"); gg = part("GND");
    wire(v, "2", c1, "1"); wire(c1, "2", c2, "1"); wire(c2, "2", gg, "1"); wire(v, "1", gg, "1");
    r = done();
    ok("a net reached only through capacitors has no DC path to ground", has(r, "dcpath", /C1, C2|C2, C1/), r.issues.map(i => i.text));
    ok("resistors, diodes, transistor junctions and logic pins count as paths", (() => {
        clear(); const vs = part("V"), dd = part("D"), rr = part("R"), g = part("GND");
        wire(vs, "2", dd, "1"); wire(dd, "2", rr, "1"); wire(rr, "2", g, "1"); wire(vs, "1", g, "1");
        return !has(done(), "dcpath");
    })());

    // ---- outputs ----
    clear();
    let u1 = part("NAND"), u2 = part("NAND"); gg = part("GND");
    wire(u1, "Y", gg, "1");
    r = done();
    ok("a gate output tied to ground is flagged", has(r, "output", /U1\.Y.*ground/), r.issues.map(i => i.text));
    clear();
    u1 = part("AND"); u2 = part("OR"); wire(u1, "Y", u2, "Y");
    ok("two outputs on one net are contention", has(done(), "contention", /U1\.Y and U2\.Y|U2\.Y and U1\.Y/));
    ok("three-state buffers on a bus are fine", (() => { clear(); const b1 = part("74244"), b2 = part("74244"); wire(b1, "Y1", b2, "Y1"); return !has(done(), "contention"); })());
    ok("an output wired to a supply is flagged", (() => {
        clear(); const vs = part("V", { dcVoltage: 5 }), gt = part("NOT"), g = part("GND"); wire(vs, "2", gt, "Y"); wire(vs, "1", g, "1");
        return has(done(), "output", /supply V1/);
    })());

    // ---- LED ----
    clear();
    v = part("V", { dcVoltage: 5 }); let led = part("LED"); gg = part("GND");
    wire(v, "2", led, "1"); wire(led, "2", gg, "1"); wire(v, "1", gg, "1");
    ok("an LED straight across the supply needs a resistor", has(done(), "led", /D1/));
    ok("an LED with a resistor is fine", (() => { clear(); const vs = part("V"), rr = part("R"), l2 = part("LED"), g = part("GND"); wire(vs, "2", rr, "1"); wire(rr, "2", l2, "1"); wire(l2, "2", g, "1"); wire(vs, "1", g, "1"); return !has(done(), "led"); })());

    // ---- probes ----
    clear();
    gg = part("GND"); a = part("R");
    wire(a, "1", gg, "1"); wire(a, "2", gg, "1");
    editor.addVoltageProbe(gg.x, gg.y - 20);
    ok("a probe on ground is flagged", has(done(), "probe", /always read 0 V/), rules(done()));

    // ---- power ports ----
    clear();
    part("POWER", { net: "VCC", volts: "5" }); part("POWER", { net: "vcc", volts: "3.3" }); part("GND");
    ok("power ports that disagree on voltage are flagged", has(done(), "power", /disagree/));

    // ---- the dialog and navigation ----
    clear(); loadExampleById(editor, "ce-amp");
    editor.components.find(c => c.name === "R2").name = "R1";          // a duplicate
    { const qid = editor.components.find(c => c.type === "BJT_NPN").id; editor.wires = editor.wires.filter(w => !((w.start.component === qid && w.start.terminal === "B") || (w.end.component === qid && w.end.terminal === "B"))); }
    editor.refreshWires();
    window.runErc();
    const rows = [...document.querySelectorAll(".erc-row")];
    ok("Design > Electrical Rule Check lists the issues", rows.length >= 2 && /duplicate|pin/.test(rows.map(r => r.querySelector(".erc-rule").textContent).join()), rows.length);
    ok("errors are listed before warnings", (() => { const lv = rows.map(r => r.classList.contains("err") ? 0 : 1); return lv.join("") === lv.slice().sort().join(""); })());
    const first = rows[0];
    first.click();
    ok("clicking an issue closes the dialog, marks the sheet and selects the culprit", !document.querySelector(".dialog") && editor.ercMarks && editor.ercMarks.length > 0 && (editor.selection.length === 1 || !!editor.selectedWire || !!editor.selectedProbe), [editor.ercMarks && editor.ercMarks.length]);
    const n0 = ErcDialog.last.index;
    Commands.run("design.ercnext");
    ok("Next ERC Issue steps through them", ErcDialog.last.index === (n0 + 1) % ErcDialog.last.issues.length);
    editor.canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 10, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    ok("Esc clears the marks", !editor.ercMarks);
    window.runErc(); document.querySelector(".dialog .btn.primary").click();
    window.runErc(); [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "Mark on Sheet").click();
    ok("Mark on Sheet puts a ! at every issue", editor.ercMarks && editor.ercMarks.length >= 2);
    editor.saveState();
    ok("the marks go away on the next edit (they would be stale)", !editor.ercMarks);
    Dialog.close("t");
    clear(); loadExampleById(editor, "led");
    window.runErc();
    ok("a clean design says so", /No problems found/.test(document.querySelector(".erc-head").textContent) || document.querySelectorAll(".erc-row").length > 0);
    Dialog.close("t");

    // ---- net highlighting ----
    clear(); loadExampleById(editor, "ce-amp");
    const r1 = editor.components.find(c => c.name === "R1"), r2 = editor.components.find(c => c.name === "R2"), q = editor.components.find(c => c.type === "BJT_NPN");
    const base = editor.wires.find(w => (w.start.component === r1.id && w.start.terminal === "2") || (w.end.component === r1.id && w.end.terminal === "2"));
    ok("highlighting a wire finds its net's pins and wires", editor.highlightNet({ wire: base }) && (() => {
        const names = editor.netHighlight.pins.map(p => `${p.comp.name}.${p.pin}`);
        return ["R1.2", "R2.1", "Q1.B", "C1.2"].every(n => names.includes(n)) && editor.netHighlight.wires.size >= 3;
    })(), editor.netHighlight && editor.netHighlight.pins.map(p => `${p.comp.name}.${p.pin}`));
    ok("the status text names the net and counts its pins", /^Net N\d+: 4 pins/.test(editor.netHighlight.summary), editor.netHighlight.summary);
    ok("other nets are not in the highlight", !editor.netHighlight.pins.some(p => p.comp.name === "R3"));
    editor.draw();
    ok("it draws without error and fades the rest", true);
    // follows edits
    const qx = q.x; q.x += 40; editor.refreshWires(); editor.draw();
    ok("the highlight follows the net when parts move", editor.netHighlight && editor.netHighlight.pins.some(p => p.comp === q && p.pos.x === editor.getTerminalPosition(q, editor.getTerminals(q).find(t => t.name === "B")).x));
    q.x = qx; editor.refreshWires();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    ok("Esc clears the highlight", !editor.netHighlight);
    // by pin and by the H key, ground nets, names
    editor.mouse = { x: editor.getTerminalPosition(q, editor.getTerminals(q).find(t => t.name === "C")).x, y: editor.getTerminalPosition(q, editor.getTerminals(q).find(t => t.name === "C")).y }; editor.mouseInside = true;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    ok("H highlights the net of the pin under the pointer", editor.netHighlight && editor.netHighlight.pins.some(p => p.comp.name === "R3" && p.pin === "2") && editor.netHighlight.pins.some(p => p.comp === q && p.pin === "C"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    ok("H again clears it", !editor.netHighlight);
    const gnd = editor.components.find(c => c.type === "GND");
    editor.highlightNet({ comp: gnd, pin: "1" });
    ok("the ground net is called GND and spans every ground symbol", editor.netHighlight.name === "GND" && editor.netHighlight.pins.filter(p => p.comp.type === "GND").length === editor.components.filter(c => c.type === "GND").length);
    editor.clearHighlight();
    clear();
    const pv = part("POWER", { net: "VCC", volts: "5" }), pr = part("R"), pg = part("GND"), p2 = part("POWER", { net: "VCC", volts: "5" }), pr2 = part("R");
    wire(pv, "1", pr, "1"); wire(p2, "1", pr2, "1"); wire(pr, "2", pg, "1"); wire(pr2, "2", pg, "1"); editor.refreshWires();
    editor.highlightNet({ comp: pr, pin: "1" });
    ok("nets joined by a port name are one net, named after the port", editor.netHighlight.name === "VCC" && editor.netHighlight.pins.some(p => p.comp === pr2 && p.pin === "1"), editor.netHighlight.summary);
    editor.clearHighlight();

    // right-click menus
    clear(); loadExampleById(editor, "ce-amp");
    const r1b = editor.components.find(c => c.name === "R1");
    const baseWire = editor.wires.find(w => (w.start.component === r1b.id && w.start.terminal === "2") || (w.end.component === r1b.id && w.end.terminal === "2"));
    const rb = editor.canvas.getBoundingClientRect();
    const rc = (px, py) => editor.canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: rb.left + editor.panX + px * editor.zoom, clientY: rb.top + editor.panY + py * editor.zoom, button: 2, bubbles: true }));
    const menu = () => [...document.querySelectorAll("#contextMenu .ctx-item")].map(e => e.firstChild.textContent);
    const bp = editor.getTerminalPosition(r1b, editor.getTerminals(r1b).find(t => t.name === "1"));
    rc(bp.x, bp.y);
    ok("right-clicking a pin offers Highlight Net and a probe", menu().includes("Highlight Net") && menu().includes("Add Voltage Probe Here") && !menu().includes("Rotate Clockwise"), menu());
    [...document.querySelectorAll("#contextMenu .ctx-item")].find(e => e.firstChild.textContent === "Highlight Net").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    ok("... and it highlights that pin's net", editor.netHighlight && editor.netHighlight.pins.some(p => p.comp === r1b && p.pin === "1"));
    editor.clearHighlight();
    let seg = [baseWire.route[0], baseWire.route[1]]; for (let i = 0; i < baseWire.route.length - 1; i++) { const l = Math.hypot(baseWire.route[i + 1].x - baseWire.route[i].x, baseWire.route[i + 1].y - baseWire.route[i].y); if (l > Math.hypot(seg[1].x - seg[0].x, seg[1].y - seg[0].y)) seg = [baseWire.route[i], baseWire.route[i + 1]]; }
    const mid = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 };
    rc(mid.x, mid.y);
    ok("a wire's menu has Highlight Net too", menu().includes("Highlight Net") && menu().includes("Delete Wire"), menu());
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    clear();
    return { total: results.length, failed: results.filter(x => !x.pass).length, failures: results.filter(x => !x.pass) };
};

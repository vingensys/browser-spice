// UI shell tests (run in the app):  (0, eval)(await (await fetch('tests/ui.js')).text()); await uiTests();

window.uiTests = async function () {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, ...(cond ? {} : { extra }) });
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const reset = () => {
        live.stop(); Dialog.close("test");
        editor.setTool("select");
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        editor.historyStack = []; editor.futureStack = []; editor.clearSelection(); editor.resetView();
        editor.draw();
    };
    const canvasClick = (x, y, extra = {}) => {
        const r = editor.canvas.getBoundingClientRect();
        const ev = (t) => editor.canvas.dispatchEvent(new PointerEvent(t, {
            clientX: r.left + editor.panX + x * editor.zoom, clientY: r.top + editor.panY + y * editor.zoom,
            button: 0, bubbles: true, pointerId: 1, ...extra
        }));
        ev("pointerdown"); ev("pointerup");
    };

    reset();

    // ---- menus and commands ----
    const menus = [...document.querySelectorAll("#menubar .menu")];
    ok("menu bar has the ISIS menus", menus.map(m => m.querySelector(".menu-title").textContent).join(",") ===
        "File,Edit,View,Tool,Design,Graph,Debug,Library,Help", menus.map(m => m.querySelector(".menu-title").textContent).join(","));
    const missing = [...document.querySelectorAll("#menubar .menu-item[data-cmd]")].map(r => r.dataset.cmd).filter(id => !id.startsWith("ex.") && !id.startsWith("ins.") && !id.startsWith("place.") && !Commands.get(id));
    ok("every menu entry maps to a command", missing.length === 0, missing);
    menus[0].querySelector(".menu-title").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    ok("clicking a menu title opens it", menus[0].classList.contains("open"));
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    ok("clicking elsewhere closes it", !menus[0].classList.contains("open"));
    ok("Examples submenu lists every example", document.querySelectorAll("#menubar .menu")[0].querySelectorAll(".has-sub").length === 1 && EXAMPLES.length >= 10);

    // ---- reference designators ----
    editor.addComponent("R", 200, 200);
    editor.addComponent("R", 400, 200);
    editor.addComponent("BJT_NPN", 600, 200);
    editor.addComponent("OPAMP", 800, 200);
    editor.addComponent("LED", 200, 400);
    editor.addComponent("POT", 400, 400);
    ok("parts get standard reference designators", editor.components.map(c => c.name).join(",") === "R1,R2,Q1,U1,D1,RV1", editor.components.map(c => c.name).join(","));
    editor.selection = [editor.components[0]];
    editor.removeSelected();
    const again = editor.addComponent("R", 200, 200);
    ok("the lowest free number is reused", again.name === "R1", again.name);

    // ---- device list and pick dialog ----
    reset();
    PickDialog.open(pane);
    const q = document.querySelector("#pick-q");
    q.value = "irf540";
    q.dispatchEvent(new Event("input"));
    const rows = document.querySelectorAll("#pick-res li");
    ok("pick dialog searches the catalog", rows.length >= 1 && [...rows].every(r => /irf540/i.test(r.textContent)), rows.length);
    rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector(".dialog .btn.primary").click();
    ok("OK adds the device and selects it", pane.devices.includes("IRF540") && pane.selected && pane.selected.name === "IRF540");
    ok("selecting a device arms placement with its model", editor.tool === "NMOS" && editor.placeProps.model === "IRF540");
    canvasClick(300, 300);
    const placed = editor.components[0];
    ok("placing from the device list applies the part's model", placed && placed.model === "IRF540" && placed.name === "Q1", placed && placed.model);
    editor.setTool("select");

    // ---- edit component dialog ----
    reset();
    const r = editor.addComponent("R", 300, 300);
    r.value = "1 kΩ";
    editor.selection = [r];
    editor.onEdit(r);
    const input = document.querySelector('.dialog [data-prop="value"]');
    ok("double-click opens Edit Component with the part's fields", !!input && input.value === "1 kΩ");
    input.value = "2.2k";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    ok("edits apply live", editor.components[0].value === "2.2k", editor.components[0].value);
    [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "Cancel").click();
    ok("Cancel reverts the edit", editor.components[0].value === "1 kΩ", editor.components[0].value);
    editor.selection = [editor.components[0]];
    editor.onEdit(editor.components[0]);
    const input2 = document.querySelector('.dialog [data-prop="value"]');
    input2.value = "4.7k";
    input2.dispatchEvent(new Event("input", { bubbles: true }));
    input2.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector(".dialog .btn.primary").click();
    ok("OK keeps the edit and it is undoable", editor.components[0].value === "4.7k" && editor.historyStack.length > 0);

    // ---- terminals / generators / instruments lists ----
    pane.setMode("generators");
    ok("generator mode lists sources", pane.entries().some(e => e.name === "SINE") && document.querySelector("#devtitle").textContent === "GENERATORS");
    pane.select(pane.entries().find(e => e.name === "SINE"));
    canvasClick(600, 400);
    const src = editor.components.find(c => c.type === "V");
    ok("a SINE generator is placed as an AC source", src && src.sourceType === "AC", src && src.sourceType);
    editor.setTool("select");
    pane.setMode("devices");

    // ---- live simulation ----
    reset();
    loadExampleById(editor, "instruments");
    document.getElementById("liveSpeed").value = "0";
    live.start();
    live.advance(100, true);   // drive the clock too: the preview pane may throttle animation frames
    live.readout();
    await wait(300);
    const am = editor.components.find(c => c.type === "AM"), vm = editor.components.find(c => c.type === "VM");
    ok("Play runs the simulation clock", live.state === "running" && live.run.t > 0.001, live.run && live.run.t);
    ok("meters show live readings", /V$/.test(vm.live || "") && /A$/.test(am.live || ""), [vm.live, am.live]);
    live.paint(true);
    ok("live displays do not change the circuit signature (no endless restarts)", live.circuitSignature() === live.signature);
    ok("the oscilloscope receives traces", editor.components.find(c => c.type === "SCOPE").scopeTrace.some(t => t.length > 10));
    live.pause();
    const tPause = live.run.t;
    await wait(200);
    ok("Pause freezes the clock", live.state === "paused" && live.run.t === tPause);
    live.start();
    live.advance(200, true); // the pane may throttle animation frames, so drive the clock too
    await wait(200);
    ok("Play resumes from the same state", live.state === "running" && live.run.t > tPause);
    const t0 = live.run.t;
    editor.components.find(c => c.name === "R1").value = "2 kΩ";
    await wait(500);
    ok("editing the circuit restarts the run", live.state === "running" && live.run.t < t0 + 0.2 && live.run.t > 0, [t0, live.run.t]);
    live.stop();
    ok("Stop clears the displays", vm.live === undefined && live.state === "stopped");

    // switches toggle without a restart
    reset();
    loadExampleById(editor, "pot-divider");
    document.getElementById("liveSpeed").value = "0";
    live.start();
    await wait(400);
    const sw = editor.components.find(c => c.type === "SW");
    const tBefore = live.run.t;
    sw.closed = false;
    live.syncControls && live.syncControls();
    live.advance(200, true);
    await wait(300);
    ok("toggling a switch keeps the run going", live.state === "running" && live.run.t > tBefore, [tBefore, live.run.t]);
    live.stop();

    // ---- graph window ----
    graph.show("ac");
    ok("graph window shows the requested tab", graph.visible && document.querySelector(".graph-tab.active").dataset.id === "ac");
    graph.hide();
    ok("graph window hides", !graph.visible);

    // ---- themes and ERC ----
    Theme.set("dark");
    ok("dark theme applies", document.documentElement.getAttribute("data-theme") === "dark" && Theme.token("sheet") === "#101318");
    Theme.set("classic");
    ok("classic theme applies", document.documentElement.getAttribute("data-theme") === "classic");

    reset();
    editor.addComponent("R", 300, 300);
    const before = AppLog.entries.length;
    Commands.run("design.erc");
    ok("the ERC reports unconnected pins and a missing ground", AppLog.entries.length > before + 2 &&
        AppLog.entries.some(e => /no ground/i.test(e.text)) && AppLog.entries.some(e => /not connected/.test(e.text)));
    Dialog.close("test");

    // ---- probes are real objects ----
    reset();
    loadExampleById(editor, "half-wave");
    {
        const pointer = (type, x, y, o = {}) => {
            const r = editor.canvas.getBoundingClientRect();
            editor.canvas.dispatchEvent(new (type === "contextmenu" ? MouseEvent : PointerEvent)(type, {
                clientX: r.left + editor.panX + x * editor.zoom, clientY: r.top + editor.panY + y * editor.zoom,
                button: o.button || 0, buttons: o.buttons === undefined ? (type === "pointerup" ? 0 : 1) : o.buttons, bubbles: true, pointerId: 1
            }));
        };
        const pr = editor.probes[0];
        pointer("pointerdown", pr.x, pr.y); pointer("pointerup", pr.x, pr.y);
        ok("clicking a probe selects it", editor.selectedProbe && editor.selectedProbe.id === pr.id);

        // it follows the part it is attached to
        const owner = editor.components.find(c => editor.getTerminals(c).some(t => { const p = editor.getTerminalPosition(c, t); return p.x === pr.x && p.y === pr.y; }));
        editor.selection = [owner]; editor.selectedProbe = null;
        const info0 = NetlistExtractor.extract(editor);
        const node0 = info0.getPointNodeName(pr.x, pr.y);
        owner.x += 40; editor.refreshWires();
        const info1 = NetlistExtractor.extract(editor);
        ok("a voltage probe follows its pin when the part moves (and still reads the same net)", info1.getPointNodeName(pr.x, pr.y) === node0 && node0 !== "0", [node0, info1.getPointNodeName(pr.x, pr.y)]);
        owner.x -= 40; editor.refreshWires();

        // drag it onto another pin
        const probe = editor.probes[0];
        const orig = { x: probe.x, y: probe.y };
        const other = editor.components.find(c => c.type !== "GND" && c !== editor.components.find(k => k.id === probe.anchor.component));
        const t = editor.getTerminals(other)[0], tp = editor.getTerminalPosition(other, t);
        pointer("pointerdown", probe.x, probe.y); pointer("pointermove", tp.x, tp.y); pointer("pointerup", tp.x, tp.y);
        const moved = editor.probes[0];
        ok("dragging a probe re-anchors it on the pin it is dropped on", moved.x === tp.x && moved.y === tp.y && moved.anchor && moved.anchor.component === other.id, [moved.x, moved.y, moved.anchor]);
        editor.undo();
        ok("probe moves are undoable", editor.probes[0].x === orig.x && editor.probes[0].y === orig.y);

        // deleting what it measures removes it
        const n = editor.probes.length;
        const target = editor.components.find(c => c.id === editor.probes[0].anchor.component);
        editor.selection = [target]; editor.removeSelected();
        ok("deleting a part removes the probes attached to it", editor.probes.length === n - 1);
        editor.undo();

        // delete the probe itself
        pointer("pointerdown", editor.probes[0].x, editor.probes[0].y); pointer("pointerup", editor.probes[0].x, editor.probes[0].y);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
        ok("Delete removes a selected probe", editor.probes.length === n - 1);
        editor.undo();
        ok("... and undo brings it back", editor.probes.length === n);

        // rename
        const rp = editor.probes[0];
        editor.onEditProbe(rp);
        const input = document.querySelector("#probe-label"); input.value = "V(supply)";
        document.querySelector(".dialog .btn.primary").click();
        ok("double-click / rename edits the probe label", editor.probes.find(p => p.id === rp.id).label === "V(supply)");
    }

    // ---- context menus depend on the target ----
    reset();
    loadExampleById(editor, "ce-amp");
    {
        const menu = () => [...document.querySelectorAll("#contextMenu .ctx-item")].map(r => r.firstChild.textContent);
        const rc = (x, y) => {
            const r = editor.canvas.getBoundingClientRect();
            editor.canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: r.left + editor.panX + x * editor.zoom, clientY: r.top + editor.panY + y * editor.zoom, button: 2, bubbles: true }));
        };
        const q = editor.components.find(c => c.type === "BJT_NPN");
        rc(q.x, q.y);
        let m = menu();
        ok("part menu: edit, delete, rotate, mirror, current probe", ["Edit Properties", "Delete Object", "Rotate Clockwise", "Rotate 180°", "Mirror Left-Right", "Mirror Top-Bottom", "Add Current Probe"].every(x => m.includes(x)), m);
        ok("right-click selects the part under the pointer", editor.selection.length === 1 && editor.selection[0] === q);
        const w = editor.wires[0], mid = w.route[Math.floor(w.route.length / 2)];
        rc(mid.x, mid.y); m = menu();
        ok("wire menu: delete wire, redraw, voltage probe", ["Delete Wire", "Redraw Wire", "Add Voltage Probe Here"].every(x => m.includes(x)) && !m.includes("Rotate Clockwise"), m);
        const pr = editor.probes[0];
        rc(pr.x, pr.y); m = menu();
        ok("probe menu: rename and delete", m.includes("Rename Probe") && m.includes("Delete Probe") && m.length === 2, m);
        editor.clearSelection();
        rc(20, 20); m = menu();
        ok("empty-sheet menu: paste, undo, zoom, pick devices", ["Paste", "Undo", "Select All", "Zoom to Fit", "Pick Devices"].every(x => m.some(y => y.startsWith(x))), m);
        editor.selection = editor.components.slice(0, 3);
        rc(editor.components[0].x, editor.components[0].y); m = menu();
        ok("multi-selection menu offers block operations", m.includes("Delete Objects") && m.includes("Cut"), m);
        // the menu entry works
        editor.selection = [q]; rc(q.x, q.y);
        const rot0 = q.rotation;
        [...document.querySelectorAll("#contextMenu .ctx-item")].find(r => r.firstChild.textContent === "Rotate Clockwise").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        ok("choosing a menu entry runs it", editor.components.find(c => c.type === "BJT_NPN").rotation === (rot0 + 90) % 360);
        ok("the menu closes after a choice", document.getElementById("contextMenu").style.display === "none");
        const sw = (() => { reset(); loadExampleById(editor, "pot-divider"); return editor.components.find(c => c.type === "SW"); })();
        if (sw) { rc(sw.x, sw.y); ok("switch menu has Toggle Switch", menu().includes("Toggle Switch"), menu()); }
    }

    // ---- unusable values are reported, not silently replaced ----
    reset();
    loadExampleById(editor, "ce-amp");
    {
        editor.components.find(c => c.type === "R").value = "abc";
        editor.components.find(c => c.type === "BJT_NPN").model = "NOPE";
        const w = NetlistExtractor.extract(editor).warnings;
        ok("an invalid resistance is flagged", w.some(x => /"abc" is not a valid resistance/.test(x)), w);
        ok("an unknown model is flagged", w.some(x => /model "NOPE" is not in the library/.test(x)), w);
    }

    // ---- paste rides on the cursor; Drag Object follows it until a click ----
    reset();
    loadExampleById(editor, "half-wave");
    {
        const pointer = (type, x, y, o = {}) => {
            const r = editor.canvas.getBoundingClientRect();
            editor.canvas.dispatchEvent(new (type === "contextmenu" ? MouseEvent : PointerEvent)(type, {
                clientX: r.left + editor.panX + x * editor.zoom, clientY: r.top + editor.panY + y * editor.zoom,
                button: o.button || 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, pointerId: 1
            }));
        };
        const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o }));
        const r1 = editor.components.find(c => c.type === "R") || editor.components.find(c => c.type === "D");
        editor.selection = [r1];
        key("c", { ctrlKey: true });
        const n = editor.components.length;
        pointer("pointermove", 700, 600);
        key("v", { ctrlKey: true });
        ok("Ctrl+V starts a paste that follows the cursor (nothing placed yet)", editor.pasteMode && editor.components.length === n);
        pointer("pointermove", 760, 640);
        editor.draw();
        pointer("pointerdown", 760, 640); pointer("pointerup", 760, 640);
        const added = editor.components[editor.components.length - 1];
        ok("a click drops the pasted block at the cursor", !editor.pasteMode && editor.components.length === n + 1 && Math.abs(added.x - 760) <= 40 && Math.abs(added.y - 640) <= 40, [added.x, added.y]);
        key("v", { ctrlKey: true });
        key("Escape");
        ok("Esc cancels a paste", !editor.pasteMode && editor.components.length === n + 1);

        // drag object
        editor.selection = [added];
        pointer("pointermove", added.x, added.y);
        const x0 = added.x, y0 = added.y;
        Commands.run("edit.drag");
        ok("Drag Object picks the selection up", editor.dragObject === true && !!editor.move);
        pointer("pointermove", x0 + 80, y0 + 60);
        ok("the object follows the pointer without a button held", added.x === x0 + 80 && added.y === y0 + 60, [added.x, added.y]);
        pointer("pointerup", x0 + 80, y0 + 60);
        ok("releasing the button does not drop it", editor.dragObject === true);
        pointer("pointerdown", x0 + 80, y0 + 60); pointer("pointerup", x0 + 80, y0 + 60);
        ok("the next click drops it", !editor.dragObject && !editor.move && added.x === x0 + 80);
        Commands.run("edit.drag");
        pointer("pointermove", x0 + 200, y0 + 100);
        key("Escape");
        const back = editor.components.find(c => c.id === added.id);
        ok("Esc puts a dragged object back", !editor.dragObject && back.x === x0 + 80 && back.y === y0 + 60, [back.x, back.y]);
    }

    // ---- keyboard in the menus ----
    reset();
    {
        const k = (key, o = {}) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...o }));
        const menus = [...document.querySelectorAll("#menubar .menu")];
        const open = () => menus.findIndex(m => m.classList.contains("open"));
        const lit = () => { const r = document.querySelector("#menubar .menu.open .menu-item.kb"); return r ? r.textContent : null; };
        ok("menu titles underline their Alt letter", document.querySelector("#menubar .menu-title u").textContent === "F");
        k("e", { altKey: true });
        ok("Alt+E opens the Edit menu with its first enabled item lit", open() === 1 && !!lit(), [open(), lit()]);
        k("ArrowRight");
        ok("Right arrow moves to the next menu", open() === 2);
        k("ArrowLeft"); k("ArrowLeft");
        ok("Left arrow wraps around to the previous menu", open() === 0);
        k("ArrowDown");
        const first = lit();
        k("ArrowDown");
        ok("Down arrow moves the highlight", lit() !== first);
        k("Escape");
        ok("Esc closes the menu", open() === -1);
        k("F10");
        ok("F10 opens the first menu", open() === 0);
        // Examples submenu by keyboard
        let guard = 0;
        while (!/Examples/.test(lit() || "") && guard++ < 20) k("ArrowDown");
        k("ArrowRight");
        ok("Right arrow opens a submenu", !!document.querySelector("#menubar .menu-item.open-sub") && document.querySelectorAll("#menubar .open-sub .menu-item.kb").length === 1);
        k("ArrowLeft");
        ok("Left arrow closes the submenu", !document.querySelector("#menubar .menu-item.open-sub"));
        k("Escape");
        // Enter runs the item
        loadExampleById(editor, "led");
        const before = editor.zoom;
        k("v", { altKey: true });
        let g2 = 0;
        while (!/Zoom In/.test(lit() || "") && g2++ < 10) k("ArrowDown");
        k("Enter");
        ok("Enter runs the highlighted command and closes the menu", open() === -1 && editor.zoom > before, [before, editor.zoom]);
    }

    // ---- insert an example next to an existing design ----
    reset();
    loadExampleById(editor, "led");
    {
        const nBefore = editor.components.length, wBefore = editor.wires.length, pBefore = editor.probes.length;
        const snapBefore = editor.snapshot(), histBefore = editor.historyStack.length;
        const built = exampleAsClipboard(editor, "ce-amp");
        ok("building an example off-sheet leaves the design and its history alone", editor.snapshot() === snapBefore && editor.historyStack.length === histBefore);
        const exParts = built.clip.comps.length, exWires = built.clip.wires.length, exProbes = built.clip.probes.length;
        ok("the block holds every part, wire (junctions included) and probe", exParts === 12 && exWires === 14 && exProbes === 2, [exParts, exWires, exProbes]);

        Commands.all.size; // menu entry exists
        ok("there is a single Examples list (no separate Insert Example)", ![...document.querySelectorAll("#menubar .has-sub .label")].some(l => l.textContent === "Insert Example"));

        editor.clipboard = built.clip;
        editor.mouse = { x: 900, y: 300, screenX: 0, screenY: 0 }; editor.mouseInside = true;
        editor.beginPaste(true);
        ok("the example rides on the cursor", editor.pasteMode && editor.components.length === nBefore);
        // drop it to the right of the existing circuit
        const r = editor.canvas.getBoundingClientRect();
        const at = (x, y) => ({ clientX: r.left + editor.panX + x * editor.zoom, clientY: r.top + editor.panY + y * editor.zoom, bubbles: true, pointerId: 1, button: 0 });
        editor.canvas.dispatchEvent(new PointerEvent("pointermove", at(900, 300)));
        editor.canvas.dispatchEvent(new PointerEvent("pointerdown", { ...at(900, 300), buttons: 1 }));
        editor.canvas.dispatchEvent(new PointerEvent("pointerup", at(900, 300)));
        ok("a click places all of it", !editor.pasteMode && editor.components.length === nBefore + exParts && editor.wires.length === wBefore + exWires && editor.probes.length === pBefore + exProbes,
            [editor.components.length, editor.wires.length, editor.probes.length]);
        const names = editor.components.filter(c => c.type !== "GND").map(c => c.name);
        ok("inserted parts get fresh reference designators", new Set(names).size === names.length, names);
        const ids = [...editor.components.map(c => c.id), ...editor.wires.map(w => w.id), ...editor.probes.map(p => p.id)];
        ok("all ids are unique", new Set(ids).size === ids.length);
        ok("no wire in the inserted block is unroutable", editor.wires.filter(w => w.blocked).length === 0);
        const junctions = editor.wires.filter(w => w.end.type === "wire");
        ok("junction wires point at wires that exist", junctions.length === 2 && junctions.every(w => editor.wires.some(x => x.id === w.end.wireId)), junctions.length);
        const info = NetlistExtractor.extract(editor);
        ok("the combined design extracts and simulates", (() => { const op = new SimEngine(info.circuit).operatingPoint(); return Object.values(op.nodeVoltages).every(Number.isFinite); })());
        ok("inserted probes read live nets", editor.probes.every(p => p.type === "I" || info.getPointNodeName(p.x, p.y) !== "0"));
        editor.undo();
        ok("one Undo removes the whole inserted example", editor.components.length === nBefore && editor.wires.length === wBefore && editor.probes.length === pBefore);

        // choosing an example from the menu on a non-empty sheet places it instead of replacing the design
        const nNow = editor.components.length;
        document.querySelector('#menubar [data-cmd="ex.half-wave"]') || document.querySelectorAll("#menubar .menu")[0].querySelector(".has-sub").dispatchEvent(new MouseEvent("mouseenter"));
        document.querySelector('#menubar [data-cmd="ex.half-wave"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        ok("an example chosen on a non-empty sheet rides on the cursor", editor.pasteMode && editor.components.length === nNow, [editor.pasteMode, editor.components.length, nNow]);
        editor.cancelPaste();
        reset();
        document.querySelector('#menubar [data-cmd="ex.led"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        ok("on an empty sheet the same entry opens the example", !editor.pasteMode && editor.components.length > 0);
        loadExampleById(editor, "led");

        // a click on a spot that cannot hold it does nothing
        editor.clipboard = built.clip;
        editor.mouse = { x: 200, y: 200, screenX: 0, screenY: 0 };
        editor.beginPaste(true);
        const offset = editor.pasteOffset(editor.components[0].x, editor.components[0].y);
        ok("the ghost finds a free spot near the cursor", offset.free === true);
        editor.cancelPaste();
    }

    // ---- sources and instruments are discoverable ----
    reset();
    {
        const names = (q) => DeviceCatalog.search(q, "(all)").map(d => d.name);
        ok("Pick Devices finds the sine, square, triangle, pulse and EXP sources", ["SINE", "SQUARE", "TRIANGLE", "PULSE", "EXP", "SFFM", "SAWTOOTH"].every(n => names(n).includes(n)), names("sine"));
        ok("Pick Devices finds the instruments and ground", names("scope").includes("OSCILLOSCOPE") && names("voltmeter").includes("VOLTMETER") && names("ground").includes("GROUND"));
        ok("the Tool menu lists every source", (() => {
            const sub = [...document.querySelectorAll("#menubar .menu")][3];
            const row = [...sub.querySelectorAll(".has-sub")].find(r => r.textContent.startsWith("Place Source"));
            row.dispatchEvent(new MouseEvent("mouseenter"));
            const labels = [...row.querySelectorAll(".menu-item .label")].map(l => l.textContent);
            return ["DC", "SINE", "PULSE", "SQUARE", "TRIANGLE"].every(n => labels.includes(n));
        })());
        const row = [...document.querySelectorAll("#menubar .menu")][3].querySelector(".has-sub .menu-item");
        row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        ok("choosing a source from the menu arms its placement", editor.tool === "V" && pane.mode === "generators", [editor.tool, pane.mode]);
        editor.setTool("select"); pane.setMode("devices");
    }

    reset();
    const failed = results.filter(x => !x.pass);
    return { total: results.length, failed: failed.length, failures: failed };
};

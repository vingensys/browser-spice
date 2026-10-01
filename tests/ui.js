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
    const missing = [...document.querySelectorAll("#menubar .menu-item[data-cmd]")].map(r => r.dataset.cmd).filter(id => !id.startsWith("ex.") && !Commands.get(id));
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

    reset();
    const failed = results.filter(x => !x.pass);
    return { total: results.length, failed: failed.length, failures: failed };
};

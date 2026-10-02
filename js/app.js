// Application bootstrap: builds the ISIS-style shell, defines every command once, and
// connects the editor, simulator, graph window and live simulation to it.

(() => {
    const $ = (id) => document.getElementById(id);

    Theme.restore();
    SimModelLibrary.restore();
    Dialog.init();

    const editor = new SchematicEditor($("schematic"));
    const graph = new GraphWindow($("graphwin"), null, null, editor);
    const plotter = graph.plotter;
    const props = new PropertiesPanel(editor, $("propertiesContent"));
    const runner = new SimRunner(editor, plotter);
    graph.runner = runner;
    const live = new LiveSim(editor, runner, graph);
    const pane = new DevicePane(editor, { list: $("devicelist"), title: $("devtitle"), preview: $("devpreview") });
    const overview = new Overview($("overview"), editor);
    const status = new StatusBar($("statusbar"), editor);
    const doc = new DocumentStore(editor, runner);
    doc.onChange(() => status.setDocument(doc));
    const opOverlay = new OpOverlay(editor, runner, live, doc);

    // the console and the tests reach these through the window
    Object.assign(window, { editor, plotter, runner, graph, live, pane, propertiesPanel: props, overview, status, doc, opOverlay });

    // an analysis run brings its tab to the front
    for (const [method, kind] of [["runDC", "dc"], ["runAC", "ac"], ["runNoise", "noise"], ["runTransient", "tran"], ["runSweep", "sweep"]]) {
        const original = runner[method].bind(runner);
        runner[method] = () => { graph.show(kind); return original(); };
    }
    pane.onGraph = (kind) => graph.show(kind);

    // ------------------------------------------------------------------ helpers

    const download = (name, text, type) => {
        const blob = text instanceof Blob ? text : new Blob([text], { type });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    window.downloadFile = download;

    const afterLoad = () => {
        ScopeWindow.closeAll();
        runner.refreshSweepSources();
        editor.notify();
        Commands.refresh();
    };

    const zoom = (f) => editor.zoomAt(editor.width / 2, editor.height / 2, f);
    const hasSel = () => editor.selection.length > 0 || !!editor.selectedWire || !!editor.selectedProbe;

    // --------------------------------------------------------------- electrical rules

    function runErc() {
        const result = ErcChecker.run(editor);
        const errs = result.issues.filter(i => i.level === "err").length, warns = result.issues.length - errs;
        AppLog.add("info", `Electrical rules check: ${result.issues.length ? `${errs} error(s), ${warns} warning(s)` : "no problems found"}.`);
        result.issues.forEach(i => AppLog.add(i.level, i.text));
        ErcDialog.open(editor, result, { onRerun: runErc });
        return result;
    }
    window.runErc = runErc;

    // ---------------------------------------------------------------------- commands

    const C = (id, label, opts) => Commands.add(Object.assign({ id, label }, opts));
    const toolIs = (t) => () => editor.tool === t;

    const saveToFile = () => {
        const name = doc.name || "circuit_design.json";
        download(name, JSON.stringify(doc.serialize(), null, 2), "application/json");
        doc.markSaved(name);
    };

    C("file.new", "New Design", { icon: "new", keys: "Ctrl+N", global: true, run() {
        doc.confirmDiscard(() => {
            live.stop();
            editor.saveState();
            editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
            editor.clearSelection(); editor.resetView(); afterLoad();
            doc.discardAutosave();
            doc.markSaved(null);
        }, saveToFile);
    } });
    C("file.open", "Open Design…", { icon: "open", keys: "Ctrl+O", global: true, run: () => doc.confirmDiscard(() => $("fileInput").click(), saveToFile) });
    C("file.save", "Save Design", { icon: "save", keys: "Ctrl+S", global: true, run: saveToFile });
    C("file.import", "Import SPICE Netlist / Model Library…", { icon: "import", run: () => doc.confirmDiscard(() => $("spiceInput").click(), saveToFile) });
    C("file.export", "Export SPICE Netlist…", { icon: "export", run: () => runner.guard(() => {
        const { text } = runner.spiceText();
        const ta = document.createElement("textarea");
        ta.className = "netlist";
        ta.readOnly = true;
        ta.value = text;
        Dialog.open({
            title: "SPICE Netlist (.cir)",
            content: ta,
            buttons: [{ label: "Download .cir", primary: true, onClick: () => { download("circuit.cir", ta.value, "text/plain"); return false; } }, { label: "Close" }]
        });
    }) });
    C("file.bom", "Bill of Materials…", { run: () => Exporter.openBom(editor) });
    C("file.image", "Export Schematic Image (PNG)…", { run: () => Exporter.savePng(editor) });
    C("file.print", "Print…", { run: () => window.print() });

    C("edit.undo", "Undo", { icon: "undo", keys: "Ctrl+Z", enabled: () => editor.historyStack.length > 0, run: () => editor.undo() });
    C("edit.redo", "Redo", { icon: "redo", keys: "Ctrl+Y", enabled: () => editor.futureStack.length > 0, run: () => editor.redo() });
    C("edit.cut", "Cut", { icon: "cut", keys: "Ctrl+X", enabled: () => editor.selection.length > 0, run: () => editor.cutSelected() });
    C("edit.copy", "Copy", { icon: "copy", keys: "Ctrl+C", enabled: () => editor.selection.length > 0, run: () => editor.copySelected() });
    C("edit.paste", "Paste", { icon: "paste", keys: "Ctrl+V", enabled: () => !!editor.clipboard, run: () => editor.beginPaste() });
    C("edit.delete", "Delete", { icon: "delete", keys: "Del", enabled: hasSel, run: () => editor.removeSelected() });
    C("edit.selectall", "Select All", { keys: "Ctrl+A", run: () => editor.selectAll() });
    C("edit.rotate", "Rotate Clockwise", { icon: "rotate", keys: "R", enabled: () => editor.selection.length > 0, run: () => editor.rotateSelected(1) });
    C("edit.rotateccw", "Rotate Anti-clockwise", { icon: "rotateccw", enabled: () => editor.selection.length > 0, run: () => editor.rotateSelected(3) });
    C("edit.drag", "Drag Object", { enabled: () => editor.selection.length > 0, run: () => editor.beginDragObject() });
    C("edit.rotate180", "Rotate 180°", { enabled: () => editor.selection.length > 0, run: () => editor.rotateSelected(2) });
    C("edit.mirrorx", "Mirror Left-Right", { icon: "mirrorx", keys: "X", enabled: () => editor.selection.length > 0 || editor.isPlacing(), run: () => editor.mirrorSelected("x") });
    C("edit.mirrory", "Mirror Top-Bottom", { icon: "mirrory", keys: "Y", enabled: () => editor.selection.length > 0 || editor.isPlacing(), run: () => editor.mirrorSelected("y") });
    C("edit.properties", "Edit Properties…", { keys: "Ctrl+E", global: true, enabled: () => !!editor.selected, run: () => editor.onEdit(editor.selected) });
    C("edit.tidy", "Tidy Wires", { icon: "tidy", keys: "T", run() {
        if (!editor.wires.length) return;
        editor.saveState();
        editor.selectedWire ? editor.tidyWire(editor.selectedWire) : editor.tidyAllWires();
        editor.draw();
    } });

    C("view.zoomin", "Zoom In", { icon: "zoomin", keys: "+", run: () => zoom(1.25) });
    C("view.zoomout", "Zoom Out", { icon: "zoomout", keys: "-", run: () => zoom(0.8) });
    C("view.fit", "Zoom to Fit", { icon: "fit", keys: "F", run: () => editor.fitView() });
    C("view.reset", "Zoom 100%", { keys: "Ctrl+0", run: () => editor.resetView() });
    C("view.grid", "Grid", { icon: "grid", keys: "Ctrl+G", global: true, checked: () => editor.showGrid !== false, run() { editor.showGrid = editor.showGrid === false; editor.draw(); } });
    C("view.graph", "Graph Window", { icon: "graph", checked: () => graph.visible, run: () => (graph.visible ? graph.hide() : graph.show()) });
    C("view.classic", "Classic (ISIS) Colours", { checked: () => Theme.name === "classic", run: () => Theme.set("classic") });
    C("view.dark", "Dark Colours", { checked: () => Theme.name === "dark", run: () => Theme.set("dark") });

    C("tool.select", "Selection Mode", { icon: "select", keys: "Esc", checked: toolIs("select"), run: () => editor.setTool("select") });
    C("tool.wire", "Wire Tool", { icon: "wire", keys: "W", checked: toolIs("wire"), run: () => editor.setTool("wire") });
    C("tool.text", "Place Text", { icon: "text", keys: "A", checked: toolIs("TEXT"), run: () => editor.setTool("TEXT") });
    C("text.here", "Add Text Here", { run() {
        editor.saveState();
        const c = editor.addComponent("TEXT", editor.contextPos.x, editor.contextPos.y, 0);
        editor.selection = [c];
        editor.draw(); editor.notify();
        editor.onEdit(c);
    } });
    C("design.ercnext", "Next ERC Issue", { keys: "F4", global: true, enabled: () => !!(ErcDialog.last && ErcDialog.last.issues.length), run: () => ErcDialog.next(editor) });
    C("view.op", "Show Operating Point", { icon: "", checked: () => opOverlay.on, run: () => opOverlay.toggle() });
    C("net.highlight", "Highlight Net", { keys: "H", run: () => editor.toggleHighlightAt(editor.mouseInside ? editor.mouse.x : undefined, editor.mouseInside ? editor.mouse.y : undefined) });
    C("net.highlightpin", "Highlight Net", { run: () => { if (editor.contextPin) editor.highlightNet(editor.contextPin); } });
    C("net.highlightwire", "Highlight Net", { enabled: () => !!editor.selectedWire, run: () => { if (editor.selectedWire) editor.highlightNet({ wire: editor.selectedWire }); } });
    C("net.clear", "Clear Net Highlight", { enabled: () => !!editor.netHighlight, run: () => editor.clearHighlight() });
    C("design.titleblock", "Title Block…", { icon: "", run: () => openTitleBlock() });
    C("tool.vprobe", "Voltage Probe", { icon: "vprobe", checked: toolIs("vProbe"), run: () => { pane.setMode("probes"); pane.select(DeviceCatalog.probes()[0]); } });
    C("tool.iprobe", "Current Probe", { icon: "iprobe", checked: toolIs("iProbe"), run: () => { pane.setMode("probes"); pane.select(DeviceCatalog.probes()[1]); } });

    C("design.settings", "Simulation Settings…", { icon: "settings", run() {
        runner.refreshSweepSources();
        Dialog.open({ title: "Simulation Settings", content: $("settings-form"), buttons: [{ label: "OK", primary: true }] });
    } });
    C("design.sweep", "Parametric Sweep…", { run: () => StudyDialog.openSweep() });
    C("design.montecarlo", "Monte Carlo…", { run: () => StudyDialog.openMonteCarlo() });
    C("design.erc", "Electrical Rules Check", { icon: "erc", run: runErc });

    C("graph.tran", "Analogue Analysis (Transient)", { run: () => graph.show("tran") });
    C("graph.ac", "Frequency Response (AC)", { run: () => graph.show("ac") });
    C("graph.noise", "Noise Analysis", { run: () => graph.show("noise") });
    C("graph.sweep", "DC Sweep", { run: () => graph.show("sweep") });
    C("graph.dc", "Operating Point", { run: () => graph.show("dc") });
    C("graph.simulate", "Simulate Graph", { icon: "graph", run: () => graph.simulate() });

    C("sim.play", "Run Simulation", { icon: "play", cls: "play", keys: "F12", global: true, enabled: () => live.state !== "running", run: () => live.start() });
    C("sim.pause", "Pause Simulation", { icon: "pause", keys: "Pause", global: true, enabled: () => live.state === "running", run: () => live.pause() });
    C("sim.stop", "Stop Simulation", { icon: "stop", cls: "stop", keys: "Shift+F12", global: true, enabled: () => live.state !== "stopped", run: () => live.stop() });
    C("sim.step", "Step Simulation", { icon: "step", keys: "F10", global: true, enabled: () => live.state !== "running", run: () => live.step() });

    C("lib.pick", "Pick Devices…", { icon: "pick", keys: "P", global: true, run: () => PickDialog.open(pane) });
    C("lib.remove", "Remove Selected Device from List", { run: () => pane.removeSelected() });
    C("lib.reset", "Forget Imported Models", { run() { SimModelLibrary.clear(); runner.toast("Imported models will be gone after you reload the page.", "info"); } });

    C("help.keys", "Keyboard & Mouse", { icon: "help", run: () => ShortcutsDialog.open() });
    C("help.about", "About Browser SPICE", { run: () => AboutDialog.open() });

    Commands.bindKeyboard();

    // -------------------------------------------------------------------------- menus

    // One Examples list. On an empty sheet an example opens (with its suggested run settings);
    // on a sheet that already holds a design it attaches to the cursor so it can be placed beside it.
    const exampleItems = () => EXAMPLES.map(ex => ({
        id: `ex.${ex.id}`, label: ex.name, keys: "",
        run() {
            live.stop();
            const empty = !editor.components.length && !editor.wires.length && !editor.probes.length;
            if (empty) {
                const loaded = loadExampleById(editor, ex.id);
                afterLoad();
                doc.markSaved(null);          // an untouched example is not "unsaved work"
                runner.toast(loaded.note, "info");
                return;
            }
            const built = exampleAsClipboard(editor, ex.id);
            if (!built) return;
            editor.clipboard = built.clip;
            editor.beginPaste(true);
            runner.toast(`${ex.name}: move onto the sheet and click to place it. Esc cancels. (File > New first to open it on its own.)`, "info");
        }
    }));

    // arm placement of a source / instrument / terminal straight from the menu
    const placeItems = (mode, entries) => entries.map(e => ({
        id: `place.${e.name}`, label: e.name, keys: "",
        run() { pane.setMode(mode); pane.select(entries.find(x => x.name === e.name)); }
    }));

    new Menubar($("menubar"), [
        { title: "File", items: ["file.new", "file.open", "file.save", "-", "file.import", "file.export", "file.bom", "file.image", "-", { sub: "Examples", items: exampleItems }, "-", "file.print"] },
        { title: "Edit", items: ["edit.undo", "edit.redo", "-", "edit.cut", "edit.copy", "edit.paste", "edit.delete", "edit.selectall", "-", "edit.drag", "-", "edit.rotate", "edit.rotateccw", "edit.rotate180", "edit.mirrorx", "edit.mirrory", "-", "edit.properties", "edit.tidy"] },
        { title: "View", items: ["view.zoomin", "view.zoomout", "view.fit", "view.reset", "-", "view.grid", "view.graph", "view.op", "-", "view.classic", "view.dark"] },
        { title: "Tool", items: ["tool.select", "tool.wire", "tool.text", "tool.vprobe", "tool.iprobe", "-",
            { sub: "Place Source", items: () => placeItems("generators", DeviceCatalog.generators()) },
            { sub: "Place Instrument", items: () => placeItems("instruments", DeviceCatalog.instruments()) },
            { sub: "Place Terminal", items: () => placeItems("terminals", DeviceCatalog.terminals()) }] },
        { title: "Design", items: ["design.titleblock", "design.settings", "-", "design.sweep", "design.montecarlo", "-", "design.erc", "design.ercnext", "-", "net.highlight", "net.clear"] },
        { title: "Graph", items: ["graph.tran", "graph.ac", "graph.noise", "graph.sweep", "graph.dc", "-", "graph.simulate"] },
        { title: "Debug", mnemonic: "b", items: ["sim.play", "sim.step", "sim.pause", "sim.stop"] },
        { title: "Library", items: ["lib.pick", "lib.remove", "-", "file.import", "lib.reset"] },
        { title: "Help", items: ["help.keys", "help.about"] }
    ]);

    new Toolbar($("toolbar"), [
        "file.new", "file.open", "file.save", "|", "file.import", "file.export", "|",
        "edit.undo", "edit.redo", "|", "edit.cut", "edit.copy", "edit.paste", "edit.delete", "|",
        "edit.rotate", "edit.rotateccw", "edit.tidy", "|",
        "view.zoomin", "view.zoomout", "view.fit", "view.grid", "|",
        "view.graph", "design.settings", "design.erc", "lib.pick"
    ]);

    // rotate buttons under the device list, as in ISIS
    new Toolbar($("rotbar"), ["edit.rotate", "edit.rotateccw", "edit.mirrorx", "edit.mirrory"]);

    // ---------------------------------------------------------------- mode toolbar

    const modes = [
        { id: "select", icon: "select", title: "Selection Mode (Esc)", run: () => editor.setTool("select") },
        { id: "component", icon: "component", title: "Component Mode: place parts from the device list", run: () => pane.setMode("devices") },
        { id: "wire", icon: "wire", title: "Wire Tool (W)", run: () => editor.setTool("wire") },
        { id: "text", icon: "text", title: "Text (A): add a note to the sheet", run: () => editor.setTool("TEXT") },
        { id: "terminals", icon: "terminal", title: "Terminals Mode: ground, initial conditions", run: () => pane.setMode("terminals") },
        { id: "generators", icon: "generator", title: "Generator Mode: sources", run: () => pane.setMode("generators") },
        { id: "vprobe", icon: "vprobe", title: "Voltage Probe (lists the probes)", run: () => { pane.setMode("probes"); pane.select(DeviceCatalog.probes()[0]); } },
        { id: "iprobe", icon: "iprobe", title: "Current Probe (lists the probes)", run: () => { pane.setMode("probes"); pane.select(DeviceCatalog.probes()[1]); } },
        { id: "instruments", icon: "instrument", title: "Virtual Instruments Mode", run: () => pane.setMode("instruments") },
        { id: "graphs", icon: "graph", title: "Graph Mode: analyses", run: () => pane.setMode("graphs") }
    ];
    const modebar = new ModeBar($("modebar"), modes, (m) => m.run());
    modebar.set("select");

    const modeForTool = () => {
        if (editor.tool === "select") return "select";
        if (editor.tool === "wire") return "wire";
        if (editor.tool === "TEXT") return "text";
        if (editor.tool === "vProbe") return "vprobe";
        if (editor.tool === "iProbe") return "iprobe";
        return { devices: "component", terminals: "terminals", generators: "generators", instruments: "instruments", graphs: "graphs" }[pane.mode];
    };

    // ------------------------------------------------------------------ status / hints

    const hint = () => {
        let text;
        if (live.state !== "stopped") text = "Simulation " + (live.state === "running" ? "running" : "paused") + ". Double-click a switch to toggle it; editing the circuit restarts the run.";
        else if (editor.wiring) text = "Click a pin or wire to finish, empty grid to add a corner, Backspace removes a corner, Esc cancels.";
        else if (editor.tool === "wire") text = "Wire tool: click a pin or wire to start.";
        else if (editor.tool === "vProbe") text = "Voltage probe: click a wire or a pin (click again for more, right-click or Esc to stop).";
        else if (editor.tool === "iProbe") text = "Current probe: click a part, or a wire next to it (click again for more, right-click or Esc to stop)."; 
        else if (editor.netHighlight) text = editor.netHighlight.summary + ". Esc clears.";
        else if (editor.pasteMode) text = "Click to place the pasted block. Esc or right-click cancels.";
        else if (editor.dragObject) text = "Move the pointer, click to drop the object. Esc puts it back.";
        else if (editor.isPlacing()) text = "Click to place (keeps placing). R rotates, right-click or Esc to stop.";
        else if (editor.selection.length > 1) text = `${editor.selection.length} objects selected.`;
        else if (editor.selected) text = `${editor.selected.name} selected. Double-click or Ctrl+E to edit.`;
        else if (editor.selectedWire) text = "Wire selected. Drag a segment to reshape, T to re-route.";
        else text = "Click a pin to wire. Drag to box-select. P picks devices, F12 runs the simulation.";
        status.hint(text);
    };

    editor.onChange = () => {
        modebar.set(modeForTool());
        pane.syncTool(editor.tool);
        runner.refreshSweepSources();
        hint();
        Commands.refresh();
    };

    editor.onNotice = (message) => runner.toast(message, "info");

    editor.onEdit = (comp) => {
        if (!comp) return;
        if (comp.type === "SCOPE") { ScopeWindow.open(editor, live, comp); return; }
        if (comp.type === "LOGAN") { LogicWindow.open(editor, live, comp); return; }
        if (comp.type === "SW") {
            editor.saveState();
            comp.closed = !comp.closed;
            comp.value = comp.closed ? "closed" : "open";
            editor.draw();
            return;
        }
        EditDialog.open(editor, props);
    };

    live.onState((state, t) => { status.setSimState(state, t); hint(); Commands.refresh(); });

    // ---------------------------------------------------------------- context menu

    const ctx = $("contextMenu");

    // right-click menus depend on what is under the pointer, as in ISIS
    C("probe.rename", "Rename Probe…", { enabled: () => !!editor.selectedProbe, run: () => editor.onEditProbe(editor.selectedProbe) });
    C("probe.addI", "Add Current Probe", { enabled: () => editor.selection.length === 1 && editor.selection[0].type !== "GND", run: () => editor.addCurrentProbe(editor.selection[0]) });
    C("probe.addV", "Add Voltage Probe Here", { run: () => editor.addVoltageProbe(editor.contextPos.x, editor.contextPos.y) });
    C("logan.open", "Open Logic Analyser", { enabled: () => editor.selection.length === 1 && editor.selection[0].type === "LOGAN", run: () => LogicWindow.open(editor, live, editor.selection[0]) });
    C("scope.open", "Open Oscilloscope", { enabled: () => editor.selection.length === 1 && editor.selection[0].type === "SCOPE", run: () => ScopeWindow.open(editor, live, editor.selection[0]) });
    C("part.toggle", "Toggle Switch", { enabled: () => editor.selection.length === 1 && editor.selection[0].type === "SW", run: () => editor.onEdit(editor.selection[0]) });

    const CTX = {
        part: ["scope.open", ["edit.properties", "Edit Properties"], "part.toggle", "edit.drag", ["edit.delete", "Delete Object"], "-", "edit.rotate", "edit.rotateccw", "edit.rotate180", "edit.mirrorx", "edit.mirrory", "-",
            "edit.cut", "edit.copy", "-", "probe.addI"],
        multi: ["edit.cut", "edit.copy", "edit.drag", ["edit.delete", "Delete Objects"], "-", "edit.rotate", "edit.rotateccw", "edit.rotate180", "edit.mirrorx", "edit.mirrory"],
        wire: ["net.highlightwire", ["edit.delete", "Delete Wire"], ["edit.tidy", "Redraw Wire"], "-", "probe.addV"],
        pin: ["net.highlightpin", "probe.addV"],
        probe: ["probe.rename", ["edit.delete", "Delete Probe"]],
        empty: ["edit.paste", "text.here", "-", "edit.undo", "edit.redo", "-", "edit.selectall", "-", "view.zoomin", "view.zoomout", "view.fit", "-", "lib.pick", "tool.wire", ["edit.tidy", "Tidy All Wires"]]
    };

    // entries: "-" | { label, key?, disabled?, run }
    window.popupMenu = (e, entries) => {
        ctx.innerHTML = "";
        for (const entry of entries) {
            if (entry === "-") { ctx.insertAdjacentHTML("beforeend", '<div class="ctx-divider"></div>'); continue; }
            const row = document.createElement("div");
            row.className = "ctx-item" + (entry.disabled ? " disabled" : "");
            row.innerHTML = `<span>${PropertiesPanel.esc(entry.label)}</span><span class="ctx-key">${PropertiesPanel.esc(entry.key || "")}</span>`;
            row.onmousedown = (ev) => { ev.preventDefault(); ctx.style.display = "none"; if (!entry.disabled) entry.run(); };
            ctx.appendChild(row);
        }
        ctx.style.display = "block";
        const h = ctx.offsetHeight, w = ctx.offsetWidth;
        ctx.style.left = `${Math.max(0, Math.min(e.clientX, window.innerWidth - w - 4))}px`;
        ctx.style.top = `${Math.max(0, Math.min(e.clientY, window.innerHeight - h - 4))}px`;
    };

    window.showContextMenu = (e, kind = "empty") => {
        const entries = [];
        for (const entry of CTX[kind] || CTX.empty) {
            if (entry === "-") { entries.push("-"); continue; }
            const [id, label] = Array.isArray(entry) ? entry : [entry];
            const cmd = Commands.get(id);
            if (!cmd) continue;
            const enabled = Commands.enabled(id) !== false;
            if (!enabled && /^(part\.toggle|probe\.|scope\.)/.test(id)) continue;   // contextual extras are hidden rather than greyed
            entries.push({ label: (label || cmd.label).replace(/…$/, ""), key: cmd.keys || "", disabled: !enabled, run: () => { Commands.run(id); editor.canvas.focus({ preventScroll: true }); } });
        }
        window.popupMenu(e, entries);
    };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { ctx.style.display = "none"; SimWorker.cancel(); } });

    editor.onEditProbe = (probe) => {
        const wrap = document.createElement("div");
        const colors = [["", "Automatic"], ["#e53935", "Red"], ["#fb8c00", "Orange"], ["#fdd835", "Yellow"], ["#43a047", "Green"], ["#00acc1", "Cyan"], ["#1e88e5", "Blue"], ["#8e24aa", "Purple"], ["#f06292", "Pink"]];
        wrap.innerHTML = `<div class="property"><label>Label</label><input type="text" id="probe-label"></div>
            <div class="property"><label>Trace colour on graphs</label><select id="probe-color">${colors.map(([v, t]) => `<option value="${v}" ${(probe.color || "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
            <div class="property"><label class="checkrow"><input type="checkbox" id="probe-graph" ${probe.graph === false ? "" : "checked"}> Plot on the graphs (otherwise it only shows its live value)</label></div>`;
        const input = wrap.querySelector("#probe-label");
        input.value = probe.label;
        Dialog.open({
            title: probe.type === "V" ? "Edit Voltage Probe" : "Edit Current Probe",
            content: wrap,
            buttons: [
                { label: "OK", primary: true, onClick: () => {
                    const v = input.value.trim() || probe.label;
                    const color = wrap.querySelector("#probe-color").value, graph = wrap.querySelector("#probe-graph").checked;
                    if (v !== probe.label || color !== (probe.color || "") || graph !== (probe.graph !== false)) {
                        editor.saveState();
                        const live = editor.probes.find(p => p.id === probe.id);
                        if (live) { live.label = v; if (color) live.color = color; else delete live.color; if (graph) delete live.graph; else live.graph = false; }
                        editor.draw();
                    }
                } },
                { label: "Cancel" }
            ]
        });
        setTimeout(() => { input.focus(); input.select(); }, 0);
    };
    document.addEventListener("mousedown", (e) => { if (!ctx.contains(e.target)) ctx.style.display = "none"; });

    // ------------------------------------------------------------------- file inputs

    $("fileInput").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const state = JSON.parse(evt.target.result);
                live.stop();
                const r = doc.apply(state);
                afterLoad();
                doc.markSaved(file.name);
                if (r.notes.length) runner.toast(`Opened "${file.name}" with ${r.notes.length} problem(s): ${r.notes.slice(0, 2).join("; ")}${r.notes.length > 2 ? " …" : ""}`, "warn");
            } catch (err) {
                runner.toast("Invalid design file: " + err.message, "error");
            }
            e.target.value = "";
        };
        reader.readAsText(file);
    });

    $("spiceInput").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                live.stop();
                const r = SchematicImporter.import(editor, evt.target.result);
                if (r.models) {
                    pane.render();
                    runner.toast(`Added ${r.models} model(s). Press P to pick them.${r.warnings.length ? " " + r.warnings[0] : ""}`, r.warnings.length ? "warn" : "info");
                } else {
                    afterLoad();
                    doc.name = null; doc.updateTitle();
                    const warn = r.warnings.length ? ` ${r.warnings.length} note(s): ${r.warnings.slice(0, 2).join("; ")}${r.warnings.length > 2 ? " …" : ""}` : "";
                    runner.toast(`Imported ${r.count} part(s)${r.title ? ` from "${r.title}"` : ""}.${warn}`, r.warnings.length ? "warn" : "info");
                }
            } catch (err) {
                console.error(err);
                runner.toast("Could not import that file: " + err.message, "error");
            }
            e.target.value = "";
        };
        reader.readAsText(file);
    });

    // -------------------------------------------------------------------- device pane

    $("pickBtn").onclick = () => PickDialog.open(pane);
    $("removeBtn").onclick = () => pane.removeSelected();

    Theme.onChange(() => { editor.draw(); plotter.draw(); Commands.refresh(); });

    runner.refreshSweepSources();
    editor.resize();
    hint();
    Commands.refresh();
    AppLog.add("info", "Ready. Press P to pick devices, or open File > Examples.");
    // ------------------------------------------------------------------------ title block

    function openTitleBlock() {
        const t = Object.assign(SchematicEditor.defaultTitleBlock(), editor.titleBlock);
        const wrap = document.createElement("div");
        wrap.style.width = "380px";
        const row = (id, label, value, hint = "") => `<div class="property"><label>${label}</label><input type="text" id="tb-${id}" value="${PropertiesPanel.esc(value)}" placeholder="${PropertiesPanel.esc(hint)}"></div>`;
        wrap.innerHTML = row("title", "Title", t.title, "e.g. Common-emitter amplifier") + row("company", "Company", t.company) +
            row("doc", "Document number", t.doc) + row("rev", "Revision", t.rev, "A") + row("author", "Author", t.author) +
            `<div class="property"><label>Date</label><input type="text" id="tb-date" value="${PropertiesPanel.esc(t.date)}" placeholder="YYYY-MM-DD" style="width:60%">
                <button class="pane-btn" id="tb-today" type="button">Today</button></div>` +
            row("sheet", "Sheet", t.sheet, "1/1") +
            `<div class="property"><label class="checkrow"><input type="checkbox" id="tb-show" ${t.show || !Object.values(t).some(v => v === true || (typeof v === "string" && v && v !== "1/1")) ? "checked" : ""}> Show the title block on the sheet</label></div>`;
        wrap.querySelector("#tb-today").onclick = () => { wrap.querySelector("#tb-date").value = new Date().toISOString().slice(0, 10); };
        Dialog.open({
            title: "Title Block",
            content: wrap,
            buttons: [
                { label: "OK", primary: true, onClick: () => {
                    const v = (id) => wrap.querySelector(`#tb-${id}`).value.trim();
                    const next = { show: wrap.querySelector("#tb-show").checked, title: v("title"), company: v("company"), doc: v("doc"), rev: v("rev"), author: v("author"), date: v("date"), sheet: v("sheet") || "1/1" };
                    if (JSON.stringify(next) !== JSON.stringify(t)) {
                        editor.saveState();
                        editor.titleBlock = next;
                        editor.draw();
                        editor.notify();
                    }
                } },
                { label: "Cancel" }
            ]
        });
    }
    window.openTitleBlock = openTitleBlock;

    // ------------------------------------------------------------------- autosave / restore

    const restored = doc.restore();
    doc.start();
    if (restored) {
        editor.fitView();          // the saved pan / zoom belongs to another window size
        afterLoad();
        const at = new Date(restored.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        runner.toast(`Restored your last session (${restored.parts} parts, autosaved ${at}). File > New starts a blank sheet.`, "info");
    }
})();

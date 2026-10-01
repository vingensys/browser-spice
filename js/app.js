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

    // the console and the tests reach these through the window
    Object.assign(window, { editor, plotter, runner, graph, live, pane, propertiesPanel: props, overview, status });

    // an analysis run brings its tab to the front
    for (const [method, kind] of [["runDC", "dc"], ["runAC", "ac"], ["runTransient", "tran"], ["runSweep", "sweep"]]) {
        const original = runner[method].bind(runner);
        runner[method] = () => { graph.show(kind); return original(); };
    }
    pane.onGraph = (kind) => graph.show(kind);

    // ------------------------------------------------------------------ helpers

    const download = (name, text, type) => {
        const blob = new Blob([text], { type });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    const afterLoad = () => {
        runner.refreshSweepSources();
        editor.notify();
        Commands.refresh();
    };

    const zoom = (f) => editor.zoomAt(editor.width / 2, editor.height / 2, f);
    const hasSel = () => editor.selection.length > 0 || !!editor.selectedWire || !!editor.selectedProbe;

    // --------------------------------------------------------------- electrical rules

    function runErc() {
        const nets = NetlistExtractor.nets(editor);
        const issues = [];
        if (!nets.hasGround) issues.push(["err", "There is no ground symbol on the sheet."]);

        const names = new Map();
        const pinCount = new Map();
        for (const c of editor.components) {
            names.set(c.name, (names.get(c.name) || 0) + 1);
            if (c.type === "GND") continue;
            for (const t of editor.getTerminals(c)) {
                const wired = nets.wired.has(`${c.id}:${t.name}`);
                if (!wired && c.type !== "NODEIC") issues.push(["warn", `${c.name}: pin ${t.name} is not connected.`]);
                const net = nets.terminalNode(c, t.name);
                if (net && net !== "0") pinCount.set(net, (pinCount.get(net) || 0) + 1);
            }
            if (c.type === "V" && nets.terminalNode(c, "1") === nets.terminalNode(c, "2")) {
                issues.push(["err", `${c.name}: both terminals are on the same net (short circuit).`]);
            }
        }
        for (const [name, n] of names) if (n > 1 && name !== "GND") issues.push(["warn", `Reference ${name} is used by ${n} parts.`]);
        for (const [net, n] of pinCount) if (n === 1) issues.push(["warn", `Net ${net} has only one connection.`]);

        AppLog.add("info", `Electrical rules check: ${issues.length ? issues.length + " issue(s)" : "no problems found"}.`);
        issues.forEach(([lvl, text]) => AppLog.add(lvl, text));
        MessagesDialog.open();
    }

    // ---------------------------------------------------------------------- commands

    const C = (id, label, opts) => Commands.add(Object.assign({ id, label }, opts));
    const toolIs = (t) => () => editor.tool === t;

    C("file.new", "New Design", { icon: "new", keys: "Ctrl+N", global: true, run() {
        live.stop();
        editor.saveState();
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        editor.clearSelection(); editor.resetView(); afterLoad();
    } });
    C("file.open", "Open Design…", { icon: "open", keys: "Ctrl+O", global: true, run: () => $("fileInput").click() });
    C("file.save", "Save Design", { icon: "save", keys: "Ctrl+S", global: true, run() {
        download("circuit_design.json", JSON.stringify({
            format: "browser-spice/1",
            components: editor.components,
            wires: editor.wires.map(({ blocked, ...w }) => w),
            probes: editor.probes.map(({ live: l, ...p }) => p),
            nextId: editor.nextId,
            view: { zoom: editor.zoom, panX: editor.panX, panY: editor.panY },
            settings: runner.settings()
        }, null, 2), "application/json");
    } });
    C("file.import", "Import SPICE Netlist / Model Library…", { icon: "import", run: () => $("spiceInput").click() });
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
    C("file.print", "Print…", { run: () => window.print() });

    C("edit.undo", "Undo", { icon: "undo", keys: "Ctrl+Z", enabled: () => editor.historyStack.length > 0, run: () => editor.undo() });
    C("edit.redo", "Redo", { icon: "redo", keys: "Ctrl+Y", enabled: () => editor.futureStack.length > 0, run: () => editor.redo() });
    C("edit.cut", "Cut", { icon: "cut", keys: "Ctrl+X", enabled: () => editor.selection.length > 0, run: () => editor.cutSelected() });
    C("edit.copy", "Copy", { icon: "copy", keys: "Ctrl+C", enabled: () => editor.selection.length > 0, run: () => editor.copySelected() });
    C("edit.paste", "Paste", { icon: "paste", keys: "Ctrl+V", enabled: () => !!editor.clipboard, run: () => editor.paste() });
    C("edit.delete", "Delete", { icon: "delete", keys: "Del", enabled: hasSel, run: () => editor.removeSelected() });
    C("edit.selectall", "Select All", { keys: "Ctrl+A", run: () => editor.selectAll() });
    C("edit.rotate", "Rotate Clockwise", { icon: "rotate", keys: "R", enabled: () => editor.selection.length > 0, run: () => editor.rotateSelected(1) });
    C("edit.rotateccw", "Rotate Anti-clockwise", { icon: "rotateccw", enabled: () => editor.selection.length > 0, run: () => editor.rotateSelected(3) });
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
    C("tool.vprobe", "Voltage Probe", { icon: "vprobe", checked: toolIs("vProbe"), run: () => editor.setTool("vProbe") });
    C("tool.iprobe", "Current Probe", { icon: "iprobe", checked: toolIs("iProbe"), run: () => editor.setTool("iProbe") });

    C("design.settings", "Simulation Settings…", { icon: "settings", run() {
        runner.refreshSweepSources();
        Dialog.open({ title: "Simulation Settings", content: $("settings-form"), buttons: [{ label: "OK", primary: true }] });
    } });
    C("design.erc", "Electrical Rules Check", { icon: "erc", run: runErc });

    C("graph.tran", "Analogue Analysis (Transient)", { run: () => graph.show("tran") });
    C("graph.ac", "Frequency Response (AC)", { run: () => graph.show("ac") });
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

    const exampleItems = () => EXAMPLES.map(ex => ({
        id: `ex.${ex.id}`, label: ex.name, keys: "",
        run() {
            live.stop();
            const loaded = loadExampleById(editor, ex.id);
            afterLoad();
            runner.toast(loaded.note, "info");
        }
    }));

    new Menubar($("menubar"), [
        { title: "File", items: ["file.new", "file.open", "file.save", "-", "file.import", "file.export", "-", { sub: "Examples", items: exampleItems }, "-", "file.print"] },
        { title: "Edit", items: ["edit.undo", "edit.redo", "-", "edit.cut", "edit.copy", "edit.paste", "edit.delete", "edit.selectall", "-", "edit.rotate", "edit.rotateccw", "edit.mirrorx", "edit.mirrory", "edit.properties", "edit.tidy"] },
        { title: "View", items: ["view.zoomin", "view.zoomout", "view.fit", "view.reset", "-", "view.grid", "view.graph", "-", "view.classic", "view.dark"] },
        { title: "Tool", items: ["tool.select", "tool.wire", "tool.vprobe", "tool.iprobe"] },
        { title: "Design", items: ["design.settings", "design.erc"] },
        { title: "Graph", items: ["graph.tran", "graph.ac", "graph.sweep", "graph.dc", "-", "graph.simulate"] },
        { title: "Debug", items: ["sim.play", "sim.step", "sim.pause", "sim.stop"] },
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
        { id: "terminals", icon: "terminal", title: "Terminals Mode: ground, initial conditions", run: () => pane.setMode("terminals") },
        { id: "generators", icon: "generator", title: "Generator Mode: sources", run: () => pane.setMode("generators") },
        { id: "vprobe", icon: "vprobe", title: "Voltage Probe", run: () => editor.setTool("vProbe") },
        { id: "iprobe", icon: "iprobe", title: "Current Probe", run: () => editor.setTool("iProbe") },
        { id: "instruments", icon: "instrument", title: "Virtual Instruments Mode", run: () => pane.setMode("instruments") },
        { id: "graphs", icon: "graph", title: "Graph Mode: analyses", run: () => pane.setMode("graphs") }
    ];
    const modebar = new ModeBar($("modebar"), modes, (m) => m.run());
    modebar.set("select");

    const modeForTool = () => {
        if (editor.tool === "select") return "select";
        if (editor.tool === "wire") return "wire";
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
        else if (editor.tool === "vProbe") text = "Click a wire or pin to attach a voltage probe.";
        else if (editor.tool === "iProbe") text = "Click a component to attach a current probe.";
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

    editor.onEdit = (comp) => {
        if (!comp) return;
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
    C("part.toggle", "Toggle Switch", { enabled: () => editor.selection.length === 1 && editor.selection[0].type === "SW", run: () => editor.onEdit(editor.selection[0]) });

    const CTX = {
        part: [["edit.properties", "Edit Properties"], "part.toggle", ["edit.delete", "Delete Object"], "-", "edit.rotate", "edit.rotateccw", "edit.rotate180", "edit.mirrorx", "edit.mirrory", "-",
            "edit.cut", "edit.copy", "-", "probe.addI"],
        multi: ["edit.cut", "edit.copy", ["edit.delete", "Delete Objects"], "-", "edit.rotate", "edit.rotateccw", "edit.rotate180", "edit.mirrorx", "edit.mirrory"],
        wire: [["edit.delete", "Delete Wire"], ["edit.tidy", "Redraw Wire"], "-", "probe.addV"],
        probe: ["probe.rename", ["edit.delete", "Delete Probe"]],
        empty: ["edit.paste", "-", "edit.undo", "edit.redo", "-", "edit.selectall", "-", "view.zoomin", "view.zoomout", "view.fit", "-", "lib.pick", "tool.wire", ["edit.tidy", "Tidy All Wires"]]
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
            if (!enabled && /^(part\.toggle|probe\.)/.test(id)) continue;   // contextual extras are hidden rather than greyed
            entries.push({ label: (label || cmd.label).replace(/…$/, ""), key: cmd.keys || "", disabled: !enabled, run: () => { Commands.run(id); editor.canvas.focus({ preventScroll: true }); } });
        }
        window.popupMenu(e, entries);
    };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") ctx.style.display = "none"; });

    editor.onEditProbe = (probe) => {
        const wrap = document.createElement("div");
        wrap.innerHTML = `<div class="property"><label>Label</label><input type="text" id="probe-label"></div>`;
        const input = wrap.querySelector("input");
        input.value = probe.label;
        Dialog.open({
            title: probe.type === "V" ? "Edit Voltage Probe" : "Edit Current Probe",
            content: wrap,
            buttons: [
                { label: "OK", primary: true, onClick: () => {
                    const v = input.value.trim();
                    if (v && v !== probe.label) { editor.saveState(); const live = editor.probes.find(p => p.id === probe.id); if (live) live.label = v; editor.draw(); }
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
                editor.saveState();
                editor.components = state.components || [];
                editor.wires = state.wires || [];
                editor.probes = state.probes || [];
                editor.nextId = state.nextId || 1;
                const v = state.view || { zoom: 1, panX: state.panX || 0, panY: state.panY || 0 };
                editor.zoom = v.zoom || 1; editor.panX = v.panX || 0; editor.panY = v.panY || 0;
                editor.clearSelection();
                editor.refreshWires();
                editor.draw();
                afterLoad();
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
})();

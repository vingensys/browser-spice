// Application bootstrap: creates the editor, plotter and panels and wires up the
// toolbar, palette, context menu and file actions.

(() => {
    const $ = (id) => document.getElementById(id);

    SimModelLibrary.restore();
    const editor = new SchematicEditor($("schematic"));
    const plotter = new WaveformPlotter($("plotCanvas"));
    const props = new PropertiesPanel(editor, $("propertiesContent"));
    const runner = new SimRunner(editor, plotter);

    // tests and the console reach these through the window
    window.editor = editor;
    window.plotter = plotter;
    window.runner = runner;
    window.propertiesPanel = props;

    // ---- status line & palette ------------------------------------------------

    function updatePaletteActive(tool) {
        document.querySelectorAll(".palette-item").forEach(i => {
            i.classList.toggle("active", i.getAttribute("data-tool") === tool);
        });
    }

    function updateStatus() {
        const status = $("statusText");
        let text;
        if (editor.wiring) {
            text = "Wiring: click a pin or wire to finish, click empty grid to add a corner, Backspace removes the last corner, double-click ends in free space, Esc cancels.";
        } else if (editor.tool === "wire") {
            text = "Wire Tool: click a pin or a wire to start. (In Pointer mode you can also just click a pin.)";
        } else if (editor.tool === "vProbe") {
            text = "V-Probe Tool: click a wire or pin to attach a voltage probe.";
        } else if (editor.tool === "iProbe") {
            text = "I-Probe Tool: click a component to attach a current probe I(comp).";
        } else if (editor.isPlacing()) {
            text = "Placing: click to drop a part (keeps placing), R rotates, right-click or Esc to stop.";
        } else if (editor.selection.length > 1) {
            text = `${editor.selection.length} parts selected. Drag to move, R rotates, Del deletes, Ctrl+C / Ctrl+V copies.`;
        } else if (editor.selected) {
            text = `${editor.selected.name} selected. Drag to move, R rotates, double-click to edit its value, Del deletes.`;
        } else if (editor.selectedWire) {
            text = "Wire selected. Drag a segment to reshape, T re-routes it from scratch, Del deletes.";
        } else {
            text = "Click a pin to wire. Drag to box-select. Scroll to zoom, hold Space or middle-drag to pan, F fits the view, T tidies all wires.";
        }
        status.textContent = text;
        updatePaletteActive(editor.autoWire ? "select" : editor.tool);
    }

    editor.onChange = () => {
        runner.refreshSweepSources();
        props.render();
        updateStatus();
    };
    editor.onEdit = (comp) => {
        if (comp && comp.type === "SW") {
            editor.saveState();
            comp.closed = !comp.closed;
            comp.value = comp.closed ? "closed" : "open";
            editor.draw();
            props.render();
            return;
        }
        props.focusMain();
    };

    document.querySelectorAll(".palette-item").forEach(item => {
        item.addEventListener("click", () => {
            editor.setTool(item.getAttribute("data-tool"));
            updateStatus();
        });
    });

    // ---- context menu -----------------------------------------------------------

    const ctxMenu = $("contextMenu");

    window.showContextMenu = function (e) {
        const hasSelection = !!(editor.selection.length || editor.selectedWire);
        $("ctxCopy").classList.toggle("disabled", !editor.selection.length);
        $("ctxPaste").classList.toggle("disabled", !editor.clipboard);
        $("ctxRotate").classList.toggle("disabled", !editor.selection.length);
        $("ctxDelete").classList.toggle("disabled", !hasSelection);

        ctxMenu.style.left = `${e.clientX}px`;
        ctxMenu.style.top = `${e.clientY}px`;
        ctxMenu.style.display = "block";
    };

    document.addEventListener("click", () => { ctxMenu.style.display = "none"; });

    $("ctxUndo").addEventListener("click", () => editor.undo());
    $("ctxRedo").addEventListener("click", () => editor.redo());
    $("ctxCopy").addEventListener("click", () => { if (editor.selection.length) editor.copySelected(); });
    $("ctxPaste").addEventListener("click", () => { if (editor.clipboard) editor.paste(); });
    $("ctxRotate").addEventListener("click", () => { if (editor.selection.length) editor.rotateSelected(); });
    $("ctxDelete").addEventListener("click", () => { if (editor.selection.length || editor.selectedWire) editor.removeSelected(); });
    $("ctxWire").addEventListener("click", () => editor.setTool("wire"));
    $("ctxVProbe").addEventListener("click", () => editor.setTool("vProbe"));
    $("ctxIProbe").addEventListener("click", () => editor.setTool("iProbe"));

    // ---- files ---------------------------------------------------------------------

    function download(name, text, type) {
        const blob = new Blob([text], { type });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    $("saveJson").addEventListener("click", () => {
        download("circuit_design.json", JSON.stringify({
            format: "browser-spice/1",
            components: editor.components,
            wires: editor.wires.map(({ blocked, ...w }) => w),
            probes: editor.probes,
            nextId: editor.nextId,
            view: { zoom: editor.zoom, panX: editor.panX, panY: editor.panY },
            settings: runner.settings()
        }, null, 2), "application/json");
    });

    $("loadJson").addEventListener("click", () => $("fileInput").click());

    $("fileInput").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const state = JSON.parse(evt.target.result);
                editor.saveState();
                editor.components = state.components || [];
                editor.wires = state.wires || [];
                editor.probes = state.probes || [];
                editor.nextId = state.nextId || 1;
                const v = state.view || { zoom: 1, panX: state.panX || 0, panY: state.panY || 0 };
                editor.zoom = v.zoom || 1;
                editor.panX = v.panX || 0;
                editor.panY = v.panY || 0;
                editor.clearSelection();
                editor.refreshWires();
                editor.draw();
                editor.notify();
                runner.refreshSweepSources();
                props.render();
                updateStatus();
            } catch (err) {
                runner.toast("Invalid schematic file: " + err.message, "error");
            }
            e.target.value = "";
        };
        reader.readAsText(file);
    });

    $("importCir").addEventListener("click", () => $("spiceInput").click());
    $("spiceInput").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const r = SchematicImporter.import(editor, evt.target.result);
                runner.refreshSweepSources();
                if (r.models) {
                    props.render();
                    runner.toast(`Added ${r.models} model(s) to the part pickers.${r.warnings.length ? " " + r.warnings[0] : ""}`, r.warnings.length ? "warn" : "info");
                    e.target.value = "";
                    return;
                }
                props.render();
                updateStatus();
                const warn = r.warnings.length ? ` ${r.warnings.length} note(s): ${r.warnings.slice(0, 2).join("; ")}${r.warnings.length > 2 ? " …" : ""}` : "";
                runner.toast(`Imported ${r.count} part(s)${r.title ? ` from "${r.title}"` : ""}.${warn}`, r.warnings.length ? "warn" : "info");
            } catch (err) {
                console.error(err);
                runner.toast("Could not import that netlist: " + err.message, "error");
            }
            e.target.value = "";
        };
        reader.readAsText(file);
    });

    $("exportCir").addEventListener("click", () => runner.showNetlist());
    $("closeNetlistModal").addEventListener("click", () => { $("netlistModal").style.display = "none"; });
    $("downloadCirBtn").addEventListener("click", () => download("circuit.cir", $("netlistText").value, "text/plain"));

    // ---- examples -------------------------------------------------------------------

    const exampleSelect = $("exampleSelect");
    for (const ex of EXAMPLES) {
        const opt = document.createElement("option");
        opt.value = ex.id;
        opt.textContent = ex.name;
        exampleSelect.appendChild(opt);
    }
    exampleSelect.addEventListener("change", () => {
        if (!exampleSelect.value) return;
        const ex = loadExampleById(editor, exampleSelect.value);
        runner.refreshSweepSources();
        runner.toast(ex.note, "info");
        exampleSelect.value = "";
        props.render();
        updateStatus();
    });

    // ---- simulation + plot controls ----------------------------------------------------

    $("runDC").addEventListener("click", () => runner.runDC());
    $("runAC").addEventListener("click", () => runner.runAC());
    $("runTransient").addEventListener("click", () => runner.runTransient());
    $("runSweep").addEventListener("click", () => { runner.refreshSweepSources(); runner.runSweep(); });

    $("zoomInBtn").addEventListener("click", () => { plotter.zoomX *= 1.2; plotter.zoomY *= 1.2; plotter.draw(); });
    $("zoomOutBtn").addEventListener("click", () => { plotter.zoomX *= 0.8; plotter.zoomY *= 0.8; plotter.draw(); });
    $("resetZoomBtn").addEventListener("click", () => plotter.resetZoom());

    runner.refreshSweepSources();
    props.render();
    updateStatus();
})();

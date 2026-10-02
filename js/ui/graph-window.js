// The graph window (ISIS "analogue analysis" / simulation log): docked under the sheet.
// Tabs: LIVE (the running simulation), ANALOGUE (transient), FREQUENCY (AC), DC SWEEP and
// OPERATING POINT. The Simulate button runs whichever analysis the active tab names.

class GraphWindow {
    constructor(root, plotter, runner, editor) {
        this.root = root;
        this.runner = runner;
        this.editor = editor;
        this.kind = "tran";

        this.tabs = [
            ["live", "LIVE"], ["tran", "ANALOGUE"], ["ac", "FREQUENCY"], ["sweep", "DC SWEEP"], ["dc", "OPERATING POINT"]
        ];
        root.innerHTML = `
            <div id="graph-resize"></div>
            <div class="graph-head">
                <span id="graph-tabs" style="display:flex;gap:2px"></span>
                <span class="grow"></span>
                <select id="acScale" class="hidden" title="Frequency response display">
                    <option value="db">Gain dB + phase</option><option value="linear">Linear magnitude</option>
                </select>
                <span id="plotTitle">No simulation run yet</span>
                <button class="tb-btn txt" id="graph-measure" title="Cursors and measurements (click the graph for cursor A, Shift+click for B)">Measure</button>
                <button class="tb-btn txt" id="graph-export" title="Export the plotted data (CSV) or the picture (PNG)">Export ▾</button>
                <button class="tb-btn" id="graph-sim" title="Simulate (analysis for this tab)">${Icons.svg("play")}</button>
                <button class="tb-btn" id="zoomInBtn" title="Zoom in">${Icons.svg("zoomin")}</button>
                <button class="tb-btn" id="zoomOutBtn" title="Zoom out">${Icons.svg("zoomout")}</button>
                <button class="tb-btn" id="resetZoomBtn" title="Reset zoom">${Icons.svg("fit")}</button>
                <button class="tb-btn" id="graph-close" title="Close graph window">✕</button>
            </div>
            <div class="graph-body">
                <div class="graph-plot"><canvas id="plotCanvas"></canvas></div>
                <div id="measure" class="hidden"></div>
                <div id="dcResults" class="hidden"><div class="no-selection">Run the operating point to see node voltages and currents.</div></div>
            </div>`;

        this.plotter = plotter || new WaveformPlotter(root.querySelector("#plotCanvas"));
        plotter = this.plotter;
        this.tabsEl = root.querySelector("#graph-tabs");
        this.tabs.forEach(([id, label]) => {
            const t = document.createElement("div");
            t.className = "graph-tab";
            t.dataset.id = id;
            t.textContent = label;
            t.onclick = () => this.show(id);
            this.tabsEl.appendChild(t);
        });

        root.querySelector("#acScale").onchange = (e) => plotter.setACScale(e.target.value);
        root.querySelector("#graph-sim").onclick = () => this.simulate();
        root.querySelector("#graph-measure").onclick = () => this.toggleMeasure();
        root.querySelector("#graph-export").onclick = (e) => this.exportMenu(e.currentTarget.getBoundingClientRect());

        // cursors and measurements
        plotter.canvas.title = "Click: cursor A. Shift+click: cursor B. Drag a cursor line to move it. Drag elsewhere to pan, wheel to zoom, double-click to reset.";
        plotter.onCursors = () => { if (plotter.cursors.a !== null || plotter.cursors.b !== null) this.toggleMeasure(true); this.scheduleMeasure(); };
        plotter.onDraw = () => this.scheduleMeasure();
        plotter.onContext = (e, x) => this.contextMenu(e, x);
        root.querySelector("#graph-close").onclick = () => this.hide();
        root.querySelector("#zoomInBtn").onclick = () => { plotter.zoomX *= 1.2; plotter.zoomY *= 1.2; plotter.draw(); };
        root.querySelector("#zoomOutBtn").onclick = () => { plotter.zoomX *= 0.8; plotter.zoomY *= 0.8; plotter.draw(); };
        root.querySelector("#resetZoomBtn").onclick = () => plotter.resetZoom();

        // drag the top edge to resize
        const grip = root.querySelector("#graph-resize");
        grip.addEventListener("pointerdown", (e) => {
            grip.setPointerCapture(e.pointerId);
            const startY = e.clientY, startH = root.getBoundingClientRect().height;
            const move = (ev) => {
                root.style.height = `${Math.max(120, Math.min(window.innerHeight - 260, startH + (startY - ev.clientY)))}px`;
                editor.resize();
                plotter.resize();
            };
            const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", up);
        });

        new ResizeObserver(() => plotter.resize()).observe(root.querySelector(".graph-plot"));
    }

    // ---- measurements ----------------------------------------------------------------------

    toggleMeasure(force) {
        const el = this.root.querySelector("#measure");
        const show = force === undefined ? el.classList.contains("hidden") : force;
        el.classList.toggle("hidden", !show);
        this.root.querySelector("#graph-measure").classList.toggle("active", show);
        if (show) this.updateMeasure();
        this.plotter.resize();
    }

    scheduleMeasure() {
        if (this.measureTimer || this.root.querySelector("#measure").classList.contains("hidden")) return;
        this.measureTimer = setTimeout(() => { this.measureTimer = 0; this.updateMeasure(); }, 150);
    }

    static unitFor(name, data) {
        if (data.mode === "sweep" || data.mode === "transient") return /^I\(/.test(name) ? "A" : "V";
        return "";
    }

    // Measurements as data: { header: [[label, value]], series: [{ name, color, rows: [[label, value]] }], scope }
    measurements() {
        const p = this.plotter, d = p.data;
        if (!d || d.mode === "dc" || !d.xValues || !d.xValues.length) return null;
        const xs = d.xValues, ac = d.mode === "ac";
        const view = p.view(d);
        const xu = d.xUnit !== undefined ? d.xUnit : (ac ? "Hz" : "s");
        const fx = (x) => Units.formatSI(x, xu);
        const { a, b } = p.cursors;
        const both = a !== null && b !== null;
        const header = [];
        if (a !== null) header.push(["Cursor A", fx(a)]);
        if (b !== null) header.push(["Cursor B", fx(b)]);
        if (both) {
            const dx = Math.abs(b - a);
            header.push(["Δx", fx(dx)]);
            if (xu === "s" && dx > 0) header.push(["1/Δx", Units.formatSI(1 / dx, "Hz")]);
        }
        const lo = both ? Math.min(a, b) : view.inv(view.vmin), hi = both ? Math.max(a, b) : view.inv(view.vmax);
        const scope = both ? "between the cursors" : "in the visible range";

        const series = [];
        if (ac && d.panels) {
            const gain = d.panels[0].series, phase = d.panels[1].series;
            gain.forEach((g, i) => {
                const ph = phase[i];
                const rows = [];
                const at = (x, tag) => rows.push([`At ${tag}`, `${PlotMath.valueAt(xs, g.values, x, true).toFixed(2)} dB, ${PlotMath.valueAt(xs, ph.values, x, true).toFixed(1)}°`]);
                if (a !== null) at(a, "A");
                if (b !== null) at(b, "B");
                if (both) rows.push(["Δ (B − A)", `${(PlotMath.valueAt(xs, g.values, b, true) - PlotMath.valueAt(xs, g.values, a, true)).toFixed(2)} dB, ${(PlotMath.valueAt(xs, ph.values, b, true) - PlotMath.valueAt(xs, ph.values, a, true)).toFixed(1)}°`]);
                const m = PlotMath.ac(xs, g.values, ph.values);
                rows.push(["Peak gain", `${m.peak.db.toFixed(2)} dB at ${Units.formatSI(m.peak.x, "Hz")}`]);
                const bw = m.bw;
                rows.push(["−3 dB", bw.low === null && bw.high === null ? "flat across the sweep" : `${bw.low !== null ? "from " + Units.formatSI(bw.low, "Hz") + " " : ""}${bw.high !== null ? "to " + Units.formatSI(bw.high, "Hz") : "upward"}`]);
                if (m.unity) rows.push(["Unity gain", `${Units.formatSI(m.unity.x, "Hz")}${m.unity.margin !== null ? `, phase margin ${m.unity.margin.toFixed(1)}°` : ""}`]);
                series.push({ name: g.name, color: g.color, rows });
            });
        } else {
            for (const s of d.series) {
                const unit = GraphWindow.unitFor(s.name, d);
                const fy = (v) => Units.formatSI(v, unit);
                const rows = [];
                const va = a !== null ? PlotMath.valueAt(xs, s.values, a, ac) : null, vb = b !== null ? PlotMath.valueAt(xs, s.values, b, ac) : null;
                if (va !== null) rows.push(["At A", fy(va)]);
                if (vb !== null) rows.push(["At B", fy(vb)]);
                if (both) rows.push(["Δ (B − A)", fy(Math.abs(vb - va) < 1e-9 * (Math.abs(va) + Math.abs(vb) + 1e-12) ? 0 : vb - va)]);   // no 1e-16 rounding noise
                const st = PlotMath.stats(xs, s.values, lo, hi);
                if (st) {
                    rows.push([`Min / max ${scope}`, `${fy(st.min)} / ${fy(st.max)}`]);
                    rows.push(["Peak-to-peak", fy(st.pkpk)]);
                    if (!ac) { rows.push(["Mean", fy(st.mean)]); rows.push(["RMS", fy(st.rms)]); }
                }
                if (d.mode === "transient") {
                    const f = PlotMath.frequency(xs, s.values, lo, hi);
                    if (f) rows.push(["Frequency", `${Units.formatSI(f.freq, "Hz")} (${Units.formatSI(f.period, "s")})${f.duty !== null ? `, duty ${(f.duty * 100).toFixed(0)} %` : ""}`]);
                    const e = PlotMath.edges(xs, s.values, lo, hi);
                    if (e && e.rise !== null) rows.push(["Rise time 10–90 %", Units.formatSI(e.rise, "s")]);
                    if (e && e.fall !== null) rows.push(["Fall time 90–10 %", Units.formatSI(e.fall, "s")]);
                }
                series.push({ name: s.name, color: s.color, rows });
            }
        }
        return { header, series, scope, hasCursors: a !== null || b !== null };
    }

    updateMeasure() {
        const el = this.root.querySelector("#measure");
        if (el.classList.contains("hidden")) return;
        const m = this.measurements();
        const esc = PropertiesPanel.esc;
        if (!m) { el.innerHTML = `<div class="no-selection">Run a transient, frequency or DC-sweep analysis (or Play) to measure it.</div>`; return; }
        let html = `<div class="meas-head"><b>${m.hasCursors ? "Cursors" : "Measure"}</b>
            <button class="pane-btn" id="meas-clear" ${m.hasCursors ? "" : "disabled"} title="Remove cursors A and B">Clear cursors</button></div>`;
        if (!m.hasCursors) html += `<div class="meas-hint">Click the graph to place cursor <b>A</b>, Shift+click for <b>B</b>. Drag a cursor line to move it. Numbers below cover the visible range until two cursors are placed.</div>`;
        if (m.header.length) html += `<table class="meas">${m.header.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
        for (const s of m.series) {
            html += `<div class="meas-series"><span class="swatch" style="background:${s.color}"></span><b>${esc(s.name)}</b></div>
                <table class="meas">${s.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
        }
        el.innerHTML = html;
        const clear = el.querySelector("#meas-clear");
        if (clear) clear.onclick = () => { this.plotter.clearCursors(); this.plotter.draw(); };
    }

    // ---- export ----------------------------------------------------------------------------

    baseName() {
        const base = (window.doc && window.doc.name ? window.doc.name : "circuit").replace(/\.[^.]+$/, "");
        return `${base}-${{ live: "live", tran: "transient", ac: "frequency", sweep: "dc-sweep" }[this.kind] || "graph"}`;
    }

    save(name, content, type) {
        if (typeof window.downloadFile === "function") window.downloadFile(name, content, type);
    }

    exportCSV(range) {
        const csv = this.plotter.csv(range);
        if (!csv) { if (this.runner) this.runner.toast("There is no graph data to export yet. Run an analysis first.", "info"); return null; }
        const suffix = range === "all" ? "" : `-${range}`;
        this.save(`${this.baseName()}${suffix}.csv`, csv, "text/csv");
        return csv;
    }

    exportMeasurementsCSV() {
        const m = this.measurements();
        if (!m) { if (this.runner) this.runner.toast("There is nothing to measure yet.", "info"); return null; }
        const rows = [["Trace", "Measurement", "Value"], ...m.header.map(([k, v]) => ["", k, v])];
        for (const s of m.series) for (const [k, v] of s.rows) rows.push([s.name, k, v]);
        const csv = rows.map(r => r.map(PlotMath.csvCell).join(",")).join("\r\n") + "\r\n";
        this.save(`${this.baseName()}-measurements.csv`, csv, "text/csv");
        return csv;
    }

    exportPNG() {
        this.plotter.canvas.toBlob((blob) => { if (blob) this.save(`${this.baseName()}.png`, blob, "image/png"); });
    }

    exportEntries() {
        const p = this.plotter;
        const have = !!(p.data && p.data.mode !== "dc");
        const both = p.cursors.a !== null && p.cursors.b !== null;
        return [
            { label: "CSV: all data", disabled: !have, run: () => this.exportCSV("all") },
            { label: "CSV: visible range", disabled: !have, run: () => this.exportCSV("visible") },
            { label: "CSV: between the cursors", disabled: !both, run: () => this.exportCSV("cursors") },
            "-",
            { label: "Measurements (CSV)", disabled: !have, run: () => this.exportMeasurementsCSV() },
            { label: "Picture (PNG)", disabled: !have, run: () => this.exportPNG() }
        ];
    }

    exportMenu(rect) {
        if (window.popupMenu) window.popupMenu({ clientX: rect.left, clientY: rect.bottom }, this.exportEntries());
    }

    contextMenu(e, x) {
        if (!window.popupMenu) return;
        const p = this.plotter, have = x !== null && !!(p.data && p.data.mode !== "dc");
        window.popupMenu(e, [
            { label: "Place cursor A here", disabled: !have, run: () => p.setCursor("a", x) },
            { label: "Place cursor B here", disabled: !have, run: () => p.setCursor("b", x) },
            { label: "Clear cursors", disabled: p.cursors.a === null && p.cursors.b === null, run: () => { p.clearCursors(); p.draw(); } },
            "-",
            { label: "Zoom to fit", run: () => p.resetZoom() },
            "-",
            ...this.exportEntries()
        ]);
    }

    get visible() { return !this.root.classList.contains("hidden"); }

    show(kind = this.kind) {
        this.kind = kind;
        this.root.classList.remove("hidden");
        this.tabsEl.querySelectorAll(".graph-tab").forEach(t => t.classList.toggle("active", t.dataset.id === kind));
        this.root.querySelector("#dcResults").classList.toggle("hidden", kind !== "dc");
        this.root.querySelector("#acScale").classList.toggle("hidden", kind !== "ac");
        this.root.querySelector("#graph-sim").style.visibility = kind === "live" ? "hidden" : "visible";
        this.editor.resize();
        this.plotter.resize();
        if (kind === "live") this.plotter.data = this.plotter.data && this.plotter.data.live ? this.plotter.data : null;
        this.plotter.draw();
    }

    hide() {
        this.root.classList.add("hidden");
        this.editor.resize();
    }

    simulate() {
        this.show(this.kind === "live" ? "tran" : this.kind);
        const run = { tran: "runTransient", ac: "runAC", sweep: "runSweep", dc: "runDC" }[this.kind];
        if (run) this.runner[run]();
    }

    // the LIVE tab: plot the running simulation's buffers
    paintLive(live) {
        if (!this.visible || this.kind !== "live") return;
        const colors = this.plotter.colors;
        const series = live.channels.map((ch, i) => ({ name: ch.name, color: (ch.probe && ch.probe.color) || colors[i % colors.length], values: live.values[i], hidden: ch.probe && ch.probe.graph === false })).filter(s => !s.hidden);
        if (!series.length || live.times.length < 2) {
            this.plotter.data = null;
        } else {
            this.plotter.data = { mode: "transient", live: true, xLabel: "Time", yLabel: "Voltage (V) / Current (A)", xValues: live.times, series };
        }
        this.plotter.draw();
        this.root.querySelector("#plotTitle").textContent = series.length
            ? `Live simulation, t = ${Units.formatSI(live.run.t, "s")}`
            : "Add voltage probes or an oscilloscope to see traces";
    }
}

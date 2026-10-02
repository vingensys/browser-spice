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
            ["live", "LIVE"], ["tran", "ANALOGUE"], ["fft", "SPECTRUM"], ["ac", "FREQUENCY"], ["noise", "NOISE"], ["sweep", "DC SWEEP"], ["step", "STUDY"], ["dc", "OPERATING POINT"]
        ];
        root.innerHTML = `
            <div id="graph-resize"></div>
            <div class="graph-head">
                <span id="graph-tabs" style="display:flex;gap:2px"></span>
                <span class="grow"></span>
                <select id="acScale" class="hidden" title="Frequency response display">
                    <option value="db">Gain dB + phase</option><option value="linear">Linear magnitude</option>
                </select>
                <select id="noiseView" class="hidden" title="Noise density shown">
                    <option value="out">Output noise</option><option value="in">Input-referred</option>
                </select>
                <span id="fftTools" class="hidden" style="display:none;gap:6px;align-items:center">
                    <select id="fftWindow" title="Window function">${Object.entries(Spectrum.WINDOWS).map(([k, w]) => `<option value="${k}" ${k === "hann" ? "selected" : ""}>${w.label}</option>`).join("")}</select>
                    <select id="fftScale" title="Amplitude scale"><option value="db">dBV</option><option value="lin">Volts</option></select>
                    <select id="fftSpan" title="Frequency range"><option value="40">To 40× f₁</option><option value="10">To 10× f₁</option><option value="200">To 200× f₁</option><option value="0">Full</option></select>
                    <select id="fftAxis" title="Frequency axis"><option value="lin">Linear</option><option value="log">Log</option></select>
                </span>
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
        root.querySelector("#noiseView").onchange = (e) => { if (plotter.noiseSource) { const [outs, name] = plotter.noiseSource; plotter.plotNoise(outs, name, e.target.value); plotter.cache.noise = plotter.data; } };
        for (const id of ["fftWindow", "fftScale", "fftSpan", "fftAxis"]) root.querySelector("#" + id).onchange = () => { if (this.kind === "fft") this.showSpectrum(); };

        // remember the data of each tab, so switching tabs shows each one's last result; note what the spectrum can use
        plotter.cache = {};
        for (const [method, kind] of [["plotTransient", "tran"], ["plotAC", "ac"], ["plotSweep", "sweep"], ["plotNoise", "noise"]]) {
            const original = plotter[method].bind(plotter);
            plotter[method] = (...args) => { original(...args); plotter.cache[kind] = plotter.data; if (kind === "tran") this.timeKind = "tran"; };
        }
        this.timeKind = "tran";
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
        if (data.yUnit !== undefined) return data.yUnit;
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
        if (d.noise) {
            const fx = (v) => Units.formatSI(v, "V/√Hz"), inRef = d.noise.view === "in", noiseSeries = [];
            d.series.forEach((sr, i) => {
                const o = d.noise.outs[i], rows = o.rows, rows_ = [];
                const dens = (k) => (inRef ? rows[k].inoise : rows[k].onoise);
                const at = (x) => { const k = rows.reduce((b, r, j) => (Math.abs(Math.log(r.frequency / x)) < Math.abs(Math.log(rows[b].frequency / x)) ? j : b), 0); return dens(k); };
                if (a !== null) rows_.push(["Spot at A", fx(at(a))]);
                if (b !== null) rows_.push(["Spot at B", fx(at(b))]);
                // integrated noise over the cursors / visible range, and who contributes
                let power = 0, ipower = 0; const parts = {};
                for (let k = 1; k < rows.length; k++) {
                    if (rows[k].frequency < lo || rows[k - 1].frequency > hi) continue;
                    const df = Math.min(rows[k].frequency, hi) - Math.max(rows[k - 1].frequency, lo);
                    if (!(df > 0)) continue;
                    power += 0.5 * (rows[k].onoise ** 2 + rows[k - 1].onoise ** 2) * df;
                    if (rows[k].inoise !== null) ipower += 0.5 * (rows[k].inoise ** 2 + rows[k - 1].inoise ** 2) * df;
                    for (const name of Object.keys(rows[k].parts)) parts[name] = (parts[name] || 0) + 0.5 * (rows[k].parts[name] + rows[k - 1].parts[name]) * df;
                }
                rows_.push([`Output noise ${scope}`, Units.formatSI(Math.sqrt(power), "V rms")]);
                if (ipower > 0) rows_.push([`Input-referred ${scope}`, Units.formatSI(Math.sqrt(ipower), "V rms")]);
                const total = Object.values(parts).reduce((s, v) => s + v, 0) || 1;
                Object.entries(parts).sort((p, q) => q[1] - p[1]).slice(0, 5).forEach(([name, v]) => rows_.push([name, `${(100 * v / total).toFixed(1)} %`]));
                noiseSeries.push({ name: sr.name, color: sr.color, rows: rows_ });
            });
            return { header, series: noiseSeries, scope, hasCursors: a !== null || b !== null };
        }
        if (d.study && d.study.kind === "montecarlo") {
            const st = d.study.stats, f = (v) => Number(v.toPrecision(5)).toString();
            const rows = [["Runs", `${st.n} of ${st.runs} measured, ${st.parts} varying part${st.parts === 1 ? "" : "s"}`], ["Mean", f(st.mean)], ["Std deviation", f(st.std)], ["Min / max", `${f(st.min)} / ${f(st.max)}`], ["Median", f(st.median)], ["±3σ", `${f(st.mean - 3 * st.std)} … ${f(st.mean + 3 * st.std)}`]];
            if (st.yield !== undefined) rows.push(["Yield (within limits)", `${(st.yield * 100).toFixed(1)} %`]);
            return { header, series: [{ name: `${d.study.probe}: ${d.study.metric}`, color: d.series[0].color, rows }], scope: "all runs", hasCursors: a !== null || b !== null };
        }

        const series = [];
        if (d.mode === "spectrum") {
            d.series.forEach((sr, i) => {
                const sp = d.spectra[i], rows = [];
                const unit = d.valueUnit;
                const fmt = (v) => `${v.toFixed(unit === "dBV" ? 1 : 4)} ${unit}`;
                if (a !== null) rows.push(["At A", fmt(PlotMath.valueAt(xs, sr.values, a))]);
                if (b !== null) rows.push(["At B", fmt(PlotMath.valueAt(xs, sr.values, b))]);
                if (both) rows.push(["Δ (B − A)", `${(PlotMath.valueAt(xs, sr.values, b) - PlotMath.valueAt(xs, sr.values, a)).toFixed(unit === "dBV" ? 1 : 4)} ${unit === "dBV" ? "dB" : "V"}`]);
                rows.push(["DC level", Units.formatSI(sp.mean, "V")]);
                if (sp.fundamental) {
                    rows.push(["Fundamental", `${Units.formatSI(sp.fundamental.f, "Hz")}, ${Units.formatSI(sp.fundamental.mag, "V")} (${(20 * Math.log10(sp.fundamental.mag)).toFixed(1)} dBV)`]);
                    rows.push(["THD (to the 10th)", `${(sp.thd * 100).toFixed(3)} %  (${(20 * Math.log10(Math.max(sp.thd, 1e-9))).toFixed(1)} dB)`]);
                    for (const h of sp.harmonics.slice(0, 4)) rows.push([`Harmonic ${h.h}`, `${Units.formatSI(h.f, "Hz")}: ${(20 * Math.log10(Math.max(h.mag / sp.fundamental.mag, 1e-9))).toFixed(1)} dBc`]);
                } else rows.push(["Fundamental", "none found"]);
                series.push({ name: sr.name, color: sr.color, rows });
            });
            return { header, series, scope: "the analysed span", hasCursors: a !== null || b !== null };
        }
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
        this.root.querySelector("#noiseView").classList.toggle("hidden", kind !== "noise");
        this.root.querySelector("#fftTools").style.display = kind === "fft" ? "inline-flex" : "none";
        this.root.querySelector("#graph-sim").style.visibility = kind === "live" ? "hidden" : "visible";
        this.editor.resize();
        this.plotter.resize();
        if (kind === "fft") { this.showSpectrum(); return; }
        const cached = this.plotter.cache && this.plotter.cache[kind];
        if (kind === "live") this.plotter.data = this.plotter.cache.live || (this.plotter.data && this.plotter.data.live ? this.plotter.data : null);
        else if (cached && kind !== "dc" && this.plotter.data !== cached) { this.plotter.clearCursors(); this.plotter.data = cached; }
        this.plotter.draw();
    }

    hide() {
        this.root.classList.add("hidden");
        this.editor.resize();
    }

    // ---- spectrum (FFT) of the last transient or live run ---------------------------------------------------

    showSpectrum() {
        const p = this.plotter;
        const src = p.cache[this.timeKind] || p.cache.tran || p.cache.live;
        const title = this.root.querySelector("#plotTitle");
        if (!src || !src.series || !src.series.length) {
            p.clearCursors(); p.data = null; p.draw();
            title.textContent = "Run a transient analysis (or Play) with probes, then open the spectrum";
            return;
        }
        // the span: between the cursors if the time plot had two, else everything
        let t0, t1;
        if (p.data === src && p.cursors.a !== null && p.cursors.b !== null) { t0 = Math.min(p.cursors.a, p.cursors.b); t1 = Math.max(p.cursors.a, p.cursors.b); }
        if (p.data !== src && this.lastSpan) ({ t0, t1 } = this.lastSpan);
        this.lastSpan = t0 !== undefined ? { t0, t1 } : null;

        const q = (id) => this.root.querySelector("#" + id).value;
        const db = q("fftScale") === "db", log = q("fftAxis") === "log", span = Number(q("fftSpan"));
        const spectra = src.series.map(s => Spectrum.analyse(src.xValues, s.values, { t0, t1, window: q("fftWindow") }));
        const ok = spectra.map((sp, i) => (sp ? i : -1)).filter(i => i >= 0);
        if (!ok.length) { p.clearCursors(); p.data = null; p.draw(); title.textContent = "Not enough data for a spectrum"; return; }
        const first = spectra[ok[0]];
        const f1 = first.fundamental ? first.fundamental.f : 0;
        let K = first.freq.length;
        if (span && f1) K = Math.min(K, Math.ceil((span * f1) / (first.freq[1] || 1)) + 2);
        // the shortest analysis defines the shared frequency axis
        K = Math.min(K, ...ok.map(i => spectra[i].freq.length));
        const floor = (arr) => { const m = Math.max(...arr.slice(1, K)); return db ? m - 120 : 0; };
        const series = ok.map(i => {
            const sp = spectra[i], vals = Array.from(db ? sp.db : sp.mag).slice(0, K);
            const lo = floor(vals);
            return { name: src.series[i].name, color: src.series[i].color, values: vals.map(v => Math.max(v, lo)) };
        });
        p.clearCursors();
        p.data = {
            mode: "spectrum", logX: log, xLabel: "Frequency (Hz)", xUnit: "Hz", yLabel: db ? "Amplitude (dBV)" : "Amplitude (V)",
            valueUnit: db ? "dBV" : "V", tickDigits: db ? 0 : undefined,
            xValues: Array.from(first.freq).slice(0, K).map((f, k) => (log && k === 0 ? first.freq[1] / 2 : f)), series,
            spectra: ok.map(i => spectra[i]), names: ok.map(i => src.series[i].name)
        };
        p.cache.fft = p.data;
        p.draw();
        title.textContent = `Spectrum, ${Spectrum.WINDOWS[q("fftWindow")].label} window, ${first.n} points over ${Units.formatSI(first.t1 - first.t0, "s")}`;
    }

    simulate() {
        if (this.kind === "fft") { this.showSpectrum(); return; }
        this.show(this.kind === "live" ? "tran" : this.kind);
        if (this.kind === "step") { if (window.StudyDialog) StudyDialog.rerun(); return; }
        const run = { tran: "runTransient", ac: "runAC", noise: "runNoise", sweep: "runSweep", dc: "runDC" }[this.kind];
        if (run) this.runner[run]();
    }

    // the STUDY tab: a parametric sweep or Monte Carlo result
    showStudy(data, title) {
        const p = this.plotter;
        p.clearCursors();
        p.data = data;
        p.cache.step = data;
        p.resetZoom && p.resetZoom();
        this.show("step");
        this.root.querySelector("#plotTitle").textContent = title;
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
            this.plotter.cache.live = this.plotter.data;
            this.timeKind = "live";
        }
        this.plotter.draw();
        this.root.querySelector("#plotTitle").textContent = series.length
            ? `Live simulation, t = ${Units.formatSI(live.run.t, "s")}`
            : "Add voltage probes or an oscilloscope to see traces";
    }
}

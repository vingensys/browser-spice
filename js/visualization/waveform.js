class WaveformPlotter {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.colors = ["#6ea8fe", "#ff79c6", "#bd93f9", "#50fa7b", "#ffb86c", "#8be9fd", "#f1fa8c"];

        this.data = null; // { mode: 'transient'|'ac'|'dc', xLabel, yLabel, xValues, series: [{ name, color, values }] }
        this.hoverIndex = -1;

        // Zoom & Pan state
        this.zoomX = 1.0;
        this.zoomY = 1.0;
        this.panX = 0;
        this.panY = 0;

        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };

        // Cursors: click places A, Shift+click places B, drag a cursor line to move it. Dragging elsewhere pans.
        this.cursors = { a: null, b: null };
        this.dragCursor = null;
        this.downAt = null;
        this.dragged = false;
        this.hoverX = null;
        this.onCursors = null;   // fired when a cursor moves
        this.onDraw = null;      // fired after every redraw (measurement panel)
        this.onContext = null;   // fired with (event, x value) on right-click

        const local = (e) => { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

        this.canvas.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || !this.data) return;
            const p = local(e);
            this.downAt = { x: e.clientX, y: e.clientY };
            this.dragged = false;
            try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
            const hit = this.cursorNear(p.x);
            if (hit) { this.dragCursor = hit; return; }
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
        });

        this.canvas.addEventListener("pointermove", (e) => {
            const p = local(e);
            if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 3) this.dragged = true;

            if (this.dragCursor) {
                this.cursors[this.dragCursor] = this.xAtPixel(p.x);
                this.draw();
                if (this.onCursors) this.onCursors();
                return;
            }

            if (this.isPanning) {
                const dx = e.clientX - this.panStart.x;
                const dy = e.clientY - this.panStart.y;
                this.panStart = { x: e.clientX, y: e.clientY };

                const graphWidth = this.width - 80;
                const graphHeight = this.height - 70;

                this.panX -= dx / graphWidth / this.zoomX;
                this.panY += dy / graphHeight / this.zoomY;
                this.draw();
                return;
            }

            this.canvas.style.cursor = this.cursorNear(p.x) ? "ew-resize" : "crosshair";
            this.updateHover(p.x);
        });

        this.canvas.addEventListener("pointerup", (e) => {
            const wasPan = this.isPanning;
            this.isPanning = false;
            this.dragCursor = null;
            // a click (no drag) on the plot places a cursor
            if (wasPan && !this.dragged && this.data && this.data.mode !== "dc") {
                this.setCursor(e.shiftKey ? "b" : "a", this.xAtPixel(local(e).x));
            }
            this.downAt = null;
        });

        this.canvas.addEventListener("pointerleave", () => {
            if (this.dragCursor) return;
            this.isPanning = false;
            this.hoverX = null;
            this.draw();
        });

        this.canvas.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            if (this.onContext) this.onContext(e, this.data ? this.xAtPixel(local(e).x) : null);
        });

        // Wheel Zooming in X and Y
        this.canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;

            if (e.shiftKey) {
                this.zoomY = Math.max(0.2, Math.min(50, this.zoomY * zoomFactor));
            } else if (e.ctrlKey || e.metaKey) {
                this.zoomX = Math.max(0.2, Math.min(50, this.zoomX * zoomFactor));
                this.zoomY = Math.max(0.2, Math.min(50, this.zoomY * zoomFactor));
            } else {
                this.zoomX = Math.max(0.2, Math.min(50, this.zoomX * zoomFactor));
            }

            this.draw();
        }, { passive: false });

        this.canvas.addEventListener("dblclick", () => {
            this.resetZoom();
        });

        this.resize();
        window.addEventListener("resize", () => this.resize());
    }

    resetZoom() {
        this.zoomX = 1.0;
        this.zoomY = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.draw();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.width = rect.width;
        this.height = rect.height;

        this.draw();
    }

    /**
     * Plots Transient time-domain response for probes ALONE. No probes = No signal.
     */
    plotTransient(transientResult, probes = [], netlistInfo = null) {
        if (!(this.data && this.data.live)) this.clearCursors();
        if (!probes || probes.length === 0) {
            this.data = null;
            this.draw();
            return;
        }

        const series = [];
        let colorIdx = 0;
        const probeSeriesMap = this.buildProbeSeriesMap(probes, netlistInfo);

        for (const item of probeSeriesMap) {
            if (item.type === 'V' && transientResult.nodeHistories[item.node]) {
                series.push({
                    name: item.label,
                    color: item.color || this.colors[colorIdx % this.colors.length],
                    values: transientResult.nodeHistories[item.node]
                });
                colorIdx++;
            } else if (item.type === 'I' && transientResult.currentHistories[item.targetName]) {
                series.push({
                    name: item.label,
                    color: item.color || this.colors[colorIdx % this.colors.length],
                    values: transientResult.currentHistories[item.targetName]
                });
                colorIdx++;
            }
        }

        if (series.length === 0) {
            this.data = null;
            this.draw();
            return;
        }

        this.data = {
            mode: "transient",
            xLabel: "Time",
            yLabel: "Voltage (V) / Current (A)",
            xValues: transientResult.timePoints,
            series
        };

        this.draw();
    }

    /**
     * Plots a DC sweep: probed node voltages / element currents against the swept source value.
     */
    plotSweep(sweepResult, probes = [], netlistInfo = null, xLabel = "Sweep", xUnit = "V") {
        if (!(this.data && this.data.live)) this.clearCursors();
        if (!probes || probes.length === 0 || !sweepResult.sweep.length) {
            this.data = null;
            this.draw();
            return;
        }

        const series = [];
        let colorIdx = 0;
        for (const item of this.buildProbeSeriesMap(probes, netlistInfo)) {
            const values = item.type === "V" ? sweepResult.nodeHistories[item.node] : sweepResult.currentHistories[item.targetName];
            if (!values) continue;
            series.push({ name: item.label, color: item.color || this.colors[colorIdx++ % this.colors.length], values });
        }
        if (!series.length) {
            this.data = null;
            this.draw();
            return;
        }

        this.data = { mode: "sweep", xLabel, xUnit, yLabel: "Voltage (V) / Current (A)", xValues: sweepResult.sweep, series };
        this.draw();
    }

    /**
     * Plots AC Frequency Sweep Bode plot for probes ALONE. No probes = No signal.
     */
    plotAC(acSweepResults, probes = [], netlistInfo = null) {
        if (!this.lastAC || this.lastAC[0] !== acSweepResults) this.clearCursors();
        this.lastAC = [acSweepResults, probes, netlistInfo];
        if (!acSweepResults || acSweepResults.length === 0 || !probes || probes.length === 0) {
            this.data = null;
            this.draw();
            return;
        }

        const freqPoints = acSweepResults.map(r => r.frequency);
        const phasors = [];   // { label, z: Complex[] }
        for (const item of this.buildProbeSeriesMap(probes, netlistInfo)) {
            const pick = item.type === 'V' ? (r => r.nodeVoltages[item.node]) : (r => r.sourceCurrents[item.targetName]);
            phasors.push({ label: item.label, color: item.color, z: acSweepResults.map(r => pick(r) || new Complex(0, 0)) });
        }
        if (phasors.length === 0) {
            this.data = null;
            this.draw();
            return;
        }

        const color = (i) => phasors[i].color || this.colors[i % this.colors.length];
        const mag = (z) => z.magnitude();
        const db = (z) => 20 * Math.log10(Math.max(z.magnitude(), 1e-20));
        // phase in degrees, unwrapped so a 180 degree crossing does not jump by 360
        const phase = (zs) => {
            const out = [];
            let offset = 0, prev = null;
            for (const z of zs) {
                let p = z.phaseDegrees();
                if (prev !== null) {
                    while (p + offset - prev > 180) offset -= 360;
                    while (p + offset - prev < -180) offset += 360;
                }
                p += offset;
                out.push(p);
                prev = p;
            }
            return out;
        };

        const linear = this.acScale === "linear";
        const magSeries = phasors.map((p, i) => ({ name: p.label, color: color(i), values: p.z.map(linear ? mag : db) }));
        this.data = {
            mode: "ac",
            xLabel: "Frequency (Hz)",
            yLabel: linear ? "Magnitude" : "Gain (dB)",
            xValues: freqPoints,
            series: magSeries,
            panels: linear ? null : [
                { yUnit: "Gain (dB)", valueUnit: "dB", tickDigits: 1, series: magSeries },
                { yUnit: "Phase (°)", valueUnit: "°", tickDigits: 0, series: phasors.map((p, i) => ({ name: p.label, color: color(i), values: phase(p.z) })) }
            ]
        };
        if (linear) this.data.yUnit = "Magnitude";

        this.draw();
    }

    setACScale(scale) {
        this.acScale = scale;
        if (this.data && this.data.mode === "ac" && this.lastAC) this.plotAC(...this.lastAC);
    }

    /**
     * Plots DC Operating Point level chart for probes ALONE. No probes = No signal.
     */
    plotDC(dcResult, probes = [], netlistInfo = null) {
        if (!(this.data && this.data.live)) this.clearCursors();
        if (!probes || probes.length === 0) {
            this.data = null;
            this.draw();
            return;
        }

        const timePoints = [0, 0.001, 0.002, 0.003, 0.004, 0.005];
        const series = [];
        let colorIdx = 0;
        const probeSeriesMap = this.buildProbeSeriesMap(probes, netlistInfo);

        for (const item of probeSeriesMap) {
            if (item.type === 'V') {
                const v = dcResult.nodeVoltages[item.node] || 0;
                series.push({
                    name: item.label,
                    color: item.color || this.colors[colorIdx % this.colors.length],
                    values: timePoints.map(() => v)
                });
                colorIdx++;
            } else if (item.type === 'I') {
                const i = dcResult.sourceCurrents[item.targetName] || 0;
                series.push({
                    name: item.label,
                    color: item.color || this.colors[colorIdx % this.colors.length],
                    values: timePoints.map(() => i)
                });
                colorIdx++;
            }
        }

        if (series.length === 0) {
            this.data = null;
            this.draw();
            return;
        }

        this.data = {
            mode: "dc",
            xLabel: "Time (DC Steady State)",
            yLabel: "Level",
            xValues: timePoints,
            series
        };

        this.draw();
    }

    buildProbeSeriesMap(probes, netlistInfo) {
        const result = [];
        if (!probes || probes.length === 0 || !netlistInfo) return result;

        for (const prb of probes) {
            if (prb.graph === false) continue;            // "live only" probes are not plotted
            if (prb.type === 'V') {
                const nodeName = netlistInfo.getPointNodeName(prb.x, prb.y) || "0";
                result.push({
                    type: 'V',
                    label: `${prb.label} (Node ${nodeName})`,
                    color: prb.color,
                    node: nodeName
                });
            } else if (prb.type === 'I') {
                result.push({
                    type: 'I',
                    label: prb.label,
                    color: prb.color,
                    targetName: prb.targetName
                });
            }
        }
        return result;
    }

    // ---------------------------------------------------------------- view geometry

    static PAD_LEFT = 60;
    static PAD_RIGHT = 20;

    // x axis mapping in "axis units" u (log10 for frequency, the value itself otherwise)
    view(data) {
        const xs = data.xValues, n = xs.length;
        const log = data.mode === "ac" && n > 0 && xs[0] > 0;
        const u = log ? (x) => Math.log10(x) : (x) => x;
        const inv = log ? (v) => Math.pow(10, v) : (v) => v;
        let a = u(xs[0]), b = u(xs[n - 1]);
        if (!(b > a)) b = a + 1;
        const span = b - a, vspan = span / this.zoomX;
        const center = Math.min(Math.max((a + b) / 2 + this.panX * span, a), b);
        return { log, u, inv, a, b, span, vspan, vmin: center - vspan / 2, vmax: center + vspan / 2 };
    }

    plotLeft() { return WaveformPlotter.PAD_LEFT; }
    plotWidth() { return this.width - WaveformPlotter.PAD_LEFT - WaveformPlotter.PAD_RIGHT; }

    // pixel -> data x (clamped to the data range)
    xAtPixel(px) {
        if (!this.data || !this.data.xValues.length) return null;
        const v = this.view(this.data);
        const x = v.inv(v.vmin + ((px - this.plotLeft()) / this.plotWidth()) * v.vspan);
        const xs = this.data.xValues;
        return Math.min(Math.max(x, xs[0]), xs[xs.length - 1]);
    }

    pixelAtX(x, view = this.view(this.data)) {
        return this.plotLeft() + ((view.u(x) - view.vmin) / view.vspan) * this.plotWidth();
    }

    // ---------------------------------------------------------------- cursors

    setCursor(which, x) {
        if (!this.data || this.data.mode === "dc") return;
        this.cursors[which] = x;
        this.draw();
        if (this.onCursors) this.onCursors();
    }

    clearCursors() {
        this.cursors = { a: null, b: null };
        this.dragCursor = null;
        if (this.onCursors) this.onCursors();
    }

    cursorNear(px) {
        if (!this.data || this.data.mode === "dc") return null;
        const view = this.view(this.data);
        for (const k of ["a", "b"]) {
            if (this.cursors[k] !== null && Math.abs(this.pixelAtX(this.cursors[k], view) - px) <= 5) return k;
        }
        return null;
    }

    // ---------------------------------------------------------------- hover

    updateHover(mouseX) {
        if (!this.data || !this.data.xValues || this.data.xValues.length === 0) return;
        this.hoverX = this.xAtPixel(mouseX);
        this.draw();
    }

    // "nice" tick positions covering [min, max]
    static niceTicks(min, max, target = 6) {
        const span = max - min;
        if (!(span > 0)) return [min];
        const raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const f = raw / mag, step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
        const out = [];
        for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
        return out;
    }

    // ---------------------------------------------------------------- drawing

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        if (!this.data || !this.data.series || this.data.series.length === 0) {
            ctx.fillStyle = "#9aa4b5";
            ctx.font = "13px system-ui";
            ctx.textAlign = "center";
            ctx.fillText("No probes attached. Place a V-Probe or I-Probe on the schematic to view waveforms.", this.width / 2, this.height / 2);
            if (this.onDraw) this.onDraw();
            return;
        }

        // a Bode plot is two stacked panels sharing the frequency axis
        const panels = this.data.panels || [this.data];
        const h = this.height / panels.length;
        const view = this.view(this.data);
        panels.forEach((panel, i) => {
            const data = panel === this.data ? panel : Object.assign({}, panel, { mode: this.data.mode, xValues: this.data.xValues, xUnit: this.data.xUnit });
            this.drawPlot(data, i * h, h, i, panels.length, view);
        });
        if (this.onDraw) this.onDraw();
    }

    drawPlot(data, top, height, index, count, view) {
        const ctx = this.ctx;
        const xs = data.xValues, n = xs.length;
        const paddingLeft = WaveformPlotter.PAD_LEFT;
        const paddingTop = top + (index === 0 ? 30 : 14);
        const paddingBottom = this.height - (top + height) + (index === count - 1 ? 40 : 10);
        const graphWidth = this.plotWidth();
        const graphHeight = this.height - paddingTop - paddingBottom;
        const xOf = (x) => paddingLeft + ((view.u(x) - view.vmin) / view.vspan) * graphWidth;

        // samples that fall inside the visible x range (plus one either side so lines reach the edge)
        const i0 = Math.max(0, PlotMath.lowerBound(xs, view.inv(view.vmin)) - 1);
        const i1 = Math.min(n - 1, PlotMath.lowerBound(xs, view.inv(view.vmax)) + 1);

        let yMin = Infinity, yMax = -Infinity;
        for (const s of data.series) {
            for (let i = i0; i <= i1; i++) {
                const v = s.values[i];
                if (v < yMin) yMin = v;
                if (v > yMax) yMax = v;
            }
        }
        if (!isFinite(yMin) || !isFinite(yMax)) { yMin = -1; yMax = 1; }
        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        const yMargin = (yMax - yMin) * 0.1;
        yMin -= yMargin; yMax += yMargin;

        const yCenter = (yMin + yMax) / 2 + (this.panY * (yMax - yMin));
        const yHalfSpan = ((yMax - yMin) / 2) / this.zoomY;
        const finalYMin = yCenter - yHalfSpan;
        const finalYMax = yCenter + yHalfSpan;
        const mapY = (val) => paddingTop + graphHeight - ((val - finalYMin) / (finalYMax - finalYMin)) * graphHeight;

        // grid + y labels
        ctx.strokeStyle = "#252b37";
        ctx.lineWidth = 1;
        ctx.fillStyle = "#9aa4b5";
        ctx.font = "11px system-ui";
        for (const yVal of WaveformPlotter.niceTicks(finalYMin, finalYMax, 5)) {
            const yPos = mapY(yVal);
            ctx.beginPath(); ctx.moveTo(paddingLeft, yPos); ctx.lineTo(paddingLeft + graphWidth, yPos); ctx.stroke();
            ctx.textAlign = "right"; ctx.textBaseline = "middle";
            ctx.fillText(data.tickDigits !== undefined ? yVal.toFixed(data.tickDigits) : Units.formatSI(yVal, ""), paddingLeft - 8, yPos);
        }

        // x grid + labels: decades on a log axis, nice values otherwise
        const unit = data.xUnit !== undefined ? data.xUnit : (data.mode === "ac" ? "Hz" : "s");
        const ticks = [];
        if (view.log) {
            for (let k = Math.floor(view.vmin); k <= Math.ceil(view.vmax); k++) {
                for (const m of (view.vspan < 2.2 ? [1, 2, 5] : [1])) {
                    const x = m * Math.pow(10, k);
                    if (view.u(x) >= view.vmin - 1e-9 && view.u(x) <= view.vmax + 1e-9) ticks.push(x);
                }
            }
        } else {
            ticks.push(...WaveformPlotter.niceTicks(view.vmin, view.vmax, 6));
        }
        for (const x of ticks) {
            const xPos = xOf(x);
            ctx.beginPath(); ctx.moveTo(xPos, paddingTop); ctx.lineTo(xPos, paddingTop + graphHeight); ctx.stroke();
            if (index < count - 1) continue;
            ctx.textAlign = "center"; ctx.textBaseline = "top";
            ctx.fillText(Units.formatSI(x, unit), xPos, paddingTop + graphHeight + 6);
        }

        if (data.yUnit) {
            ctx.fillStyle = "#9aa4b5";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(data.yUnit, paddingLeft + 6, paddingTop + 4);
        }

        ctx.strokeStyle = "#3b4454";
        ctx.lineWidth = 1;
        ctx.strokeRect(paddingLeft, paddingTop, graphWidth, graphHeight);

        // traces (min / max per pixel column when there are many more samples than pixels)
        ctx.save();
        ctx.beginPath();
        ctx.rect(paddingLeft, paddingTop, graphWidth, graphHeight);
        ctx.clip();
        const dense = (i1 - i0 + 1) > graphWidth * 3;
        for (const s of data.series) {
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            if (!dense) {
                for (let i = i0; i <= i1; i++) {
                    const px = xOf(xs[i]), py = mapY(s.values[i]);
                    if (i === i0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
            } else {
                let col = null, lo = 0, hi = 0, loI = 0, hiI = 0, started = false;
                const flush = () => {
                    if (col === null) return;
                    const a = loI < hiI ? [lo, hi] : [hi, lo];
                    for (const v of a) { const py = mapY(v); if (!started) { ctx.moveTo(col + 0.5, py); started = true; } else ctx.lineTo(col + 0.5, py); }
                };
                for (let i = i0; i <= i1; i++) {
                    const c = Math.floor(xOf(xs[i])), v = s.values[i];
                    if (c !== col) { flush(); col = c; lo = hi = v; loI = hiI = i; }
                    else { if (v < lo) { lo = v; loI = i; } if (v > hi) { hi = v; hiI = i; } }
                }
                flush();
            }
            ctx.stroke();
        }

        // cursors
        const flags = { a: "#ffd166", b: "#06d6a0" };
        for (const k of ["a", "b"]) {
            const cx = this.cursors[k];
            if (cx === null || data.mode === "dc") continue;
            const px = xOf(cx);
            if (px < paddingLeft - 1 || px > paddingLeft + graphWidth + 1) continue;
            ctx.strokeStyle = flags[k];
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(px, paddingTop); ctx.lineTo(px, paddingTop + graphHeight); ctx.stroke();
            ctx.setLineDash([]);
            for (const s of data.series) {
                const v = PlotMath.valueAt(xs, s.values, cx, view.log);
                ctx.fillStyle = s.color;
                ctx.beginPath(); ctx.arc(px, Math.max(paddingTop, Math.min(paddingTop + graphHeight, mapY(v))), 4, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.restore();
        for (const k of ["a", "b"]) {
            const cx = this.cursors[k];
            if (cx === null || data.mode === "dc") continue;
            const px = xOf(cx);
            if (px < paddingLeft - 1 || px > paddingLeft + graphWidth + 1) continue;
            ctx.fillStyle = flags[k];
            ctx.fillRect(px - 8, paddingTop - 14, 16, 14);
            ctx.fillStyle = "#101318";
            ctx.font = "bold 10px system-ui";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(k.toUpperCase(), px, paddingTop - 7);
        }

        // legend (first panel only)
        let legendX = paddingLeft + 10;
        for (const s of index === 0 ? data.series : []) {
            ctx.fillStyle = s.color;
            ctx.fillRect(legendX, 10, 10, 10);
            ctx.fillStyle = "#e8edf5";
            ctx.font = "12px system-ui";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(s.name, legendX + 14, 15);
            legendX += ctx.measureText(s.name).width + 30;
        }

        if (this.zoomX !== 1.0 || this.zoomY !== 1.0) {
            ctx.fillStyle = "#6ea8fe";
            ctx.font = "10px system-ui";
            ctx.textAlign = "right";
            ctx.fillText(`Zoom: ${this.zoomX.toFixed(1)}x X, ${this.zoomY.toFixed(1)}x Y (Dbl-click to reset)`, paddingLeft + graphWidth, 15);
        }

        // hover crosshair + values at the pointer
        if (this.hoverX !== null && this.hoverX >= xs[0] && this.hoverX <= xs[n - 1] && !this.dragCursor) {
            const hX = xOf(this.hoverX);
            if (hX >= paddingLeft && hX <= paddingLeft + graphWidth) {
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(hX, paddingTop); ctx.lineTo(hX, paddingTop + graphHeight); ctx.stroke();
                ctx.setLineDash([]);

                let tooltipY = paddingTop + 15;
                ctx.font = "11px system-ui";
                ctx.textAlign = "right";
                ctx.fillStyle = "#9aa4b5";
                ctx.fillText(Units.formatSI(this.hoverX, unit), paddingLeft + graphWidth - 10, tooltipY);
                tooltipY += 15;
                for (const s of data.series) {
                    const val = PlotMath.valueAt(xs, s.values, this.hoverX, view.log);
                    const hY = mapY(val);
                    ctx.fillStyle = s.color;
                    ctx.beginPath();
                    ctx.arc(hX, Math.max(paddingTop, Math.min(paddingTop + graphHeight, hY)), 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.textAlign = "right";
                    ctx.fillText(`${s.name}: ${Units.formatSI(val, data.valueUnit || "")}`, paddingLeft + graphWidth - 10, tooltipY);
                    tooltipY += 15;
                }
            }
        }
    }

    // ---------------------------------------------------------------- export

    // x header, x values and the plotted columns (an AC Bode plot exports gain and phase for each trace)
    exportColumns() {
        const d = this.data;
        if (!d || d.mode === "dc") return null;
        const xHeader = d.mode === "transient" ? "Time (s)" : (d.mode === "ac" ? "Frequency (Hz)" : d.xLabel);
        let columns;
        if (d.panels) {
            columns = [];
            d.series.forEach((s, i) => {
                columns.push({ header: `${s.name} gain (dB)`, values: d.panels[0].series[i].values });
                columns.push({ header: `${s.name} phase (deg)`, values: d.panels[1].series[i].values });
            });
        } else {
            columns = d.series.map(s => ({ header: d.mode === "ac" ? `${s.name} magnitude` : s.name, values: s.values }));
        }
        return { xHeader, xs: d.xValues, columns };
    }

    // range: "all" | "visible" | "cursors"
    csv(range = "all") {
        const e = this.exportColumns();
        if (!e) return null;
        const xs = e.xs;
        let i0 = 0, i1 = xs.length - 1;
        if (range === "visible") {
            const v = this.view(this.data);
            i0 = Math.max(0, PlotMath.lowerBound(xs, v.inv(v.vmin)));
            i1 = Math.min(xs.length - 1, PlotMath.lowerBound(xs, v.inv(v.vmax)));
        } else if (range === "cursors" && this.cursors.a !== null && this.cursors.b !== null) {
            const lo = Math.min(this.cursors.a, this.cursors.b), hi = Math.max(this.cursors.a, this.cursors.b);
            i0 = PlotMath.lowerBound(xs, lo);
            i1 = Math.min(xs.length - 1, PlotMath.lowerBound(xs, hi));
            if (xs[i1] > hi) i1--;
        }
        return PlotMath.csv(e.xHeader, xs, e.columns, i0, i1);
    }
}

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

        // Interaction listeners
        this.canvas.addEventListener("pointerdown", (e) => {
            if (e.button === 0) {
                this.isPanning = true;
                this.panStart = { x: e.clientX, y: e.clientY };
            }
        });

        this.canvas.addEventListener("pointermove", (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;

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

            this.updateHover(mouseX);
        });

        this.canvas.addEventListener("pointerup", () => {
            this.isPanning = false;
        });

        this.canvas.addEventListener("pointerleave", () => {
            this.isPanning = false;
            this.hoverIndex = -1;
            this.draw();
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
                    color: this.colors[colorIdx % this.colors.length],
                    values: transientResult.nodeHistories[item.node]
                });
                colorIdx++;
            } else if (item.type === 'I' && transientResult.currentHistories[item.targetName]) {
                series.push({
                    name: item.label,
                    color: this.colors[colorIdx % this.colors.length],
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
            series.push({ name: item.label, color: this.colors[colorIdx++ % this.colors.length], values });
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
            phasors.push({ label: item.label, z: acSweepResults.map(r => pick(r) || new Complex(0, 0)) });
        }
        if (phasors.length === 0) {
            this.data = null;
            this.draw();
            return;
        }

        const color = (i) => this.colors[i % this.colors.length];
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
                    color: this.colors[colorIdx % this.colors.length],
                    values: timePoints.map(() => v)
                });
                colorIdx++;
            } else if (item.type === 'I') {
                const i = dcResult.sourceCurrents[item.targetName] || 0;
                series.push({
                    name: item.label,
                    color: this.colors[colorIdx % this.colors.length],
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
            if (prb.type === 'V') {
                const nodeName = netlistInfo.getPointNodeName(prb.x, prb.y) || "0";
                result.push({
                    type: 'V',
                    label: `${prb.label} (Node ${nodeName})`,
                    node: nodeName
                });
            } else if (prb.type === 'I') {
                result.push({
                    type: 'I',
                    label: prb.label,
                    targetName: prb.targetName
                });
            }
        }
        return result;
    }

    updateHover(mouseX) {
        if (!this.data || !this.data.xValues || this.data.xValues.length === 0) return;

        const paddingLeft = 60;
        const paddingRight = 20;
        const graphWidth = this.width - paddingLeft - paddingRight;

        const relativeX = Math.max(0, Math.min(graphWidth, mouseX - paddingLeft));
        const fraction = relativeX / graphWidth;

        const totalPoints = this.data.xValues.length;
        this.hoverIndex = Math.min(totalPoints - 1, Math.max(0, Math.round(fraction * (totalPoints - 1))));

        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        if (!this.data || !this.data.series || this.data.series.length === 0) {
            ctx.fillStyle = "#9aa4b5";
            ctx.font = "13px system-ui";
            ctx.textAlign = "center";
            ctx.fillText("No probes attached. Place a V-Probe or I-Probe on the schematic to view waveforms.", this.width / 2, this.height / 2);
            return;
        }

        // a Bode plot is two stacked panels sharing the frequency axis
        const panels = this.data.panels || [this.data];
        const h = this.height / panels.length;
        panels.forEach((panel, i) => {
            const data = panel === this.data ? panel : Object.assign({}, panel, { mode: this.data.mode, xValues: this.data.xValues, xUnit: this.data.xUnit });
            this.drawPlot(data, i * h, h, i, panels.length);
        });
    }

    drawPlot(data, top, height, index, count) {
        const ctx = this.ctx;
        const paddingLeft = 60;
        const paddingRight = 20;
        const paddingTop = top + (index === 0 ? 30 : 14);
        const paddingBottom = this.height - (top + height) + (index === count - 1 ? 40 : 10);

        const graphWidth = this.width - paddingLeft - paddingRight;
        const graphHeight = this.height - paddingTop - paddingBottom;

        let yMin = Infinity;
        let yMax = -Infinity;

        for (const s of data.series) {
            for (const v of s.values) {
                if (v < yMin) yMin = v;
                if (v > yMax) yMax = v;
            }
        }

        if (yMin === yMax) {
            yMin -= 1;
            yMax += 1;
        }

        const yMargin = (yMax - yMin) * 0.1;
        yMin -= yMargin;
        yMax += yMargin;

        const yCenter = (yMin + yMax) / 2 + (this.panY * (yMax - yMin));
        const yHalfSpan = ((yMax - yMin) / 2) / this.zoomY;
        const finalYMin = yCenter - yHalfSpan;
        const finalYMax = yCenter + yHalfSpan;

        const totalPoints = data.xValues.length;
        const xSpan = (totalPoints - 1) / this.zoomX;
        const xCenter = (totalPoints - 1) / 2 + (this.panX * totalPoints);
        const xMinIdx = Math.max(0, Math.floor(xCenter - xSpan / 2));
        const xMaxIdx = Math.min(totalPoints - 1, Math.ceil(xCenter + xSpan / 2));

        // Draw background grid
        ctx.strokeStyle = "#252b37";
        ctx.lineWidth = 1;
        ctx.fillStyle = "#9aa4b5";
        ctx.font = "11px system-ui";

        // Y Grid Lines & Labels
        const yTicks = 5;
        for (let i = 0; i <= yTicks; i++) {
            const yVal = finalYMin + (i / yTicks) * (finalYMax - finalYMin);
            const yPos = paddingTop + graphHeight - (i / yTicks) * graphHeight;

            ctx.beginPath();
            ctx.moveTo(paddingLeft, yPos);
            ctx.lineTo(paddingLeft + graphWidth, yPos);
            ctx.stroke();

            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillText(data.tickDigits !== undefined ? yVal.toFixed(data.tickDigits) : Units.formatSI(yVal, ""), paddingLeft - 8, yPos);
        }

        // X Grid Lines & Labels
        const xTicks = 6;
        const isLog = data.mode === "ac";
        const xMinVal = data.xValues[xMinIdx];
        const xMaxVal = data.xValues[xMaxIdx];

        for (let i = 0; i <= xTicks; i++) {
            const fraction = i / xTicks;
            const xPos = paddingLeft + fraction * graphWidth;

            let xVal;
            if (isLog && xMinVal > 0 && xMaxVal > 0) {
                const logMin = Math.log10(xMinVal);
                const logMax = Math.log10(xMaxVal);
                xVal = Math.pow(10, logMin + fraction * (logMax - logMin));
            } else {
                xVal = xMinVal + fraction * (xMaxVal - xMinVal);
            }

            ctx.beginPath();
            ctx.moveTo(xPos, paddingTop);
            ctx.lineTo(xPos, paddingTop + graphHeight);
            ctx.stroke();

            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            if (index < count - 1) continue;
            const unitStr = data.xUnit !== undefined ? data.xUnit : (data.mode === "ac" ? "Hz" : "s");
            ctx.fillText(Units.formatSI(xVal, unitStr), xPos, paddingTop + graphHeight + 6);
        }

        if (data.yUnit) {
            ctx.fillStyle = "#9aa4b5";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(data.yUnit, paddingLeft + 6, paddingTop + 4);
        }

        // Draw Axes Border
        ctx.strokeStyle = "#3b4454";
        ctx.lineWidth = 1;
        ctx.strokeRect(paddingLeft, paddingTop, graphWidth, graphHeight);

        const mapX = (index) => {
            const frac = (index - (xCenter - xSpan / 2)) / xSpan;
            return paddingLeft + frac * graphWidth;
        };

        const mapY = (val) => {
            return paddingTop + graphHeight - ((val - finalYMin) / (finalYMax - finalYMin)) * graphHeight;
        };

        // Draw Traces
        ctx.save();
        ctx.beginPath();
        ctx.rect(paddingLeft, paddingTop, graphWidth, graphHeight);
        ctx.clip();

        for (const s of data.series) {
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 2;
            ctx.beginPath();

            for (let i = xMinIdx; i <= xMaxIdx; i++) {
                const px = mapX(i);
                const py = mapY(s.values[i]);

                if (i === xMinIdx) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
        ctx.restore();

        // Draw Legend
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

        // Draw Hover Crosshair
        if (this.hoverIndex >= xMinIdx && this.hoverIndex <= xMaxIdx) {
            const hX = mapX(this.hoverIndex);
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);

            ctx.beginPath();
            ctx.moveTo(hX, paddingTop);
            ctx.lineTo(hX, paddingTop + graphHeight);
            ctx.stroke();

            ctx.setLineDash([]);

            let tooltipY = paddingTop + 15;
            for (const s of data.series) {
                const val = s.values[this.hoverIndex];
                const hY = mapY(val);

                ctx.fillStyle = s.color;
                ctx.beginPath();
                ctx.arc(hX, Math.max(paddingTop, Math.min(paddingTop + graphHeight, hY)), 4, 0, Math.PI * 2);
                ctx.fill();

                ctx.textAlign = "right";
                ctx.fillStyle = s.color;
                ctx.fillText(`${s.name}: ${Units.formatSI(val, data.valueUnit || "")}`, paddingLeft + graphWidth - 10, tooltipY);
                tooltipY += 15;
            }
        }
    }
}

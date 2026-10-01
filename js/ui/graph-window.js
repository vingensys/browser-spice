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
                <span id="plotTitle">No simulation run yet</span>
                <button class="tb-btn" id="graph-sim" title="Simulate (analysis for this tab)">${Icons.svg("play")}</button>
                <button class="tb-btn" id="zoomInBtn" title="Zoom in">${Icons.svg("zoomin")}</button>
                <button class="tb-btn" id="zoomOutBtn" title="Zoom out">${Icons.svg("zoomout")}</button>
                <button class="tb-btn" id="resetZoomBtn" title="Reset zoom">${Icons.svg("fit")}</button>
                <button class="tb-btn" id="graph-close" title="Close graph window">✕</button>
            </div>
            <div class="graph-body">
                <div class="graph-plot"><canvas id="plotCanvas"></canvas></div>
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

        root.querySelector("#graph-sim").onclick = () => this.simulate();
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

    get visible() { return !this.root.classList.contains("hidden"); }

    show(kind = this.kind) {
        this.kind = kind;
        this.root.classList.remove("hidden");
        this.tabsEl.querySelectorAll(".graph-tab").forEach(t => t.classList.toggle("active", t.dataset.id === kind));
        this.root.querySelector("#dcResults").classList.toggle("hidden", kind !== "dc");
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
        const series = live.channels.map((ch, i) => ({ name: ch.name, color: colors[i % colors.length], values: live.values[i] }));
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

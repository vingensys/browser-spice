// Runs the simulation engine on the current schematic and renders the results.

class SimRunner {
    constructor(editor, plotter) {
        this.editor = editor;
        this.plotter = plotter;
        this.toastTimer = null;
    }

    el(id) { return document.getElementById(id); }

    settings() {
        const num = (id, fallback) => {
            const input = this.el(id);
            const v = input ? Units.parseSI(input.value) : 0;
            if (!(v > 0) && input && input.value.trim() !== "") {
                const msg = `Simulation setting "${input.value}" is not a positive number; using ${Units.formatSI(fallback, "").replace(/\s/g, "")}`;
                if (msg !== this.lastSettingWarning) { this.lastSettingWarning = msg; this.toast(msg, "warn"); }
            }
            return v > 0 ? v : fallback;
        };
        return {
            tStop: num("simTstop", 0.02),
            tStep: num("simTstep", 2e-5),
            uic: this.el("simUic") ? this.el("simUic").checked : true,
            fStart: num("simFstart", 10),
            fStop: num("simFstop", 1e6),
            engine: this.el("simEngine") ? this.el("simEngine").value : "builtin",
            liveSpeed: this.el("liveSpeed") ? Number(this.el("liveSpeed").value) : 0.1,
            temp: this.el("simTemp") && this.el("simTemp").value !== "" ? Number(this.el("simTemp").value) : 27,
            sweepSource: this.el("sweepSrc") ? this.el("sweepSrc").value : "",
            sweepStart: this.el("sweepStart") ? Units.parseSI(this.el("sweepStart").value) : 0,
            sweepStop: this.el("sweepStop") ? Units.parseSI(this.el("sweepStop").value) : 5,
            sweepStep: this.el("sweepStep") ? (Units.parseSI(this.el("sweepStep").value) || 0.1) : 0.1
        };
    }

    toast(message, kind = "info") {
        if (typeof AppLog !== "undefined") AppLog.add(kind === "error" ? "err" : (kind === "warn" ? "warn" : "info"), message);
        const t = this.el("toast");
        if (!t) { if (kind === "error") alert(message); return; }
        t.textContent = message;
        t.className = `toast show ${kind}`;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => { t.className = "toast"; }, kind === "error" ? 9000 : 4500);
    }

    // build the netlist, warn about suspicious wiring
    prepare() {
        this.rejectImpossible();
        const info = NetlistExtractor.extract(this.editor);
        if (info.warnings.length) {
            this.toast(`Warning: ${info.warnings.slice(0, 3).join("; ")}${info.warnings.length > 3 ? " …" : ""}`, "warn");
        }
        return info;
    }

    // a loop of ideal voltage sources has no solution: say so in plain words instead of a singular-matrix error
    rejectImpossible() {
        const fatal = ErcChecker.fatal(this.editor);
        if (fatal.length) throw new Error(`${fatal[0].text}${fatal.length > 1 ? ` (${fatal.length - 1} more problem(s): see Design > Electrical Rule Check)` : ""}`);
    }

    async guard(fn) {
        try {
            await fn();
        } catch (err) {
            if (err.message === "Cancelled") { this.toast("Simulation cancelled.", "info"); return; }
            console.error(err);
            this.toast(err.message, "error");
        }
    }

    // Solve on a worker thread (page stays responsive, progress bar, Cancel); on the main thread when workers are
    // unavailable. kind: "op" | "tran" | "ac" | "sweep"; args as in worker.js.
    async solve(info, kind, args, label = "Simulating") {
        if (SimWorker.available()) {
            const busy = this.busyShow(label);
            try {
                const res = await SimWorker.run(info.elements, kind, args, this.engineOptions(), busy.progress);
                return kind === "ac" ? SimWorker.unpackAc(res) : res;
            } catch (e) {
                if (!e.workerFailed) throw e;
            } finally { busy.done(); }
        }
        const engine = new SimEngine(info.circuit, this.engineOptions());
        if (kind === "op") return engine.operatingPoint({ uic: !!args.uic, nodeIC: args.nodeIC || null });
        if (kind === "tran") return engine.transient({ tStop: args.tStop, tStep: args.tStep, uic: args.uic, method: "trap", nodeIC: args.nodeIC });
        if (kind === "ac") return engine.ac({ fStart: args.fStart, fStop: args.fStop, pointsPerDecade: args.pointsPerDecade || 20 });
        if (kind === "noise") return engine.noise({ out: args.out, input: args.input, fStart: args.fStart, fStop: args.fStop, pointsPerDecade: args.pointsPerDecade || 10 });
        return engine.dcSweep(args.source, args.start, args.stop, args.step);
    }

    // the status-bar progress strip: appears only if the job takes longer than a moment
    busyShow(label) {
        const el = this.el("busy");
        let shown = false, last = 0;
        const timer = setTimeout(() => { shown = true; if (el) { el.classList.remove("hidden"); this.el("busyText").textContent = `${label}…`; this.el("busyFill").style.width = "0%"; } }, 200);
        return {
            progress: (p) => { last = p; if (shown && el) { this.el("busyFill").style.width = `${Math.round(100 * Math.min(1, p))}%`; this.el("busyText").textContent = `${label}… ${Math.round(100 * Math.min(1, p))} %`; } },
            done: () => { clearTimeout(timer); if (el) el.classList.add("hidden"); }
        };
    }

    // Use ngspice when asked for and possible; say so when a part forces the fallback.
    wantsNgspice(info) {
        if (this.settings().engine !== "ngspice") return false;
        const bad = NgspiceBackend.unsupported(info);
        if (bad.length) {
            this.toast(`${bad.join(", ")} has no SPICE model in the export, so this run used the built-in engine.`, "warn");
            return false;
        }
        return true;
    }

    async ngspice(info, analysis) {
        if (!NgspiceBackend.simulation) this.toast("Loading ngspice (first use only)…", "info");
        const t = this.settings().temp;
        const deck = NetlistExtractor.toSpice(info.elements, { analysis: (t !== 27 ? `.temp ${t}\n` : "") + analysis });
        const res = await NgspiceBackend.run(deck);
        const problems = NgspiceBackend.problems(res);
        if (problems.length) this.toast(`ngspice: ${problems[0]}`, "warn");
        return res;
    }

    engineOptions() { return { temp: this.settings().temp }; }

    runDC() {
        return this.guard(async () => {
            const info = this.prepare();
            const t0 = performance.now();
            let op, label = "";
            if (this.wantsNgspice(info)) {
                op = NgspiceBackend.toOperatingPoint(await this.ngspice(info, ".op"), info);
                label = " (ngspice)";
            } else {
                op = await this.solve(info, "op", {}, "Operating point");
            }
            const ms = performance.now() - t0;

            let html = `<table class="results-table"><thead><tr><th>Node / Branch</th><th>Value</th></tr></thead><tbody>`;
            const names = Object.keys(op.nodeVoltages).sort((a, b) => Number(a) - Number(b));
            for (const node of names) {
                html += `<tr><td>V(${node === "0" ? "GND" : "node " + node})</td><td class="val">${Units.formatSI(op.nodeVoltages[node], "V")}</td></tr>`;
            }
            for (const el of info.elements) {
                const i = op.currents[el.name];
                if (i === undefined) continue;
                html += `<tr><td>I(${PropertiesPanel.esc(el.name)})</td><td class="val">${Units.formatSI(i, "A")}</td></tr>`;
            }
            html += `</tbody></table>`;
            html += `<div class="prop-note">${op.method === "ngspice" ? "Solved by ngspice" :
                `Converged in ${op.iterations || "n/a"} iteration(s)${op.method !== "newton" ? ` using ${op.method}` : ""}`}, ${ms.toFixed(1)} ms.</div>`;

            this.el("dcResults").innerHTML = html;
            this.el("plotTitle").textContent = `DC Analysis Probed Values${label}`;
            this.plotter.plotDC({ nodeVoltages: op.nodeVoltages, sourceCurrents: op.currents }, this.editor.probes, info);
            this.last = { kind: "dc", info, op };
        });
    }

    runAC() {
        return this.guard(async () => {
            const info = this.prepare();
            const s = this.settings();
            let results, label = "";
            if (this.wantsNgspice(info)) {
                const res = await this.ngspice(info, `.ac dec 20 ${s.fStart} ${s.fStop}`);
                results = NgspiceBackend.toAc(res, info);
                label = " (ngspice)";
            } else {
                results = await this.solve(info, "ac", { fStart: s.fStart, fStop: s.fStop, pointsPerDecade: 20 }, "AC sweep");
            }
            this.plotter.plotAC(results, this.editor.probes, info);
            this.el("plotTitle").textContent = `AC Frequency Sweep (Bode Plot)${label}`;
            this.last = { kind: "ac", info, results };
            if (!this.editor.probes.length) this.toast("Add a voltage probe to see the response.", "info");
        });
    }

    // Output and input-referred noise at every voltage probe, between the AC sweep's start and stop frequencies
    runNoise() {
        return this.guard(async () => {
            const info = this.prepare();
            const s = this.settings();
            const probes = this.editor.probes.filter(p => p.type === "V" && p.graph !== false);
            if (!probes.length) throw new Error("Add a voltage probe at the node whose noise you want to see.");
            const sources = info.elements.filter(e => e.kind === "V" || e.kind === "I");
            const input = sources.find(e => (e.params.acMag || 0) > 0) || sources.find(e => e.kind === "V");
            const t0 = performance.now();
            const outs = [];
            for (const prb of probes) {
                const node = info.getPointNodeName(prb.x, prb.y) || "0";
                if (node === "0") throw new Error(`${prb.label} is on ground: put the probe on the node whose noise you want.`);
                const rows = await this.solve(info, "noise", { out: [node], input: input ? input.name : null, fStart: s.fStart, fStop: s.fStop, pointsPerDecade: 10 }, "Noise");
                outs.push({ label: `${prb.label} (Node ${node})`, color: prb.color, rows });
            }
            this.plotter.plotNoise(outs, input ? input.name : null);
            this.el("plotTitle").textContent = `Noise Analysis${input ? `, input referred to ${input.name}` : ""}`;
            this.last = { kind: "noise", info, outs };
            this.toast(`Noise analysis: ${outs[0].rows.length} frequencies, ${Object.keys(outs[0].rows[0].parts).length} noise sources, ${(performance.now() - t0).toFixed(0)} ms.`, "info");
        });
    }

    runTransient() {
        return this.guard(async () => {
            const info = this.prepare();
            const s = this.settings();
            if (s.tStop / s.tStep > 2e6) throw new Error("That is too many time steps. Increase the step or shorten the stop time.");

            const t0 = performance.now();
            let res, label = "";
            if (this.wantsNgspice(info)) {
                const raw = await this.ngspice(info, `.tran ${s.tStep} ${s.tStop}${s.uic ? " uic" : ""}`);
                res = NgspiceBackend.toTransient(raw, info);
                label = " (ngspice)";
            } else {
                res = await this.solve(info, "tran", { tStop: s.tStop, tStep: s.tStep, uic: s.uic, nodeIC: info.nodeIC }, "Transient");
            }
            const ms = performance.now() - t0;

            this.plotter.plotTransient(res, this.editor.probes, info);
            this.el("plotTitle").textContent = `Transient Waveform V(t) / I(t)${label}`;
            this.last = { kind: "tran", info, res };
            this.toast(`Transient${label}: ${res.steps} steps in ${ms.toFixed(0)} ms${res.rejected ? ` (${res.rejected} retried)` : ""}.` +
                (this.editor.probes.length ? "" : " Add voltage probes to plot signals."), "info");
        });
    }

    runSweep() {
        return this.guard(async () => {
            const info = this.prepare();
            const s = this.settings();
            const src = info.elements.find(e => (e.kind === "V" || e.kind === "I") && e.name === s.sweepSource);
            if (!src) throw new Error("Choose a source to sweep (add a voltage or current source first).");
            if (!(s.sweepStep > 0)) throw new Error("The sweep step must be greater than zero.");

            const unit = src.kind === "I" ? "A" : "V";
            const t0 = performance.now();
            let res, label = "";
            if (this.wantsNgspice(info)) {
                const raw = await this.ngspice(info, `.dc ${NetlistExtractor.spiceName(src)} ${s.sweepStart} ${s.sweepStop} ${s.sweepStep}`);
                res = NgspiceBackend.toSweep(raw, info);
                label = " (ngspice)";
            } else {
                res = await this.solve(info, "sweep", { source: src.name, start: s.sweepStart, stop: s.sweepStop, step: s.sweepStep }, "DC sweep");
            }
            this.plotter.plotSweep(res, this.editor.probes, info, `${src.name} (${unit})`, unit);
            this.el("plotTitle").textContent = `DC Sweep of ${src.name}${label}`;
            this.last = { kind: "sweep", info, res };
            this.toast(`DC sweep${label}: ${res.sweep.length} points in ${(performance.now() - t0).toFixed(0)} ms.` +
                (this.editor.probes.length ? "" : " Add voltage probes to plot signals."), "info");
        });
    }

    // keep the sweep source list in step with the schematic
    refreshSweepSources() {
        const sel = this.el("sweepSrc");
        if (!sel) return;
        const names = this.editor.components.filter(c => c.type === "V" || c.type === "I").map(c => c.name);
        if (names.join("|") === sel.dataset.names) return;
        const keep = sel.value;
        sel.dataset.names = names.join("|");
        sel.innerHTML = names.length ? names.map(n => `<option value="${PropertiesPanel.esc(n)}">${PropertiesPanel.esc(n)}</option>`).join("") : `<option value="">(no sources)</option>`;
        if (names.includes(keep)) sel.value = keep;
    }

    spiceText() {
        const info = NetlistExtractor.extract(this.editor);
        const s = this.settings();
        const fmt = (v) => Number(v.toPrecision(4)).toString();
        const analysis = `.op\n.tran ${fmt(s.tStep)} ${fmt(s.tStop)}${s.uic ? " UIC" : ""}\n.ac dec 20 ${fmt(s.fStart)} ${fmt(s.fStop)}`;
        const tb = this.editor.titleBlock;
        const title = tb && tb.title ? tb.title + (tb.rev ? ` (rev ${tb.rev})` : "") : undefined;
        return { info, text: NetlistExtractor.toSpice(info.elements, { analysis, title }) };
    }

    showNetlist() {
        this.guard(() => {
            const { text } = this.spiceText();
            this.el("netlistText").value = text;
            this.el("netlistModal").style.display = "flex";
        });
    }
}

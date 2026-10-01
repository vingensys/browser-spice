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
        const info = NetlistExtractor.extract(this.editor);
        if (info.warnings.length) {
            this.toast(`Warning: ${info.warnings.slice(0, 3).join("; ")}${info.warnings.length > 3 ? " …" : ""}`, "warn");
        }
        return info;
    }

    async guard(fn) {
        try {
            await fn();
        } catch (err) {
            console.error(err);
            this.toast(err.message, "error");
        }
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
                op = new SimEngine(info.circuit, this.engineOptions()).operatingPoint();
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
                results = new SimEngine(info.circuit, this.engineOptions()).ac({ fStart: s.fStart, fStop: s.fStop, pointsPerDecade: 20 });
            }
            this.plotter.plotAC(results, this.editor.probes, info);
            this.el("plotTitle").textContent = `AC Frequency Sweep (Bode Plot)${label}`;
            this.last = { kind: "ac", info, results };
            if (!this.editor.probes.length) this.toast("Add a voltage probe to see the response.", "info");
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
                res = new SimEngine(info.circuit, this.engineOptions()).transient({ tStop: s.tStop, tStep: s.tStep, uic: s.uic, method: "trap", nodeIC: info.nodeIC });
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
                res = new SimEngine(info.circuit, this.engineOptions()).dcSweep(src.name, s.sweepStart, s.sweepStop, s.sweepStep);
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
        return { info, text: NetlistExtractor.toSpice(info.elements, { analysis }) };
    }

    showNetlist() {
        this.guard(() => {
            const { text } = this.spiceText();
            this.el("netlistText").value = text;
            this.el("netlistModal").style.display = "flex";
        });
    }
}

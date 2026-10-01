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
            return v > 0 ? v : fallback;
        };
        return {
            tStop: num("simTstop", 0.02),
            tStep: num("simTstep", 2e-5),
            uic: this.el("simUic") ? this.el("simUic").checked : true,
            fStart: num("simFstart", 10),
            fStop: num("simFstop", 1e6),
            engine: this.el("simEngine") ? this.el("simEngine").value : "builtin"
        };
    }

    toast(message, kind = "info") {
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
        const deck = NetlistExtractor.toSpice(info.elements, { analysis });
        return NgspiceBackend.run(deck);
    }

    runDC() {
        return this.guard(async () => {
            const info = this.prepare();
            const t0 = performance.now();
            let op, label = "";
            if (this.wantsNgspice(info)) {
                op = NgspiceBackend.toOperatingPoint(await this.ngspice(info, ".op"), info);
                label = " (ngspice)";
            } else {
                op = new SimEngine(info.circuit).operatingPoint();
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
                results = new SimEngine(info.circuit).ac({ fStart: s.fStart, fStop: s.fStop, pointsPerDecade: 20 });
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
                res = new SimEngine(info.circuit).transient({ tStop: s.tStop, tStep: s.tStep, uic: s.uic, method: "trap" });
            }
            const ms = performance.now() - t0;

            this.plotter.plotTransient(res, this.editor.probes, info);
            this.el("plotTitle").textContent = `Transient Waveform V(t) / I(t)${label}`;
            this.last = { kind: "tran", info, res };
            this.toast(`Transient${label}: ${res.steps} steps in ${ms.toFixed(0)} ms${res.rejected ? ` (${res.rejected} retried)` : ""}.` +
                (this.editor.probes.length ? "" : " Add voltage probes to plot signals."), "info");
        });
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

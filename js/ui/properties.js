// Properties panel: edits the selected part. Rendering is data-driven so adding a
// part type means adding a row spec here, not another block of handlers.

class PropertiesPanel {
    constructor(editor, container) {
        this.editor = editor;
        this.el = container;
        this.before = null;

        // snapshot on focus so one edit session is one undo step
        container.addEventListener("focusin", () => { this.before = editor.snapshot(); });
        container.addEventListener("input", e => this.onInput(e));
        container.addEventListener("change", e => this.onChange(e));
    }

    static esc(s) {
        return String(s === undefined || s === null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // ---- row builders ---------------------------------------------------------

    text(label, prop, value, hint = "") {
        const e = PropertiesPanel.esc;
        return `<div class="property"><label>${label}</label>
            <input type="text" data-prop="${prop}" value="${e(value)}" ${hint ? `placeholder="${e(hint)}"` : ""}></div>`;
    }

    select(label, prop, options, current, note = "") {
        const e = PropertiesPanel.esc;
        const opts = options.map(([v, text]) => `<option value="${e(v)}" ${v === current ? "selected" : ""}>${e(text)}</option>`).join("");
        return `<div class="property"><label>${label}</label>
            <select data-prop="${prop}">${opts}</select>
            ${note ? `<div class="prop-note">${e(note)}</div>` : ""}</div>`;
    }

    // ---- rendering -------------------------------------------------------------

    render() {
        const sel = this.editor.selection;

        if (!sel.length) {
            this.el.innerHTML = `<div class="no-selection">Nothing selected.<br><br>
                Click a part to edit it, or drag a box to select several. Double-click a part to jump to its value.</div>`;
            return;
        }
        if (sel.length > 1) {
            this.el.innerHTML = `<div class="no-selection">${sel.length} parts selected.<br><br>
                Drag to move them together, R rotates, Ctrl+C / Ctrl+V copies, Del deletes.</div>`;
            return;
        }

        const c = sel[0];
        let html = this.text("Name", "name", c.name);
        const type = c.type;

        if (type === "V") html += this.sourceRows(c);
        else if (type === "R") html += this.text("Resistance", "value", c.value, "e.g. 4.7k");
        else if (type === "C") html += this.text("Capacitance", "value", c.value, "e.g. 10u") + this.text("Initial voltage (UIC)", "ic", c.ic || "", "0");
        else if (type === "L") html += this.text("Inductance", "value", c.value, "e.g. 10m") + this.text("Initial current (UIC)", "ic", c.ic || "", "0");

        if (SIM_MODELS[type]) {
            const names = Object.keys(SIM_MODELS[type]);
            if (c.customParams) {
                // imported from a SPICE netlist: keep its exact parameters until the user picks a library part
                const opts = [[c.model, `${c.model} (imported)`], ...names.map(n => [n, n])];
                html += this.select("Model", "model", opts, c.model, "Imported SPICE model; pick a library part to replace it.");
            } else {
                const current = c.model || SIM_DEFAULT_MODEL[type];
                const m = simModel(type, current);
                html += this.select("Model", "model", names.map(n => [n, n]), current, m ? m.desc : "");
            }
        }

        if (type === "OPAMP") {
            html += this.text("Positive supply (V)", "vcc", c.vcc === undefined ? "15" : c.vcc, "15");
            html += this.text("Negative supply (V)", "vee", c.vee === undefined ? "-15" : c.vee, "-15 (0 for single supply)");
        }
        if (["AND", "OR", "NOT", "NAND", "NOR", "XOR"].includes(type)) {
            html += this.text("Supply (V)", "vcc", c.vcc === undefined ? "5" : c.vcc, "5");
        }
        if (type === "IC555") {
            html += `<div class="prop-note">NE555 timer: supply on VCC / GND, RESET is pulled high if left open.</div>`;
        }

        this.el.innerHTML = html;
    }

    sourceRows(c) {
        const t = c.sourceType || "DC";
        let html = this.select("Source type", "sourceType",
            [["DC", "DC voltage"], ["AC", "Sine wave"], ["PULSE", "Pulse / square"]], t);

        if (t === "DC") {
            html += this.text("Voltage", "dcVoltage", c.dcVoltage !== undefined ? this.fmt(c.dcVoltage, "V") : c.value, "5 V");
            html += this.text("AC sweep magnitude", "acStim", c.acStim || "", "0 (set 1 to drive an AC sweep)");
        } else if (t === "AC") {
            html += this.text("Amplitude", "acMagnitude", this.fmt(c.acMagnitude, "V", "5 V"), "5 V");
            html += this.text("DC offset", "dcOffset", this.fmt(c.dcOffset, "V", "0 V"), "0 V");
            html += this.text("Frequency", "frequency", this.fmt(c.frequency, "Hz", "1 kHz"), "1 kHz");
            html += this.text("Phase (deg)", "acPhase", c.acPhase === undefined ? "0" : c.acPhase, "0");
        } else {
            const p = c.pulse || {};
            html += this.text("Low level", "pulse.v1", this.fmt(p.v1, "V", "0 V"), "0 V");
            html += this.text("High level", "pulse.v2", this.fmt(p.v2, "V", "5 V"), "5 V");
            html += this.text("Delay", "pulse.delay", this.fmt(p.delay, "s", "0 s"), "0 s");
            html += this.text("Rise time", "pulse.rise", this.fmt(p.rise, "s", "1 µs"), "1 µs");
            html += this.text("Fall time", "pulse.fall", this.fmt(p.fall, "s", "1 µs"), "1 µs");
            html += this.text("Pulse width", "pulse.width", this.fmt(p.width, "s", "500 µs"), "500 µs");
            html += this.text("Period", "pulse.period", this.fmt(p.period, "s", "1 ms"), "1 ms");
            html += this.text("AC sweep magnitude", "acStim", c.acStim || "", "0");
        }
        return html;
    }

    fmt(v, unit, fallback = "") {
        if (v === undefined || v === null || v === "") return fallback;
        if (typeof v === "string") return v;
        return Units.formatSI(v, unit);
    }

    // The label drawn under the symbol
    static sourceLabel(c) {
        const f = (v, u) => (typeof v === "string" ? v : Units.formatSI(v, u));
        const t = c.sourceType || "DC";
        if (t === "AC") return `${f(c.acMagnitude, "V")} @ ${f(c.frequency, "Hz")}`;
        if (t === "PULSE") {
            const p = c.pulse || {};
            const per = Units.parseSI(p.period);
            return `${f(p.v1 === undefined ? 0 : p.v1, "V")}/${f(p.v2 === undefined ? 5 : p.v2, "V")}${per ? ` @ ${Units.formatSI(1 / per, "Hz")}` : ""}`;
        }
        return f(c.dcVoltage !== undefined ? c.dcVoltage : c.value, "V");
    }

    // ---- editing ----------------------------------------------------------------

    target(e) {
        const prop = e.target.getAttribute && e.target.getAttribute("data-prop");
        const comp = this.editor.selected;
        return prop && comp ? { prop, comp } : null;
    }

    assign(comp, prop, value) {
        if (prop.startsWith("pulse.")) {
            comp.pulse = comp.pulse || {};
            comp.pulse[prop.slice(6)] = value;
        } else {
            comp[prop] = value;
        }
    }

    onInput(e) {
        const t = this.target(e);
        if (!t || e.target.tagName === "SELECT") return;
        const { prop, comp } = t;
        const v = e.target.value;

        this.assign(comp, prop, v);
        this.refreshLabel(comp);
        this.editor.draw();
    }

    onChange(e) {
        const t = this.target(e);
        if (!t) return;
        const { prop, comp } = t;
        const v = e.target.value;

        if (e.target.tagName === "SELECT") {
            this.assign(comp, prop, v);
            if (prop === "model") {
                comp.value = v;
                if (SIM_MODELS[comp.type] && SIM_MODELS[comp.type][v]) delete comp.customParams;
            }
            if (prop === "sourceType") {
                // seed sensible defaults when switching waveform
                if (v === "PULSE" && !comp.pulse) comp.pulse = { v1: 0, v2: 5, delay: 0, rise: 1e-6, fall: 1e-6, width: 5e-4, period: 1e-3 };
                if (v === "AC" && comp.acMagnitude === undefined) comp.acMagnitude = 5;
            }
            this.refreshLabel(comp);
            this.commit();
            this.render();
        } else {
            this.refreshLabel(comp);
            this.commit();
        }
        this.editor.draw();
    }

    refreshLabel(comp) {
        if (comp.type === "V") comp.value = PropertiesPanel.sourceLabel(comp);
    }

    // one undo step per edit session
    commit() {
        const ed = this.editor;
        if (this.before && ed.snapshot() !== this.before) {
            ed.historyStack.push(this.before);
            ed.futureStack = [];
        }
        this.before = ed.snapshot();
    }

    focusMain() {
        const input = this.el.querySelector('[data-prop="value"], [data-prop="dcVoltage"], [data-prop="acMagnitude"], [data-prop="name"]');
        if (input) { input.focus(); input.select(); }
    }
}

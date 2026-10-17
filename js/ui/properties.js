// Properties panel: edits the selected part. Rendering is data-driven so adding a
// part type means adding a row spec here, not another block of handlers.

class PropertiesPanel {
    constructor(editor, container) {
        this.editor = editor;
        this.el = null;
        this.before = null;
        this.handlers = {
            focusin: () => { this.before = editor.snapshot(); },
            input: (e) => this.onInput(e),
            change: (e) => this.onChange(e),
            click: (e) => this.onClick(e)
        };
        this.attach(container);
    }

    // (re)bind the panel to a container: it lives in a hidden store normally and is moved
    // into the Edit Component dialog while that is open
    attach(container) {
        if (this.el) for (const [type, fn] of Object.entries(this.handlers)) this.el.removeEventListener(type, fn);
        this.el = container;
        for (const [type, fn] of Object.entries(this.handlers)) container.addEventListener(type, fn);
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

    area(label, prop, value, rows = 3) {
        return `<div class="property"><label>${label}</label>
            <textarea data-prop="${prop}" rows="${rows}" spellcheck="false">${PropertiesPanel.esc(value)}</textarea></div>`;
    }

    check(label, prop, checked) {
        return `<div class="property"><label class="checkrow"><input type="checkbox" data-prop="${prop}" ${checked ? "checked" : ""}> ${label}</label></div>`;
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
        const type = c.type;
        let html = type === "TEXT" ? "" : this.text("Name", "name", c.name);

        if (type === "V") html += this.sourceRows(c, "V");
        else if (type === "I") html += this.sourceRows(c, "A");
        else if (type === "NODEIC") html += this.text("Voltage", "value", c.value, "0 V") +
            this.select("Use as", "mode", [["ic", "Initial condition (.ic): the start of a \"start from 0\" transient"], ["nodeset", "Starting guess (.nodeset): helps the DC solver find a bistable circuit's state"]], c.mode || "ic") +
            `<div class="prop-note">An initial condition forces the net's voltage at the start; a starting guess only picks where the solver begins looking, so it never changes a circuit that has a single solution.</div>`;
        else if (type === "CLAMP") {
            const targets = this.editor.components.filter(k => !["GND", "VM", "AM", "SCOPE", "CLAMP", "LOGAN", "NODEIC", "POWER", "NETLABEL", "PORT", "OFFSHEET", "TEXT", "SHEET", "BUSTAP"].includes(k.type) && !this.editor.isOverlay(k));
            html += this.select("Clamped on", "target", [["", "(nothing)"], ...targets.map(k => [String(k.id), k.name])], c.target === undefined ? "" : String(c.target), "The part whose current it reads. Placing the clamp next to a part attaches it.") +
                this.text("Sensitivity (V per A)", "sens", c.sens === undefined ? "0.1" : c.sens, "0.1 = 100 mV/A") +
                `<div class="prop-note">The output pin carries volts = amps x sensitivity. Wire it to a scope channel; the scope shows amps. The reading is the current of the clamped part as the simulator defines it (into its first pin).</div>`;
        }
        else if (type === "E") html += this.text("Voltage gain", "value", c.value, "10") + this.text("Bandwidth (Hz)", "bw", c.bw === undefined ? "" : c.bw, "blank = ideal (infinite)");
        else if (type === "G") html += this.text("Transconductance (S)", "value", c.value, "10m") + this.text("Bandwidth (Hz)", "bw", c.bw === undefined ? "" : c.bw, "blank = ideal (infinite)");
        else if (type === "SW") html += this.select("State", "closed", [["false", "Open"], ["true", "Closed"]], String(!!c.closed), "Double-click the switch to toggle it.");
        else if (type === "POT") html += this.text("Total resistance", "value", c.value, "10k") +
            `<div class="property"><label>Wiper position</label>
                <input type="range" data-prop="position" min="0" max="100" value="${Math.round((c.position === undefined ? 0.5 : c.position) * 100)}">
                <div class="prop-note">${Math.round((c.position === undefined ? 0.5 : c.position) * 100)}% from pin A</div></div>`;
        else if (type === "R") html += this.text("Resistance", "value", c.value, "e.g. 4.7k") + this.text("Tolerance (Monte Carlo)", "tol", c.tol || "", "e.g. 5 (%)");
        else if (type === "C") html += this.text("Capacitance", "value", c.value, "e.g. 10u") + this.text("Initial voltage (UIC)", "ic", c.ic || "", "0") + this.text("Tolerance (Monte Carlo)", "tol", c.tol || "", "e.g. 5 (%)");
        else if (type === "L") html += this.text("Inductance", "value", c.value, "e.g. 10m") + this.text("Initial current (UIC)", "ic", c.ic || "", "0") + this.text("Tolerance (Monte Carlo)", "tol", c.tol || "", "e.g. 5 (%)");

        const part = typeof PartLib !== "undefined" && PartLib.defs[type];
        if (part && part.rows) html += part.rows(this, c);

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
        if (["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "BUF"].includes(type)) {
            html += this.text("Supply (V)", "vcc", c.vcc === undefined ? "5" : c.vcc, "5");
        }
        if (type === "IC555") {
            html += `<div class="prop-note">NE555 timer: supply on VCC / GND, RESET is pulled high if left open.</div>`;
        }

        this.el.innerHTML = html;
    }

    sourceRows(c, unit) {
        const t = c.sourceType || "DC";
        const what = unit === "A" ? "Current" : "Voltage";
        let html = this.select("Source type", "sourceType",
            [["DC", `DC ${what.toLowerCase()}`], ["AC", "Sine wave"], ["PULSE", "Pulse (full control)"], ["SQUARE", "Square / clock"], ["TRIANGLE", "Triangle"],
             ["SAWTOOTH", "Sawtooth"], ["EXP", "Exponential"], ["SFFM", "Frequency modulated"], ["PWL", "Piecewise linear"]], t);

        if (t === "DC") {
            html += this.text(what, "dcVoltage", c.dcVoltage !== undefined ? this.fmt(c.dcVoltage, unit) : c.value, unit === "A" ? "1 mA" : "5 V");
            html += this.text("AC sweep magnitude", "acStim", c.acStim || "", "0 (set 1 to drive an AC sweep)");
        } else if (t === "AC") {
            html += this.text("Amplitude", "acMagnitude", this.fmt(c.acMagnitude, unit, unit === "A" ? "1 mA" : "5 V"), "5");
            html += this.text("DC offset", "dcOffset", this.fmt(c.dcOffset, unit, `0 ${unit}`), `0 ${unit}`);
            html += this.text("Frequency", "frequency", this.fmt(c.frequency, "Hz", "1 kHz"), "1 kHz");
            html += this.text("Phase (deg)", "acPhase", c.acPhase === undefined ? "0" : c.acPhase, "0");
        } else if (t === "SQUARE" || t === "TRIANGLE" || t === "SAWTOOTH") {
            const g = c.gen || {};
            html += this.text("Low level", "gen.low", this.fmt(g.low, unit, `0 ${unit}`), `0 ${unit}`);
            html += this.text("High level", "gen.high", this.fmt(g.high, unit, `5 ${unit}`), `5 ${unit}`);
            html += this.text("Frequency", "gen.freq", this.fmt(g.freq, "Hz", "1 kHz"), "1 kHz");
            if (t === "SQUARE") html += this.text("Duty cycle (%)", "gen.duty", g.duty === undefined ? "50" : g.duty, "50");
        } else if (t === "EXP") {
            const x = c.exp || {};
            html += this.text("Initial level", "exp.v1", this.fmt(x.v1, unit, `0 ${unit}`), `0 ${unit}`);
            html += this.text("Pulsed level", "exp.v2", this.fmt(x.v2, unit, `5 ${unit}`), `5 ${unit}`);
            html += this.text("Rise delay", "exp.td1", this.fmt(x.td1, "s", "0 s"), "0 s");
            html += this.text("Rise time constant", "exp.tau1", this.fmt(x.tau1, "s", "1 ms"), "1 ms");
            html += this.text("Fall delay", "exp.td2", this.fmt(x.td2, "s", "5 ms"), "5 ms");
            html += this.text("Fall time constant", "exp.tau2", this.fmt(x.tau2, "s", "1 ms"), "1 ms");
        } else if (t === "SFFM") {
            const x = c.sffm || {};
            html += this.text("Offset", "sffm.vo", this.fmt(x.vo, unit, `0 ${unit}`), `0 ${unit}`);
            html += this.text("Amplitude", "sffm.va", this.fmt(x.va, unit, `1 ${unit}`), `1 ${unit}`);
            html += this.text("Carrier frequency", "sffm.fc", this.fmt(x.fc, "Hz", "10 kHz"), "10 kHz");
            html += this.text("Modulation index", "sffm.mdi", x.mdi === undefined ? "5" : x.mdi, "5");
            html += this.text("Signal frequency", "sffm.fs", this.fmt(x.fs, "Hz", "1 kHz"), "1 kHz");
        } else if (t === "PWL") {
            html += this.text("Points (time value ...)", "pwl", c.pwl || "0 0 1m 5 2m 0", "0 0 1m 5 2m 0");
            html += this.text("AC sweep magnitude", "acStim", c.acStim || "", "0");
        } else {
            const p = c.pulse || {};
            html += this.text("Low level", "pulse.v1", this.fmt(p.v1, unit, `0 ${unit}`), `0 ${unit}`);
            html += this.text("High level", "pulse.v2", this.fmt(p.v2, unit, `5 ${unit}`), `5 ${unit}`);
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
        const u = c.type === "I" ? "A" : "V";
        const f = (v, unit) => (typeof v === "string" ? v : Units.formatSI(v, unit === "V" ? u : unit));
        const t = c.sourceType || "DC";
        if (t === "PWL") return "PWL";
        if (t === "EXP") return "EXP";
        if (t === "SFFM") return "FM";
        if (t === "SQUARE" || t === "TRIANGLE" || t === "SAWTOOTH") {
            const g = c.gen || {};
            return `${{ SQUARE: "SQ", TRIANGLE: "TRI", SAWTOOTH: "SAW" }[t]} ${f(g.freq === undefined ? 1000 : g.freq, "Hz")}`;
        }
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
        const dot = prop.indexOf(".");
        if (dot > 0) {
            const group = prop.slice(0, dot);
            comp[group] = comp[group] || {};
            comp[group][prop.slice(dot + 1)] = value;
        } else {
            comp[prop] = value;
        }
    }

    onInput(e) {
        const t = this.target(e);
        if (!t || e.target.tagName === "SELECT" || e.target.type === "checkbox") return;
        const { prop, comp } = t;
        const v = e.target.value;

        if (prop === "position") {
            comp.position = Number(v) / 100;
            const note = e.target.parentElement.querySelector(".prop-note");
            if (note) note.textContent = `${Math.round(comp.position * 100)}% from pin A`;
        } else {
            this.assign(comp, prop, v);
        }
        this.refreshLabel(comp);
        this.editor.draw();
    }

    onChange(e) {
        const t = this.target(e);
        if (!t) return;
        const { prop, comp } = t;
        const v = e.target.value;

        if (e.target.type === "checkbox") {
            this.assign(comp, prop, e.target.checked);
            if (prop === "busPins" && this.editor.pruneDanglingWires) this.editor.pruneDanglingWires(comp);
            this.refreshLabel(comp);
            this.commit();
        } else if (e.target.tagName === "SELECT") {
            this.assign(comp, prop, prop === "closed" ? v === "true" : v);
            if (prop === "model") {
                comp.value = v;
                if (SIM_MODELS[comp.type] && SIM_MODELS[comp.type][v]) delete comp.customParams;
            }
            if (prop === "sourceType") {
                // seed sensible defaults when switching waveform
                if (v === "PWL" && !comp.pwl) comp.pwl = "0 0 1m 5 2m 0";
                if (v === "PULSE" && !comp.pulse) comp.pulse = { v1: 0, v2: 5, delay: 0, rise: 1e-6, fall: 1e-6, width: 5e-4, period: 1e-3 };
                if (v === "AC" && comp.acMagnitude === undefined) comp.acMagnitude = 5;
                if (["SQUARE", "TRIANGLE", "SAWTOOTH"].includes(v) && !comp.gen) comp.gen = { low: 0, high: 5, freq: 1000, duty: 50 };
                if (v === "EXP" && !comp.exp) comp.exp = { v1: 0, v2: 5, td1: 0, tau1: 1e-3, td2: 5e-3, tau2: 1e-3 };
                if (v === "SFFM" && !comp.sffm) comp.sffm = { vo: 0, va: 1, fc: 10e3, mdi: 5, fs: 1e3 };
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

    // buttons inside the panel (a memory chip's Load file / Clear)
    onClick(e) {
        const b = e.target.closest && e.target.closest("button");
        if (!b || ["memload", "memclear", "memview", "mcuload", "mcuclear", "mcuview"].every(k => b.dataset[k] === undefined)) return;
        const comp = this.editor.selection[0];
        if (!comp) return;
        if (b.dataset.mcuview !== undefined) { McuWindow.open(this.editor, window.live, comp); return; }
        if (b.dataset.mcuclear !== undefined) { this.editor.saveState(); comp.src = ""; comp.hex = ""; comp.bps = []; this.editor.draw(); this.render(); this.before = this.editor.snapshot(); return; }
        if (b.dataset.mcuload !== undefined) {
            const inp = document.createElement("input");
            inp.type = "file"; inp.accept = ".asm,.inc,.s,.txt,.hex,.ihx";
            inp.onchange = () => {
                const file = inp.files[0];
                if (!file) return;
                const rd = new FileReader();
                rd.onload = () => {
                    const text = String(rd.result);
                    this.editor.saveState();
                    if (/\.(hex|ihx)$/i.test(file.name) || /^\s*:[0-9a-fA-F]{8}/.test(text)) { comp.hex = text.trim(); comp.src = ""; } else { comp.src = text; comp.hex = ""; }
                    comp.bps = []; this.editor.draw(); this.render(); this.before = this.editor.snapshot();
                };
                rd.readAsText(file);
            };
            inp.click();
            return;
        }
        if (b.dataset.memview !== undefined) { MemoryWindow.open(this.editor, window.live, comp); return; }
        const set = (text) => { this.editor.saveState(); comp.mem = text; this.refreshLabel(comp); this.editor.draw(); this.render(); this.before = this.editor.snapshot(); };
        if (b.dataset.memclear !== undefined) { set(""); return; }
        const input = document.createElement("input");
        input.type = "file"; input.accept = ".hex,.ihx,.bin,.rom,.txt,.mem";
        input.onchange = () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const bytes = new Uint8Array(reader.result);
                const asText = new TextDecoder().decode(bytes);
                // Intel HEX and plain hex text stay as text; anything else is a raw binary image
                const textual = /^\s*(:[0-9a-fA-F]{8}|[0-9a-fA-FxX$ ,;#\r\n:]*$)/.test(asText.slice(0, 200)) && !/\.(bin|rom)$/i.test(file.name);
                set(textual ? asText.trim() : Array.from(bytes, (v, i) => v.toString(16).padStart(2, "0") + ((i & 15) === 15 ? "\n" : " ")).join("").trim());
            };
            reader.readAsArrayBuffer(file);
        };
        input.click();
    }

    refreshLabel(comp) {
        if (comp.type === "V" || comp.type === "I") comp.value = PropertiesPanel.sourceLabel(comp);
        if (comp.type === "SW") comp.value = comp.closed ? "closed" : "open";
        const part = typeof PartLib !== "undefined" && PartLib.defs[comp.type];
        if (part && part.label) comp.value = part.label(comp);
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

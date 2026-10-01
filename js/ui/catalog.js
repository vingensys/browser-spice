// The parts library as the user sees it: named devices in categories, like ISIS's
// "Pick Devices" dialog. Generic parts are fixed; semiconductors come straight from
// SIM_MODELS, so models imported from vendor files show up here automatically.

const DeviceCatalog = {
    categories: [
        "Resistors", "Capacitors", "Inductors", "Diodes", "Optoelectronics", "Transistors",
        "Operational Amplifiers", "Analog ICs", "Switches & Relays", "Simulator Primitives", "Logic Gates"
    ],

    generics() {
        return [
            { name: "RES", category: "Resistors", type: "R", desc: "Generic resistor", props: { value: "1 kΩ" } },
            { name: "POT", category: "Resistors", type: "POT", desc: "Potentiometer (wiper position is adjustable)", props: { value: "10 kΩ", position: 0.5 } },
            { name: "CAP", category: "Capacitors", type: "C", desc: "Generic capacitor", props: { value: "100 nF" } },
            { name: "IND", category: "Inductors", type: "L", desc: "Generic inductor", props: { value: "10 mH" } },
            { name: "SWITCH", category: "Switches & Relays", type: "SW", desc: "SPST switch. Double-click to toggle.", props: { closed: false, value: "open" } },
            { name: "NE555", category: "Analog ICs", type: "IC555", desc: "NE555 timer (behavioural)", props: { value: "NE555" } },
            { name: "CELL", category: "Simulator Primitives", type: "V", desc: "DC voltage source", props: { sourceType: "DC", dcVoltage: 5, value: "5 V" } },
            { name: "ISOURCE", category: "Simulator Primitives", type: "I", desc: "DC current source", props: { sourceType: "DC", dcVoltage: 0.001, value: "1 mA" } },
            { name: "VCVS", category: "Simulator Primitives", type: "E", desc: "Voltage-controlled voltage source", props: { value: "10" } },
            { name: "VCCS", category: "Simulator Primitives", type: "G", desc: "Voltage-controlled current source", props: { value: "10 mS" } },
            ...["AND", "OR", "NOT", "NAND", "NOR", "XOR"].map(g => ({
                name: g, category: "Logic Gates", type: g, desc: `${g} gate (5 V logic, 10 ns delay)`, props: { vcc: "5" }
            }))
        ];
    },

    kindInfo: {
        D: { category: "Diodes", label: (n) => n },
        DZ: { category: "Diodes", label: (n) => `${n} (zener)` },
        LED: { category: "Optoelectronics", label: (n) => `LED-${n}` },
        BJT_NPN: { category: "Transistors", label: (n) => n },
        BJT_PNP: { category: "Transistors", label: (n) => n },
        NMOS: { category: "Transistors", label: (n) => n },
        PMOS: { category: "Transistors", label: (n) => n },
        OPAMP: { category: "Operational Amplifiers", label: (n) => n }
    },

    all() {
        const list = DeviceCatalog.generics();
        for (const [kind, info] of Object.entries(DeviceCatalog.kindInfo)) {
            for (const [model, def] of Object.entries(SIM_MODELS[kind] || {})) {
                const name = info.label(model);
                if (kind === "D" && SIM_MODELS.DZ && SIM_MODELS.DZ[model]) continue; // listed as a zener
                const props = { model, value: model };
                if (kind === "OPAMP") Object.assign(props, { vcc: "15", vee: "-15" });
                list.push({ name, category: info.category, type: kind, desc: def.desc + (def.imported ? " (imported)" : ""), props, model });
            }
        }
        return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    },

    find(name) { return DeviceCatalog.all().find(d => d.name === name) || null; },

    search(text, category) {
        const q = text.trim().toLowerCase();
        return DeviceCatalog.all().filter(d =>
            (!category || category === "(all)" || d.category === category) &&
            (!q || d.name.toLowerCase().includes(q) || d.desc.toLowerCase().includes(q) || d.type.toLowerCase() === q));
    },

    // lists shown for the other tool modes
    terminals() {
        return [
            { name: "GROUND", type: "GND", desc: "Ground reference (0 V)", props: {} },
            { name: "INITIAL COND", type: "NODEIC", desc: "Initial voltage of a net for 'start from 0' transients", props: { value: "0 V" } }
        ];
    },

    generators() {
        return [
            { name: "DC", type: "V", desc: "DC voltage source", props: { sourceType: "DC", dcVoltage: 5, value: "5 V" } },
            { name: "SINE", type: "V", desc: "Sine wave source", props: { sourceType: "AC", acMagnitude: 5, frequency: 1000, dcOffset: 0, acPhase: 0, value: "5 V @ 1 kHz" } },
            { name: "PULSE", type: "V", desc: "Pulse / square wave source", props: { sourceType: "PULSE", pulse: { v1: 0, v2: 5, delay: 0, rise: 1e-6, fall: 1e-6, width: 5e-4, period: 1e-3 }, value: "0 V/5 V @ 1 kHz" } },
            { name: "PWLIN", type: "V", desc: "Piecewise-linear source", props: { sourceType: "PWL", pwl: "0 0 1m 5 2m 5 3m 0", value: "PWL" } },
            { name: "DCURRENT", type: "I", desc: "DC current source", props: { sourceType: "DC", dcVoltage: 0.001, value: "1 mA" } },
            { name: "SCURRENT", type: "I", desc: "Sine current source", props: { sourceType: "AC", acMagnitude: 0.001, frequency: 1000, dcOffset: 0, acPhase: 0, value: "1 mA @ 1 kHz" } }
        ];
    },

    instruments() {
        return [
            { name: "VOLTMETER", type: "VM", desc: "DC voltmeter: reads the voltage across its pins while the simulation runs", props: { value: "" } },
            { name: "AMMETER", type: "AM", desc: "DC ammeter: put it in series; reads the current while the simulation runs", props: { value: "" } },
            { name: "OSCILLOSCOPE", type: "SCOPE", desc: "Four-channel oscilloscope: shows its inputs live while the simulation runs", props: { value: "" } }
        ];
    },

    graphs() {
        return [
            { name: "ANALOGUE", graph: "tran", desc: "Transient (time domain) analysis" },
            { name: "FREQUENCY", graph: "ac", desc: "Frequency response (AC sweep)" },
            { name: "DC SWEEP", graph: "sweep", desc: "DC sweep of a source" },
            { name: "OP", graph: "dc", desc: "DC operating point" }
        ];
    }
};

// Draws a symbol into a small canvas (device preview / pick dialog) using the same
// renderer as the sheet.
class SymbolPreview {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.zoom = 1;
        this.connectedPins = new Set();
        this.selection = [];
    }

    isSelected() { return false; }

    render(entry) {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, rect.width * dpr);
        this.canvas.height = Math.max(1, rect.height * dpr);
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = Theme.token("sheet");
        ctx.fillRect(0, 0, rect.width, rect.height);
        if (!entry || !entry.type || !SYMBOL_DEFS[entry.type]) return;

        const comp = Object.assign({ type: entry.type, x: 0, y: 0, rotation: 0, name: "", value: "" },
            JSON.parse(JSON.stringify(entry.props || {})));
        const box = this.getComponentBox(comp);
        const w = box.x2 - box.x1 + 40, h = box.y2 - box.y1 + 50;
        this.zoom = Math.min(rect.width / w, rect.height / h, 1.4);
        ctx.save();
        ctx.translate(rect.width / 2 - ((box.x1 + box.x2) / 2) * this.zoom, rect.height / 2 - ((box.y1 + box.y2) / 2) * this.zoom);
        ctx.scale(this.zoom, this.zoom);
        this.drawComponent(comp);
        ctx.restore();
    }
}

// the preview borrows the editor's geometry and the shared symbol renderer
for (const name of ["getSymbolDef", "rotateOffset", "getTerminals", "getTerminalPosition", "getComponentBox"]) {
    SymbolPreview.prototype[name] = SchematicEditor.prototype[name];
}
applyMixin(SymbolPreview, SymbolRenderer);

// Built-in example circuits. Each one builds real parts and wires, so it is a
// working schematic (move things, change values, re-simulate), not a picture.

class ExampleBuilder {
    constructor(editor) {
        this.ed = editor;
    }

    part(type, x, y, opts = {}) {
        const { rot = 0, ...props } = opts;
        const c = this.ed.addComponent(type, x, y, rot);
        if (c.x !== x || c.y !== y) console.warn(`example: ${type} moved from ${x},${y} to ${c.x},${c.y}`);
        Object.assign(c, props);
        if (type === "V" && !props.value) c.value = PropertiesPanel.sourceLabel(c);
        return c;
    }

    wire(a, pa, b, pb) {
        this.ed.wires.push({
            id: this.ed.nextId++,
            start: { type: "terminal", component: a.id, terminal: pa },
            end: { type: "terminal", component: b.id, terminal: pb },
            route: null
        });
    }

    pin(c, name) {
        return this.ed.getTerminalInfo(c.id, name).position;
    }

    vprobe(c, pin, label) {
        const p = this.pin(c, pin);
        this.ed.probes.push({ id: this.ed.nextId++, type: "V", label, x: p.x, y: p.y });
    }

    iprobe(c) {
        this.ed.probes.push({
            id: this.ed.nextId++, type: "I", target: c.id, targetName: c.name,
            label: `I(${c.name})`, x: c.x, y: c.y - 35
        });
    }

    finish() {
        this.ed.refreshWires();
        this.ed.fitView();
        this.ed.draw();
        this.ed.notify();
    }
}

const EXAMPLES = [
    {
        id: "rc-ladder",
        name: "RC ladder (transient)",
        note: "Press Run Transient: both capacitors charge through the resistors.",
        settings: { tStop: "50m", tStep: "50u" },
        build(b) {
            const y = 200;
            const v = b.part("V", 100, y, { dcVoltage: 10 });
            v.value = "10 V";
            const r1 = b.part("R", 240, y, { value: "1 kΩ" });
            const r2 = b.part("R", 380, y, { value: "2.2 kΩ" });
            const c1 = b.part("C", 520, y, { value: "10 µF" });
            const c2 = b.part("C", 660, y, { value: "4.7 µF" });
            const g = b.part("GND", 800, y + 80);
            b.wire(v, "2", r1, "1"); b.wire(r1, "2", r2, "1"); b.wire(r2, "2", c1, "1");
            b.wire(c1, "2", c2, "1"); b.wire(c2, "2", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(r1, "1", "V(in)"); b.vprobe(c1, "1", "V(c1)"); b.vprobe(c2, "1", "V(c2)");
        }
    },
    {
        id: "half-wave",
        name: "Half-wave rectifier + filter",
        note: "1N4007 rectifier on a 10 V / 50 Hz source. Run Transient to see the ripple.",
        settings: { tStop: "60m", tStep: "100u" },
        build(b) {
            const v = b.part("V", 120, 300, { rot: 270, sourceType: "AC", acMagnitude: 10, frequency: 50, dcOffset: 0, acPhase: 0 });
            const d = b.part("D", 260, 220, { model: "1N4007", value: "1N4007" });
            const r = b.part("R", 440, 320, { rot: 90, value: "1 kΩ" });
            const c = b.part("C", 560, 320, { rot: 90, value: "100 µF" });
            const g = b.part("GND", 440, 460);
            b.wire(v, "2", d, "1"); b.wire(d, "2", r, "1"); b.wire(d, "2", c, "1");
            b.wire(r, "2", g, "1"); b.wire(c, "2", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(v, "2", "V(in)"); b.vprobe(d, "2", "V(out)");
        }
    },
    {
        id: "led",
        name: "LED with current-limiting resistor",
        note: "Run DC: the resistor sets about 10 mA through a red LED.",
        settings: {},
        build(b) {
            const v = b.part("V", 120, 300, { rot: 270, dcVoltage: 5, value: "5 V" });
            const r = b.part("R", 260, 220, { value: "330 Ω" });
            const d = b.part("LED", 400, 300, { rot: 90, model: "RED", value: "RED" });
            const g = b.part("GND", 260, 440);
            b.wire(v, "2", r, "1"); b.wire(r, "2", d, "1"); b.wire(d, "2", g, "1"); b.wire(v, "1", g, "1");
            b.iprobe(r);
        }
    },
    {
        id: "zener",
        name: "Zener shunt regulator",
        note: "Run DC: 12 V is regulated to the 5.1 V zener voltage across the load.",
        settings: {},
        build(b) {
            const v = b.part("V", 120, 300, { rot: 270, dcVoltage: 12, value: "12 V" });
            const r = b.part("R", 260, 220, { value: "470 Ω" });
            const z = b.part("DZ", 400, 320, { rot: 270, model: "5V1", value: "5V1" });
            const rl = b.part("R", 540, 320, { rot: 90, value: "1 kΩ" });
            const g = b.part("GND", 400, 460);
            b.wire(v, "2", r, "1"); b.wire(r, "2", z, "2"); b.wire(r, "2", rl, "1");
            b.wire(z, "1", g, "1"); b.wire(rl, "2", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(rl, "1", "V(load)");
        }
    },
    {
        id: "ce-amp",
        name: "Common-emitter amplifier",
        note: "2N3904 stage with emitter bypass. Run Transient: the 5 mV input is amplified and inverted.",
        settings: { tStop: "4m", tStep: "5u" },
        build(b) {
            const vcc = b.part("V", 140, 200, { rot: 270, dcVoltage: 12, value: "12 V" });
            const vin = b.part("V", 100, 420, { rot: 270, sourceType: "AC", acMagnitude: 0.005, frequency: 1000, dcOffset: 0, acPhase: 0 });
            const cin = b.part("C", 240, 380, { value: "10 µF" });
            const r1 = b.part("R", 340, 200, { rot: 90, value: "47 kΩ" });
            const r2 = b.part("R", 340, 400, { rot: 90, value: "10 kΩ" });
            const rc = b.part("R", 480, 180, { rot: 90, value: "2.2 kΩ" });
            const q = b.part("BJT_NPN", 460, 320, { model: "2N3904", value: "2N3904" });
            const re = b.part("R", 480, 440, { rot: 90, value: "470 Ω" });
            const ce = b.part("C", 580, 440, { rot: 90, value: "100 µF" });
            const g = b.part("GND", 480, 560);
            b.wire(vcc, "2", r1, "1"); b.wire(vcc, "2", rc, "1");
            b.wire(r1, "2", q, "B"); b.wire(r2, "1", q, "B");
            b.wire(vin, "2", cin, "1"); b.wire(cin, "2", q, "B");
            b.wire(rc, "2", q, "C"); b.wire(q, "E", re, "1"); b.wire(q, "E", ce, "1");
            b.wire(r2, "2", g, "1"); b.wire(re, "2", g, "1"); b.wire(ce, "2", g, "1");
            b.wire(vcc, "1", g, "1"); b.wire(vin, "1", g, "1");
            b.vprobe(cin, "1", "V(in)"); b.vprobe(q, "C", "V(out)");
        }
    },
    {
        id: "inverting-opamp",
        name: "Inverting op-amp amplifier",
        note: "Gain = -Rf/Rin = -10. Run Transient to see a 0.5 V sine become -5 V peak.",
        settings: { tStop: "3m", tStep: "5u" },
        build(b) {
            const v = b.part("V", 100, 320, { rot: 270, sourceType: "AC", acMagnitude: 0.5, frequency: 1000, dcOffset: 0, acPhase: 0 });
            const r1 = b.part("R", 240, 260, { value: "1 kΩ" });
            const rf = b.part("R", 400, 160, { value: "10 kΩ" });
            const u = b.part("OPAMP", 440, 300, { model: "LM741", value: "LM741", vcc: "15", vee: "-15" });
            const rl = b.part("R", 580, 360, { rot: 90, value: "10 kΩ" });
            const g = b.part("GND", 300, 460);
            b.wire(v, "2", r1, "1"); b.wire(r1, "2", u, "IN-"); b.wire(rf, "1", r1, "2");
            b.wire(rf, "2", u, "OUT"); b.wire(u, "IN+", g, "1"); b.wire(rl, "1", u, "OUT");
            b.wire(rl, "2", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(r1, "1", "V(in)"); b.vprobe(u, "OUT", "V(out)");
        }
    },
    {
        id: "555-astable",
        name: "555 astable oscillator + LED",
        note: "Free-running 555 (about 690 Hz). Run Transient and probe the timing capacitor and output.",
        settings: { tStop: "10m", tStep: "5u" },
        build(b) {
            const v = b.part("V", 100, 260, { rot: 270, dcVoltage: 5, value: "5 V" });
            const u = b.part("IC555", 360, 300, { value: "NE555" });
            const r1 = b.part("R", 520, 180, { rot: 90, value: "1 kΩ" });
            const r2 = b.part("R", 520, 300, { rot: 90, value: "10 kΩ" });
            const c1 = b.part("C", 520, 420, { rot: 90, value: "100 nF" });
            const cc = b.part("C", 640, 380, { rot: 90, value: "10 nF" });
            const r3 = b.part("R", 180, 340, { value: "330 Ω" });
            const led = b.part("LED", 100, 420, { rot: 90, model: "RED", value: "RED" });
            const g = b.part("GND", 360, 540);
            b.wire(v, "2", u, "VCC"); b.wire(v, "2", u, "RESET"); b.wire(v, "2", r1, "1");
            b.wire(r1, "2", r2, "1"); b.wire(u, "DISCH", r2, "1");
            b.wire(r2, "2", u, "THRES"); b.wire(r2, "2", u, "TRIG"); b.wire(r2, "2", c1, "1");
            b.wire(u, "CTRL", cc, "1");
            b.wire(u, "OUT", r3, "2"); b.wire(r3, "1", led, "1");
            b.wire(u, "GND", g, "1"); b.wire(c1, "2", g, "1"); b.wire(cc, "2", g, "1");
            b.wire(led, "2", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(u, "OUT", "V(out)"); b.vprobe(u, "THRES", "V(cap)");
        }
    },
    {
        id: "boost",
        name: "Boost converter (switching)",
        note: "5 V to about 9.7 V with an IRF540 switched at 50 kHz. Run Transient for 5 ms.",
        settings: { tStop: "5m", tStep: "1u" },
        build(b) {
            const vin = b.part("V", 100, 300, { rot: 270, dcVoltage: 5, value: "5 V" });
            const l = b.part("L", 240, 200, { value: "100 µH" });
            const m = b.part("NMOS", 360, 320, { model: "IRF540", value: "IRF540" });
            const d = b.part("D", 480, 200, { model: "1N5819", value: "1N5819" });
            const c = b.part("C", 600, 320, { rot: 90, value: "100 µF" });
            const rl = b.part("R", 720, 320, { rot: 90, value: "50 Ω" });
            const vg = b.part("V", 220, 420, {
                rot: 270, sourceType: "PULSE",
                pulse: { v1: 0, v2: 10, delay: 0, rise: 20e-9, fall: 20e-9, width: 10e-6, period: 20e-6 }
            });
            const g = b.part("GND", 380, 520);
            b.wire(vin, "2", l, "1"); b.wire(l, "2", d, "1"); b.wire(l, "2", m, "D");
            b.wire(d, "2", c, "1"); b.wire(d, "2", rl, "1");
            b.wire(vg, "2", m, "G"); b.wire(m, "S", g, "1");
            b.wire(c, "2", g, "1"); b.wire(rl, "2", g, "1"); b.wire(vg, "1", g, "1"); b.wire(vin, "1", g, "1");
            b.vprobe(d, "2", "V(out)"); b.vprobe(m, "D", "V(sw)");
        }
    }
];

function loadExampleById(editor, id) {
    const ex = EXAMPLES.find(e => e.id === id) || EXAMPLES[0];

    editor.saveState();
    editor.setTool("select");
    editor.components = [];
    editor.wires = [];
    editor.probes = [];
    editor.nextId = 1;
    editor.clearSelection();
    editor.resetView();

    ex.build(new ExampleBuilder(editor));
    new ExampleBuilder(editor).finish();

    // push the example's suggested run settings into the toolbar
    for (const [key, value] of Object.entries(ex.settings || {})) {
        const input = document.getElementById(key === "tStop" ? "simTstop" : key === "tStep" ? "simTstep" : "");
        if (input) input.value = value;
    }
    return ex;
}

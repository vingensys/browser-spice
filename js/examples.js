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
        const w = {
            id: this.ed.nextId++,
            start: { type: "terminal", component: a.id, terminal: pa },
            end: { type: "terminal", component: b.id, terminal: pb },
            route: null
        };
        this.ed.wires.push(w);
        return w;
    }

    // a pin wired to a point on an existing wire (makes a junction, like clicking a wire in the editor)
    junction(a, pa, wire, x, y) {
        const w = {
            id: this.ed.nextId++,
            start: { type: "terminal", component: a.id, terminal: pa },
            end: { type: "wire", wireId: wire.id, x, y },
            route: null
        };
        this.ed.wires.push(w);
        return w;
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
        note: "Press Play (F12) for the live run, or Graph > Analogue Analysis for a full transient: both capacitors charge through the resistors.",
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
        note: "1N4007 rectifier on a 10 V / 50 Hz source. Press Play (F12) to watch the probes and the ripple.",
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
            // bias divider down x = 340, signal in from the left, collector load up, emitter network down
            const vcc = b.part("V", 60, 200, { rot: 270, dcVoltage: 12, value: "12 V" });
            const gv = b.part("GND", 60, 320);
            const vin = b.part("V", 140, 440, { rot: 270, sourceType: "AC", acMagnitude: 0.005, frequency: 1000, dcOffset: 0, acPhase: 0 });
            const gi = b.part("GND", 140, 560);
            const cin = b.part("C", 240, 320, { value: "10 µF" });
            const r1 = b.part("R", 340, 200, { rot: 90, value: "47 kΩ" });
            const r2 = b.part("R", 340, 400, { rot: 90, value: "10 kΩ" });
            const rc = b.part("R", 480, 200, { rot: 90, value: "2.2 kΩ" });
            const q = b.part("BJT_NPN", 460, 320, { model: "2N3904", value: "2N3904" });
            const re = b.part("R", 480, 440, { rot: 90, value: "470 Ω" });
            const ce = b.part("C", 600, 440, { rot: 90, value: "100 µF" });
            const g = b.part("GND", 480, 560);
            b.wire(vcc, "2", r1, "1"); b.wire(r1, "1", rc, "1");
            const bias = b.wire(r1, "2", r2, "1");            // the divider; the base and the coupling capacitor tap it
            b.junction(q, "B", bias, 340, 320); b.junction(cin, "2", bias, 340, 320);
            b.wire(vin, "2", cin, "1");
            b.wire(rc, "2", q, "C"); b.wire(q, "E", re, "1"); b.wire(q, "E", ce, "1");
            b.wire(re, "2", g, "1"); b.wire(ce, "2", re, "2"); b.wire(r2, "2", re, "2");
            b.wire(vcc, "1", gv, "1"); b.wire(vin, "1", gi, "1");
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
            // supply and LED on the left, the timing network in a column on the right
            const v = b.part("V", 100, 260, { rot: 270, dcVoltage: 5, value: "5 V" });
            const u = b.part("IC555", 400, 320, { value: "NE555" });
            const r1 = b.part("R", 560, 200, { rot: 90, value: "1 kΩ" });
            const r2 = b.part("R", 560, 320, { rot: 90, value: "10 kΩ" });
            const c1 = b.part("C", 560, 440, { rot: 90, value: "100 nF" });
            const cc = b.part("C", 680, 440, { rot: 90, value: "10 nF" });
            const r3 = b.part("R", 200, 340, { value: "330 Ω" });
            const led = b.part("LED", 100, 420, { rot: 90, model: "RED", value: "RED" });
            const g = b.part("GND", 400, 560);
            const gu = b.part("GND", 280, 240);
            b.wire(v, "2", r1, "1"); b.wire(r1, "1", u, "VCC"); b.wire(v, "2", u, "RESET");
            b.wire(r1, "2", r2, "1"); b.wire(u, "DISCH", r1, "2");
            b.wire(r2, "2", u, "THRES"); b.wire(u, "THRES", u, "TRIG"); b.wire(r2, "2", c1, "1");
            b.wire(u, "CTRL", cc, "1");
            b.wire(u, "OUT", r3, "2"); b.wire(r3, "1", led, "1");
            b.wire(u, "GND", gu, "1"); b.wire(c1, "2", g, "1"); b.wire(cc, "2", g, "1");
            b.wire(led, "2", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(u, "OUT", "V(out)"); b.vprobe(u, "THRES", "V(cap)");
        }
    },
    {
        id: "diode-iv",
        name: "Diode I-V curve (DC sweep)",
        note: "Press DC Sweep: V1 sweeps 0 to 1 V and the probe plots the diode current (the exponential knee near 0.6 V).",
        settings: {},
        sweep: { start: "0", stop: "1", step: "0.01" },
        build(b) {
            const v = b.part("V", 120, 260, { rot: 270, dcVoltage: 0, value: "0 V" });
            const r = b.part("R", 260, 180, { value: "1 Ω" });
            const d = b.part("D", 400, 260, { rot: 90, model: "1N4148", value: "1N4148" });
            const g = b.part("GND", 260, 400);
            b.wire(v, "2", r, "1"); b.wire(r, "2", d, "1"); b.wire(d, "2", g, "1"); b.wire(v, "1", g, "1");
            b.iprobe(d);
        }
    },
    {
        id: "pot-divider",
        name: "Potentiometer divider + switch",
        note: "Run DC, then change the wiper in the Properties panel or double-click the switch to connect the load.",
        settings: {},
        build(b) {
            const v = b.part("V", 120, 300, { rot: 270, dcVoltage: 10, value: "10 V" });
            const p = b.part("POT", 300, 240, { value: "10 kΩ", position: 0.25 });
            const sw = b.part("SW", 480, 140, { closed: true, value: "closed" });
            const rl = b.part("R", 620, 300, { rot: 90, value: "10 kΩ" });
            const g = b.part("GND", 300, 440);
            b.wire(v, "2", p, "A"); b.wire(p, "B", g, "1"); b.wire(p, "W", sw, "1");
            b.wire(sw, "2", rl, "1"); b.wire(rl, "2", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(p, "W", "V(wiper)");
        }
    },
    {
        id: "instruments",
        name: "Virtual instruments (meters + scope)",
        note: "Press Play (F12): the ammeter, voltmeter and oscilloscope read the RC circuit live. Double-click a part to change its value.",
        settings: { tStop: "30m", tStep: "20u" },
        build(b) {
            const v = b.part("V", 120, 300, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 5, delay: 0, rise: 1e-6, fall: 1e-6, width: 5e-3, period: 10e-3 } });
            const r = b.part("R", 260, 200, { value: "1 kΩ" });
            const am = b.part("AM", 400, 200, {});
            const c = b.part("C", 540, 300, { rot: 90, value: "2.2 µF" });
            const vm = b.part("VM", 660, 300, { rot: 90 });
            const sc = b.part("SCOPE", 860, 240, {});
            const g = b.part("GND", 400, 440);
            b.wire(v, "2", r, "1"); b.wire(r, "2", am, "+"); b.wire(am, "-", c, "1");
            b.wire(c, "1", vm, "+"); b.wire(vm, "-", g, "1"); b.wire(c, "2", g, "1"); b.wire(v, "1", g, "1");
            b.wire(sc, "A", r, "1"); b.wire(sc, "B", c, "1");
        }
    },
    {
        id: "psu",
        name: "Power supply (transformer, bridge, 7805)",
        note: "36 V / 50 Hz mains-style source, 2:1 transformer, bridge rectifier, 1000 µF reservoir and a 7805. Press Play: the probes show the ripple and the regulated 5 V.",
        settings: { tStop: "80m", tStep: "100u" },
        build(b) {
            const v = b.part("V", 100, 360, { rot: 270, sourceType: "AC", acMagnitude: 36, frequency: 50, dcOffset: 0, acPhase: 0 });
            const tr = b.part("XFMR", 300, 360, { l1: "5", ratio: "0.5", k: "0.999", rp: "0.5", rs: "0.5", value: "2:1" });
            const br = b.part("BRIDGE", 500, 360, {});
            const c1 = b.part("ECAP", 640, 440, { rot: 90, value: "1000 µF" });
            const reg = b.part("REG", 800, 320, {});
            const rl = b.part("R", 960, 440, { rot: 90, value: "100 Ω" });
            const g = b.part("GND", 640, 580);
            b.wire(v, "2", tr, "P1"); b.wire(v, "1", g, "1"); b.wire(tr, "P2", g, "1");
            b.wire(tr, "S1", br, "AC1"); b.wire(tr, "S2", br, "AC2");
            b.wire(br, "-", g, "1"); b.wire(br, "+", c1, "1"); b.wire(br, "+", reg, "IN");
            b.wire(c1, "2", g, "1"); b.wire(reg, "GND", g, "1");
            b.wire(reg, "OUT", rl, "1"); b.wire(rl, "2", g, "1");
            b.vprobe(c1, "1", "V(unreg)"); b.vprobe(reg, "OUT", "V(out)");
        }
    },
    {
        id: "jfet-amp",
        name: "JFET common-source amplifier",
        note: "Self-biased N-channel JFET (J201). Run AC for the frequency response (gain in dB and phase) or Play for the live waveforms.",
        settings: { tStop: "2m", tStep: "2u" },
        build(b) {
            const vdd = b.part("V", 100, 280, { rot: 270, dcVoltage: 15, value: "15 V" });
            const rd = b.part("R", 420, 200, { rot: 90, value: "10 kΩ" });
            const j = b.part("JFET_N", 420, 360, {});
            const rs = b.part("R", 440, 500, { rot: 90, value: "1 kΩ" });
            const cs = b.part("C", 580, 500, { rot: 90, value: "100 µF" });
            const vin = b.part("V", 100, 480, { rot: 270, sourceType: "AC", acMagnitude: 0.05, frequency: 1000, dcOffset: 0, acPhase: 0 });
            const cin = b.part("C", 260, 360, { value: "1 µF" });
            const rg = b.part("R", 320, 500, { rot: 90, value: "1 MΩ" });
            const g = b.part("GND", 440, 620);
            b.wire(vdd, "2", rd, "1"); b.wire(rd, "2", j, "D"); b.wire(j, "S", rs, "1"); b.wire(j, "S", cs, "1");
            b.wire(vin, "2", cin, "1"); b.wire(cin, "2", j, "G"); b.wire(rg, "1", j, "G");
            b.wire(rs, "2", g, "1"); b.wire(cs, "2", g, "1"); b.wire(rg, "2", g, "1");
            b.wire(vin, "1", g, "1"); b.wire(vdd, "1", g, "1");
            b.vprobe(cin, "1", "V(in)"); b.vprobe(j, "D", "V(out)");
        }
    },
    {
        id: "relay-driver",
        name: "Relay driver with lamp",
        note: "A 5 V logic pulse switches a 2N2222 that drives a 12 V relay; its contact lights a 12 V lamp. The 1N4007 absorbs the coil's kick. Press Play.",
        settings: { tStop: "80m", tStep: "50u" },
        build(b) {
            // coil and flyback diode in the middle, driver transistor below, lamp on the contact to the right
            const vcc = b.part("V", 100, 300, { rot: 270, dcVoltage: 12, value: "12 V" });
            const g1 = b.part("GND", 100, 380);
            const k = b.part("RELAY", 420, 260, { model: "12V", value: "12V" });
            const d = b.part("D", 280, 260, { rot: 270, model: "1N4007", value: "1N4007" });
            const q = b.part("BJT_NPN", 420, 420, {});
            const rb = b.part("R", 260, 420, { value: "4.7 kΩ" });
            const vin = b.part("V", 100, 500, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 5, delay: 5e-3, rise: 1e-6, fall: 1e-6, width: 30e-3, period: 60e-3 } });
            const lamp = b.part("LAMP", 600, 300, { rot: 90, vrated: "12", prated: "5", value: "12 V 5 W" });
            const g = b.part("GND", 440, 560);
            const g2 = b.part("GND", 100, 600);
            const g3 = b.part("GND", 600, 420);
            b.wire(vcc, "2", k, "C1"); b.wire(vcc, "2", k, "COIL+");
            b.wire(d, "2", k, "COIL+"); b.wire(d, "1", k, "COIL-");
            b.wire(k, "COIL-", q, "C"); b.wire(q, "E", g, "1");
            b.wire(vin, "2", rb, "1"); b.wire(rb, "2", q, "B");
            b.wire(k, "C2", lamp, "1"); b.wire(lamp, "2", g3, "1");
            b.wire(vcc, "1", g1, "1"); b.wire(vin, "1", g2, "1");
            b.vprobe(k, "COIL-", "V(coil)"); b.vprobe(lamp, "1", "V(lamp)");
        }
    },
    {
        id: "scr-lamp",
        name: "SCR phase control (lamp)",
        note: "An SCR fires part-way through each positive half-cycle and latches until the current falls. Press Play to see the lamp glow.",
        settings: { tStop: "60m", tStep: "50u" },
        build(b) {
            const v = b.part("V", 100, 340, { rot: 270, sourceType: "AC", acMagnitude: 24, frequency: 50, dcOffset: 0, acPhase: 0 });
            const lamp = b.part("LAMP", 320, 240, { vrated: "12", prated: "10", value: "12 V 10 W" });
            const scr = b.part("SCR", 520, 340, { rot: 90, model: "C106D", value: "C106D" });
            const vg = b.part("V", 300, 520, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 4, delay: 3e-3, rise: 1e-6, fall: 1e-6, width: 0.5e-3, period: 20e-3 } });
            const rg = b.part("R", 440, 460, { value: "100 Ω" });
            const g = b.part("GND", 520, 600);
            b.wire(v, "2", lamp, "1"); b.wire(lamp, "2", scr, "A"); b.wire(scr, "K", g, "1");
            b.wire(vg, "2", rg, "1"); b.wire(rg, "2", scr, "G");
            b.wire(vg, "1", g, "1"); b.wire(v, "1", g, "1");
            b.vprobe(lamp, "2", "V(scr)"); b.vprobe(v, "2", "V(in)");
        }
    },
    {
        id: "logic-analyser",
        name: "Logic analyser on a ripple counter",
        note: "Press Play, then double-click the logic analyser: the clock and the three counter outputs as digital traces. Try the trigger, cursors (bus value in hex) and Auto set.",
        settings: { tStop: "10m", tStep: "10u" },
        build(b) {
            const ck = b.part("V", 100, 360, { rot: 270, sourceType: "SQUARE", gen: { low: 0, high: 5, freq: 1000, duty: 50 } });
            const ff = [0, 1, 2].map(i => b.part("DFF", 340 + i * 280, 360, {}));
            const g = b.part("GND", 100, 560);
            b.wire(ck, "2", ff[0], "CLK"); b.wire(ck, "1", g, "1");
            ff.forEach((f, i) => {
                b.wire(f, "QN", f, "D");
                if (i < 2) b.wire(f, "QN", ff[i + 1], "CLK");
                const gs = b.part("GND", f.x - 20, 560); const gr = b.part("GND", f.x + 20, 620);
                b.wire(f, "S", gs, "1"); b.wire(f, "R", gr, "1");
            });
            const la = b.part("LOGAN", 1300, 360, {});
            b.wire(la, "D0", ck, "2");
            ff.forEach((f, i) => b.wire(la, `D${i + 1}`, f, "Q"));
        }
    },
    {
        id: "ripple-counter",
        name: "3-bit ripple counter (flip-flops)",
        note: "Three D flip-flops, each wired D = QN and clocked by the previous QN, divide a 1 kHz clock by 2, 4 and 8. Press Play.",
        settings: { tStop: "10m", tStep: "10u" },
        build(b) {
            const ck = b.part("V", 100, 360, { rot: 270, sourceType: "SQUARE", gen: { low: 0, high: 5, freq: 1000, duty: 50 } });
            const ff = [0, 1, 2].map(i => b.part("DFF", 340 + i * 280, 360, {}));
            const g = b.part("GND", 100, 560);
            b.wire(ck, "2", ff[0], "CLK"); b.wire(ck, "1", g, "1");
            ff.forEach((f, i) => {
                b.wire(f, "QN", f, "D");
                if (i < 2) b.wire(f, "QN", ff[i + 1], "CLK");
                const gs = b.part("GND", f.x - 20, 560); const gr = b.part("GND", f.x + 20, 620);
                b.wire(f, "S", gs, "1"); b.wire(f, "R", gr, "1");
            });
            ff.forEach((f, i) => {
                const r = b.part("R", f.x + 140, 460, { rot: 90, value: "10 kΩ" });
                const gq = b.part("GND", f.x + 140, 580);
                b.wire(f, "Q", r, "1"); b.wire(r, "2", gq, "1");
                b.vprobe(f, "Q", `Q${i}`);
            });
        }
    },
    {
        id: "counter-7seg",
        name: "Counter with 7-segment display (74161 + 7447)",
        note: "A 10 Hz clock drives a 74161 4-bit counter; a 7447 decodes it for a common-anode display. Press Play: the digit counts 0 to F (live speed 0.1x = about one count per second). Open inputs need no wires.",
        settings: { tStop: "2", tStep: "1m" },
        build(b) {
            const ck = b.part("V", 140, 360, { rot: 270, sourceType: "SQUARE", gen: { low: 0, high: 5, freq: 10, duty: 50 } });
            const g = b.part("GND", 140, 460);
            const cnt = b.part("74161", 400, 360, {});
            const dec = b.part("7447", 700, 340, {});
            const ds = b.part("SEG7", 1000, 340, { common: "anode", color: "RED", value: "7SEG-CA" });
            const rl = b.part("R", 1140, 320, { rot: 90, value: "100 Ω" });
            const vcc = b.part("POWER", 1140, 220, { net: "VCC", volts: "5" });
            b.wire(ck, "2", cnt, "CLK"); b.wire(ck, "1", g, "1");
            ["QA", "QB", "QC", "QD"].forEach((q, i) => b.wire(cnt, q, dec, "ABCD"[i]));
            "abcdefg".split("").forEach(sg => b.wire(dec, sg, ds, sg));
            b.wire(ds, "COM", rl, "2"); b.wire(rl, "1", vcc, "1");
            ["QA", "QB", "QC", "QD"].forEach((q, i) => b.vprobe(cnt, q, q));
        }
    },
    {
        id: "shift-register",
        name: "Shift register (74164 serial in, parallel out)",
        note: "A single 1 is clocked into a 74164 and marches along its eight outputs. Press Play and watch the LIVE graph, or run a transient.",
        settings: { tStop: "1.6", tStep: "1m" },
        build(b) {
            const ck = b.part("V", 140, 380, { rot: 270, sourceType: "SQUARE", gen: { low: 0, high: 5, freq: 10, duty: 50 } });
            const data = b.part("V", 140, 560, { rot: 270, sourceType: "PULSE", pulse: { v1: 0, v2: 5, delay: 0.02, rise: 1e-4, fall: 1e-4, width: 0.1, period: 1 } });
            const g1 = b.part("GND", 140, 460), g2 = b.part("GND", 140, 640);
            const sr = b.part("74164", 460, 440, {});
            const vcc = b.part("POWER", 300, 280, { net: "VCC", volts: "5" });
            b.wire(data, "2", sr, "A"); b.wire(vcc, "1", sr, "B"); b.wire(ck, "2", sr, "CLK");
            b.wire(ck, "1", g1, "1"); b.wire(data, "1", g2, "1");
            "ABCDEFGH".split("").forEach(c => b.vprobe(sr, "Q" + c, "Q" + c));
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

// Build an example off-sheet and return it as a clipboard block, leaving the design, its undo
// history and the view untouched. The caller then pastes it (editor.beginPaste) next to what is there.
function exampleAsClipboard(editor, id) {
    const ex = EXAMPLES.find(e => e.id === id);
    if (!ex) return null;
    const saved = editor.snapshot();
    const view = { zoom: editor.zoom, panX: editor.panX, panY: editor.panY };
    const history = [editor.historyStack, editor.futureStack];
    try {
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        editor.clearSelection();
        ex.build(new ExampleBuilder(editor));
        editor.refreshWires();
        return { clip: editor.clipboardFrom(editor.components), ex };
    } finally {
        editor.restore(saved);
        Object.assign(editor, view);
        [editor.historyStack, editor.futureStack] = history;
        editor.draw();
    }
}

function loadExampleById(editor, id) {
    const ex = EXAMPLES.find(e => e.id === id) || EXAMPLES[0];

    editor.saveState();
    editor.setTool("select");
    editor.resetSheets(); if (typeof sheetBar !== "undefined" && sheetBar) sheetBar.render();
    editor.components = [];
    editor.wires = [];
    editor.probes = [];
    editor.nextId = 1;
    editor.clearSelection();
    editor.resetView();

    ex.build(new ExampleBuilder(editor));
    new ExampleBuilder(editor).finish();

    // push the example's suggested sweep range
    if (ex.sweep) {
        for (const [id, v] of [["sweepStart", ex.sweep.start], ["sweepStop", ex.sweep.stop], ["sweepStep", ex.sweep.step]]) {
            const input = document.getElementById(id);
            if (input) input.value = v;
        }
    }

    // push the example's suggested run settings into the toolbar
    for (const [key, value] of Object.entries(ex.settings || {})) {
        const input = document.getElementById(key === "tStop" ? "simTstop" : key === "tStep" ? "simTstep" : "");
        if (input) input.value = value;
    }
    return ex;
}

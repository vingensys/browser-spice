// Parts beyond the core set, defined once each: symbol (pins + body), artwork, property
// rows, the simulation elements they expand to, library entries and live displays.
// The editor, renderer, properties panel, netlist extractor and catalog look a part up
// here when they meet a type they do not handle themselves.
//
//   PartLib.defs[type] = {
//     prefix, value, props, symbol: { pins, box }, draw(r, c), label(c), rows(panel, c),
//     netlist(c, k) -> neutral elements, live(c, run), catalog: [{ name, category, desc, props }]
//   }

const PartLib = {
    defs: {},

    add(type, def) {
        PartLib.defs[type] = def;
        SYMBOL_DEFS[type] = def.symbol;
        SchematicEditor.REF_PREFIX[type] = def.prefix;
        return def;
    },

    // component fields a freshly placed part starts with
    defaults(type) {
        const d = PartLib.defs[type];
        return d ? JSON.parse(JSON.stringify(d.props || {})) : null;
    },

    catalog() {
        return Object.entries(PartLib.defs).flatMap(([type, d]) => (d.catalog || []).map(e => ({ type, ...e })));
    },

    // helpers handed to netlist(): pin lookup, SI parsing with a fallback, sub-element names
    kit(comp, nets, P, editor = null) {
        const num = (v, fallback) => (v === undefined || v === null || v === "" ? fallback : (isFinite(Units.parseSI(v)) ? Units.parseSI(v) : fallback));
        return {
            pin: (name) => nets.terminalNode(comp, name) || "0",
            P, num, editor,
            base: { name: comp.name, comp },
            sub: (s) => `${comp.name}_${s}`,
            node: (s) => `${comp.name}_${s}`
        };
    }
};


// ----------------------------------------------------------------- artwork

class PartRenderer {

    // Part-specific artwork; the caller (drawComponent) has already translated / rotated.
    drawPart(component) {
        const def = PartLib.defs[component.type];
        if (def) def.draw(this, component);
    }

    partLine(points, color, width = 3) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col(color);
        ctx.lineWidth = this.lw(width);
        ctx.beginPath();
        points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
    }

    partText(text, x, y, { size = 11, bold = false, color = "#e8edf5", align = "center", base = "middle" } = {}) {
        const ctx = this.ctx;
        ctx.font = `${bold ? "bold " : ""}${size}px system-ui`;
        ctx.fillStyle = this.col(color);
        ctx.textAlign = align;
        ctx.textBaseline = base;
        ctx.fillText(text, x, y);
    }

    // rectangular IC body with the pin names written inside, ISIS style
    partIC(component, rect, color, { title = "", names = true } = {}) {
        const ctx = this.ctx;
        const [x, y, w, h] = rect;
        ctx.strokeStyle = this.col(color);
        ctx.fillStyle = this.col("#171b23");
        ctx.lineWidth = this.lw(3);
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.stroke();
        for (const [name, px, py, dx, dy] of this.getSymbolDef(component).pins) {
            // lead from the pin to the body edge
            const ex = dx !== 0 ? (dx < 0 ? x : x + w) : px;
            const ey = dy !== 0 ? (dy < 0 ? y : y + h) : py;
            this.partLine([[px, py], [ex, ey]], color);
            if (names) this.partText(name, ex - dx * 4, ey - dy * 8, { size: 9, color: "#9aa4b5", align: dx < 0 ? "left" : dx > 0 ? "right" : "center" });
        }
        if (title) this.partText(title, x + w / 2, y + h / 2, { size: 12, bold: true, color });
    }

    triangle(pts, color, fill = true) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col(color);
        ctx.fillStyle = this.col(color);
        ctx.lineWidth = this.lw(3);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        if (fill) ctx.fill();
        ctx.stroke();
    }
}
applyMixin(SchematicEditor, PartRenderer);
applyMixin(SymbolPreview, PartRenderer);


// ========================================================= text annotations

PartLib.measure = (font, lines) => {
    PartLib._measureCtx = PartLib._measureCtx || document.createElement("canvas").getContext("2d");
    const c = PartLib._measureCtx;
    c.font = font;
    return Math.max(...lines.map(l => c.measureText(l).width), 4);
};

PartLib.COLORS = { auto: null, red: "#d32f2f", blue: "#1565c0", green: "#2e7d32", orange: "#ef6c00", grey: "#757575" };

const textLines = (c) => String(c.text === undefined ? "Text" : c.text).split("\n");
const textFont = (c) => `${c.bold ? "bold " : ""}${c.italic ? "italic " : ""}${Number(c.size) || 14}px system-ui`;

PartLib.add("TEXT", {
    prefix: "TXT", value: "Text", props: { text: "Text", size: 14, bold: false, italic: false, color: "auto", align: "left" },
    symbol: {
        pins: [], box: [0, 0, 60, 20], overlay: true,
        // the box follows the text so it can be selected, moved and hit-tested
        dynamic: (c) => {
            const size = Number(c.size) || 14, lines = textLines(c);
            const w = Math.ceil(PartLib.measure(textFont(c), lines)) + 6, h = Math.ceil(lines.length * size * 1.25) + 4;
            return { pins: [], box: [0, 0, w, h], overlay: true };
        }
    },
    label: (c) => String(c.text || "").split("\n")[0].slice(0, 24),
    draw(r, c) {
        const ctx = r.ctx, size = Number(c.size) || 14, lines = textLines(c);
        const w = Math.ceil(PartLib.measure(textFont(c), lines));
        const color = PartLib.COLORS[c.color] || r.tok("label");
        ctx.font = textFont(c);
        ctx.fillStyle = color;
        ctx.textBaseline = "top";
        lines.forEach((line, i) => {
            const tw = ctx.measureText(line).width;
            const x = c.align === "center" ? 3 + (w - tw) / 2 : c.align === "right" ? 3 + (w - tw) : 3;
            ctx.textAlign = "left";
            ctx.fillText(line, x, 2 + i * size * 1.25);
        });
    },
    rows: (p, c) => p.area("Text", "text", c.text === undefined ? "Text" : c.text, 4) +
        p.select("Size", "size", [8, 10, 12, 14, 18, 24, 36, 48].map(n => [String(n), `${n} px`]), String(Number(c.size) || 14)) +
        p.select("Colour", "color", [["auto", "Automatic"], ["red", "Red"], ["blue", "Blue"], ["green", "Green"], ["orange", "Orange"], ["grey", "Grey"]], c.color || "auto") +
        p.select("Alignment", "align", [["left", "Left"], ["center", "Centre"], ["right", "Right"]], c.align || "left") +
        p.check("Bold", "bold", !!c.bold) + p.check("Italic", "italic", !!c.italic) +
        `<div class="prop-note">Notes are ignored by the simulator and never block parts or wires. R rotates them.</div>`,
    netlist() { return []; },
    catalog: [{ name: "TEXT", category: "Annotations", desc: "Text note on the sheet (also: press A)", props: { text: "Text", size: 14, value: "Text" } }]
});

// ============================================================== simple parts

const TWO = { pins: [["1", -40, 0, -1, 0], ["2", 40, 0, 1, 0]], box: [-40, -30, 40, 30] };
const lead2 = (r, c, a = 16, b = a) => r.partLine([[-40, 0], [-a, 0]], c) || r.partLine([[b, 0], [40, 0]], c);

PartLib.add("LAMP", {
    prefix: "LP", value: "12 V 5 W", props: { vrated: "12", prated: "5" }, symbol: TWO,
    label: (c) => `${c.vrated || 12} V ${c.prated || 5} W`,
    draw(r, c) {
        const ctx = r.ctx;
        lead2(r, "#f1fa8c", 18);
        ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.fillStyle = r.col(`rgba(255, 230, 90, ${(c.glow || 0) * 0.9})`);
        if (c.glow) ctx.fill();
        ctx.strokeStyle = r.col("#f1fa8c"); ctx.lineWidth = r.lw(3); ctx.stroke();
        r.partLine([[-13, -13], [13, 13]], "#f1fa8c", 2); r.partLine([[13, -13], [-13, 13]], "#f1fa8c", 2);
        r.drawLabel(c);
    },
    rows: (p, c) => p.text("Rated voltage (V)", "vrated", c.vrated, "12") + p.text("Rated power (W)", "prated", c.prated, "5") +
        `<div class="prop-note">A resistor of V²/P that glows with the power it dissipates.</div>`,
    netlist(c, k) {
        const v = k.num(c.vrated, 12), pw = k.num(c.prated, 5);
        return [{ ...k.base, kind: "R", nodes: [k.pin("1"), k.pin("2")], params: { r: Math.max(v * v / Math.max(pw, 1e-9), 1e-3) } }];
    },
    live(c, run) { c.glow = Math.min(1, run.current(c.name) ** 2 * (Units.parseSI(c.vrated) ** 2 / Units.parseSI(c.prated)) / Units.parseSI(c.prated)) || 0; },
    catalog: [
        { name: "LAMP", category: "Miscellaneous", desc: "Incandescent lamp, glows with its dissipation", props: { vrated: "12", prated: "5", value: "12 V 5 W" } }
    ]
});

PartLib.add("BUZZER", {
    prefix: "BZ", value: "BUZZER", props: { rbuzz: "50" }, symbol: TWO,
    label: () => "BUZZER",
    draw(r, c) {
        const ctx = r.ctx;
        lead2(r, "#ffb86c", 16);
        ctx.strokeStyle = r.col("#ffb86c"); ctx.lineWidth = r.lw(3);
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke();
        r.partText("♪", 0, 1, { size: 18, color: "#ffb86c" });
        r.drawLabel(c);
    },
    rows: (p, c) => p.text("Coil resistance (Ω)", "rbuzz", c.rbuzz, "50"),
    netlist(c, k) { return [{ ...k.base, kind: "R", nodes: [k.pin("1"), k.pin("2")], params: { r: Math.max(k.num(c.rbuzz, 50), 1e-3) } }]; },
    catalog: [{ name: "BUZZER", category: "Miscellaneous", desc: "Piezo / electromagnetic buzzer modelled by its coil resistance", props: { rbuzz: "50", value: "BUZZER" } }]
});

PartLib.add("MOTOR", {
    prefix: "M", value: "MOTOR", props: { ra: "1.5", la: "2m" }, symbol: TWO,
    label: () => "MOTOR",
    draw(r, c) {
        const ctx = r.ctx;
        lead2(r, "#50fa7b", 20);
        ctx.strokeStyle = r.col("#50fa7b"); ctx.lineWidth = r.lw(3);
        ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.stroke();
        r.partText("M", 0, 1, { size: 20, bold: true, color: "#50fa7b" });
        r.drawLabel(c);
    },
    rows: (p, c) => p.text("Armature resistance (Ω)", "ra", c.ra, "1.5") + p.text("Armature inductance (H)", "la", c.la, "2m") +
        `<div class="prop-note">Armature resistance in series with its inductance (no mechanical load).</div>`,
    netlist(c, k) {
        const mid = k.node("m");
        return [
            { name: k.sub("Ra"), comp: c, kind: "R", nodes: [k.pin("1"), mid], params: { r: Math.max(k.num(c.ra, 1.5), 1e-3) } },
            { name: k.sub("La"), comp: c, kind: "L", nodes: [mid, k.pin("2")], params: { l: Math.max(k.num(c.la, 2e-3), 1e-9), ic: 0 } }
        ];
    },
    catalog: [{ name: "MOTOR-DC", category: "Electromechanical", desc: "DC motor: armature resistance and inductance", props: { ra: "1.5", la: "2m", value: "MOTOR" } }]
});

PartLib.add("CRYSTAL", {
    prefix: "X", value: "16 MHz", props: { freq: "16M", cp: "5p", qfac: "50k" }, symbol: TWO,
    label: (c) => `${c.freq || "16M"}Hz`,
    draw(r, c) {
        const ctx = r.ctx;
        r.partLine([[-40, 0], [-10, 0]], "#8be9fd"); r.partLine([[10, 0], [40, 0]], "#8be9fd");
        r.partLine([[-10, -14], [-10, 14]], "#8be9fd"); r.partLine([[10, -14], [10, 14]], "#8be9fd");
        ctx.strokeStyle = r.col("#8be9fd"); ctx.lineWidth = r.lw(2);
        ctx.strokeRect(-5, -10, 10, 20);
        r.drawLabel(c);
    },
    rows: (p, c) => p.text("Frequency (Hz)", "freq", c.freq, "16M") + p.text("Shunt capacitance Cp", "cp", c.cp, "5p") + p.text("Quality factor Q", "qfac", c.qfac, "50k") +
        `<div class="prop-note">Butterworth-Van Dyke model: a series RLC branch in parallel with Cp.</div>`,
    netlist(c, k) {
        const f = Math.max(k.num(c.freq, 16e6), 1), cp = Math.max(k.num(c.cp, 5e-12), 1e-15), q = Math.max(k.num(c.qfac, 5e4), 1);
        const cs = cp / 250;                                  // motional capacitance about 0.4 % of Cp
        const ls = 1 / ((2 * Math.PI * f) ** 2 * cs);
        const rs = (2 * Math.PI * f * ls) / q;
        const a = k.pin("1"), b = k.pin("2"), m1 = k.node("a"), m2 = k.node("b");
        return [
            { name: k.sub("Cp"), comp: c, kind: "C", nodes: [a, b], params: { c: cp } },
            { name: k.sub("Ls"), comp: c, kind: "L", nodes: [a, m1], params: { l: ls, ic: 0 } },
            { name: k.sub("Cs"), comp: c, kind: "C", nodes: [m1, m2], params: { c: cs } },
            { name: k.sub("Rs"), comp: c, kind: "R", nodes: [m2, b], params: { r: rs } }
        ];
    },
    catalog: [
        { name: "CRYSTAL-16MHz", category: "Miscellaneous", desc: "16 MHz quartz crystal (BVD model)", props: { freq: "16M", value: "16 MHz" } },
        { name: "CRYSTAL-32kHz", category: "Miscellaneous", desc: "32.768 kHz watch crystal (BVD model)", props: { freq: "32.768k", cp: "1p", qfac: "40k", value: "32.768 kHz" } }
    ]
});

PartLib.add("FUSE", {
    prefix: "F", value: "1 A", props: { rating: "1" }, symbol: TWO,
    label: (c) => `${c.rating || 1} A`,
    draw(r, c) {
        const ctx = r.ctx;
        lead2(r, c.blown ? "#ff5555" : "#ffb86c", 22);
        ctx.strokeStyle = r.col(c.blown ? "#ff5555" : "#ffb86c"); ctx.lineWidth = r.lw(3);
        ctx.strokeRect(-22, -8, 44, 16);
        if (c.blown) r.partLine([[-14, 0], [-4, 0]], "#ff5555", 2); else r.partLine([[-22, 0], [22, 0]], "#ffb86c", 2);
        r.drawLabel(c);
    },
    rows: (p, c) => p.text("Rating (A)", "rating", c.rating, "1") +
        `<div class="prop-note">10 mΩ until I²t reaches rating² × 20 ms, then it opens for good (during a transient run).</div>`,
    netlist(c, k) { return [{ ...k.base, kind: "FUSE", nodes: [k.pin("1"), k.pin("2")], params: { rating: Math.max(k.num(c.rating, 1), 1e-6), r: 0.01, tm: 0.02 } }]; },
    live(c, run) { const el = run.c.elements.find(e => e.name === c.name); c.blown = !!(el && el.blown); },
    catalog: [{ name: "FUSE", category: "Miscellaneous", desc: "Fuse that blows when its I²t rating is exceeded", props: { rating: "1", value: "1 A" } }]
});

PartLib.add("BATTERY", {
    prefix: "BAT", value: "9 V", props: { volts: "9", rint: "0" }, symbol: TWO,
    label: (c) => `${c.volts || 9} V`,
    draw(r, c) {
        r.partLine([[-40, 0], [-5, 0]], "#50fa7b"); r.partLine([[5, 0], [40, 0]], "#50fa7b");
        r.partLine([[-5, -9], [-5, 9]], "#50fa7b", 4); r.partLine([[5, -17], [5, 17]], "#50fa7b", 3);
        r.partText("+", 16, -14, { size: 14, color: "#50fa7b" });
        r.drawLabel(c);
    },
    rows: (p, c) => p.text("Voltage (V)", "volts", c.volts, "9") + p.text("Internal resistance (Ω)", "rint", c.rint, "0") +
        `<div class="prop-note">Pin 2 (right, long plate) is the positive terminal.</div>`,
    netlist(c, k) {
        const rint = k.num(c.rint, 0);
        const out = rint > 0 ? k.node("i") : k.pin("2");
        const els = [{ ...k.base, kind: "V", nodes: [out, k.pin("1")], params: { sourceType: "DC", dc: k.num(c.volts, 9), acMag: 0 } }];
        if (rint > 0) els.push({ name: k.sub("Ri"), comp: c, kind: "R", nodes: [out, k.pin("2")], params: { r: rint } });
        return els;
    },
    catalog: [
        { name: "BATTERY", category: "Simulator Primitives", desc: "Battery with optional internal resistance", props: { volts: "9", value: "9 V" } },
        { name: "CELL-1.5V", category: "Simulator Primitives", desc: "1.5 V cell with 0.2 Ω internal resistance", props: { volts: "1.5", rint: "0.2", value: "1.5 V" } }
    ]
});

PartLib.add("ECAP", {
    prefix: "C", value: "100 µF", props: { esr: "0" }, symbol: TWO,
    label: (c) => c.value,
    draw(r, c) {
        const ctx = r.ctx;
        r.partLine([[-40, 0], [-6, 0]], "#8be9fd"); r.partLine([[8, 0], [40, 0]], "#8be9fd");
        r.partLine([[-6, -18], [-6, 18]], "#8be9fd");
        ctx.strokeStyle = r.col("#8be9fd"); ctx.lineWidth = r.lw(3);
        ctx.beginPath(); ctx.arc(24, 0, 20, Math.PI * 0.78, Math.PI * 1.22); ctx.stroke();
        r.partText("+", -17, -12, { size: 14, color: "#8be9fd" });
        r.drawLabel(c);
    },
    rows: (p, c) => p.text("Capacitance", "value", c.value, "100u") + p.text("ESR (Ω)", "esr", c.esr || "", "0") + p.text("Initial voltage (UIC)", "ic", c.ic || "", "0") +
        `<div class="prop-note">Polarised: pin 1 (flat plate, +) is the positive terminal.</div>`,
    netlist(c, k) {
        const esr = k.num(c.esr, 0);
        const mid = esr > 0 ? k.node("e") : k.pin("2");
        const cc = { ...k.base, kind: "C", nodes: [k.pin("1"), mid], params: { c: Math.max(k.num(c.value, 100e-6), 1e-15), ic: (c.ic === undefined || c.ic === "" ? undefined : Units.parseSI(c.ic)) } };
        return esr > 0 ? [cc, { name: k.sub("esr"), comp: c, kind: "R", nodes: [mid, k.pin("2")], params: { r: esr } }] : [cc];
    },
    catalog: [
        { name: "CAP-ELEC", category: "Capacitors", desc: "Polarised electrolytic capacitor with ESR", props: { value: "100 µF", esr: "0.1" } }
    ]
});


// ============================================================ transistors etc.

const FET3 = { pins: [["G", -40, 0, -1, 0], ["D", 20, -40, 0, -1], ["S", 20, 40, 0, 1]], box: [-40, -40, 40, 40] };

for (const [type, n] of [["JFET_N", true], ["JFET_P", false]]) {
    PartLib.add(type, {
        prefix: "Q", value: "", symbol: FET3,
        draw(r, c) {
            const col = "#bd93f9";
            r.partLine([[-40, 0], [n ? -12 : -4, 0]], col);
            r.partLine([[-4, -22], [-4, 22]], col);
            r.partLine([[-4, -16], [20, -16], [20, -40]], col);
            r.partLine([[-4, 16], [20, 16], [20, 40]], col);
            r.triangle(n ? [[-14, -6], [-14, 6], [-4, 0]] : [[-12, 0], [-4, -6], [-4, 6]], col);
            r.drawLabel(c);
        },
        netlist(c, k) {
            const model = c.model || SIM_DEFAULT_MODEL[type];
            return [{ ...k.base, kind: "J", model, modelKind: type, pol: n ? 1 : -1, nodes: [k.pin("G"), k.pin("D"), k.pin("S")], params: c.customParams || simModel(type, model).params }];
        },
        catalog: []   // the models come from SIM_MODELS.JFET_N / JFET_P
    });
}

PartLib.add("XFMR", {
    prefix: "TR", value: "1:1", props: { l1: "1", ratio: "1", k: "0.999", rp: "0", rs: "0" },
    symbol: { pins: [["P1", -40, -20, -1, 0], ["P2", -40, 20, -1, 0], ["S1", 40, -20, 1, 0], ["S2", 40, 20, 1, 0]], box: [-40, -40, 40, 40] },
    label: (c) => { const n = Units.parseSI(c.ratio) || 1; return n === 1 ? "1:1" : (n < 1 ? `${Number((1 / n).toPrecision(3))}:1` : `1:${Number(n.toPrecision(3))}`); },
    draw(r, c) {
        const ctx = r.ctx, col = "#bd93f9";
        r.partLine([[-40, -20], [-14, -20]], col); r.partLine([[-40, 20], [-14, 20]], col);
        r.partLine([[40, -20], [14, -20]], col); r.partLine([[40, 20], [14, 20]], col);
        ctx.strokeStyle = r.col(col); ctx.lineWidth = r.lw(3);
        const rad = 40 / 6;
        for (let i = 0; i < 3; i++) {
            const cy = -20 + rad + i * 2 * rad;
            ctx.beginPath(); ctx.arc(-14, cy, rad, -Math.PI / 2, Math.PI / 2, true); ctx.stroke();
            ctx.beginPath(); ctx.arc(14, cy, rad, -Math.PI / 2, Math.PI / 2, false); ctx.stroke();
        }
        r.partLine([[-3, -24], [-3, 24]], col, 2); r.partLine([[3, -24], [3, 24]], col, 2);
        ctx.fillStyle = r.col(col);
        ctx.beginPath(); ctx.arc(-24, -28, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(24, -28, 2.5, 0, Math.PI * 2); ctx.fill();
        r.drawLabel(c);
    },
    rows: (p, c) => p.text("Primary inductance (H)", "l1", c.l1, "1") + p.text("Turns ratio N2 / N1", "ratio", c.ratio, "1") +
        p.text("Coupling k", "k", c.k, "0.999") + p.text("Primary resistance (Ω)", "rp", c.rp, "0") + p.text("Secondary resistance (Ω)", "rs", c.rs, "0") +
        `<div class="prop-note">Two coupled inductors (SPICE K). Secondary inductance = L1 × ratio². Dots mark pins P1 and S1.</div>`,
    netlist(c, k) {
        return [{
            ...k.base, kind: "T", nodes: [k.pin("P1"), k.pin("P2"), k.pin("S1"), k.pin("S2")],
            params: { l1: Math.max(k.num(c.l1, 1), 1e-9), ratio: Math.max(k.num(c.ratio, 1), 1e-6), k: Math.min(Math.max(k.num(c.k, 0.999), 0), 0.99999), rp: k.num(c.rp, 0), rs: k.num(c.rs, 0) }
        }];
    },
    catalog: [
        { name: "TRAN-1:1", category: "Inductors", desc: "Transformer 1:1 (1 H primary)", props: { l1: "1", ratio: "1", value: "1:1" } },
        { name: "TRAN-10:1", category: "Inductors", desc: "Step-down transformer 10:1 (10 H primary)", props: { l1: "10", ratio: "0.1", value: "10:1" } },
        { name: "TRAN-1:10", category: "Inductors", desc: "Step-up transformer 1:10 (100 mH primary)", props: { l1: "0.1", ratio: "10", value: "1:10" } }
    ]
});

PartLib.add("RELAY", {
    prefix: "K", value: "", symbol: { pins: [["COIL+", -40, -20, -1, 0], ["COIL-", -40, 20, -1, 0], ["C1", 40, -20, 1, 0], ["C2", 40, 20, 1, 0]], box: [-40, -40, 40, 40] },
    draw(r, c) {
        const ctx = r.ctx, col = "#ffb86c";
        r.partLine([[-40, -20], [-18, -20], [-18, -14]], col); r.partLine([[-40, 20], [-18, 20], [-18, 14]], col);
        ctx.strokeStyle = r.col(col); ctx.lineWidth = r.lw(3);
        ctx.fillStyle = r.col("#171b23");
        ctx.beginPath(); ctx.rect(-26, -14, 16, 28); ctx.fill(); ctx.stroke();
        r.partLine([[-26, 14], [-10, -14]], col, 2);
        ctx.setLineDash([3, 3]); r.partLine([[-10, 0], [16, 0]], col, 1.5); ctx.setLineDash([]);
        r.partLine([[40, -20], [22, -20]], col); r.partLine([[40, 20], [22, 20], [22, 14]], col);
        r.partLine([[22, -20], c.energized ? [22, 14] : [10, 8]], col);
        r.drawLabel(c);
    },
    live(c, run) { const el = run.c.elements.find(e => e.name === c.name); c.energized = !!(el && el.closed); },
    netlist(c, k) {
        const m = simModel("RELAY", c.model || SIM_DEFAULT_MODEL.RELAY);
        return [{ ...k.base, kind: "RLY", model: c.model || SIM_DEFAULT_MODEL.RELAY, nodes: [k.pin("COIL+"), k.pin("COIL-"), k.pin("C1"), k.pin("C2")], params: m.params }];
    },
    catalog: []
});

for (const type of ["SCR", "TRIAC"]) {
    const triac = type === "TRIAC";
    PartLib.add(type, {
        prefix: triac ? "TR" : "SCR", value: "",
        symbol: { pins: [[triac ? "MT1" : "A", -40, 0, -1, 0], [triac ? "MT2" : "K", 40, 0, 1, 0], ["G", 20, 40, 0, 1]], box: [-40, -30, 40, 40] },
        draw(r, c) {
            const col = "#ff79c6";
            r.partLine([[-40, 0], [-14, 0]], col); r.partLine([[14, 0], [40, 0]], col);
            r.triangle([[-14, -14], [14, 0], [-14, 14]], col, !triac);
            if (triac) r.triangle([[14, -14], [-14, 0], [14, 14]], col, false);
            r.partLine([[14, -14], [14, 14]], col);
            if (triac) r.partLine([[-14, -14], [-14, 14]], col);
            r.partLine([[20, 40], [20, 22], [10, 12]], col, 2);
            r.drawLabel(c);
        },
        live(c, run) { const el = run.c.elements.find(e => e.name === c.name); c.on = !!(el && el.on); },
        netlist(c, k) {
            const m = simModel(type, c.model || SIM_DEFAULT_MODEL[type]);
            return [{
                ...k.base, kind: type, model: c.model || SIM_DEFAULT_MODEL[type], nodes: [k.pin(triac ? "MT1" : "A"), k.pin(triac ? "MT2" : "K"), k.pin("G")],
                params: Object.assign({ triac }, m.params)
            }];
        },
        catalog: []
    });
}

PartLib.add("REG", {
    prefix: "U", value: "",
    symbol: { pins: [["IN", -40, -20, -1, 0], ["OUT", 40, -20, 1, 0], ["GND", 0, 40, 0, 1]], box: [-40, -40, 40, 40] },
    draw(r, c) {
        const adj = /^LM3[13]7/.test(c.model || "");
        r.partIC(c, [-26, -34, 52, 62], "#8be9fd", { names: false });
        r.partText(c.model || "7805", 0, -4, { size: 12, bold: true, color: "#8be9fd" });
        r.partText("IN", -22, -20, { size: 9, color: "#9aa4b5", align: "left" });
        r.partText("OUT", 22, -20, { size: 9, color: "#9aa4b5", align: "right" });
        r.partText(adj ? "ADJ" : "GND", 0, 20, { size: 9, color: "#9aa4b5", base: "middle" });
        r.drawLabel(c);
    },
    netlist(c, k) {
        const model = c.model || SIM_DEFAULT_MODEL.REG;
        const m = simModel("REG", model);
        return [{ ...k.base, kind: "REG", model, nodes: [k.pin("IN"), k.pin("OUT"), k.pin("GND")], params: m.params }];
    },
    catalog: []
});

for (const [type, kind, label] of [["DFF", "D", "D"], ["TFF", "T", "T"], ["JKFF", "JK", "JK"]]) {
    const jk = kind === "JK";
    PartLib.add(type, {
        prefix: "U", value: `${kind}-FF`, props: { vcc: "5" },
        symbol: {
            pins: [
                [jk ? "J" : label, -60, -20, -1, 0], [jk ? "K" : "CLK", -60, jk ? 20 : 20, -1, 0],
                ...(jk ? [["CLK", -60, 0, -1, 0]] : []),
                ["Q", 60, -20, 1, 0], ["QN", 60, 20, 1, 0], ["S", 0, -60, 0, -1], ["R", 0, 60, 0, 1]
            ],
            box: [-60, -60, 60, 60]
        },
        label: () => `${kind}-FF`,
        draw(r, c) {
            const ctx = r.ctx, col = "#f1fa8c";
            r.partIC(c, [-40, -40, 80, 80], col, {});
            r.partText(`${kind}-FF`, 0, 0, { size: 12, bold: true, color: col });
            // clock wedge
            const cy = jk ? 0 : 20;
            r.partLine([[-40, cy - 6], [-32, cy], [-40, cy + 6]], col, 2);
            // QN overline
            ctx.strokeStyle = r.col("#9aa4b5"); ctx.lineWidth = r.lw(1.5);
            ctx.beginPath(); ctx.moveTo(26, 12); ctx.lineTo(34, 12); ctx.stroke();
            r.drawLabel(c);
        },
        rows: (p, c) => p.text("Supply / logic high (V)", "vcc", c.vcc === undefined ? "5" : c.vcc, "5") +
            `<div class="prop-note">Rising-edge triggered. S (set) and R (reset) are active high and read low when unconnected.</div>`,
        netlist(c, k) {
            const pins = jk ? ["J", "K", "CLK"] : [label, null, "CLK"];
            const nodes = [k.pin(pins[0]), pins[1] ? k.pin(pins[1]) : "0", k.pin("CLK"), k.pin("Q"), k.pin("QN"), k.pin("S"), k.pin("R")];
            return [{ ...k.base, kind: "FF", ff: kind, nodes, params: { vcc: k.num(c.vcc, 5) } }];
        },
        catalog: [{ name: `${kind}-FF`, category: "Digital ICs", desc: { D: "D flip-flop (rising edge, async set / reset)", T: "T (toggle) flip-flop (rising edge, async set / reset)", JK: "JK flip-flop (rising edge, async set / reset)" }[kind], props: { vcc: "5", value: `${kind}-FF` } }]
    });
}

// 7-segment display: 8 LEDs sharing a common pin
const SEGS = ["a", "b", "c", "d", "e", "f", "g"];
PartLib.add("SEG7", {
    prefix: "DS", value: "7SEG", props: { common: "cathode", color: "RED" }, quietPins: true,
    symbol: {
        pins: [...SEGS.map((s, i) => [s, -60, -60 + i * 20, -1, 0]), ["DP", 60, -20, 1, 0], ["COM", 60, 20, 1, 0]],
        box: [-60, -80, 60, 80]
    },
    label: (c) => `7SEG-${c.common === "anode" ? "CA" : "CC"}`,
    draw(r, c) {
        const ctx = r.ctx, col = "#ff5555";
        r.partIC(c, [-40, -80, 80, 160], "#ff79c6", {});
        const on = c.seg || {};
        const seg = (s, x1, y1, x2, y2) => {
            ctx.strokeStyle = r.col(on[s] ? "#ff4040" : "rgba(255, 85, 85, 0.18)");
            ctx.lineWidth = on[s] ? 7 : 6;
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.lineCap = "butt";
        };
        seg("a", -14, -50, 14, -50); seg("g", -14, 0, 14, 0); seg("d", -14, 50, 14, 50);
        seg("f", -18, -46, -18, -4); seg("b", 18, -46, 18, -4);
        seg("e", -18, 4, -18, 46); seg("c", 18, 4, 18, 46);
        ctx.fillStyle = r.col(on.dp ? "#ff4040" : "rgba(255, 85, 85, 0.18)");
        ctx.beginPath(); ctx.arc(28, 58, 3.5, 0, Math.PI * 2); ctx.fill();
        r.drawLabel(c);
    },
    rows: (p, c) => p.select("Common pin", "common", [["cathode", "Common cathode (COM to ground)"], ["anode", "Common anode (COM to supply)"]], c.common || "cathode") +
        p.select("Colour", "color", Object.keys(SIM_MODELS.LED).map(n => [n, n]), c.color || "RED"),
    netlist(c, k) {
        const model = SIM_MODELS.LED[c.color] ? c.color : "RED";
        const params = SIM_MODELS.LED[model].params;
        const anode = c.common === "anode";
        return [...SEGS, "DP"].map(s => ({
            name: k.sub(s), comp: c, kind: "D", model, modelKind: "LED",
            // common cathode: pin -> COM; common anode: COM -> pin
            nodes: anode ? [k.pin("COM"), k.pin(s)] : [k.pin(s), k.pin("COM")], params
        }));
    },
    live(c, run) {
        const seg = {};
        for (const s of [...SEGS, "DP"]) seg[s === "DP" ? "dp" : s] = Math.abs(run.current(`${c.name}_${s}`)) > 1e-3;
        c.seg = seg;
    },
    catalog: [
        { name: "7SEG-CC", category: "Optoelectronics", desc: "7-segment display, common cathode", props: { common: "cathode", color: "RED", value: "7SEG-CC" } },
        { name: "7SEG-CA", category: "Optoelectronics", desc: "7-segment display, common anode", props: { common: "anode", color: "RED", value: "7SEG-CA" } }
    ]
});

PartLib.add("BRIDGE", {
    prefix: "BR", value: "1N4007", props: { model: "1N4007" },
    symbol: { pins: [["AC1", -40, -20, -1, 0], ["AC2", -40, 20, -1, 0], ["+", 40, -20, 1, 0], ["-", 40, 20, 1, 0]], box: [-40, -40, 40, 40] },
    label: (c) => c.model || "1N4007",
    draw(r, c) {
        r.partIC(c, [-26, -34, 52, 68], "#ff79c6", { names: false });
        const col = "#ff79c6";
        r.partLine([[0, -22], [18, 0], [0, 22], [-18, 0], [0, -22]], col, 2);
        r.partText("~", -10, -10, { size: 14, color: col }); r.partText("~", -10, 10, { size: 14, color: col });
        r.partText("+", 10, -10, { size: 13, color: col }); r.partText("−", 10, 10, { size: 13, color: col });
        r.drawLabel(c);
    },
    rows: (p, c) => p.select("Diode model", "model", Object.keys(SIM_MODELS.D).map(n => [n, n]), c.model || "1N4007"),
    netlist(c, k) {
        const model = SIM_MODELS.D[c.model] ? c.model : "1N4007";
        const params = SIM_MODELS.D[model].params;
        const [a1, a2, p, n] = [k.pin("AC1"), k.pin("AC2"), k.pin("+"), k.pin("-")];
        return [[a1, p, "1"], [a2, p, "2"], [n, a1, "3"], [n, a2, "4"]].map(([an, ca, i]) => ({
            name: k.sub(`D${i}`), comp: c, kind: "D", model, modelKind: "D", nodes: [an, ca], params
        }));
    },
    catalog: [{ name: "BRIDGE", category: "Diodes", desc: "Full-wave bridge rectifier (four diodes)", props: { model: "1N4007", value: "1N4007" } }]
});


// ============================================== sensors, protection, optocoupler, ports

const slider = (p, c, label, note) => `<div class="property"><label>${label}</label>
    <input type="range" data-prop="position" min="0" max="100" value="${Math.round((c.position === undefined ? 0.5 : c.position) * 100)}">
    <div class="prop-note">${note}</div></div>`;

// resistor-like symbol with an overlay: draws the box and leads, the callback adds the extras
const boxResistor = (r, c, color, extra) => {
    const ctx = r.ctx;
    r.partLine([[-40, 0], [-24, 0]], color); r.partLine([[24, 0], [40, 0]], color);
    ctx.strokeStyle = r.col(color); ctx.lineWidth = r.lw(3);
    ctx.fillStyle = r.col("#171b23");
    ctx.beginPath(); ctx.rect(-24, -9, 48, 18); ctx.fill(); ctx.stroke();
    if (extra) extra(ctx);
    r.drawLabel(c);
};
const arrowHead = (ctx, x, y, dx, dy, size = 5) => {
    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(a - 0.45), y - size * Math.sin(a - 0.45));
    ctx.lineTo(x - size * Math.cos(a + 0.45), y - size * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fill();
};

PartLib.add("LDR", {
    prefix: "LDR", value: "100 lux", props: { lux: "100", r10: "10k", gamma: "0.7" }, symbol: TWO, tweak: ["lux"],
    label: (c) => `${c.lux || 100} lux`,
    resistance: (c) => {
        const lux = Math.max(Units.parseSI(c.lux) || 0, 0.01), r10 = Units.parseSI(c.r10) || 1e4, g = isFinite(Number(c.gamma)) ? Number(c.gamma) : 0.7;
        return Math.min(Math.max(r10 * Math.pow(lux / 10, -g), 50), 5e6);
    },
    draw(r, c) {
        boxResistor(r, c, "#ffb86c", (ctx) => {
            ctx.fillStyle = r.col("#ffb86c"); ctx.strokeStyle = r.col("#ffb86c"); ctx.lineWidth = r.lw(2);
            for (const x of [-12, 0]) { ctx.beginPath(); ctx.moveTo(x - 10, -30); ctx.lineTo(x + 2, -12); ctx.stroke(); arrowHead(ctx, x + 2, -12, 12, 18); }
        });
    },
    rows: (p, c) => p.text("Light level (lux)", "lux", c.lux, "100") + p.text("Resistance at 10 lux", "r10", c.r10, "10k") + p.text("Gamma", "gamma", c.gamma, "0.7") +
        `<div class="prop-note">R = R10 × (lux / 10)^−γ, limited to 50 Ω … 5 MΩ. Change the light level while a simulation runs.</div>`,
    netlist(c, k) { return [{ ...k.base, kind: "R", nodes: [k.pin("1"), k.pin("2")], params: { r: PartLib.defs.LDR.resistance(c) } }]; },
    catalog: [{ name: "LDR", category: "Resistors", desc: "Light-dependent resistor (photoresistor)", props: { lux: "100", value: "100 lux" } }]
});

for (const [type, ntc] of [["NTC", true], ["PTC", false]]) {
    PartLib.add(type, {
        prefix: "TH", value: "10 kΩ", props: ntc ? { r25: "10k", beta: "3950", temp: "25" } : { r25: "1k", tc: "0.7", temp: "25" }, symbol: TWO, tweak: ["temp"],
        label: (c) => `${c.r25 || "10k"}Ω ${c.temp || 25}°C`,
        resistance: (c) => {
            const r25 = Units.parseSI(c.r25) || 1e4, T = (isFinite(Number(c.temp)) ? Number(c.temp) : 25);
            if (ntc) { const B = Units.parseSI(c.beta) || 3950; return Math.max(r25 * Math.exp(B * (1 / (T + 273.15) - 1 / 298.15)), 1e-2); }
            const tc = (isFinite(Number(c.tc)) ? Number(c.tc) : 0.7) / 100;
            return Math.max(r25 * (1 + tc * (T - 25)), r25 * 0.02);
        },
        draw(r, c) {
            boxResistor(r, c, "#ff79c6", (ctx) => {
                r.partLine([[-18, 14], [-12, 14], [12, -14], [18, -14]], "#ff79c6", 2);
                r.partText(ntc ? "-t°" : "+t°", 0, -18, { size: 9, color: "#ff79c6" });
            });
        },
        rows: (p, c) => p.text("Resistance at 25 °C", "r25", c.r25, ntc ? "10k" : "1k") +
            (ntc ? p.text("Beta (K)", "beta", c.beta, "3950") : p.text("Temperature coefficient (%/°C)", "tc", c.tc, "0.7")) +
            p.text("Temperature (°C)", "temp", c.temp, "25") +
            `<div class="prop-note">${ntc ? "R = R25 × exp(B (1/T − 1/298.15 K))" : "R = R25 × (1 + tc (T − 25))"}. Change the temperature while a simulation runs.</div>`,
        netlist(c, k) { return [{ ...k.base, kind: "R", nodes: [k.pin("1"), k.pin("2")], params: { r: PartLib.defs[type].resistance(c) } }]; },
        catalog: [{ name: ntc ? "THERMISTOR-NTC" : "THERMISTOR-PTC", category: "Resistors", desc: ntc ? "NTC thermistor (resistance falls as it heats)" : "PTC thermistor / silicon temperature sensor (resistance rises)", props: ntc ? { r25: "10k", beta: "3950", temp: "25", value: "10 kΩ 25°C" } : { r25: "1k", tc: "0.7", temp: "25", value: "1 kΩ 25°C" } }]
    });
}

PartLib.add("RHEO", {
    prefix: "RV", value: "10 kΩ", props: { position: 0.5 }, symbol: TWO, tweak: ["position"],
    label: (c) => c.value,
    resistance: (c) => Math.max((Units.parseSI(c.value) || 1e4) * Math.min(1, Math.max(0, c.position === undefined ? 0.5 : c.position)), 1e-3),
    draw(r, c) {
        boxResistor(r, c, "#ffb86c", (ctx) => {
            r.partLine([[-16, 20], [16, -20]], "#ffb86c", 2);
            ctx.fillStyle = r.col("#ffb86c"); arrowHead(ctx, 16, -20, 8, -10, 6);
        });
    },
    rows: (p, c) => p.text("Maximum resistance", "value", c.value, "10k") +
        slider(p, c, "Setting", `${Math.round((c.position === undefined ? 0.5 : c.position) * 100)} % of maximum`),
    netlist(c, k) { return [{ ...k.base, kind: "R", nodes: [k.pin("1"), k.pin("2")], params: { r: PartLib.defs.RHEO.resistance(c) } }]; },
    catalog: [{ name: "RHEOSTAT", category: "Resistors", desc: "Variable resistor (rheostat), adjustable during a run", props: { value: "10 kΩ", position: 0.5 } }]
});

PartLib.add("MOV", {
    prefix: "RV", value: "22 V", props: { vz: "22" }, symbol: TWO,
    label: (c) => `${c.vz || 22} V`,
    draw(r, c) {
        boxResistor(r, c, "#ff79c6", () => {
            r.partLine([[-18, 14], [-12, 14], [12, -14], [18, -14]], "#ff79c6", 2);
            r.partText("V", 0, -18, { size: 9, color: "#ff79c6" });
        });
    },
    rows: (p, c) => p.text("Clamping voltage at 1 mA (V)", "vz", c.vz, "22") +
        `<div class="prop-note">Metal-oxide varistor: open below the clamp voltage, conducts either way above it (two back-to-back breakdown diodes).</div>`,
    netlist(c, k) {
        const vz = Math.max(k.num(c.vz, 22), 2);
        const model = `MOV_${String(vz).replace(/[^0-9]/g, "p")}`;
        const params = { is: 1e-14, n: 1, rs: Math.max(vz * 0.02, 0.5), bv: Math.max(vz - 0.7, 1), ibv: 1e-3, nbv: 1 };
        const mid = k.node("m");
        return [
            { name: k.sub("D1"), comp: c, kind: "D", model, modelKind: "DZ", nodes: [k.pin("1"), mid], params },
            { name: k.sub("D2"), comp: c, kind: "D", model, modelKind: "DZ", nodes: [k.pin("2"), mid], params }
        ];
    },
    catalog: [
        { name: "VARISTOR", category: "Resistors", desc: "Metal-oxide varistor (surge clamp)", props: { vz: "22", value: "22 V" } },
        { name: "MOV-14V", category: "Resistors", desc: "Varistor, 14 V AC rated (about 22 V clamp)", props: { vz: "22", value: "22 V" } },
        { name: "MOV-275V", category: "Resistors", desc: "Varistor, 275 V AC rated (about 430 V clamp)", props: { vz: "430", value: "430 V" } }
    ]
});

PartLib.add("PHOTODIODE", {
    prefix: "D", value: "100 lux", props: { lux: "100", sens: "70n" }, symbol: TWO, tweak: ["lux"],
    label: (c) => `${c.lux || 100} lux`,
    photocurrent: (c) => Math.max((Units.parseSI(c.lux) || 0) * (Units.parseSI(c.sens) || 70e-9), 0),
    draw(r, c) {
        r.drawDiode(c);
        const ctx = r.ctx;
        ctx.strokeStyle = r.col("#50fa7b"); ctx.fillStyle = r.col("#50fa7b"); ctx.lineWidth = r.lw(2);
        for (const x of [-8, 4]) { ctx.beginPath(); ctx.moveTo(x - 4, -26); ctx.lineTo(x + 6, -14); ctx.stroke(); arrowHead(ctx, x + 6, -14, 10, 12); }
    },
    rows: (p, c) => p.text("Light level (lux)", "lux", c.lux, "100") + p.text("Sensitivity (A per lux)", "sens", c.sens, "70n") +
        `<div class="prop-note">A reverse photocurrent of lux × sensitivity flows from cathode to anode. Change the light while a simulation runs.</div>`,
    netlist(c, k) {
        const model = "PHOTODIODE";
        const params = { is: 2e-11, n: 1.2, rs: 1, cjo: 70e-12, vj: 0.7, m: 0.5, bv: 32, ibv: 1e-5 };
        return [
            { name: k.sub("d"), comp: c, kind: "D", model, modelKind: "D", nodes: [k.pin("1"), k.pin("2")], params },
            { name: k.sub("i"), comp: c, kind: "I", nodes: [k.pin("2"), k.pin("1")], params: { sourceType: "DC", dc: PartLib.defs.PHOTODIODE.photocurrent(c), acMag: 0 } }
        ];
    },
    sync(c, elements) {
        const el = elements.find(e => e.name === `${c.name}_i`);
        if (el) el.wave = Waveform.dc(PartLib.defs.PHOTODIODE.photocurrent(c));
    },
    catalog: [{ name: "PHOTODIODE", category: "Optoelectronics", desc: "Photodiode (about 70 nA per lux)", props: { lux: "100", sens: "70n", value: "100 lux" } }]
});

PartLib.add("OPTO", {
    prefix: "U", value: "",
    symbol: { pins: [["A", -40, -20, -1, 0], ["K", -40, 20, -1, 0], ["C", 40, -20, 1, 0], ["E", 40, 20, 1, 0]], box: [-40, -40, 40, 40] },
    draw(r, c) {
        const ctx = r.ctx, col = "#ff79c6", col2 = "#bd93f9";
        r.partLine([[-40, -20], [-18, -20]], col); r.partLine([[-40, 20], [-18, 20]], col);
        // LED (left): diode pointing down from anode to cathode
        r.triangle([[-26, -14], [-10, -14], [-18, 4]], col);
        r.partLine([[-26, 4], [-10, 4]], col);
        r.partLine([[-18, 4], [-18, 20]], col); r.partLine([[-18, -20], [-18, -14]], col);
        // phototransistor (right)
        r.partLine([[40, -20], [22, -20], [10, -8]], col2); r.partLine([[40, 20], [22, 20], [10, 8]], col2);
        r.partLine([[10, -12], [10, 12]], col2, 3);
        ctx.fillStyle = r.col(col2); arrowHead(ctx, 10, 8, -9, 8, 6);
        // light between them
        ctx.strokeStyle = r.col("#50fa7b"); ctx.fillStyle = r.col("#50fa7b"); ctx.lineWidth = r.lw(1.5);
        for (const y of [-6, 2]) { ctx.beginPath(); ctx.moveTo(-6, y); ctx.lineTo(4, y); ctx.stroke(); arrowHead(ctx, 5, y, 8, 0, 4); }
        ctx.setLineDash([3, 3]); ctx.strokeStyle = r.col("#9aa4b5"); ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, 38); ctx.stroke(); ctx.setLineDash([]);
        r.drawLabel(c);
    },
    netlist(c, k) {
        const model = c.model || SIM_DEFAULT_MODEL.OPTO;
        const m = simModel("OPTO", model);
        const led = (SIM_MODELS.LED.IR || SIM_MODELS.LED.RED).params;
        const mid = k.node("m");
        return [
            { name: k.sub("s"), comp: c, kind: "V", nodes: [k.pin("A"), mid], params: { sourceType: "DC", dc: 0, acMag: 0 } },
            { name: k.sub("d"), comp: c, kind: "D", model: SIM_MODELS.LED.IR ? "IR" : "RED", modelKind: "LED", nodes: [mid, k.pin("K")], params: led },
            { name: k.sub("c"), comp: c, kind: "CCCS", ctrl: k.sub("s"), nodes: [k.pin("C"), k.pin("E")], params: { gain: m.params.ctr, vsat: m.params.vsat } }
        ];
    },
    catalog: []
});

// power ports and net labels: same name = same net, no wire needed
for (const type of ["POWER", "NETLABEL"]) {
    const power = type === "POWER";
    PartLib.add(type, {
        prefix: power ? "P" : "NL", value: power ? "VCC" : "NET1", props: power ? { net: "VCC", volts: "5" } : { net: "NET1" },
        symbol: { pins: [["1", 0, 20, 0, 1]], box: [-24, -30, 24, 20] },
        label: (c) => c.net || (power ? "VCC" : "NET1"),
        draw(r, c) {
            const col = power ? "#ff5555" : "#8be9fd", name = String(c.net || (power ? "VCC" : "NET1"));
            if (power) {
                r.partLine([[0, 20], [0, -6]], col); r.partLine([[-14, -6], [14, -6]], col);
                r.partText(name, 0, -17, { size: 11, bold: true, color: col });
                if (!/^(gnd|0)$/i.test(name)) r.partText(`${c.volts || 5} V`, 0, -28, { size: 9, color: "#9aa4b5" });
            } else {
                r.partLine([[0, 20], [0, 0]], col);
                const ctx = r.ctx;
                ctx.strokeStyle = r.col(col); ctx.lineWidth = r.lw(2); ctx.fillStyle = r.col("#171b23");
                ctx.beginPath(); ctx.moveTo(-22, -16); ctx.lineTo(18, -16); ctx.lineTo(24, -8); ctx.lineTo(18, 0); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
                r.partText(name, -2, -8, { size: 10, bold: true, color: col });
            }
        },
        rows: (p, c) => p.text("Net name", "net", c.net, power ? "VCC" : "NET1") + (power ? p.text("Voltage (V)", "volts", c.volts, "5") : "") +
            `<div class="prop-note">All ports and labels with the same name are connected, with no wire between them.${power ? " The first port of each name supplies the voltage; a net called GND is ground." : ""}</div>`,
        netlist(c, k) {
            if (!power) return [];
            const name = String(c.net || "VCC").trim().toUpperCase();
            if (name === "GND" || name === "0") return [];
            const first = k.editor.components.find(o => o.type === "POWER" && String(o.net || "VCC").trim().toUpperCase() === name);
            if (first !== c) return [];
            return [{ name: k.sub("v"), comp: c, kind: "V", nodes: [k.pin("1"), "0"], params: { sourceType: "DC", dc: k.num(c.volts, 5), acMag: 0 } }];
        },
        catalog: []   // listed under Terminals
    });
}

// ====================================================== 74xx / 4000-series logic ICs

// One part per chip in LOGIC_ICS. The symbol has the inputs down the left and the outputs down the right;
// open inputs and unused outputs are fine (no connection warnings), the chip needs no power pins.
function logicICGeometry(spec) {
    const rows = Math.max(spec.left.length, spec.right.length);
    const top = -20 * Math.ceil((rows + 1) / 2);
    const bottom = top + 20 * (rows + 1);
    const pins = [
        ...spec.left.map((n, i) => [n, -80, top + 20 + 20 * i, -1, 0]),
        ...spec.right.map((n, i) => [n, 80, top + 20 + 20 * i, 1, 0])
    ];
    return { top, bottom, symbol: { pins, box: [-80, top, 80, bottom] } };
}

// "1CLR_N" -> { text: "1CLR", bar: true }; "SH_LD_N" -> "SH/LD" barred
function logicPinLabel(name) {
    const bar = /_N$/.test(name);
    return { text: name.replace(/_N$/, "").replace(/_/g, "/"), bar };
}

for (const [key, spec] of Object.entries(LOGIC_ICS)) {
    const g = logicICGeometry(spec);
    PartLib.add(key, {
        prefix: "U", value: key, props: { vcc: "5" }, symbol: g.symbol, quietPins: true,
        label: () => key,
        draw(r, c) {
            const ctx = r.ctx, col = "#f1fa8c";
            ctx.strokeStyle = r.col(col); ctx.fillStyle = r.col("#171b23"); ctx.lineWidth = r.lw(3);
            ctx.beginPath(); ctx.rect(-60, g.top, 120, g.bottom - g.top); ctx.fill(); ctx.stroke();
            r.partText(key, 0, g.top + 9, { size: 11, bold: true, color: col });
            const side = (names, sign) => names.forEach((name, i) => {
                const y = g.top + 20 + 20 * i, { text, bar } = logicPinLabel(name);
                const active = bar && (sign < 0 || !/^Q/.test(name) || true);
                const x0 = sign * 60, x1 = sign * 80;
                // lead (with a bubble where the pin is active low)
                r.partLine([[x1, y], [x0 + sign * (bar ? 6 : 0), y]], col, 2);
                if (bar) { ctx.beginPath(); ctx.arc(x0 + sign * 3, y, 3, 0, Math.PI * 2); ctx.fillStyle = r.col("#171b23"); ctx.fill(); ctx.strokeStyle = r.col(col); ctx.lineWidth = r.lw(1.5); ctx.stroke(); }
                if (sign < 0 && spec.clocks.includes(name)) r.partLine([[-60, y - 5], [-52, y], [-60, y + 5]], col, 1.5);
                const tx = sign * (clockPad(sign, name) ? 50 : 54), align = sign < 0 ? "left" : "right";
                r.partText(text, tx, y, { size: 9, color: "#c8d0dc", align });
                if (bar) {
                    const w = ctx.measureText(text).width;
                    r.partLine([[sign < 0 ? tx : tx - w, y - 6], [sign < 0 ? tx + w : tx, y - 6]], "#c8d0dc", 1);
                }
            });
            const clockPad = (sign, name) => sign < 0 && spec.clocks.includes(name);
            side(spec.left, -1);
            side(spec.right, 1);
            r.drawLabel(c);
        },
        rows: (p, c) => p.text("Supply / logic high (V)", "vcc", c.vcc === undefined ? "5" : c.vcc, "5") +
            `<div class="prop-note">${PropertiesPanel.esc(spec.desc)}. No power pins are needed. Inputs left open read high when active-low (barred), and enables read active, so an unwired chip works; unused outputs may stay open.</div>`,
        netlist(c, k) {
            return [{ ...k.base, kind: "DIGITAL", ic: key, nodes: LogicIC.pins(spec).map(n => k.pin(n)), params: { vcc: k.num(c.vcc, 5) } }];
        },
        catalog: [{ name: key, category: spec.category, desc: `${spec.desc}`, props: { vcc: "5", value: key } }]
    });
}


// ------------------------------------------------------------- behavioural source (SPICE "B")

PartLib.add("BSRC", {
    prefix: "B", value: "2*v(A)", props: { mode: "V", expr: "2*v(A)" },
    symbol: { pins: [["A", -60, -40, -1, 0], ["B", -60, -20, -1, 0], ["C", -60, 20, -1, 0], ["D", -60, 40, -1, 0], ["O+", 60, -20, 1, 0], ["O-", 60, 20, 1, 0]], box: [-60, -60, 60, 60] },
    quietPins: true,
    label: (c) => String(c.expr === undefined ? "0" : c.expr),
    draw(r, c) {
        const ctx = r.ctx, col = "#ffb86c";
        r.partIC(c, [-40, -52, 80, 104], col, { names: true });
        r.partText(c.mode === "I" ? "B  I=" : "B  V=", 0, -30, { size: 11, bold: true, color: col });
        const text = String(c.expr === undefined ? "" : c.expr), shown = text.length > 12 ? text.slice(0, 11) + "…" : text;
        r.partText(shown, 0, 0, { size: 10, color: "#e8edf5" });
        r.drawLabel(c);
    },
    rows: (p, c) => p.select("Type", "mode", [["V", "Voltage source  V = f(...)"], ["I", "Current source  I = f(...)"]], c.mode || "V") +
        p.text("Expression", "expr", c.expr, "e.g. 2*v(A) + sin(2*pi*1k*time)") +
        `<div class="prop-note">Read the sense inputs with v(A), v(B), v(C), v(D) or differentially v(A,B); i(V1) reads the current of a voltage source; time is the simulation time. Operators + - * / ^ and comparisons, ?:, and abs sqrt exp ln log sin cos tan atan atan2 tanh min max pow limit u uramp if. An open input reads 0 V. Output current flows from O+ through the source to O- for a current source; O+ is the positive terminal of a voltage source.</div>`,
    netlist(c, k) {
        const text = String(c.expr === undefined ? "0" : c.expr);
        // v(A) -> the net on pin A; unwired sense pins are ground
        const sub = text.replace(/\bv\(\s*([a-d])\s*(?:,\s*([a-d])\s*)?\)/gi, (_, a, b) => `v(${k.pin(a.toUpperCase())}${b ? "," + k.pin(b.toUpperCase()) : ""})`);
        try { Expr.compile(sub); } catch (e) { throw new Error(`${c.name}: ${e.message}`); }
        return [{ ...k.base, kind: "BSRC", nodes: [k.pin("O+"), k.pin("O-")], params: { mode: c.mode === "I" ? "I" : "V", expr: sub, shown: text } }];
    },
    catalog: [
        { name: "BSOURCE-V", category: "Simulator Primitives", desc: "Behavioural voltage source: V = any expression of node voltages, currents and time", props: { mode: "V", expr: "2*v(A)", value: "2*v(A)" } },
        { name: "BSOURCE-I", category: "Simulator Primitives", desc: "Behavioural current source: I = any expression of node voltages, currents and time", props: { mode: "I", expr: "v(A)/1k", value: "v(A)/1k" } }
    ]
});


// ------------------------------------------------------------- library hooks

// models of the semiconductor-like parts show up in the catalog like any other model
Object.assign(DeviceCatalog.kindInfo, {
    JFET_N: { category: "Transistors", label: (n) => n },
    JFET_P: { category: "Transistors", label: (n) => n },
    REG: { category: "Voltage Regulators", label: (n) => n },
    SCR: { category: "Thyristors", label: (n) => n },
    TRIAC: { category: "Thyristors", label: (n) => n },
    RELAY: { category: "Electromechanical", label: (n) => `RELAY-${n}` },
    OPTO: { category: "Optoelectronics", label: (n) => n }
});

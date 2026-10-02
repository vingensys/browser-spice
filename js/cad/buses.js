// Buses. A bus wire (the Bus tool, key B) is drawn thick and carries a name such as D[0..7]; it joins nothing by itself.
// A BUS ENTRY part touches a bus with its slanted end and connects its pin to the bus member of its index: entry 3 on
// bus D is the net D3, the same net as every other D3 on the sheet (net labels work by name), so one bus carries many
// signals between two places without drawing each wire. A sheet symbol or hierarchical port named D[0..7] is a bus pin:
// it takes the bus on its sheet and the matching members D0..D7 cross the sheet boundary together.

const BusUtil = {
    VECTOR: /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\.\.(\d+)\]$/,

    // "D[0..7]" -> { base: "D", lo: 0, hi: 7 }, anything else -> null
    parse(name) {
        const m = BusUtil.VECTOR.exec(String(name === undefined || name === null ? "" : name).trim());
        if (!m) return null;
        const a = Number(m[2]), b = Number(m[3]);
        return { base: m[1].toUpperCase(), lo: Math.min(a, b), hi: Math.max(a, b) };
    },

    // the vector a pin carries when it is a bus pin (sheet symbol pin or vector port)
    pinInfo(comp, pinName) {
        if (comp.type === "PORT") return BusUtil.parse(comp.net);
        if (comp.type === "SHEET") return BusUtil.parse(pinName);
        return null;
    },

    // where a bus entry touches its bus, as an offset from the part origin (before rotation)
    TAP: [20, -20]
};

PartLib.add("BUSTAP", {
    prefix: "BE", value: "0", props: { index: 0, bus: "" },
    symbol: { pins: [["1", 0, 0, 0, 1]], box: [-8, -26, 28, 8] },
    quietPins: false,
    label: (c) => `${c.bus ? String(c.bus).toUpperCase() : ""}${Number(c.index) || 0}`,
    draw(r, c) {
        const col = "#2f55d4", ctx = r.ctx;
        r.partLine([[0, 0], [20, -20]], col, 3);
        ctx.fillStyle = r.col(col); ctx.beginPath(); ctx.arc(20, -20, 3.5, 0, Math.PI * 2); ctx.fill();
        r.upright(c);
        r.partText(`${c.bus ? String(c.bus).toUpperCase() : ""}${Number(c.index) || 0}`, 18, -2, { size: 10, bold: true, color: col, align: "left" });
    },
    rows: (p, c) => p.text("Bit index", "index", c.index === undefined ? 0 : c.index, "0") +
        p.text("Bus name (optional)", "bus", c.bus || "", "the bus's own name") +
        `<div class="prop-note">Put the slanted end on a bus wire and wire the pin to the signal. Entry <b>3</b> on bus <b>D</b> is the net <b>D3</b>; every D3 on the sheet is one net. Placing several in a row counts up by itself.</div>`,
    netlist: () => [],
    catalog: [{ name: "BUS ENTRY", category: "Terminals", desc: "Connects a signal to a member of a bus (index N on bus D is the net DN)", props: { index: 0, bus: "", value: "0" } }]
});

SchematicEditor.REF_PREFIX.BUSTAP = "BE";

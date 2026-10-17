// MOSFET models above level 1: flagged as approximated, and ngspice (not the built-in engine) is what runs them.  node tests/mos-levels.test.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
if (!fs.existsSync(path.join(root, "node_modules", "eecircuit-engine"))) { console.log("eecircuit-engine not installed: skipping"); process.exit(0); }
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js", "js/sim/spice-parser.js", "js/circuit/netlist.js", "js/sim/ngspice-backend.js"];
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
const { SpiceParser, SimEngine, NgspiceBackend, NetlistExtractor } = new Function(src + "\nreturn { SpiceParser, SimEngine, NgspiceBackend, NetlistExtractor };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const deck = (level, extra = "") => `mos level ${level}\nVDD d 0 DC 5\nVG g 0 DC 3\nM1 d g 0 0 NM W=10u L=1u\n.model NM NMOS(LEVEL=${level} VTO=1 KP=5e-5 GAMMA=0.4 PHI=0.65 TOX=2e-8 ${extra})\n.op\n.end`;
(async () => {
    const { Simulation } = await import("eecircuit-engine");
    const sim = new Simulation(); await sim.start(); NgspiceBackend.simulation = sim;
    const lvl1 = SpiceParser.build(SpiceParser.parse(deck(1)));
    check("a level-1 card raises no warning", !lvl1.warnings.some(w => /LEVEL/.test(w)), lvl1.warnings);
    const l3 = SpiceParser.build(SpiceParser.parse(deck(3, "THETA=0.1 VMAX=1e5 ETA=0.2 KAPPA=0.3")));
    check("a LEVEL 3 card is flagged as approximated by the built-in engine", l3.warnings.some(w => /m1.*LEVEL 3.*level-1/i.test(w)), l3.warnings);
    // why it matters: ngspice's LEVEL 3 and the level-1 equations give clearly different drain voltages for the same card
    const rdDeck = (level, extra = "") => `mos\nVDD vdd 0 DC 5\nRD vdd d 2k\nVG g 0 DC 3\nM1 d g 0 0 NM W=10u L=1u\n.model NM NMOS(LEVEL=${level} VTO=1 KP=5e-5 GAMMA=0.4 PHI=0.65 TOX=2e-8 ${extra})\n.op\n.end`;
    const vd = async (text) => NgspiceBackend.toOperatingPoint(await NgspiceBackend.run(text), { elements: [] }).nodeVoltages.d;
    const v1 = await vd(rdDeck(1)), v3 = await vd(rdDeck(3, "THETA=0.3 VMAX=5e4 ETA=0.1"));
    check(`ngspice: V(d) with the level-1 card is ${Number(v1).toFixed(3)} V, with the LEVEL 3 card ${Number(v3).toFixed(3)} V (a clear difference)`, Number.isFinite(v1) && Number.isFinite(v3) && Math.abs(v1 - v3) > 0.2, [v1, v3]);
    const builtin = new SimEngine(SpiceParser.build(SpiceParser.parse(rdDeck(3, "THETA=0.3 VMAX=5e4 ETA=0.1"))).circuit).operatingPoint().nodeVoltages.d;
    check(`the built-in engine, which only has level 1, gets ${builtin.toFixed(3)} V for the LEVEL 3 card: that is why those runs go to ngspice`, Math.abs(builtin - v3) > 0.2 && Math.abs(builtin - v1) < 0.3, [builtin, v1, v3]);
    console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

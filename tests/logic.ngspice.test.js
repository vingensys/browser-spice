// The logic-IC SPICE export (combinational truth tables, D / JK flip-flops) against ngspice.
//   node tests/logic.ngspice.test.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
if (!fs.existsSync(path.join(root, "node_modules", "eecircuit-engine"))) { console.log("eecircuit-engine not installed: skipping"); process.exit(0); }
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/logic-ics.js", "js/sim/models.js", "js/circuit/netlist.js", "js/sim/ngspice-backend.js"];
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
const { NgspiceBackend, NetlistExtractor, LOGIC_ICS, LogicIC } = new Function(src + "\nreturn { NgspiceBackend, NetlistExtractor, LOGIC_ICS, LogicIC };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

(async () => {
    const { Simulation } = await import("eecircuit-engine");
    const sim = new Simulation(); await sim.start(); NgspiceBackend.simulation = sim;
    const build = (key, drive) => {
        const spec = LOGIC_ICS[key], pins = LogicIC.pins(spec), els = [];
        els.push({ kind: "DIGITAL", name: "U1", ic: key, nodes: pins.map((p, i) => `n${i}`), params: { vcc: 5, ro: 50 } });
        for (const p of spec.left) if (drive[p] !== undefined) els.push({ kind: "V", name: `V_${p}`, nodes: [`n${LogicIC.pins(spec).indexOf(p)}`, "0"], params: typeof drive[p] === "number" ? { sourceType: "DC", dc: drive[p] * 5 } : drive[p] });
        return { spec, els };
    };
    const outs = async (key, vec) => {
        const drive = {}; for (const k in vec) drive[k] = vec[k];
        const { spec, els } = build(key, drive);
        const info = { elements: els };
        const op = NgspiceBackend.toOperatingPoint(await NgspiceBackend.run(NetlistExtractor.toSpice(els, { analysis: ".op" })), info);
        return { op, spec };
    };
    const rnd = (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
    for (const key of ["7400", "7402", "7404", "7408", "7432", "7486", "7447", "74138", "74139", "74157", "74153"]) {
        const spec = LOGIC_ICS[key];
        check(`${key} exports`, !!NetlistExtractor.digitalSubckt("x", key, {}, v => v));
        let worst = 0, cases = 0;
        for (let t = 0; t < 6; t++) {
            const vec = {}, lv = {};
            for (const p of spec.left) { lv[p] = rnd() < 0.5 ? 0 : 1; vec[p] = lv[p]; }
            const { op } = await outs(key, vec); if (process.env.DBG && t === 0) console.log(JSON.stringify(op.nodeVoltages), JSON.stringify(vec));
            const want = spec.step(spec.init(), lv, lv).out;
            for (const o of spec.right) { const v = op.nodeVoltages[`n${LogicIC.pins(spec).indexOf(o)}`]; if (v === undefined) continue; worst = Math.max(worst, Math.abs(v - want[o] * 5)); cases++; }
        }
        check(`${key}: ngspice outputs follow the truth table (worst ${worst.toFixed(3)} V over ${cases})`, cases > 0 && worst < 0.05);
    }
    for (const key of ["74161", "7490", "74164", "74244", "74151"]) check(`${key} is reported as not exported`, !NetlistExtractor.digitalSubckt("x", key, {}, v => v));
    // D flip-flop: D=1, clock rising edge sets Q; clear wins
    for (const [key, dpin, kpin, clk, clkHigh] of [["7474", "1D", null, "1CLK", true], ["74112", "1J", "1K", "1CLK_N", false]]) {
        const lo = clkHigh ? 0 : 5, hi = clkHigh ? 5 : 0;
        const drive = { [dpin]: 1, [`${clk[0]}PRE_N`]: 1, "1PRE_N": 1, "1CLR_N": 1, [clk]: { sourceType: "PULSE", pulse: { v1: lo, v2: hi, delay: 1e-6, rise: 1e-9, fall: 1e-9, width: 2e-6, period: 4e-6 } } };
        if (kpin) drive[kpin] = 0;
        for (const p of ["2D", "2J", "2K", "2CLK", "2CLK_N"]) if (LOGIC_ICS[key].left.includes(p)) drive[p] = 0;
        for (const p of ["2PRE_N", "2CLR_N"]) drive[p] = 1;
        const { spec, els } = build(key, drive);
        const info = { elements: els };
        const r = NgspiceBackend.toTransient(await NgspiceBackend.run(NetlistExtractor.toSpice(els, { analysis: ".tran 20n 3u uic" })), info);
        const q = r.nodeHistories[`n${LogicIC.pins(spec).indexOf("1Q")}`], qn = r.nodeHistories[`n${LogicIC.pins(spec).indexOf("1QN")}`];
        check(`${key}: Q is low before the clock edge and high after (${q[0].toFixed(2)} → ${q[q.length - 1].toFixed(2)} V)`, q[2] < 1 && q[q.length - 1] > 4 && qn[qn.length - 1] < 1);
    }
    console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// The SPICE export of counters, shift registers, registers, latches and three-state buffers against the built-in engine,
// both run on the same schematic elements: ngspice (WebAssembly) simulates the exported macromodel, the built-in
// engine the chip's state machine. Output levels must agree at every sample time.
//   node tests/logic.seq.ngspice.test.js            (DBG=1 prints the first disagreement of each chip)
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
if (!fs.existsSync(path.join(root, "node_modules", "eecircuit-engine"))) { console.log("eecircuit-engine not installed: skipping"); process.exit(0); }
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js",
    "js/sim/engine.js", "js/circuit/logic-export.js", "js/circuit/netlist.js", "js/sim/ngspice-backend.js"];
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
const { NgspiceBackend, NetlistExtractor, LOGIC_ICS, LogicIC, SimEngine, LogicExport } = new Function(src + "\nreturn { NgspiceBackend, NetlistExtractor, LOGIC_ICS, LogicIC, SimEngine, LogicExport };")();
for (const k of ["CAP", "GDRV", "GKEEP", "GASYNC"]) if (process.env[k]) LogicExport[k] = process.env[k];
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

// Every chip runs at two time scales: microseconds with 2 ns edges, and the app's examples' milliseconds-to-seconds with 1 us edges
// (TS slows every waveform down by that factor; EDGE is the input rise / fall time). TS=... EDGE=... runs just one.
const SCALES = process.env.TS ? [[Number(process.env.TS), Number(process.env.EDGE || 2e-9)]] : [[1, 2e-9], [1000, 1e-6]];
let TS = 1, EDGE = 2e-9, US = 1e-6, T_END = 48 * US;
// a pulse train of 5 V pulses: [idle level, active level] with the first active edge at `delay`
const train = (idle, active, delay, width, period) => ({ sourceType: "PULSE", pulse: { v1: idle, v2: active, delay, rise: EDGE, fall: EDGE, width, period } });
// a control that changes only at 0.5 us + k * 2 us (never next to a clock edge): a seeded random bit pattern
const bits = (seed, pOne = 0.5, start = 0) => {
    let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pts = [[0, start * 5]]; let level = start;
    for (let t = 0.5; t < T_END / US; t += 2) { const nl = rnd() < pOne ? 1 : 0; if (nl !== level) { pts.push([t * US, level * 5], [t * US + EDGE, nl * 5]); level = nl; } }
    return { sourceType: "PWL", pwl: pts };
};
const dc = (v) => ({ sourceType: "DC", dc: v * 5 });
let CASES;
const buildCases = () => {

// stimulus per chip: pin -> source (pins not listed get a seeded random pattern; "hold" lists pins held at a level)
const A = (idle, active) => train(idle, active, 1 * US, 1 * US, 2 * US);           // edges every microsecond
const B = (idle, active) => train(idle, active, 1.2 * US, 2 * US, 4 * US);         // a slower, offset clock
CASES = {
    "7493": { CKA_N: A(5, 0), CKB_N: B(5, 0), R01: bits(11, 0.12), R02: bits(12, 0.5, 1) },
    "7490": { CKA_N: A(5, 0), CKB_N: B(5, 0), R01: bits(21, 0.1), R02: bits(22, 0.6, 1), R91: bits(23, 0.08), R92: bits(24, 0.6, 1) },
    "74161": { CLK: A(0, 5), CLR_N: bits(31, 0.9, 1), LOAD_N: bits(32, 0.8, 1), ENP: bits(33, 0.85, 1), ENT: bits(34, 0.85, 1) },
    "74163": { CLK: A(0, 5), CLR_N: bits(35, 0.9, 1), LOAD_N: bits(36, 0.8, 1), ENP: bits(37, 0.85, 1), ENT: bits(38, 0.85, 1) },
    "74160": { CLK: A(0, 5), CLR_N: bits(39, 0.9, 1), LOAD_N: bits(40, 0.8, 1), ENP: bits(41, 0.85, 1), ENT: bits(42, 0.85, 1) },
    "74162": { CLK: A(0, 5), CLR_N: bits(43, 0.9, 1), LOAD_N: bits(44, 0.8, 1), ENP: bits(45, 0.85, 1), ENT: bits(46, 0.85, 1) },
    "74193": { UP: A(5, 0), DOWN: B(5, 0), CLR: bits(51, 0.06), LOAD_N: bits(52, 0.85, 1) },
    "74393": { "1CLK_N": A(5, 0), "2CLK_N": B(5, 0), "1CLR": bits(61, 0.1), "2CLR": bits(62, 0.1) },
    "4017": { CLK: A(0, 5), INH: bits(71, 0.2), RST: bits(72, 0.08) },
    "4040": { CLK_N: A(5, 0), RST: bits(73, 0.04) },
    "74164": { CLK: A(0, 5), A: bits(81, 0.6), B: bits(82, 0.8, 1), CLR_N: bits(83, 0.95, 1) },
    "74165": { CLK: A(0, 5), SER: bits(91, 0.5), CLK_INH: bits(92, 0.2), SH_LD_N: bits(93, 0.9, 1) },
    "74194": { CLK: A(0, 5), S0: bits(101, 0.5), S1: bits(102, 0.5), SR: bits(103, 0.5), SL: bits(104, 0.5), CLR_N: bits(105, 0.95, 1) },
    "74595": { SRCLK: A(0, 5), RCLK: B(0, 5), SER: bits(111, 0.5), SRCLR_N: bits(112, 0.95, 1), OE_N: bits(113, 0.25) },
    "74273": { CLK: A(0, 5), CLR_N: bits(121, 0.9, 1) },
    "74175": { CLK: A(0, 5), CLR_N: bits(122, 0.9, 1) },
    "74374": { CLK: A(0, 5), OE_N: bits(114, 0.25) },
    "74373": { LE: bits(131, 0.5), OE_N: bits(115, 0.25) },
    "74244": { G1_N: bits(141, 0.3), G2_N: bits(142, 0.3) }
};

    return CASES;
};

(async () => {
    const { Simulation } = await import("eecircuit-engine");
    const sim = new Simulation(); await sim.start(); NgspiceBackend.simulation = sim;
    let seed = 1000;
    for (const [ts, edge] of SCALES) {
    TS = ts; EDGE = edge; US = 1e-6 * TS; T_END = 48 * US; buildCases();
    console.log(`time scale x${TS} (clock period ${(2 * US).toExponential(1)} s), input edges ${EDGE} s`);
    for (const [key, drive] of Object.entries(CASES)) {
        if (process.env.ONLY && process.env.ONLY !== key) continue;
        const spec = LOGIC_ICS[key], pins = LogicIC.pins(spec), node = (p) => `n${pins.indexOf(p)}`;
        check(`${key} exports a SPICE model (x${TS})`, !!NetlistExtractor.digitalSubckt("x", key, { vcc: 5 }, v => v));
        const els = [{ kind: "DIGITAL", name: "U1", ic: key, nodes: pins.map((p, i) => `n${i}`), params: { vcc: 5, ro: 50 } }];
        for (const p of spec.left) els.push({ kind: "V", name: `V_${p}`, nodes: [node(p), "0"], params: drive[p] || bits(seed++, 0.5) });
        // built-in engine
        const circuit = NetlistExtractor.instantiate(els);
        const ours = new SimEngine(circuit).transient({ tStop: T_END, tStep: 20e-9 * TS, uic: true });
        // ngspice on the exported deck
        const deck = NetlistExtractor.toSpice(els, { analysis: `.tran ${(US / 100).toPrecision(3)} ${T_END} 0 ${Number(process.env.TMAX || 25e-9 * TS).toPrecision(3)} uic` });
        let theirs;
        try { theirs = NgspiceBackend.toTransient(await NgspiceBackend.run(deck), { elements: els }); } catch (e) { check(`${key}: ngspice ran`, false, e.message); continue; }
        const at = (r, name, t) => { const ts = r.timePoints, v = r.nodeHistories[name]; let lo = 0, hi = ts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; } return ts[hi] === ts[lo] ? v[lo] : v[lo] + (v[hi] - v[lo]) * (t - ts[lo]) / (ts[hi] - ts[lo]); };
        check(`${key} x${TS}: ngspice ran the whole ${T_END} s (not cut short)`, theirs.timePoints[theirs.timePoints.length - 1] > T_END * 0.99, theirs.timePoints[theirs.timePoints.length - 1]);
        let bad = 0, total = 0, first = null, skippedZ = 0;
        const outs = spec.right;
        for (let t = 0.95 * US; t < T_END - 0.2 * US; t += 1 * US) {
            for (const o of outs) {
                const a = at(ours, node(o), t), b = at(theirs, node(o), t);
                // a three-state output that is disabled floats in both engines: nothing to compare
                const lv = Object.fromEntries(spec.left.map(p => [p, at(ours, node(p), t) > 2.5 ? 1 : 0]));
                if (spec.step(spec.init(), lv, lv).out[o] === "Z") { skippedZ++; continue; }
                total++;
                if ((a > 2.5) !== (b > 2.5) || Math.abs(a - b) > 1.0) { bad++; if (!first) first = `${o} at ${(t / US).toFixed(2)} us: built-in ${a.toFixed(2)} V, ngspice ${b.toFixed(2)} V`; }
            }
        }
        if (process.env.RAW) { const ts = theirs.timePoints, y = theirs.nodeHistories[node(process.env.RAW)]; console.log(ts.length, ts.map((t, i) => [t, y[i]]).filter(([t]) => t > 2.3e-6 && t < 3.3e-6).map(([t, v]) => `${(t * 1e6).toFixed(3)}:${v.toFixed(2)}`).join(" ")); }
        if (process.env.DBG && bad) { for (let t = 0.95 * US; t < T_END - 0.2 * US; t += 1 * US) console.log((t / US).toFixed(2).padStart(6), outs.map(o => `${o}:${at(ours, node(o), t) > 2.5 ? 1 : 0}/${at(theirs, node(o), t) > 2.5 ? 1 : 0}`).join(" "), " ", spec.left.filter(p => !(drive[p] && drive[p].pulse)).map(p => `${p}=${at(ours, node(p), t) > 2.5 ? 1 : 0}/${at(theirs, node(p), t) > 2.5 ? 1 : 0}`).join(" ")); }
        check(`${key} x${TS}: ngspice and the built-in model agree on ${total} output samples${bad ? ` (${bad} differ: ${first})` : ""}`, bad === 0 && total > 0);
    }
    }
    // a disabled three-state output really floats: a 1 k load pulls it to 0, an enabled one drives it near 5 V
    {
        const spec = LOGIC_ICS["74244"], pins = LogicIC.pins(spec), node = (p) => `n${pins.indexOf(p)}`;
        const run = async (g, a) => {
            const els = [{ kind: "DIGITAL", name: "U1", ic: "74244", nodes: pins.map((p, i) => `n${i}`), params: { vcc: 5, ro: 50 } }];
            for (const p of spec.left) els.push({ kind: "V", name: `V_${p}`, nodes: [node(p), "0"], params: dc(p === "G1_N" ? g : p === "G2_N" ? 0 : (p === "A1" ? a : 0)) });
            els.push({ kind: "R", name: "RL", nodes: [node("Y1"), "0"], params: { r: 1000 } });
            const op = NgspiceBackend.toOperatingPoint(await NgspiceBackend.run(NetlistExtractor.toSpice(els, { analysis: ".op" })), { elements: els });
            return op.nodeVoltages[node("Y1")];
        };
        const on = await run(0, 1), off = await run(1, 1);
        check(`74244 enabled drives the load (${on.toFixed(2)} V), disabled leaves it floating (${off.toFixed(3)} V)`, on > 4.6 && on < 4.9 && Math.abs(off) < 0.05);
    }
    // the chips that are still not exported
    for (const key of ["74151", "7483", "7485"]) check(`${key} is still reported as not exported`, !NetlistExtractor.digitalSubckt("x", key, {}, v => v));
    console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

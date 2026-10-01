// Checks the ngspice-WASM adapter (js/sim/ngspice-backend.js) end to end in Node.
//   node tests/ngspice-wasm.test.js        (skips when `npm install` has not been run)

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
if (!fs.existsSync(path.join(root, "node_modules", "eecircuit-engine"))) {
    console.log("eecircuit-engine not installed: skipping (run npm install)");
    process.exit(0);
}

const files = ["js/utils/complex.js", "js/utils/units.js", "js/circuit/netlist.js", "js/sim/ngspice-backend.js"];
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
const { NgspiceBackend, NetlistExtractor, Complex } = new Function(src + "\nreturn { NgspiceBackend, NetlistExtractor, Complex };")();

let passed = 0, failed = 0;
const check = (name, cond, extra = "") => {
    if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

(async () => {
    const { Simulation } = await import("eecircuit-engine");
    const sim = new Simulation();
    await sim.start();
    NgspiceBackend.simulation = sim;

    // an RC low-pass as the exporter would describe it
    const info = {
        elements: [
            { kind: "V", name: "V1", nodes: ["1", "0"], params: { sourceType: "PULSE", pulse: { v1: 0, v2: 5, delay: 0, rise: 1e-9, fall: 1e-9, width: 1, period: 2 } } },
            { kind: "R", name: "R1", nodes: ["1", "2"], params: { r: 1000 } },
            { kind: "C", name: "C1", nodes: ["2", "0"], params: { c: 1e-6 } }
        ]
    };
    const deck = (analysis) => NetlistExtractor.toSpice(info.elements, { analysis });

    const op = NgspiceBackend.toOperatingPoint(await NgspiceBackend.run(deck(".op")), info);
    check("operating point maps nodes", Math.abs(op.nodeVoltages["1"]) < 1e-9 || Math.abs(op.nodeVoltages["1"] - 0) < 1e-6, JSON.stringify(op.nodeVoltages));

    const tr = NgspiceBackend.toTransient(await NgspiceBackend.run(deck(".tran 10u 5m")), info);
    const v2 = tr.nodeHistories["2"], t = tr.timePoints;
    const k = t.findIndex(x => x >= 1e-3);
    check("transient follows 1 - exp(-t/RC)", Math.abs(v2[k] - 5 * (1 - Math.exp(-t[k] / 1e-3))) < 0.05, `v=${v2[k]}`);
    check("source current is mapped by element name", Array.isArray(tr.currentHistories.V1));
    check("resistor current is derived from node voltages", Math.abs(tr.currentHistories.R1[k] - (5 - v2[k]) / 1000) < 1e-4);

    const ac = NgspiceBackend.toAc(await NgspiceBackend.run(NetlistExtractor.toSpice(
        [{ ...info.elements[0], params: { sourceType: "AC", sin: { offset: 0, amp: 1, freq: 1, phase: 0 }, acMag: 1, acPhase: 0 } }, info.elements[1], info.elements[2]],
        { analysis: ".ac dec 10 10 100k" })), info);
    const corner = ac.reduce((b, r) => (Math.abs(Math.log(r.frequency / 159.155)) < Math.abs(Math.log(b.frequency / 159.155)) ? r : b));
    check("AC magnitude is -3 dB at the corner", Math.abs(corner.nodeVoltages["2"].magnitude() - Math.SQRT1_2) < 0.05, `${corner.nodeVoltages["2"].magnitude()}`);
    check("AC gives complex node voltages", corner.nodeVoltages["2"] instanceof Complex);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

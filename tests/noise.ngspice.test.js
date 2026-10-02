// Noise analysis against ngspice's .noise:  node tests/noise.ngspice.test.js
// The built-in engine's output and input-referred noise densities are compared with ngspice for amplifiers whose
// noise comes from resistors, BJT shot noise and MOSFET channel noise. Skips cleanly without ngspice.

const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
if (spawnSync("ngspice", ["-v"]).error) { console.log("ngspice not found on PATH: skipping the noise cross-check"); process.exit(0); }

const root = path.join(__dirname, "..");
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js", "js/sim/spice-parser.js"];
const { SimEngine, SpiceParser } = new Function(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + "\nreturn { SimEngine, SpiceParser };")();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "noise-"));

// deck, output node, input source, band
const CASES = [
    ["noise_flicker", "c", "vin", [1, 1e5]],
    ["ce_amp", "c", "vin", [10, 1e6]],
    ["cs_amp", "d", "vin", [10, 1e6]],
    ["diff_pair", "c1", "v1", [1e3, 1e6]],
    ["sallen_key", "out", "v1", [10, 1e5]]
];
let failed = 0;
for (const [id, out, input, [f0, f1]] of CASES) {
    const text = fs.readFileSync(path.join(root, "tests", "decks", `${id}.cir`), "utf8");
    const deck = SpiceParser.parse(text);
    const { circuit } = SpiceParser.build(deck);
    const ours = new SimEngine(circuit).noise({ out: [out], input: input.toUpperCase(), fStart: f0, fStop: f1, pointsPerDecade: 10 });

    const body = text.split("\n").filter(l => !/^\s*\.(op|tran|ac|dc|end)\b/i.test(l)).join("\n");
    fs.writeFileSync(`${tmp}/${id}.cir`, `${body}\n.control\nset noaskquit\nnoise v(${out}) ${input} dec 10 ${f0} ${f1}\nsetplot noise1\nwrdata ${tmp}/${id}.txt onoise_spectrum inoise_spectrum\nquit\n.endc\n.end\n`);
    spawnSync("ngspice", ["-b", `${tmp}/${id}.cir`], { encoding: "utf8", timeout: 60000 });
    if (!fs.existsSync(`${tmp}/${id}.txt`)) { console.log(`skip ${id}: ngspice produced no noise data`); continue; }
    const rows = fs.readFileSync(`${tmp}/${id}.txt`, "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number)).filter(r => r.every(Number.isFinite));
    let worstO = 0, worstI = 0;
    for (const r of rows) {
        const mine = ours.reduce((b, p) => Math.abs(Math.log(p.frequency / r[0])) < Math.abs(Math.log(b.frequency / r[0])) ? p : b);
        worstO = Math.max(worstO, Math.abs(mine.onoise - r[1]) / r[1]);
        if (mine.inoise !== null) worstI = Math.max(worstI, Math.abs(mine.inoise - r[3]) / r[3]);
    }
    const bad = worstO > 0.02 || worstI > 0.02;
    if (bad) failed++;
    console.log(`${bad ? "FAIL" : "ok  "} ${id}: output noise within ${(worstO * 100).toFixed(2)} %, input-referred within ${(worstI * 100).toFixed(2)} % of ngspice (${rows.length} points)`);
}
console.log(failed ? `\n${failed} case(s) disagree with ngspice` : "\nnoise agrees with ngspice");
process.exit(failed ? 1 : 0);

// Transfer function (.tf) against ngspice:  node tests/tf.ngspice.test.js
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
if (spawnSync("ngspice", ["-v"]).error) { console.log("ngspice not found on PATH: skipping the .tf cross-check"); process.exit(0); }
const root = path.join(__dirname, "..");
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js", "js/sim/spice-parser.js"];
const { SimEngine, SpiceParser } = new Function(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + "\nreturn { SimEngine, SpiceParser };")();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tf-"));
const CASES = [["diff_pair", "c1", "v1"], ["diff_pair", "c2", "v1"], ["sallen_key", "out", "v1"], ["cs_amp", "d", "vin"], ["ce_amp", "c", "vin"], ["bridge_rect", "p", "v1"], ["controlled", null, null]];
let failed = 0;
for (const [id, out, input] of CASES) {
    const text = fs.readFileSync(path.join(root, "tests", "decks", `${id}.cir`), "utf8");
    let o = out, i = input;
    if (!o) { const tf = text.match(/^\.tf\s+v\(([^)]+)\)\s+(\S+)/im); if (!tf) continue; o = tf[1]; i = tf[2]; }
    const { circuit } = SpiceParser.build(SpiceParser.parse(text));
    const ours = new SimEngine(circuit).tf({ out: [o], input: i.toUpperCase() });
    const body = text.split("\n").filter(l => !/^\s*\.(op|tran|ac|dc|tf|end)\b/i.test(l)).join("\n");
    fs.writeFileSync(`${tmp}/${id}.cir`, `${body}\n.control\nset noaskquit\ntf v(${o}) ${i}\nprint all\nquit\n.endc\n.end\n`);
    const res = spawnSync("ngspice", ["-b", `${tmp}/${id}.cir`], { encoding: "utf8" });
    const g = (re) => { const m = (res.stdout + res.stderr).match(re); return m ? parseFloat(m[1]) : NaN; };
    const ng = { gain: g(/transfer_function\s*=\s*(\S+)/), rout: g(/output_impedance_at_[^\s]+\s*=\s*(\S+)/), rin: g(/input_impedance\s*=\s*(\S+)/) };
    if (Number.isNaN(ng.gain)) { console.log(`skip ${id}: ngspice gave no .tf result`); continue; }
    const close = (a, b) => (b > 1e15 ? a > 1e12 : Math.abs(a - b) <= 1e-3 * Math.abs(b) + 1e-9);
    const bad = !close(ours.gain, ng.gain) || !close(ours.rout, ng.rout) || !close(ours.rin, ng.rin);
    if (bad) failed++;
    console.log(`${bad ? "FAIL" : "ok  "} ${id} v(${o}) / ${i}: gain ${ours.gain.toPrecision(5)} (${ng.gain.toPrecision(5)}), Rin ${ours.rin.toPrecision(5)} (${ng.rin.toPrecision(5)}), Rout ${ours.rout.toPrecision(5)} (${ng.rout.toPrecision(5)})`);
}
console.log(failed ? `\n${failed} case(s) disagree with ngspice` : "\n.tf agrees with ngspice");
process.exit(failed ? 1 : 0);

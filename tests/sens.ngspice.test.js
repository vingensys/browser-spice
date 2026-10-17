// DC sensitivity (.sens) against ngspice:  node tests/sens.ngspice.test.js
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
if (spawnSync("ngspice", ["-v"]).error) { console.log("ngspice not found on PATH: skipping the .sens cross-check"); process.exit(0); }
const { SimEngine, SpiceParser } = require("../mcp/engine.cjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sens-"));
const CASES = {
    divider: ["divider\nV1 in 0 DC 5\nR1 in out 1k\nR2 out 0 2k\nR3 out m 500\nR4 m 0 1k\nI1 0 out DC 1m\n", ["out"]],
    bridge: ["bridge\nV1 a 0 DC 10\nR1 a b 1k\nR2 b 0 2k\nR3 a c 3k\nR4 c 0 1k\nR5 b c 10k\n", ["b", "c"]],
    twosrc: ["two sources\nV1 a 0 DC 3\nV2 c 0 DC -2\nR1 a b 470\nR2 b c 1.5k\nR3 b 0 10k\nI1 0 b DC 2m\n", ["b"]]
};
let failed = 0;
for (const [id, [body, out]] of Object.entries(CASES)) {
    const { circuit } = SpiceParser.build(SpiceParser.parse(body + ".end\n"));
    const ours = new SimEngine(circuit).sens({ out });
    const expr = out.length === 2 ? `v(${out[0]},${out[1]})` : `v(${out[0]})`;
    fs.writeFileSync(`${tmp}/${id}.cir`, `${body}.control\nset noaskquit\nsens ${expr}\nprint all\nquit\n.endc\n.end\n`);
    const res = spawnSync("ngspice", ["-b", `${tmp}/${id}.cir`], { encoding: "utf8" });
    const txt = res.stdout + res.stderr;
    let bad = 0, n = 0;
    for (const r of ours.rows) {
        const m = txt.match(new RegExp(`^${r.element.toLowerCase()}\\s*=\\s*(\\S+)`, "m"));
        if (!m) { console.log(`FAIL ${id}: ngspice printed no sensitivity for ${r.element}`); bad++; continue; }
        const ng = parseFloat(m[1]); n++;
        if (Math.abs(r.abs - ng) > 1e-4 * Math.abs(ng) + 1e-12) { console.log(`FAIL ${id} ${r.element}: ${r.abs.toPrecision(6)} vs ngspice ${ng.toPrecision(6)}`); bad++; }
    }
    if (bad) failed++;
    console.log(`${bad ? "FAIL" : "ok  "} ${id}: ${n} sensitivities agree with ngspice`);
}
// the same through the MCP tool and the .sens card
const { simulate } = require("../mcp/tools.cjs");
const r = simulate({ netlist: CASES.divider[0] + ".sens v(out)\n.end\n" });
const r1 = r.sensitivities && r.sensitivities.find(x => x.element === "R1");
const mcpOk = !!r1 && r1.d_output_d_parameter < 0 && Math.abs(r.output_dc) > 0;
if (!mcpOk) failed++;
console.log(`${mcpOk ? "ok  " : "FAIL"} MCP simulate picks up the .sens card (R1: ${r1 && r1.d_output_d_parameter})`);
console.log(failed ? `\n${failed} case(s) disagree` : "\n.sens agrees with ngspice");
process.exit(failed ? 1 : 0);

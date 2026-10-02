// KiCad import on real KiCad 7/8 projects: the simulation demos of the KiCad source tree, fetched when this runs (they are
// not bundled). Every file must import; the self-contained ones must match native ngspice; parts whose model is a vendor library
// file are reported with stand-ins, never dropped silently.   node tests/kicad/real-files.mjs   (needs network)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../../mcp/engine.cjs"), { TOOLS } = require("../../mcp/tools.cjs");
const base = "https://raw.githubusercontent.com/KiCad/kicad-source-mirror/master/demos/simulation/";
const files = { "amplifier-ac/amplifier-ac": "self", "rectifier/rectifier": "self", "v_i_sources/v_i_sources": "sources", "sallen_key/sallen_key": "opamp", "laser_driver/laser_driver": "opamp", "gain_control/mult_vca810": "lib", "class-d/Class-D": "lib", "q17/Q17ng": "lib" };
let pass = 0, fail = 0; const row = (ok, s, d = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + s + (ok ? "" : "\n        -> " + d)); };
let fetched = 0;
for (const [f, kind] of Object.entries(files)) {
    let text;
    try { text = await (await fetch(base + f + ".kicad_sch")).text(); fetched++; } catch (e) { console.log("SKIP  " + f + " (no network)"); continue; }
    const name = f.split("/")[1];
    let r;
    try { r = E.KicadImporter.toSpice(text); } catch (e) { row(false, `${name}: imports`, e.message); continue; }
    const d = E.SpiceParser.parse(r.deck), { circuit } = E.SpiceParser.build(d);
    let ok = true, err = "";
    try { new E.SimEngine(circuit).operatingPoint(); } catch (e) { ok = false; err = e.message; }
    row(ok, `${name}: ${r.deck.split("\n").length - 3} lines, ${r.warnings.length} note(s), operating point converges`, err);
    if (kind === "self" || kind === "sources") {
        const c = TOOLS.find(t => t.name === "compare_with_ngspice").run({ netlist: r.deck.replace(".end", ".op\n.end") });
        row(c.operatingPoint.worst_deviation_percent_of_full_scale < 0.5, `${name}: operating point matches native ngspice (${c.operatingPoint.worst_deviation_percent_of_full_scale}% of full scale)`, JSON.stringify(c.operatingPoint).slice(0, 200));
    }
    if (kind === "opamp") row(r.warnings.some(w => /generic op-amp/.test(w)), `${name}: the vendor op-amp is replaced by a generic one and the note says so`, r.warnings.join("; "));
    if (kind === "lib") row(r.warnings.length > 0, `${name}: parts with unavailable library models are reported`, "");
}
if (!fetched) console.log("(no files fetched: nothing checked)");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

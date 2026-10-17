// .include / .lib resolution: node tests/include.test.js
const { SpiceParser, SimEngine } = require("../mcp/engine.cjs");
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const op = (deck) => { const { circuit } = SpiceParser.build(deck); const r = new SimEngine(circuit).operatingPoint(); return r.nodeVoltages; };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const lib = `vendor models
.subckt half a b out
R1 a out 1k
R2 out b 1k
.ends
.model dx D(IS=1e-14)
.end`;
const deck = (inc) => `divider\nV1 in 0 DC 5\n${inc}\nX1 in 0 mid half\n.op\n.end`;

let d = SpiceParser.parse(deck('.include "models/Vendor.LIB"'), { files: { "vendor.lib": lib } });
check("include: subckt from the file is used", near(op(d).mid, 2.5), JSON.stringify(op(d)));
check("include: no warnings, nothing missing", d.warnings.length === 0 && d.missingFiles.length === 0, d.warnings);
check("include: name match ignores path and case", SpiceParser.parse(deck(".inc VENDOR.lib"), { files: { "C:\\x\\vendor.lib": lib } }).missingFiles.length === 0);
check("include: the file's .end does not stop the deck", SpiceParser.parse(deck(".include vendor.lib"), { files: { "vendor.lib": lib } }).analyses.length === 1);

d = SpiceParser.parse(deck(".include nothere.lib"), {});
check("include: a missing file is reported", d.missingFiles[0] === "nothere.lib" && /not found/.test(d.warnings.join()), d.warnings);

const sections = `corners
.lib typ
.subckt half a b out
R1 a out 1k
R2 out b 1k
.ends
.endl
.lib slow
.subckt half a b out
R1 a out 1k
R2 out b 3k
.ends
.endl`;
d = SpiceParser.parse(deck(".lib corners.lib slow"), { files: { "corners.lib": sections } });
check("lib: the named section only (slow -> 3.75 V)", near(op(d).mid, 3.75), JSON.stringify(op(d)));
d = SpiceParser.parse(deck(".lib corners.lib typ"), { files: { "corners.lib": sections } });
check("lib: the other section (typ -> 2.5 V)", near(op(d).mid, 2.5));
d = SpiceParser.parse(deck(".lib corners.lib fast"), { files: { "corners.lib": sections } });
check("lib: unknown section is a warning", /section "fast" was not found/.test(d.warnings.join()), d.warnings);
d = SpiceParser.parse(sections + "\nR9 a 0 1k\n.end");
check("lib: a library file parsed on its own raises no warning", d.warnings.length === 0, d.warnings);

d = SpiceParser.parse(deck(".include a.lib"), { files: { "a.lib": ".include b.lib\n", "b.lib": lib } });
check("nested includes resolve", near(op(d).mid, 2.5));
d = SpiceParser.parse(deck(".include a.lib"), { files: { "a.lib": ".include b.lib\n", "b.lib": ".include a.lib\n" + lib } });
check("circular includes are cut, not looped", /circular/.test(d.warnings.join()) && near(op(d).mid, 2.5), d.warnings);

check("pickRoot: the file nobody includes", SpiceParser.pickRoot({ "vendor.lib": lib, "top.cir": deck(".include vendor.lib") }) === "top.cir");
check("pickRoot: prefers the file with elements", SpiceParser.pickRoot({ "a.lib": lib, "b.cir": deck("") }) === "b.cir");

// through the MCP tool
const { simulate } = require("../mcp/tools.cjs");
const r = simulate({ netlist: deck(".include vendor.lib"), files: { "vendor.lib": lib }, analysis: "op", signals: ["v(mid)"] });
check("MCP simulate accepts files", JSON.stringify(r).includes("2.5"), JSON.stringify(r).slice(0, 200));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

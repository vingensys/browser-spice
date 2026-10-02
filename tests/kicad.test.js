// KiCad schematic / netlist import: pins are placed from symbol geometry and the nets recomputed.
//   node tests/kicad.test.js
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js/ui/kicad-import.js"), "utf8");
const { KicadImporter } = new Function(src + "\nreturn { KicadImporter };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const sym2 = (id, a, b) => `(symbol "${id}" (symbol "${id.split(":")[1]}_1_1"
  (pin passive line (at 0 3.81 270) (length 1.27) (name "${a}" (effects)) (number "1" (effects)))
  (pin passive line (at 0 -3.81 90) (length 1.27) (name "${b}" (effects)) (number "2" (effects)))))`;
const inst = (id, ref, val, x, y, rot = 0, extra = "") => `(symbol (lib_id "${id}") (at ${x} ${y} ${rot}) (unit 1) ${extra}
  (property "Reference" "${ref}" (at 0 0 0)) (property "Value" "${val}" (at 0 0 0)))`;
const sch = `(kicad_sch (version 20230121) (generator eeschema)
 (lib_symbols
  ${sym2("Device:R", "~", "~")}
  (symbol "power:GND" (power) (symbol "GND_1_1" (pin power_in line (at 0 0 270) (length 0) (name "GND" (effects)) (number "1" (effects)))))
  (symbol "Simulation_SPICE:VDC" (symbol "VDC_1_1"
    (pin passive line (at 0 5.08 270) (length 1.27) (name "+" (effects)) (number "1" (effects)))
    (pin passive line (at 0 -5.08 90) (length 1.27) (name "-" (effects)) (number "2" (effects))))))
 ${inst("Simulation_SPICE:VDC", "V1", "5", 40, 60, 0, '')}
 ${inst("Device:R", "R1", "1k", 60, 50)}
 ${inst("Device:R", "R2", "2k", 60, 70)}
 ${inst("power:GND", "#PWR01", "GND", 40, 70)}
 ${inst("power:GND", "#PWR02", "GND", 60, 80)}
 (wire (pts (xy 40 54.92) (xy 40 46.19)) (stroke (width 0)))
 (wire (pts (xy 40 46.19) (xy 60 46.19)) (stroke (width 0)))
 (wire (pts (xy 60 53.81) (xy 60 66.19)) (stroke (width 0)))
 (wire (pts (xy 40 65.08) (xy 40 70)) (stroke (width 0)))
 (wire (pts (xy 60 73.81) (xy 60 80)) (stroke (width 0)))
 (label "mid" (at 60 60 0)))`;
const r = KicadImporter.toSpice(sch);
console.log(r.deck, r.warnings);
check("V1 sits between the supply net and ground", /^V1 N\d+ 0 DC 5$/m.test(r.deck));
check("R1 joins the supply to the labelled net", /^R1 N\d+ mid 1k$/m.test(r.deck));
check("R2 joins the labelled net to ground (power symbols name it 0)", /^R2 mid 0 2k$/m.test(r.deck));
check("the supply net is the same on V1 and R1", (() => { const v = r.deck.match(/^V1 (\S+)/m)[1], q = r.deck.match(/^R1 (\S+)/m)[1]; return v === q; })());
check("no warnings for a clean schematic", r.warnings.length === 0, r.warnings);
// rotation: R1 rotated 90 puts pin 1 to the left
const rot = sch.replace(inst("Device:R", "R1", "1k", 60, 50), inst("Device:R", "R1", "1k", 60, 50, 90)).replace("(wire (pts (xy 40 46.19) (xy 60 46.19))", "(wire (pts (xy 40 46.19) (xy 40 50)) (stroke (width 0))) (wire (pts (xy 40 50) (xy 56.19 50))");
const rr = KicadImporter.toSpice(rot);
check("a symbol rotated 90° has its pin 1 on the left", /^R1 N\d+ N\d+ 1k$/m.test(rr.deck) && rr.deck.match(/^V1 (\S+)/m)[1] === rr.deck.match(/^R1 (\S+)/m)[1], rr.deck);
// netlist format
const net = `(export (version "E") (components
 (comp (ref "R1") (value "1k") (libsource (lib "Device") (part "R")))
 (comp (ref "Q1") (value "2N3906") (libsource (lib "Device") (part "Q_PNP_BCE")) )
 (comp (ref "U1") (value "LM358") (libsource (lib "Amplifier_Operational") (part "LM358"))))
 (nets
  (net (code "1") (name "/in") (node (ref "R1") (pin "1")) (node (ref "Q1") (pin "1") (pinfunction "B")))
  (net (code "2") (name "GND") (node (ref "R1") (pin "2")) (node (ref "Q1") (pin "3") (pinfunction "E")))
  (net (code "3") (name "Net-(Q1-C)") (node (ref "Q1") (pin "2") (pinfunction "C")) (node (ref "U1") (pin "1")))))`;
const rn = KicadImporter.toSpice(net);
check("a .net netlist maps R and the PNP transistor with its type", /^R1 in 0 1k$/m.test(rn.deck) && /^Q1 Net-_Q1-C_ in 0 2N3906$/m.test(rn.deck) && /^\.model 2N3906 PNP$/m.test(rn.deck), rn.deck);
check("an unmapped part is reported, not dropped silently", rn.warnings.some(w => /U1/.test(w)), rn.warnings);
check("garbage is refused", (() => { try { KicadImporter.toSpice("(foo)"); return false; } catch (e) { return /neither/.test(e.message); } })());
check("a truncated file is refused", (() => { try { KicadImporter.toSpice("(kicad_sch (wire"); return false; } catch (e) { return /truncated/.test(e.message); } })());
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);

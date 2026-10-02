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
check("a .net netlist maps R and the PNP transistor with its type", /^R1 in 0 1k$/m.test(rn.deck) && /^Q1 Netm_Q1mC_ in 0 2N3906$/m.test(rn.deck) && /^\.model 2N3906 PNP$/m.test(rn.deck), rn.deck);
check("an unmapped part is reported, not dropped silently", rn.warnings.some(w => /U1/.test(w)), rn.warnings);
check("garbage is refused", (() => { try { KicadImporter.toSpice("(foo)"); return false; } catch (e) { return /neither/.test(e.message); } })());
check("a truncated file is refused", (() => { try { KicadImporter.toSpice("(kicad_sch (wire"); return false; } catch (e) { return /truncated/.test(e.message); } })());
// ---- values and Sim.* fields as real KiCad 7 / 8 files write them
{
    const V = (x) => KicadImporter.spiceValue(x);
    check("KiCad value notations: 2k7 -> 2.7k, 10R -> 10, 4R7 -> 4.7, 1M -> 1meg, 2200uF;63V -> 2200uF, 10;2W -> 10", V("2k7") === "2.7k" && V("10R") === "10" && V("4R7") === "4.7" && V("1M") === "1meg" && V("2200uF;63V") === "2200uF" && V("10;2W") === "10", [V("2k7"), V("10R"), V("4R7"), V("1M"), V("2200uF;63V"), V("10;2W")]);
    check("but a lower-case m stays milli and an explicit meg stays", V("5m") === "5m" && V("2meg") === "2meg");
    const P = KicadImporter.simParams('y1=-1 y2=1 td=2n pwl="0 -1.2 10m -1.2" type="V"');
    check("Sim.Params are key=value pairs with quoted values", P.y1 === "-1" && P.td === "2n" && P.pwl === "0 -1.2 10m -1.2" && P.type === "V", JSON.stringify(P));
    check("Sim.Pins map pin numbers to roles", JSON.stringify(KicadImporter.simPins("1=C 2=B 3=E")) === '{"1":"C","2":"B","3":"E"}');
    const sym = (ref, lib, props, pins) => `(symbol (lib_id "${lib}") (at 0 0 0) (unit 1) (property "Reference" "${ref}" (at 0 0 0)) ${Object.entries(props).map(([k, v]) => `(property "${k}" "${v.replace(/"/g, '\\"')}" (at 0 0 0))`).join(" ")})`;
    // build a one-source / one-resistor file with the source modelled by Sim.* fields
    const file = (src) => `(kicad_sch (version 20230121) (lib_symbols
      (symbol "S:V" (symbol "V_1_1" (pin passive line (at 0 5.08 270) (length 1) (name "+" (effects)) (number "1" (effects))) (pin passive line (at 0 -5.08 90) (length 1) (name "-" (effects)) (number "2" (effects)))))
      (symbol "S:R" (symbol "R_1_1" (pin passive line (at 0 3.81 270) (length 1) (name "~" (effects)) (number "1" (effects))) (pin passive line (at 0 -3.81 90) (length 1) (name "~" (effects)) (number "2" (effects)))))
      (symbol "power:GND" (power) (symbol "GND_1_1" (pin power_in line (at 0 0 270) (length 0) (name "GND" (effects)) (number "1" (effects))))))
      ${src}
      ${sym("R1", "S:R", { Value: "1k" }).replace("(at 0 0 0)", "(at 30 50 0)")}
      ${sym("#PWR1", "power:GND", { Value: "GND" }).replace("(at 0 0 0)", "(at 30 60 0)")}
      ${sym("#PWR2", "power:GND", { Value: "GND" }).replace("(at 0 0 0)", "(at 10 70 0)")}
      (wire (pts (xy 10 54.92) (xy 10 46.19) (xy 30 46.19))) (wire (pts (xy 30 53.81) (xy 30 60.19))) (wire (pts (xy 10 65.08) (xy 10 70))))`;
    const v = (type, params, value = "V") => file(sym("V1", "S:V", { Value: value, "Sim.Device": "V", "Sim.Type": type, "Sim.Params": params, "Sim.Pins": "1=+ 2=-" }).replace("(at 0 0 0)", "(at 10 60 0)"));
    const deckOf = (t) => KicadImporter.toSpice(t).deck;
    check("a PULSE source from Sim.Type / Sim.Params", /^V1 \S+ 0 PULSE\(0 3 100n 1n 1n 20n 100n\)$/m.test(deckOf(v("PULSE", "y1=0 y2=3 td=100n tr=1n tf=1n tw=20n per=100n"))), deckOf(v("PULSE", "y1=0 y2=3 td=100n tr=1n tf=1n tw=20n per=100n")));
    check("a SIN source with an AC magnitude", /^V1 \S+ 0 SIN\(0 1 1k 0 0 0\) AC 1$/m.test(deckOf(v("SIN", "dc=0 ampl=1 f=1k ac=1"))), deckOf(v("SIN", "dc=0 ampl=1 f=1k ac=1")));
    check("a PWL source", /^V1 \S+ 0 PWL\(0 0 1m 5\)$/m.test(deckOf(v("PWL", 'pwl="0 0 1m 5"'))), deckOf(v("PWL", 'pwl="0 0 1m 5"')));
    check("a DC source whose Value is the ${SIM.PARAMS} variable still gets a number (0, or dc=)", /^V1 \S+ 0 DC 0 AC 1$/m.test(deckOf(v("DC", "ac=1", "${SIM.PARAMS}"))) && /^V1 \S+ 0 DC 12$/m.test(deckOf(v("DC", "dc=12"))), deckOf(v("DC", "ac=1", "${SIM.PARAMS}")));
    const t = KicadImporter.toSpice(v("RANDUNIFORM", "ts=1u"));
    check("an unsupported source type is reported by name", t.warnings.some(w => /V1.*RANDUNIFORM/.test(w)), t.warnings);
    const rawV = KicadImporter.toSpice(file(sym("V1", "S:V", { Value: "VPWL", "Sim.Device": "SPICE", "Sim.Params": 'type="V" model="pwl(0 -7 50n -7)" lib=""', "Sim.Pins": "1=1 2=2" }).replace("(at 0 0 0)", "(at 10 60 0)")));
    check("a raw SPICE source model (dev SPICE: pwl / sffm) is passed through", /^V1 \S+ 0 pwl\(0 -7 50n -7\)$/m.test(rawV.deck), rawV.deck);
}
// ---- hierarchical sheets
{
    const lib = `(lib_symbols
      (symbol "S:R" (symbol "R_1_1" (pin passive line (at 0 3.81 270) (length 1) (name "~" (effects)) (number "1" (effects))) (pin passive line (at 0 -3.81 90) (length 1) (name "~" (effects)) (number "2" (effects)))))
      (symbol "S:V" (symbol "V_1_1" (pin passive line (at 0 5.08 270) (length 1) (name "+" (effects)) (number "1" (effects))) (pin passive line (at 0 -5.08 90) (length 1) (name "-" (effects)) (number "2" (effects)))))
      (symbol "power:GND" (power) (symbol "GND_1_1" (pin power_in line (at 0 0 270) (length 0) (name "GND" (effects)) (number "1" (effects))))))`;
    const part = (id, ref, val, x, y, extra = "") => `(symbol (lib_id "${id}") (at ${x} ${y} 0) (unit 1) (property "Reference" "${ref}" (at 0 0 0)) (property "Value" "${val}" (at 0 0 0)) ${extra})`;
    // child: a hierarchical label "in" on a wire to R2 (pin 1), R2 pin 2 to a local label "mid" and on to R3 to GND
    const child = `(kicad_sch (version 20230121) ${lib}
      (hierarchical_label "in" (at 10 40 0))
      (wire (pts (xy 10 40) (xy 30 40) (xy 30 46.19)))
      ${part("S:R", "R2", "2k", 30, 50)}
      (wire (pts (xy 30 53.81) (xy 30 60.19)))
      (label "mid" (at 30 56 0))
      ${part("S:R", "R3", "3k", 30, 64)}
      (wire (pts (xy 30 67.81) (xy 30 75)))
      ${part("power:GND", "#PWR3", "GND", 30, 75)})`;
    const main = `(kicad_sch (version 20230121) ${lib}
      ${part("S:V", "V1", "5", 10, 60, '(property "Sim.Device" "V" (at 0 0 0)) (property "Sim.Type" "DC" (at 0 0 0)) (property "Sim.Params" "dc=5" (at 0 0 0)) (property "Sim.Pins" "1=+ 2=-" (at 0 0 0))')}
      ${part("power:GND", "#PWR1", "GND", 10, 70)} (wire (pts (xy 10 65.08) (xy 10 70)))
      ${part("S:R", "R1", "1k", 40, 40)}
      (wire (pts (xy 10 54.92) (xy 10 30) (xy 40 30) (xy 40 36.19)))
      (wire (pts (xy 40 43.81) (xy 60 43.81)))
      (sheet (at 60 40) (size 20 10)
        (property "Sheetname" "load" (at 0 0 0)) (property "Sheetfile" "load.kicad_sch" (at 0 0 0))
        (pin "in" input (at 60 43.81 180))))`;
    const r = KicadImporter.toSpice(main, { "load.kicad_sch": child });
    check("a sub-sheet is followed: its parts come in, joined to the main sheet through the sheet pin", /^R1 \S+ (\S+) 1k$/m.test(r.deck) && /^R2 /m.test(r.deck) && /^R3 /m.test(r.deck), r.deck);
    const nodeOf = (name, k) => r.deck.match(new RegExp(`^${name} (\\S+) (\\S+)`, "m"))[k];
    check("R1's far end is R2's near end (through the pin 'in' and the hierarchical label)", nodeOf("R1", 2) === nodeOf("R2", 1), r.deck);
    check("the sub-sheet's own net ('mid') joins R2 to R3 and its ground is the global 0", nodeOf("R2", 2) === nodeOf("R3", 1) && nodeOf("R3", 2) === "0", r.deck);
    check("no warning when the sheet file is provided", r.warnings.length === 0, r.warnings);
    const missing = KicadImporter.toSpice(main);
    check("without the file the sheet is left out and the note says what to do", missing.warnings.some(w => /load\.kicad_sch was not provided/.test(w)) && !/^R2 /m.test(missing.deck), missing.warnings);
    check("pickRoot chooses the sheet nobody refers to", KicadImporter.pickRoot({ "load.kicad_sch": child, "top.kicad_sch": main }) === "top.kicad_sch");
    // the same sheet used twice keeps the two copies' local nets apart
    const main2 = main.replace(/\(sheet \(at 60 40\)[\s\S]*$/, `(sheet (at 60 40) (size 20 10) (property "Sheetname" "a" (at 0 0 0)) (property "Sheetfile" "load.kicad_sch" (at 0 0 0)) (pin "in" input (at 60 43.81 180)))
      (wire (pts (xy 60 43.81) (xy 60 43.81)))
      (sheet (at 60 70) (size 20 10) (property "Sheetname" "b" (at 0 0 0)) (property "Sheetfile" "load.kicad_sch" (at 0 0 0)) (pin "in" input (at 60 73.81 180)))
      (wire (pts (xy 40 43.81) (xy 45 43.81) (xy 45 73.81) (xy 60 73.81))))`);
    const r2 = KicadImporter.toSpice(main2, { "load.kicad_sch": child });
    const mids = [...r2.deck.matchAll(/^R[23] (\S+) (\S+)/gm)].length;
    check("one sheet file used twice gives two separate copies (six parts, two 'mid' nets)", (r2.deck.match(/^R\d+_? /gm) || []).length >= 5 && new Set([...r2.deck.matchAll(/^R2\S* (\S+) (\S+)/gm)].map(m => m[2])).size === 2, r2.deck);
}
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);

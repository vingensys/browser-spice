// .measure against ngspice:  node tests/measure.ngspice.test.js
// The decks in tests/measure carry .meas lines. Each is evaluated by Measure on the built-in engine's results and by
// ngspice itself; the numbers must agree. Skips cleanly without ngspice.

const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
if (spawnSync("ngspice", ["-v"]).error) { console.log("ngspice not found on PATH: skipping the .measure cross-check"); process.exit(0); }
const root = path.join(__dirname, "..");
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js", "js/visualization/plot-math.js", "js/analysis/measure.js", "js/sim/spice-parser.js"];
const { SimEngine, SpiceParser, Measure } = new Function(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + "\nreturn { SimEngine, SpiceParser, Measure };")();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meas-"));
let failed = 0, total = 0;
for (const id of ["tran", "ac"]) {
    const text = fs.readFileSync(path.join(root, "tests", "measure", `${id}.cir`), "utf8");
    const deck = SpiceParser.parse(text);
    const { circuit } = SpiceParser.build(deck);
    const eng = new SimEngine(circuit);
    const an = deck.analyses[0];
    const get = an.type === "tran" ? Measure.tranSignals(eng.transient({ tStop: an.tStop, tStep: an.tStep, uic: true })) : Measure.acSignals(eng.ac({ fStart: an.fStart, fStop: an.fStop, pointsPerDecade: an.points }));
    // ngspice runs each measurement as a control-mode `meas` command, written back from the parsed spec (so the SPICE
    // writer is exercised too); its `vp` is in radians, ours in degrees
    const body = text.split("\n").filter(l => !/^\s*\.(meas|measure|end|tran|ac)\b/i.test(l)).join("\n");
    const run = an.type === "tran" ? `tran ${an.tStep} ${an.tStop} uic` : `ac ${an.mode} ${an.points} ${an.fStart} ${an.fStop}`;
    fs.writeFileSync(`${tmp}/${id}.cir`, `${body}\n.control\nset noaskquit\n${run}\n${deck.measures.map(m => Measure.toSpice(m).slice(1)).join("\n")}\nquit\n.endc\n.end\n`);
    const out = spawnSync("ngspice", ["-b", `${tmp}/${id}.cir`], { encoding: "utf8", timeout: 60000 });
    const ng = {};
    for (const m of (out.stdout + out.stderr).matchAll(/^(\w+)\s+=\s+(\S+)/gm)) ng[m[1].toLowerCase()] = parseFloat(m[2]);
    for (const spec of deck.measures) {
        total++;
        let mine, why = "";
        try { mine = Measure.compute(spec, get); } catch (e) { mine = NaN; why = e.message; }
        let ref = ng[spec.name];
        if (spec.fn === "findph") ref = ref * 180 / Math.PI;
        const span = Math.max(Math.abs(ref), 1e-12);
        const tol = ["integ", "avg", "rms"].includes(spec.fn) ? 0.01 : 0.005;
        const good = Number.isFinite(ref) && Number.isFinite(mine) && Math.abs(mine - ref) <= tol * span + (an.type === "tran" ? 2 * an.tStep : 0) * (["when", "delay"].includes(spec.fn) ? 1 : 0) + 1e-9 * (spec.fn === "find" ? 0 : 0);
        if (!good) failed++;
        console.log(`${good ? "ok  " : "FAIL"} ${id}: ${spec.name} (${spec.fn} ${spec.sig}) = ${Number.isFinite(mine) ? mine.toPrecision(6) : "—"} ${why}   ngspice ${ref}`);
    }
}
console.log(failed ? `\n${failed} of ${total} measurements disagree with ngspice` : `\nall ${total} measurements agree with ngspice`);
process.exit(failed ? 1 : 0);

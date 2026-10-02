// Loads the browser-spice simulation engine into Node (no DOM): the same files the page runs, concatenated.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js",
    "js/sim/models.js", "js/sim/models-extra.js", "js/sim/models-parts.js", "js/sim/engine.js", "js/visualization/plot-math.js", "js/visualization/fft.js", "js/analysis/measure.js", "js/sim/spice-parser.js", "js/ui/kicad-import.js", "js/pcb/pcb.js"];
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
module.exports = new Function(src + "\nreturn { SimEngine, SpiceParser, Measure, PlotMath, Spectrum, Units, Complex, SIM_MODELS, simModelCardFromParams, SimCircuit, Expr, Pcb, KicadImporter };")();

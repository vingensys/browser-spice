// Cross-checks the engine against native ngspice on a library of reference decks.
//   node tests/ngspice.test.js            (skips cleanly when ngspice is not installed)
//
// Every deck in tests/decks is parsed by SpiceParser, simulated by SimEngine, and also
// run through ngspice. DC operating points, transient waveforms and AC magnitudes are
// compared node by node.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const files = [
    "js/utils/complex.js", "js/utils/units.js",
    "js/sim/linalg.js", "js/sim/devices.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js", "js/sim/spice-parser.js"
];
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
const { SimEngine, SpiceParser, SPARSE_THRESHOLD } = new Function(src + "\nreturn { SimEngine, SpiceParser, SPARSE_THRESHOLD };")();
if (process.env.SPARSE) SPARSE_THRESHOLD.n = 0; // force the sparse solver for every circuit

if (spawnSync("ngspice", ["-v"]).error) {
    console.log("ngspice not found on PATH: skipping cross-check");
    process.exit(0);
}

// per-deck tolerances (fraction of the signal's peak-to-peak range)
const TOL = {
    default: { op: 0.005, tran: 0.02, ac: 0.01 },
    cmos_inv: { op: 0.005, tran: 0.04, ac: 0.01 },
    npn_switch: { op: 0.005, tran: 0.04, ac: 0.01 },
    // the inductive kick when the diode turns off is a narrow spike; its timing sets the error
    transformer_rect: { op: 0.005, tran: 0.03, ac: 0.01 }
};

const dir = path.join(root, "tests", "decks");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ngcheck-"));
let failed = 0;

function readPairs(file, vectors) {
    const cols = fs.readFileSync(file, "utf8").split("\n").map(l => l.trim()).filter(Boolean)
        .map(l => l.split(/\s+/).map(Number)).filter(r => r.every(Number.isFinite));
    return {
        x: cols.map(r => r[0]),
        y: vectors.map((_, i) => cols.map(r => r[2 * i + 1]))
    };
}

function interp(xs, ys, x) {
    let lo = 0, hi = xs.length - 1;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[hi]) return ys[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
    return ys[lo] + f * (ys[hi] - ys[lo]);
}

for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".cir")).sort()) {
    const id = path.basename(file, ".cir");
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const tol = TOL[id] || TOL.default;
    const deck = SpiceParser.parse(text);
    const { circuit, warnings } = SpiceParser.build(deck);
    const nodes = circuit.names.filter(n => !n.includes("#") && !n.includes("."));
    const sim = new SimEngine(circuit, { temp: deck.temp === undefined ? 27 : deck.temp });

    // ngspice run
    const body = text.split("\n").filter(l => !/^\s*\.(op|tran|ac|dc|end)\b/i.test(l)).join("\n");
    const ctl = [".control", "set noaskquit"];
    const op = deck.analyses.find(a => a.type === "op");
    const tr = deck.analyses.find(a => a.type === "tran");
    const ac = deck.analyses.find(a => a.type === "ac");
    if (op) { ctl.push("op"); nodes.forEach(n => ctl.push(`print v(${n})`)); }
    if (tr) {
        ctl.push(`tran ${tr.tStep} ${tr.tStop}${tr.uic ? " uic" : ""}`);
        ctl.push(`wrdata ${tmp}/${id}.tran.txt ${nodes.map(n => `v(${n})`).join(" ")}`);
    }
    if (ac) {
        ctl.push(`ac ${ac.mode} ${ac.points} ${ac.fStart} ${ac.fStop}`);
        ctl.push(`wrdata ${tmp}/${id}.ac.txt ${nodes.map(n => `vm(${n})`).join(" ")}`);
    }
    ctl.push("quit", ".endc", ".end");
    const deckPath = path.join(tmp, `${id}.cir`);
    fs.writeFileSync(deckPath, body + "\n" + ctl.join("\n") + "\n");
    const run = spawnSync("ngspice", ["-b", deckPath], { encoding: "utf8", timeout: 120000 });
    const out = run.stdout + run.stderr;

    const lines = [];
    let worst = {};

    try {
        if (op) {
            const ours = sim.operatingPoint().nodeVoltages;
            const ng = {};
            for (const m of out.matchAll(/^v\(([^)]+)\)\s*=\s*(\S+)/gm)) if (!(m[1] in ng)) ng[m[1]] = parseFloat(m[2]);
            const span = Math.max(1, ...nodes.map(n => Math.abs(ng[n] || 0)));
            let w = 0, wn = "";
            for (const n of nodes) {
                if (!(n in ng)) continue;
                const d = Math.abs(ours[n] - ng[n]) / span;
                if (d > w) { w = d; wn = n; }
            }
            worst.op = [w, wn];
            lines.push(`op   worst ${(w * 100).toFixed(3)}% of full scale at v(${wn})`);
        }
        if (tr) {
            const r = sim.transient({ tStop: tr.tStop, tStep: tr.tStep, uic: tr.uic, nodeIC: deck.ic });
            const ng = readPairs(`${tmp}/${id}.tran.txt`, nodes);
            let w = 0, wn = "";
            nodes.forEach((n, k) => {
                const ys = ng.y[k];
                // a node that barely moves is judged against 5 % of its absolute level,
                // so a 0.3 mV offset on a millivolt-swing node isn't scored as a 17 % error
                const range = Math.max(Math.max(...ys) - Math.min(...ys), 0.05 * Math.max(...ys.map(Math.abs)), 1e-3);
                let acc = 0;
                ng.x.forEach((t, i) => { const d = interp(r.timePoints, r.nodeHistories[n], t) - ys[i]; acc += d * d; });
                const rms = Math.sqrt(acc / ng.x.length) / range;
                if (rms > w) { w = rms; wn = n; }
            });
            worst.tran = [w, wn];
            lines.push(`tran worst rms ${(w * 100).toFixed(3)}% of range at v(${wn}) (${r.steps} steps vs ${ng.x.length} ngspice points)`);
        }
        if (ac) {
            const r = sim.ac({ fStart: ac.fStart, fStop: ac.fStop, pointsPerDecade: ac.points });
            const ng = readPairs(`${tmp}/${id}.ac.txt`, nodes);
            let w = 0, wn = "";
            nodes.forEach((n, k) => {
                const ys = ng.y[k];
                const peak = Math.max(...ys);
                if (peak < 1e-9) return;
                ng.x.forEach((f, i) => {
                    const mine = r.reduce((best, p) => Math.abs(Math.log(p.frequency / f)) < Math.abs(Math.log(best.frequency / f)) ? p : best);
                    const d = Math.abs(mine.nodeVoltages[n].magnitude() - ys[i]) / peak;
                    if (d > w) { w = d; wn = n; }
                });
            });
            worst.ac = [w, wn];
            lines.push(`ac   worst ${(w * 100).toFixed(3)}% of peak at v(${wn})`);
        }
    } catch (e) {
        lines.push(`ERROR ${e.message}`);
        worst.error = true;
    }

    const bad = worst.error || (worst.op && worst.op[0] > tol.op) || (worst.tran && worst.tran[0] > tol.tran) || (worst.ac && worst.ac[0] > tol.ac);
    if (bad) failed++;
    console.log(`${bad ? "FAIL" : "ok  "} ${id}${warnings.length ? `  (${warnings.length} parser warning${warnings.length > 1 ? "s" : ""})` : ""}`);
    lines.forEach(l => console.log("       " + l));
}

console.log(failed ? `\n${failed} deck(s) disagree with ngspice` : "\nall decks agree with ngspice");
process.exit(failed ? 1 : 0);

// Random-circuit cross-check against native ngspice:  node tests/fuzz.test.js   (FUZZ_N=100 FUZZ_SEED=7 to change)
//
// Builds seeded random circuits (resistor networks with diodes, BJTs, capacitors, inductors, sine / pulse sources and
// behavioural sources), solves each with the built-in engine and with ngspice, and compares the operating point, the
// transient waveforms and the AC magnitudes node by node. Skips cleanly when ngspice is not installed.
// A failing circuit is written to the temp directory and its deck is printed so it can be added to tests/decks.

const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");

if (spawnSync("ngspice", ["-v"]).error) { console.log("ngspice not found on PATH: skipping the random-circuit cross-check"); process.exit(0); }

const root = path.join(__dirname, "..");
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js", "js/sim/spice-parser.js"];
const src = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
const { SimEngine, SpiceParser } = new Function(src + "\nreturn { SimEngine, SpiceParser };")();

const N = Number(process.env.FUZZ_N || 60), SEED = Number(process.env.FUZZ_SEED || 20240601);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-"));

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- circuit generator ------------------------------------------------------------------------------------------
function generate(seed) {
    const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)], int = (a, b) => a + Math.floor(r() * (b - a + 1));
    const logu = (lo, hi) => lo * Math.pow(hi / lo, r());
    const fmt = (v) => Number(v.toPrecision(3)).toString();
    const kind = pick(["resistive", "diodes", "bjt", "rlc", "rlc", "behavioural", "mixed"]);
    const n = int(3, 7), nodes = Array.from({ length: n }, (_, i) => `n${i + 1}`);
    const lines = [`Random circuit seed ${seed} (${kind})`];
    let k = 0;
    const R = (a, b) => lines.push(`R${++k} ${a} ${b} ${fmt(logu(100, 1e5))}`);
    // a spanning tree to ground keeps every node DC-connected
    nodes.forEach((nd, i) => R(nd, i === 0 ? "0" : pick(nodes.slice(0, i).concat(["0"]))));
    for (let e = int(1, 3); e > 0; e--) { const a = pick(nodes), b = pick(nodes.concat(["0"])); if (a !== b) R(a, b); }
    const dc = fmt(logu(1, 12));
    const useSine = kind === "rlc" || kind === "mixed" || r() < 0.3;
    lines.push(useSine ? `V1 ${nodes[0]} 0 SIN(${fmt(r() * 2)} ${fmt(logu(0.5, 5))} ${fmt(logu(200, 5000))}) AC 1` : `V1 ${nodes[0]} 0 DC ${dc} AC 1`);
    if (r() < 0.5) lines.push(`I1 0 ${pick(nodes)} ${fmt(logu(1e-4, 5e-3))}`);
    const tran = useSine || kind === "rlc";
    let inductors = 0;          // at most one: two inductors (or one across the source) make a loop with the source whose DC current is undetermined
    if (kind === "rlc" || kind === "mixed") for (let e = int(1, 3); e > 0; e--) {
        const a = pick(nodes), b = pick(nodes.concat(["0"]));
        if (a === b || (a === nodes[0] && b === "0")) continue;          // an inductor straight across the source is a V-L loop
        if (r() < 0.6 || inductors) lines.push(`C${++k} ${a} ${b} ${fmt(logu(1e-9, 1e-6))}`); else { inductors++; lines.push(`L${++k} ${a} ${b} ${fmt(logu(1e-4, 1e-1))}`); }
    }
    let models = false;
    if (kind === "diodes" || kind === "mixed") for (let e = int(1, 3); e > 0; e--) { const a = pick(nodes), b = pick(nodes.concat(["0"])); if (a !== b && !(a === nodes[0] && b === "0")) { lines.push(`D${++k} ${a} ${b} DM`); models = true; } }
    if (kind === "bjt") {          // no BJTs next to capacitors: a UIC start would force absurd junction voltages (the engines legitimately differ there)
        for (let e = int(1, 2); e > 0; e--) {
            const c = pick(nodes), b = pick(nodes.slice(1)), em = pick(nodes.concat(["0"]));      // the base is never the source node itself (that would force an absurd Vbe)
            if (new Set([c, b, em]).size === 3) { lines.push(`Q${++k} ${c} ${b} ${em} QM`); models = true; }
        }
    }
    if (kind === "behavioural") {
        const a = pick(nodes), b = pick(nodes), o = `n${n + 1}`;
        lines.push(`B1 ${o} 0 V = ${pick(["2*v(%a)", "tanh(v(%a)/2)*3", "v(%a)*v(%b)/5", "max(-3,min(3,v(%a)*2))", "abs(v(%a))+0.5*v(%b)"]).replace(/%a/g, a).replace(/%b/g, b)}`);
        R(o, "0");
    }
    if (models) lines.push(".model DM D(IS=1e-14 N=1.05 RS=5 CJO=2p)", ".model QM NPN(IS=1e-14 BF=120 VAF=80 CJE=3p CJC=2p TF=0.3n)");
    const probe = nodes.concat(kind === "behavioural" ? [`n${n + 1}`] : []);
    lines.push(`.tran ${tran ? "0.1u 0.4m" : "20u 1m"}`, ".ac dec 10 10 100k", ".end");
    return { text: lines.join("\n") + "\n", probe, tran: true };
}

// ---- comparison -------------------------------------------------------------------------------------------------------
function interp(xs, ys, x) {
    let lo = 0, hi = xs.length - 1;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[hi]) return ys[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
    return ys[lo] + f * (ys[hi] - ys[lo]);
}
function readPairs(file, count) {
    const rows = fs.readFileSync(file, "utf8").split("\n").map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/).map(Number)).filter(r => r.every(Number.isFinite));
    return { x: rows.map(r => r[0]), y: Array.from({ length: count }, (_, i) => rows.map(r => r[2 * i + 1])) };
}

function check(seed) {
    const { text } = generate(seed);
    const deck = SpiceParser.parse(text);
    const { circuit, warnings } = SpiceParser.build(deck);
    const nodes = circuit.names.filter(n => !n.includes("#") && !n.includes("."));
    const id = `s${seed}`;
    const body = text.split("\n").filter(l => !/^\s*\.(op|tran|ac|dc|end)\b/i.test(l)).join("\n");
    const tr = deck.analyses.find(a => a.type === "tran"), ac = deck.analyses.find(a => a.type === "ac");
    const ctl = [".control", "set noaskquit", "op", ...nodes.map(n => `print v(${n})`), `tran ${tr.tStep} ${tr.tStop} uic`, `wrdata ${tmp}/${id}.tran.txt ${nodes.map(n => `v(${n})`).join(" ")}`,
        `ac ${ac.mode} ${ac.points} ${ac.fStart} ${ac.fStop}`, `wrdata ${tmp}/${id}.ac.txt ${nodes.map(n => `vm(${n})`).join(" ")}`, "quit", ".endc", ".end"];
    fs.writeFileSync(`${tmp}/${id}.cir`, body + "\n" + ctl.join("\n") + "\n");
    const run = spawnSync("ngspice", ["-b", `${tmp}/${id}.cir`], { encoding: "utf8", timeout: 60000 });
    const out = run.stdout + run.stderr;
    const ng = {};
    for (const m of out.matchAll(/^v\(([^)]+)\)\s*=\s*(\S+)/gm)) if (!(m[1] in ng)) ng[m[1]] = parseFloat(m[2]);
    if (!nodes.every(n => n in ng) || !fs.existsSync(`${tmp}/${id}.tran.txt`) || !fs.existsSync(`${tmp}/${id}.ac.txt`)) return { skipped: "ngspice did not converge" };

    const problems = [];
    const sim = new SimEngine(circuit);
    // operating point
    try {
        const ours = sim.operatingPoint().nodeVoltages;
        const span = Math.max(1, ...nodes.map(n => Math.abs(ng[n])));
        for (const n of nodes) if (Math.abs(ours[n] - ng[n]) / span > 0.005) problems.push(`op v(${n}): ${ours[n]} vs ngspice ${ng[n]}`);
    } catch (e) { problems.push(`op: ${e.message}`); }
    // transient (from the same initial state: uic on both sides)
    try {
        const r = sim.transient({ tStop: tr.tStop, tStep: tr.tStep, uic: true, nodeIC: deck.ic });
        const t = readPairs(`${tmp}/${id}.tran.txt`, nodes.length);
        nodes.forEach((n, k) => {
            const ys = t.y[k];
            const range = Math.max(Math.max(...ys) - Math.min(...ys), 0.05 * Math.max(...ys.map(Math.abs)), 1e-3);
            let acc = 0, cnt = 0;
            // the first few steps are skipped: with "uic" ngspice starts every node at 0 V, this engine starts from the
            // consistent initial state, and the two agree once the first steps have passed
            t.x.forEach((tt, i) => { if (tt < 5 * tr.tStep) return; const d = interp(r.timePoints, r.nodeHistories[n], tt) - ys[i]; acc += d * d; cnt++; });
            const rms = Math.sqrt(acc / Math.max(cnt, 1)) / range;
            if (rms > 0.06) problems.push(`tran v(${n}): rms ${(rms * 100).toFixed(2)}% of range`);
        });
    } catch (e) { problems.push(`tran: ${e.message}`); }
    // AC
    try {
        const r = sim.ac({ fStart: ac.fStart, fStop: ac.fStop, pointsPerDecade: ac.points });
        const a = readPairs(`${tmp}/${id}.ac.txt`, nodes.length);
        nodes.forEach((n, k) => {
            const peak = Math.max(...a.y[k]);
            const scale = Math.max(peak, 1e-3);    // the source is 1 V: responses below a millivolt (-60 dB) are judged against 1 mV, they are decided by leakage terms, not by the circuit
            let worst = 0;
            a.x.forEach((f, i) => {
                const mine = r.reduce((best, p) => Math.abs(Math.log(p.frequency / f)) < Math.abs(Math.log(best.frequency / f)) ? p : best);
                worst = Math.max(worst, Math.abs(mine.nodeVoltages[n].magnitude() - a.y[k][i]) / scale);
            });
            if (worst > 0.02) problems.push(`ac v(${n}): ${(worst * 100).toFixed(2)}% of peak`);
        });
    } catch (e) { problems.push(`ac: ${e.message}`); }
    return { problems, text, warnings };
}

if (process.env.FUZZ_PRINT) { process.stdout.write(generate(Number(process.env.FUZZ_PRINT)).text); process.exit(0); }   // print one circuit's deck

let failed = 0, skipped = 0, ok = 0;
for (let i = 0; i < N; i++) {
    const seed = SEED + i;
    const res = check(seed);
    if (res.skipped) { skipped++; continue; }
    if (res.problems.length) {
        failed++;
        fs.writeFileSync(path.join(tmp, `fail-${seed}.cir`), res.text);
        console.log(`FAIL seed ${seed}: ${res.problems.slice(0, 3).join("; ")}\n--- deck (also saved in ${tmp}) ---\n${res.text}---`);
    } else ok++;
}
console.log(`${ok} random circuits agree with ngspice, ${failed} disagree, ${skipped} skipped (ngspice failed to converge)`);
process.exit(failed ? 1 : 0);

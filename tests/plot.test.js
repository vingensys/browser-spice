// Graph maths: node tests/plot.test.js
const fs = require("fs"), path = require("path");
const { PlotMath } = new Function(fs.readFileSync(path.join(__dirname, "..", "js/visualization/plot-math.js"), "utf8") + "\nreturn { PlotMath };")();

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const near = (a, b, tol, what = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} expected ${b} +/- ${tol}, got ${a}`); };

// a 1 kHz, 0-5 V square wave with 25 % duty and a non-uniform time grid (like the adaptive solver)
function square(duty = 0.25, f = 1000, cycles = 6) {
    const xs = [], ys = [];
    const per = 1 / f, edge = per * 0.002;
    for (let k = 0; k < cycles; k++) {
        const t0 = k * per;
        for (const [t, v] of [[0, 0], [edge, 5], [per * duty, 5], [per * duty + edge, 0], [per - 1e-12, 0]]) { xs.push(t0 + t); ys.push(v); }
    }
    return { xs, ys };
}

console.log("graph maths");
test("valueAt interpolates linearly and clamps at the ends", () => {
    const xs = [0, 1, 3], ys = [0, 10, 30];
    near(PlotMath.valueAt(xs, ys, 0.5), 5, 1e-12); near(PlotMath.valueAt(xs, ys, 2), 20, 1e-12);
    near(PlotMath.valueAt(xs, ys, -1), 0, 0); near(PlotMath.valueAt(xs, ys, 9), 30, 0);
});
test("valueAt on a log axis interpolates against log frequency", () => {
    const xs = [10, 1000], ys = [0, -40];
    near(PlotMath.valueAt(xs, ys, 100, true), -20, 1e-9);
    near(PlotMath.valueAt(xs, ys, 505, false), -40 * (495 / 990), 1e-9);
});
test("stats of a sine over whole periods: mean 0, RMS A/sqrt2, pk-pk 2A (non-uniform steps)", () => {
    const xs = [], ys = [];
    let t = 0;
    while (t < 0.01) { xs.push(t); ys.push(3 * Math.sin(2 * Math.PI * 1000 * t)); t += 1e-6 * (1 + 0.8 * Math.sin(t * 7e3)); }
    const s = PlotMath.stats(xs, ys, 0, 0.01);
    near(s.mean, 0, 0.01); near(s.rms, 3 / Math.SQRT2, 0.01); near(s.pkpk, 6, 0.01);
});
test("stats weight by time, not by sample count", () => {
    // 1 V for 9 s then 11 V for 1 s, sampled densely only in the second part
    const xs = [0, 9, 9.001, 9.5, 10], ys = [1, 1, 11, 11, 11];
    near(PlotMath.stats(xs, ys, 0, 10).mean, 2, 0.01);
});
test("stats over a sub-range clip with interpolated end points", () => {
    const s = PlotMath.stats([0, 10], [0, 10], 2, 4);
    near(s.min, 2, 1e-12); near(s.max, 4, 1e-12); near(s.mean, 3, 1e-12);
});
test("frequency, period and duty of a square wave", () => {
    const { xs, ys } = square(0.25);
    const f = PlotMath.frequency(xs, ys, 0, 6e-3);
    near(f.freq, 1000, 1); near(f.period, 1e-3, 1e-6); near(f.duty, 0.25, 0.01);
});
test("no frequency is reported for a flat or one-shot signal", () => {
    if (PlotMath.frequency([0, 1, 2], [3, 3, 3], 0, 2) !== null) throw new Error("flat");
    if (PlotMath.frequency([0, 1, 2, 3], [0, 0, 5, 5], 0, 3) !== null) throw new Error("single edge");
});
test("rise and fall time (10-90 %) of an RC edge", () => {
    const xs = [], ys = [];
    for (let i = 0; i <= 2000; i++) { const t = i * 1e-6; xs.push(t); ys.push(5 * (1 - Math.exp(-t / 2e-4))); }
    const e = PlotMath.edges(xs, ys, 0, 2e-3);
    near(e.rise, 2.197 * 2e-4, 3e-6);          // 10-90 % of an RC charge = 2.197 tau
    const xs2 = xs.slice(), ys2 = ys.map(v => 5 - v);
    near(PlotMath.edges(xs2, ys2, 0, 2e-3).fall, 2.197 * 2e-4, 3e-6);
});
test("AC figures of a single-pole low-pass: -3 dB at the corner, no unity crossing below 0 dB gain", () => {
    const fc = 1000, xs = [], g = [], ph = [];
    for (let k = -10; k <= 40; k++) { const f = 10 * Math.pow(10, k / 10); xs.push(f); g.push(-10 * Math.log10(1 + (f / fc) ** 2)); ph.push(-Math.atan(f / fc) * 180 / Math.PI); }
    const a = PlotMath.ac(xs, g, ph);
    near(a.peak.db, 0, 0.01); near(a.bw.high, fc, 12); if (a.bw.low !== null) throw new Error("low edge should be absent");
    if (a.unity !== null) throw new Error("gain never exceeds 0 dB, so no unity crossing");
});
test("AC figures of an integrator-like response: unity-gain frequency and phase margin", () => {
    const xs = [], g = [], ph = [];
    for (let k = 0; k <= 40; k++) { const f = Math.pow(10, k / 10); xs.push(f); g.push(40 - 20 * Math.log10(f)); ph.push(-135); }   // 40 dB at 1 Hz, -20 dB/dec
    const a = PlotMath.ac(xs, g, ph);
    near(Math.log10(a.unity.x), 2, 0.01); near(a.unity.margin, 45, 0.5);
});
test("CSV: header, one row per sample, quoting, and a row range", () => {
    const csv = PlotMath.csv("Time (s)", [0, 1, 2], [{ header: 'V(a, "x")', values: [1, 2.5, NaN] }, { header: "I", values: [0.1, 0.2, 0.3] }], 1, 2);
    const lines = csv.trim().split("\r\n");
    if (lines[0] !== 'Time (s),"V(a, ""x"")",I') throw new Error(lines[0]);
    if (lines.length !== 3 || lines[1] !== "1,2.5,0.2" || lines[2] !== "2,,0.3") throw new Error(JSON.stringify(lines));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Spectrum analysis: node tests/fft.test.js
const fs = require("fs"), path = require("path");
const src = ["js/visualization/plot-math.js", "js/visualization/fft.js"].map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n");
const { Spectrum } = new Function(src + "\nreturn { Spectrum };")();
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const near = (a, b, tol, what = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} expected ${b} +/- ${tol}, got ${a}`); };

// an unevenly sampled signal (like the adaptive solver's)
function sample(fn, t1, dt0 = 1e-6) { const xs = [], ys = []; let t = 0, k = 0; while (t <= t1) { xs.push(t); ys.push(fn(t)); t += dt0 * (1 + 0.6 * Math.sin(k++ * 0.37)); } return { xs, ys }; }

console.log("spectrum");
test("the FFT of a known signal: a single tone lands in the right bin with the right size", () => {
    const n = 1024, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos(2 * Math.PI * 50 * i / n);
    Spectrum.fft(re, im);
    near(Math.hypot(re[50], im[50]), n / 2, 1e-6); near(Math.hypot(re[51], im[51]), 0, 1e-6);
    near(Math.hypot(re[n - 50], im[n - 50]), n / 2, 1e-6, "negative frequency mirror");
});
test("a 1 kHz, 2 V sine reads 2 V at 1 kHz (Hann) from uneven data", () => {
    const { xs, ys } = sample(t => 2 * Math.sin(2 * Math.PI * 1000 * t), 0.02);
    const sp = Spectrum.analyse(xs, ys, { window: "hann" });
    near(sp.fundamental.f, 1000, 5); near(sp.fundamental.mag, 2, 0.08);
    near(sp.db[sp.fundamental.bin], 20 * Math.log10(2), 0.8, "dBV");
});
test("every window reports the same amplitude for a tone (flat top is the most accurate)", () => {
    const { xs, ys } = sample(t => 1.5 * Math.sin(2 * Math.PI * 1234.5 * t), 0.02);
    for (const w of ["rect", "hann", "hamming", "blackman", "flattop"]) {
        const sp = Spectrum.analyse(xs, ys, { window: w });
        near(sp.fundamental.mag, 1.5, w === "rect" ? 0.35 : 0.15, w);
    }
    near(Spectrum.analyse(xs, ys, { window: "flattop" }).fundamental.mag, 1.5, 0.03, "flat top");
});
test("THD of a sine with a 10 % third harmonic and a 5 % fifth is about 11.2 %", () => {
    const { xs, ys } = sample(t => Math.sin(2 * Math.PI * 1000 * t) + 0.1 * Math.sin(2 * Math.PI * 3000 * t) + 0.05 * Math.sin(2 * Math.PI * 5000 * t), 0.02);
    const sp = Spectrum.analyse(xs, ys, { window: "blackman" });
    near(sp.thd, Math.sqrt(0.1 * 0.1 + 0.05 * 0.05), 0.006);
    near(sp.harmonics.find(h => h.h === 3).mag, 0.1, 0.008, "3rd harmonic"); near(sp.harmonics.find(h => h.h === 5).mag, 0.05, 0.006, "5th harmonic");
});
test("a square wave has odd harmonics at 1/n", () => {
    const { xs, ys } = sample(t => (Math.sin(2 * Math.PI * 1000 * t) >= 0 ? 1 : -1), 0.02, 2e-7);
    const sp = Spectrum.analyse(xs, ys, { window: "hann" });
    near(sp.fundamental.mag, 4 / Math.PI, 0.06);
    near(sp.harmonics.find(h => h.h === 3).mag, 4 / (3 * Math.PI), 0.05); near(sp.harmonics.find(h => h.h === 2).mag, 0, 0.03);
    near(sp.thd, Math.sqrt(1 / 9 + 1 / 25 + 1 / 49 + 1 / 81), 0.012, "THD of a square wave through the 9th harmonic");
});
test("the DC level is reported separately and does not disturb the tone", () => {
    const { xs, ys } = sample(t => 3 + Math.sin(2 * Math.PI * 500 * t), 0.02);
    const sp = Spectrum.analyse(xs, ys, { window: "hann" });
    near(sp.fundamental.f, 500, 5); near(sp.fundamental.mag, 1, 0.06); near(sp.mag[0], 3, 0.2, "DC bin");
});
test("a sub-range analyses only that part (a different tone in each half)", () => {
    const { xs, ys } = sample(t => (t < 0.01 ? Math.sin(2 * Math.PI * 1000 * t) : Math.sin(2 * Math.PI * 4000 * t)), 0.02);
    near(Spectrum.analyse(xs, ys, { t0: 0, t1: 0.0099 }).fundamental.f, 1000, 12);
    near(Spectrum.analyse(xs, ys, { t0: 0.0101, t1: 0.02 }).fundamental.f, 4000, 12);
});
test("too little data returns null instead of nonsense", () => {
    if (Spectrum.analyse([0, 1, 2], [0, 1, 0]) !== null) throw new Error("short data");
    if (Spectrum.analyse([0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1, 1, 1]) !== null) throw new Error("zero span");
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

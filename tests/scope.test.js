// Oscilloscope core: node tests/scope.test.js
const fs = require("fs"), path = require("path");
const src = ["js/visualization/plot-math.js", "js/visualization/fft.js", "js/visualization/scope-core.js"].map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n");
const { ScopeCore, PlotMath, Spectrum } = new Function(src + "\nreturn { ScopeCore, PlotMath, Spectrum };")();

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const near = (a, b, tol, what = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} expected ${b} +/- ${tol}, got ${a}`); };

// feed a signal: sine of freq f, amplitude a, offset o, sampled every dt up to tEnd
function feed(scope, tEnd, dt, fn) { for (let t = 0; t <= tEnd + 1e-15; t += dt) scope.push(t, fn(t)); }
const sine = (f, a = 1, o = 0, phase = 0) => (t) => ({ A: o + a * Math.sin(2 * Math.PI * f * t + phase), B: 0.5 * Math.sin(2 * Math.PI * f * t) });

console.log("oscilloscope");
test("settings merge fills in everything and keeps edits", () => {
    const m = ScopeCore.merge({ tdiv: 2e-3, chan: { A: { vdiv: 5 } }, trig: { level: 1.5 } });
    near(m.tdiv, 2e-3, 0); near(m.chan.A.vdiv, 5, 0); if (m.chan.A.coup !== "DC" || m.chan.B.vdiv !== 1 || m.trig.slope !== "rise" || m.trig.level !== 1.5) throw new Error(JSON.stringify(m));
    const again = ScopeCore.merge(undefined);
    if (again.trig.mode !== "auto" || !again.run) throw new Error("defaults");
});

test("a rising trigger gives a stable picture: every capture starts at the same phase", () => {
    const s = ScopeCore.merge({ tdiv: 1e-4, trig: { src: "A", level: 0, slope: "rise", mode: "auto" } });
    const sc = new ScopeCore(s);
    const phases = [];
    for (const tEnd of [0.0113, 0.01207, 0.0131, 0.01444]) {          // the "present" moves between frames
        sc.reset(); feed(sc, tEnd, 1e-6, sine(1000));
        const cap = sc.capture();
        if (!cap.trigged) throw new Error("no trigger at " + tEnd);
        phases.push(((cap.trigT * 1000) % 1));                          // where in the 1 ms period the trigger sat
        // the trigger point is at the centre of the screen
        near(cap.t0 + 5 * cap.tdiv, cap.trigT, 1e-12);
        // and the displayed value there is the trigger level
        const ys = sc.samples("A", 1001, cap);
        near(ys[500], 0, 0.01, "value at the trigger point");
        if (!(ys[505] > ys[500])) throw new Error("rising after a rising trigger");
    }
    if (Math.max(...phases) - Math.min(...phases) > 0.01) throw new Error("phase moves: " + phases);
});

test("falling-edge triggers, levels and horizontal position", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4, hpos: -2, trig: { src: "A", level: 0.5, slope: "fall", mode: "auto" } }));
    feed(sc, 0.02, 1e-6, sine(1000));
    const cap = sc.capture();
    const y = sc.samples("A", 1001, cap);
    const i = Math.round(((5 + sc.s.hpos) / 10) * 1000);                // trigger sits 3 divisions from the left
    near(y[i], 0.5, 0.01); if (!(y[i + 4] < y[i])) throw new Error("falling");
    near(cap.t0 + (5 + sc.s.hpos) * cap.tdiv, cap.trigT, 1e-12);
});

test("AUTO free-runs when nothing triggers; NORMAL holds the last sweep", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-3, trig: { src: "A", level: 5, slope: "rise", mode: "auto" } }));
    feed(sc, 0.03, 1e-5, sine(1000));
    let cap = sc.capture();
    if (cap.trigged || sc.status !== "AUTO") throw new Error("auto free-run: " + sc.status);
    near(cap.t0 + 10 * cap.tdiv, sc.tNow, 1e-9);
    // normal mode: first a real trigger, then a signal that stops crossing the level
    const n = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4, trig: { src: "A", level: 0, slope: "rise", mode: "normal" } }));
    feed(n, 0.01, 1e-6, sine(1000));
    const first = n.capture();
    if (!first || n.status !== "TRIG'D") throw new Error("normal should trigger: " + n.status);
    for (let t = 0.0101; t < 0.02; t += 1e-6) n.push(t, { A: 2, B: 0 });   // DC: never crosses 0 again
    const held = n.capture();
    if (n.status !== "WAIT" || held.trigT !== first.trigT) throw new Error(`normal holds: ${n.status} ${held.trigT} vs ${first.trigT}`);
});

test("SINGLE catches one trigger after arming, then stops", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4, trig: { src: "A", level: 0, slope: "rise", mode: "single" } }));
    feed(sc, 0.005, 1e-6, sine(1000));
    sc.capture();                                                           // arms on the first look
    if (sc.status !== "STOP" && sc.status !== "WAIT") throw new Error(sc.status);
    sc.arm();
    if (sc.status !== "WAIT" || !sc.s.run) throw new Error("armed: " + sc.status);
    feed(sc, 0.0073, 1e-6, (t) => ({ A: Math.sin(2 * Math.PI * 1000 * t), B: 0 }));   // (re-feeding older times: ignored by a real run)
    for (let t = 0.0073; t < 0.0092; t += 1e-6) sc.push(t, { A: Math.sin(2 * Math.PI * 1000 * t), B: 0 });
    const cap = sc.capture();
    if (!cap || sc.status !== "STOP" || sc.s.run) throw new Error(`single should hold: ${sc.status} run=${sc.s.run}`);
    const held = cap.trigT;
    for (let t = 0.0092; t < 0.02; t += 1e-6) sc.push(t, { A: Math.sin(2 * Math.PI * 1000 * t), B: 0 });
    if (sc.capture().trigT !== held) throw new Error("it must not move once caught");
});

test("STOP freezes the picture; RUN resumes", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4 }));
    feed(sc, 0.01, 1e-6, sine(1000));
    const a = sc.capture();
    sc.s.run = false;
    feed(sc, 0.0123, 1e-6, sine(1000));
    if (sc.capture().trigT !== a.trigT || sc.status !== "STOP") throw new Error("frozen");
    sc.s.run = true;
    if (sc.capture().trigT === a.trigT) throw new Error("running again");
});

test("coupling: AC removes the DC level, GND shows zero", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4, trig: { src: "A", level: 3, slope: "rise", mode: "auto" } }));
    feed(sc, 0.01, 1e-6, sine(1000, 1, 3));
    const cap = sc.capture();
    const dc = sc.samples("A", 500, cap), mean = (a) => a.filter(Number.isFinite).reduce((x, y) => x + y, 0) / a.filter(Number.isFinite).length;
    near(mean(dc), 3, 0.05);
    sc.s.chan.A.coup = "AC";
    near(mean(sc.samples("A", 500, cap)), 0, 0.05, "AC mean");
    sc.s.chan.A.coup = "GND";
    if (!sc.samples("A", 10, cap).every(v => v === 0)) throw new Error("GND");
    sc.s.chan.B.on = false;
    if (!sc.samples("B", 10, cap).every(Number.isNaN)) throw new Error("a channel that is off draws nothing");
});

test("measurements: Vpp, Vrms, frequency", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 5e-4 }));
    feed(sc, 0.02, 1e-6, sine(1000, 2));
    sc.capture();
    const m = sc.measure("A");
    near(m.vpp, 4, 0.05); near(m.vrms, 2 / Math.SQRT2, 0.05); near(m.freq, 1000, 15);
    const b = sc.measure("B");
    near(b.vpp, 1, 0.03);
});

test("the buffer is bounded: it keeps about 30 screens however long the run", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-3 }));
    feed(sc, 5, 1e-5, sine(100));
    if (sc.t.length > 3200) throw new Error("buffer grew to " + sc.t.length);
    if (sc.t[0] < 5 - 31e-3) throw new Error("kept too much history: " + sc.t[0]);
    // and it thins instead of growing without limit when the screen is very slow
    const big = new ScopeCore(ScopeCore.merge({ tdiv: 10 }));
    feed(big, 40, 1e-3, sine(1));
    if (big.t.length > ScopeCore.CAPACITY) throw new Error("capacity: " + big.t.length);
    if (!(PlotMath.valueAt(big.t, big.v.A, 40) !== undefined)) throw new Error("still readable");
});

test("autoset finds the timebase, volts per div, centring and trigger", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1, chan: { A: { vdiv: 0.001 } } }));
    feed(sc, 0.03, 2e-6, sine(500, 2.5, 1));            // 500 Hz, 5 V pk-pk, 1 V offset
    sc.capture();
    // the buffer only holds 30 screens of the (silly) starting timebase, so fill it
    if (!sc.autoset()) throw new Error("autoset failed");
    const s = sc.s;
    if (s.tdiv < 5e-4 || s.tdiv > 1e-3) throw new Error("timebase for ~3 periods: " + s.tdiv);
    if (s.chan.A.vdiv < 1 || s.chan.A.vdiv > 2) throw new Error("vdiv fits 5 V pk-pk in ~6 divs: " + s.chan.A.vdiv);
    near(s.trig.level, 1, 0.05, "trigger at the middle of the swing"); if (s.trig.src !== "A") throw new Error("trigger source");
    near(s.chan.A.pos, -1, 0.51, "centred by position");
});

test("XY needs the two channels sampled over the same window", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4, xy: true }));
    feed(sc, 0.01, 1e-6, (t) => ({ A: Math.sin(2 * Math.PI * 1000 * t), B: Math.cos(2 * Math.PI * 1000 * t) }));
    const cap = sc.capture();
    const x = sc.samples("A", 200, cap), y = sc.samples("B", 200, cap);
    for (let i = 0; i < 200; i++) near(x[i] * x[i] + y[i] * y[i], 1, 0.02);       // a circle
});

test("auto level triggers a unipolar signal with no level set", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4 }));
    if (!sc.s.trig.autoLevel) throw new Error("auto level should be on by default");
    feed(sc, 0.01, 1e-6, (t) => ({ A: (t * 1000) % 1 < 0.5 ? 0 : 5, B: 0 }));          // 0 / 5 V square wave
    const cap = sc.capture();
    if (!cap.trigged || sc.status !== "TRIG'D") throw new Error("should trigger: " + sc.status);
    near(sc.s.trig.level, 2.5, 0.1, "level follows the middle of the signal");
    // an explicit level turns it off
    const m = ScopeCore.merge({ trig: { level: 1.25 } });
    if (m.trig.autoLevel !== false || m.trig.level !== 1.25) throw new Error("explicit level wins");
});

test("the trigger is stable on a 0/5 V square wave: successive captures are identical", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4 }));
    const shots = [];
    for (const tEnd of [0.0123, 0.01301, 0.0147]) {
        sc.reset(); feed(sc, tEnd, 1e-6, (t) => ({ A: (t * 1000) % 1 < 0.5 ? 0 : 5, B: 0 }));
        const cap = sc.capture();
        shots.push(sc.samples("A", 40, cap).map(v => Math.round(v)).join(""));
    }
    if (new Set(shots).size !== 1) throw new Error("captures differ: " + shots.join(" | "));
});

test("the 1-2-5 steps", () => {
    const t = ScopeCore.TDIV, v = ScopeCore.VDIV;
    near(t[0], 1e-6, 0); near(t[t.length - 1], 10, 0); near(v[0], 1e-3, 0); near(v[v.length - 1], 100, 0);
    if (!t.includes(2e-4) || !t.includes(5e-3) || !v.includes(0.2) || !v.includes(5)) throw new Error("1-2-5 values missing");
    if (t.some((x, i) => i && x <= t[i - 1])) throw new Error("ascending");
});

test("cursors read time difference, frequency and voltage at their positions", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4, trig: { level: 0, slope: "rise", mode: "auto", autoLevel: false }, cur: { on: true, x: [5, 7.5], ch: "A" } }));
    feed(sc, 0.0113, 1e-6, sine(1000)); const cap = sc.capture();
    const r = sc.cursorReadout(cap);
    near(r.dt, 2.5e-4, 1e-9, "dt"); near(r.freq, 4000, 1, "1/dt");
    near(r.v1, 0, 0.02, "v at the trigger (0 V rising)"); near(r.v2, 1, 0.02, "v a quarter period later (peak)"); near(r.dv, r.v2 - r.v1, 1e-12);
});
test("cursor positions survive a settings merge and default sensibly", () => {
    const m = ScopeCore.merge({ cur: { on: true, x: [1, 9], ch: "B" } });
    if (!m.cur.on || m.cur.x[0] !== 1 || m.cur.x[1] !== 9 || m.cur.ch !== "B" || ScopeCore.merge().cur.on) throw new Error(JSON.stringify(m.cur));
});
test("the scope's FFT finds the tone and its level", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-3, trig: { level: 0, mode: "auto", autoLevel: false } }));
    feed(sc, 0.05, 2e-6, (t) => ({ A: 0.5 * Math.sin(2 * Math.PI * 1000 * t), B: 0 })); const cap = sc.capture();
    const sp = sc.spectrum("A", cap, "flattop");
    near(sp.fundamental.f, 1000, 15, "f"); near(sp.fundamental.mag, 0.5, 0.01, "mag");
    if (sc.spectrum("C", cap) !== null) throw new Error("a channel that is off has no spectrum");
});
test("a saved trace keeps the screen as it was, and the CSV lists time and channels", () => {
    const sc = new ScopeCore(ScopeCore.merge({ tdiv: 1e-4, trig: { level: 0, autoLevel: false } }));
    feed(sc, 0.0113, 1e-6, sine(1000)); const cap = sc.capture();
    const snap = sc.snapshot(cap, 100);
    if (snap.traces.A.length !== 100 || Object.keys(snap.traces).join() !== "A,B") throw new Error(JSON.stringify(Object.keys(snap.traces)));
    sc.reset(); feed(sc, 0.0113, 1e-6, sine(500));
    if (!snap.traces.A.some(Number.isFinite)) throw new Error("snapshot changed");
    sc.capture(); const lines = sc.csv(sc.last, 50).split("\r\n");
    if (lines.length !== 51 || lines[0] !== "Time (s),A (V),B (V)") throw new Error(lines[0]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);


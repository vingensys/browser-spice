// Logic analyser core: node tests/logic.analyser.test.js
const fs = require("fs"), path = require("path");
const src = ["js/visualization/plot-math.js", "js/visualization/logic-core.js"].map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n");
const { LogicCore } = new Function(src + "\nreturn { LogicCore };")();
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const near = (a, b, tol, w = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${w} expected ${b} +/- ${tol}, got ${a}`); };
// a square wave of period p, starting low
const sq = (p, hi = 5) => (t) => ((t % p) >= p / 2 ? hi : 0);
const feed = (la, tEnd, dt, fn) => { for (let t = 0; t <= tEnd + 1e-15; t += dt) { const v = {}; fn(t, v); la.push(t, v); } };

console.log("logic analyser");
test("settings merge fills in names, trigger and cursors", () => {
    const m = LogicCore.merge({ tdiv: 2e-3, names: ["CLK"], cur: { x: [1, 9] } });
    if (m.names[0] !== "CLK" || m.names[7] !== "D7" || m.trig.edge !== "none" || m.cur.x[1] !== 9 || m.thresh !== 1.5) throw new Error(JSON.stringify(m));
});
test("segments follow the threshold crossings of a square wave", () => {
    const la = new LogicCore(LogicCore.merge({ tdiv: 1e-3 }));
    feed(la, 0.02, 1e-6, (t, v) => { v[0] = sq(2e-3)(t); });
    const cap = la.capture(), sg = la.segments(0, cap);
    if (sg.length < 9) throw new Error("expected ~10 segments, got " + sg.length);
    near(sg[2].x1 - sg[2].x0, 1, 0.01, "a half period is one division");
    if (sg[1].level === sg[2].level) throw new Error("levels must alternate");
});
test("an edge trigger puts the edge at the same place every time", () => {
    const la = new LogicCore(LogicCore.merge({ tdiv: 1e-3, trig: { ch: 0, edge: "rise" } }));
    const pos = [];
    for (const end of [0.0213, 0.02377, 0.0251]) {
        la.reset(); feed(la, end, 1e-6, (t, v) => { v[0] = sq(2e-3)(t); });
        const cap = la.capture(); if (!cap.trigged) throw new Error("no trigger");
        const sg = la.segments(0, cap).find(s => s.level === 1 && s.x0 > 1); pos.push(sg.x0);
    }
    near(pos[0], 2, 0.02); near(pos[1], 2, 0.02); near(pos[2], 2, 0.02);
});
test("the bus value reads the eight inputs at a position (null when an input has no data)", () => {
    const la = new LogicCore(LogicCore.merge({ tdiv: 1e-3 }));
    feed(la, 0.02, 1e-5, (t, v) => { v[0] = 5; v[1] = 0; v[2] = 5; v[3] = 0; v[4] = 0; v[5] = 0; v[6] = 0; v[7] = 5; });
    const cap = la.capture();
    if (la.bus(cap, 5) !== 0b10000101) throw new Error(String(la.bus(cap, 5)));
    la.reset(); feed(la, 0.02, 1e-5, (t, v) => { v[0] = 5; });
    if (la.bus(la.capture(), 5) !== null) throw new Error("unwired inputs have no value");
    if (la.bus(la.capture(), 5, [0]) !== 1) throw new Error("a single channel bus");
});
test("scrolling back moves the window into the past", () => {
    const la = new LogicCore(LogicCore.merge({ tdiv: 1e-3 }));
    feed(la, 0.04, 1e-5, (t, v) => { v[0] = sq(2e-3)(t); });
    const a = la.capture().t0; la.s.back = 5; const b = la.capture().t0;
    near(a - b, 5e-3, 1e-9);
});
test("auto set picks a timebase that shows a few cycles of the fastest signal", () => {
    const la = new LogicCore(LogicCore.merge({ tdiv: 1e-1 }));
    feed(la, 0.02, 1e-6, (t, v) => { v[0] = sq(1e-3)(t); v[1] = sq(4e-3)(t); });
    if (!la.autoset()) throw new Error("no result");
    if (la.s.tdiv > 1e-3 || la.s.tdiv < 2e-4) throw new Error(String(la.s.tdiv));
});
test("CSV lists time and the eight channels", () => {
    const la = new LogicCore(LogicCore.merge({ tdiv: 1e-3 }));
    feed(la, 0.02, 1e-5, (t, v) => { v[0] = 5; });
    la.capture(); const lines = la.csv(la.last, 20).split("\r\n");
    if (lines.length !== 21 || lines[0] !== "Time (s),D0,D1,D2,D3,D4,D5,D6,D7") throw new Error(lines[0]);
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Track lengths, match groups and meander tuning:  node tests/pcb.length.test.js
const fs = require("fs"), path = require("path");
const src = ["js/pcb/pcb.js", "js/pcb/length.js"].map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n");
const { Pcb, PcbLength } = new Function(src + "\nreturn { Pcb, PcbLength };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

function board() {
    const b = Pcb.blank(80, 40);
    b.parts = [["A", "1", 10, 10], ["B", "1", 60, 10], ["C", "2", 10, 25], ["D", "2", 40, 25], ["E", "3", 10, 35], ["F", "3", 13, 35]].map(([ref, net, x, y]) => {
        const p = { ref, kind: "X", nodes: [net], x, y, rot: 0, placed: true }; Pcb.setPackage(p, undefined, b.footprints); return p;
    });
    const t = (x1, y1, x2, y2) => ({ id: b.nextId++, layer: "F", w: 0.3, pts: [[x1, y1], [x2, y2]] });
    b.tracks = [t(10, 10, 60, 10), t(10, 25, 40, 25), t(10, 35, 13, 35)];
    return b;
}

const b = board();
const lens = PcbLength.netLengths(b);
check("net lengths are the copper of their tracks", Math.abs(lens.get("1").length - 50) < 1e-9 && Math.abs(lens.get("2").length - 30) < 1e-9 && lens.get("3").tracks === 1, [...lens]);

b.groups = [{ name: "bus", nets: ["1", "2"], target: null, tol: 0.5, pair: false }];
let rep = PcbLength.report(b)[0];
check("a group's target is its longest net and each net shows its difference", rep.target === 50 && rep.rows.find(r => r.net === "2").delta === -20 && !rep.ok, rep);
check("the rule check reports a group that is out of tolerance", Pcb.drc(b, { zones: false }).some(i => i.type === "length" && /bus/.test(i.msg) && /net 2/.test(i.msg)));

const res = PcbLength.tuneGroup(b, b.groups[0]);
check("tuning adds a serpentine to the short net only", res.length === 1 && res[0].net === "2" && res[0].ok, res);
const after = PcbLength.netLengths(b);
check("the short net now matches the longest to a hundredth of a millimetre", Math.abs(after.get("2").length - 50) < 0.01 && Math.abs(after.get("1").length - 50) < 1e-9, after.get("2").length);
rep = PcbLength.report(b)[0];
check("the group is within tolerance", rep.ok, rep.rows);
check("the tuned board has no clearance, short or edge violations", Pcb.drc(b, { zones: false }).filter(i => ["clearance", "short", "edge"].includes(i.type)).length === 0);
check("the serpentine kept the track's ends on its pads", (() => { const t = b.tracks[1]; return t.pts[0][0] === 10 && t.pts[0][1] === 25 && t.pts[t.pts.length - 1][0] === 40 && t.pts[t.pts.length - 1][1] === 25; })());
check("the net still connects its two pads", (() => { const g = Pcb.connectivity(b, false).find(x => x.net === "2"); return g && g.pads.length === 2; })());

// a run too short to take the serpentine
const short = PcbLength.tune(b, "3", 20);
check("a net with no room for the extra copper is refused with a reason and left alone", !short.ok && /room/.test(short.reason) && b.tracks[2].pts.length === 2, short);

// a pair: skew in tolerance or not
const p = board();
p.groups = [{ name: "usb", nets: ["1", "2"], pair: true }];
rep = PcbLength.report(p)[0];
check("a pair reports its skew (length spread) and uses a tight default tolerance", Math.abs(rep.spread - 20) < 1e-9 && rep.tol === 0.1);
PcbLength.tuneGroup(p, p.groups[0]);
check("tuning a pair brings the skew under its tolerance", PcbLength.report(p)[0].ok, PcbLength.report(p)[0].spread);

// an explicit target longer than any net
const q = board();
q.groups = [{ name: "t", nets: ["1", "2"], target: 60, tol: 0.2 }];
PcbLength.tuneGroup(q, q.groups[0]);
const ql = PcbLength.netLengths(q);
check("a group with its own target lengthens every net to it", Math.abs(ql.get("1").length - 60) < 0.01 && Math.abs(ql.get("2").length - 60) < 0.01, [ql.get("1").length, ql.get("2").length]);

// copper of another net on one side of the run: the serpentine goes to the other side
const r = board();
for (const [ref, x] of [["G", 18], ["H", 34]]) { const pp = { ref, kind: "X", nodes: ["4"], x, y: 29, rot: 0, placed: true }; Pcb.setPackage(pp, undefined, r.footprints); r.parts.push(pp); }
r.tracks.push({ id: 99, layer: "F", w: 0.3, pts: [[18, 29], [34, 29]] });
const clean = Pcb.drc(r, { zones: false }).filter(i => ["clearance", "short", "edge"].includes(i.type)).length;
r.groups = [{ name: "g", nets: ["1", "2"], tol: 0.5 }];
const rr = PcbLength.tuneGroup(r, r.groups[0]);
check("tuning avoids the side where another net's copper is in the way", rr[0].ok && rr[0].side === -1, JSON.stringify({ ok: rr[0].ok, side: rr[0].side, reason: rr[0].reason }));
check("and creates no violation", Pcb.drc(r, { zones: false }).filter(i => ["clearance", "short", "edge"].includes(i.type)).length === clean);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

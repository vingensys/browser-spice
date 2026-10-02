// PCB kernel: footprints and nets from schematic elements, ratsnest, autorouter, DRC, Gerber / Excellon / ZIP.
//   node tests/pcb.test.js
const fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");
const src = fs.readFileSync(path.join(__dirname, "..", "js/pcb/pcb.js"), "utf8");
const { Pcb } = new Function(src + "\nreturn { Pcb };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const els = [
    { name: "V1", kind: "V", nodes: ["1", "0"] }, { name: "R1", kind: "R", nodes: ["1", "2"] }, { name: "R2", kind: "R", nodes: ["2", "3"] },
    { name: "Q1", kind: "Q", nodes: ["3", "2", "0"] }, { name: "C1", kind: "C", nodes: ["2", "0"] }, { name: "D1", kind: "D", nodes: ["1", "3"] },
    { name: "R3", kind: "R", nodes: ["3", "0"] }
];
const pcb = Pcb.blank(60, 40);
const s = Pcb.sync(pcb, els);
check("every element becomes a part with a pad per pin", s.added === 7 && pcb.parts.every(p => p.nets.length === p.fp.pads.length) && pcb.parts.find(p => p.ref === "Q1").fp.name === "TO-92");
check("pads carry the net of their pin", pcb.parts.find(p => p.ref === "R2").nets.join() === "2,3");
Pcb.autoPlace(pcb);
const all = Pcb.pads(pcb);
let overlap = 0;
for (let i = 0; i < pcb.parts.length; i++) for (let j = i + 1; j < pcb.parts.length; j++) { const a = pcb.parts[i], b = pcb.parts[j]; if (Math.abs(a.x - b.x) < (a.fp.w + b.fp.w) / 2 && Math.abs(a.y - b.y) < (a.fp.h + b.fp.h) / 2) overlap++; }
check("auto-place leaves no two courtyards overlapping and fits the board", overlap === 0 && all.every(p => p.x > 0 && p.y > 0 && p.x < pcb.outline.w && p.y < pcb.outline.h), [overlap, pcb.outline]);
const rats = Pcb.ratsnest(pcb);
// nets: 1 (V1,R1,D1)=3 pads -> 2 lines; 0 (V1,Q1,C1,R3)=4 -> 3; 2 (R1,R2,Q1,C1)=4 -> 3; 3 (R2,Q1,D1,R3)=4 -> 3
check("the ratsnest is a spanning tree per net (11 airwires)", rats.length === 11, rats.length);
const t0 = Date.now();
const rr = Pcb.autoRoute(pcb);
console.log(`       autoroute: ${rr.routed}/${rr.total} in ${Date.now() - t0} ms, ${pcb.tracks.length} tracks, ${pcb.vias.length} vias, board ${pcb.outline.w}x${pcb.outline.h}`);
check("the autorouter completes every connection", rr.failed === 0 && rr.routed === 11, rr);
const issues = Pcb.drc(pcb);
check("and the result passes the design-rule check (no shorts, clearance, edge or unrouted)", issues.length === 0, JSON.stringify(issues.slice(0, 5)));
check("nothing is left in the ratsnest", Pcb.ratsnest(pcb).length === 0);
// DRC catches a deliberate fault: a track of net 1 laid across the pads of another net
const bad = JSON.parse(JSON.stringify(pcb));
const p2 = bad.parts.find(p => p.ref === "R3"), pa = Pcb.pads(bad).filter(p => p.part.ref === "R3");
bad.tracks.push({ id: 999, layer: "F", w: 0.3, pts: [[pa[0].x, pa[0].y], [pa[1].x, pa[1].y]] });
const bi = Pcb.drc(bad);
check("a track bridging two pads of different nets is reported as a short", bi.some(i => i.type === "short"), bi.slice(0, 3));
const bad2 = Pcb.blank(30, 20);
bad2.parts.push({ ref: "A", kind: "R", fp: Pcb.footprint("R", 2), x: 10, y: 10, rot: 0, nets: ["a", "b"] });
bad2.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[10 - 5.08, 10], [10 - 5.08, 14]] });   // starts on pad a
bad2.parts.push({ ref: "B", kind: "R", fp: Pcb.footprint("R", 2), x: 10, y: 15, rot: 0, nets: ["c", "d"] });
const gi = Pcb.drc(bad2);
check("copper of different nets closer than the clearance is reported", gi.some(i => i.type === "clearance" || i.type === "short"), gi);
const edge = Pcb.blank(30, 20); edge.parts.push({ ref: "A", kind: "R", fp: Pcb.footprint("R", 2), x: 3, y: 10, rot: 0, nets: ["a", "b"] });
check("pads outside the board edge margin are reported", Pcb.drc(edge).some(i => i.type === "edge"));
const rot = Pcb.blank(30, 20); rot.parts.push({ ref: "A", kind: "R", fp: Pcb.footprint("R", 2), x: 10, y: 10, rot: 90, nets: ["a", "b"] });
const rp = Pcb.pads(rot);
check("rotating a part by 90° turns its pad row vertical", Math.abs(rp[0].x - 10) < 1e-9 && Math.abs(Math.abs(rp[0].y - rp[1].y) - 10.16) < 1e-9);
// re-sync keeps the placement and routing of parts that stay, drops those that vanish
const before = pcb.tracks.length, x1 = pcb.parts.find(p => p.ref === "R1").x;
const s2 = Pcb.sync(pcb, els.filter(e => e.name !== "R3").concat([{ name: "R9", kind: "R", nodes: ["1", "3"] }]));
check("re-sync keeps placed parts, adds new ones and removes deleted ones", s2.added === 1 && s2.removed === 1 && pcb.parts.find(p => p.ref === "R1").x === x1 && pcb.tracks.length === before);
// output files
const files = Pcb.files(pcb, "t");
const fcu = files[0][1];
check("Gerber has the RS-274X header, apertures, flashes and draws", /%FSLAX46Y46\*%/.test(fcu) && /%ADD1\d[CR],/.test(fcu) && /D03\*/.test(fcu) && /D01\*/.test(fcu) && /M02\*/.test(fcu));
check("the outline layer is a closed rectangle", (files[2][1].match(/D01\*/g) || []).length === 4);
check("Excellon lists a tool per drill size and every hole", /^T\d+C\d\.\d+/m.test(files[3][1]) && (files[3][1].match(/^X/gm) || []).length === Pcb.pads(pcb).length + pcb.vias.length);
const zip = Pcb.zip(files), tmp = path.join(os.tmpdir(), `pcbtest-${process.pid}.zip`);
fs.writeFileSync(tmp, zip);
let zt = ""; try { zt = cp.execSync(`unzip -t ${tmp} 2>&1`).toString(); } catch (e) { zt = (e.stdout || "").toString() + e.message; }
check("the ZIP is valid (unzip -t) and holds the four files", /No errors detected/.test(zt) && /t-F_Cu\.gtl/.test(zt) && /t\.drl/.test(zt), zt.slice(0, 200));
fs.unlinkSync(tmp);
// a denser board: four 14-pin chips and eight resistors on random nets; whatever the router finishes must be DRC-clean
for (const seed of [5, 9]) {
    let sd = seed; const rnd = () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, pick = () => String(1 + Math.floor(rnd() * 14));
    const big = [];
    for (let i = 0; i < 4; i++) big.push({ name: "U" + i, kind: "DIGITAL", ic: "7400", nodes: Array.from({ length: 12 }, pick) });
    for (let i = 0; i < 8; i++) big.push({ name: "R" + i, kind: "R", nodes: [pick(), pick()] });
    const b = Pcb.blank(80, 60); Pcb.sync(b, big); Pcb.autoPlace(b);
    const r = Pcb.autoRoute(b), iss = Pcb.drc(b).filter(i => i.type !== "unrouted");
    check(`dense board (seed ${seed}): ${r.routed}/${r.total} routed, ${b.vias.length} vias, no DRC violations in what was routed`, r.routed >= r.total - 2 && iss.length === 0, JSON.stringify(iss.slice(0, 3)));
}
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);

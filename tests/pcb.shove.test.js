// Push-and-shove invariants on autorouted random boards: a refused move changes nothing; an accepted one adds no
// clearance / short / edge violation, keeps every net connected and never moves a track end that sits on a pad.
//   node tests/pcb.shove.test.js
const fs = require("fs"), path = require("path");
const { Pcb } = new Function(fs.readFileSync(path.join(__dirname, "..", "js/pcb/pcb.js"), "utf8") + "\nreturn { Pcb };")();
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let accepted = 0, refused = 0, vias = 0, tracks = 0; const problems = [];
const hard = (b) => Pcb.drc(b, { zones: false }).filter(i => ["clearance", "short", "edge"].includes(i.type));
for (let trial = 0; trial < 14; trial++) {
    const pick = () => String(1 + Math.floor(rnd() * 10)), els = [];
    for (let i = 0; i < 3; i++) els.push({ name: "U" + i, kind: "DIGITAL", ic: "7400", nodes: Array.from({ length: 12 }, pick) });
    for (let i = 0; i < 6; i++) els.push({ name: "R" + i, kind: "R", nodes: [pick(), pick()] });
    const b = Pcb.blank(70, 50); Pcb.sync(b, els); Pcb.autoPlace(b); Pcb.autoRoute(b);
    const base = hard(b).length, rats = Pcb.ratsnest(b).length;
    for (let k = 0; k < 6; k++) {
        let layer = rnd() < 0.5 ? "F" : "B", draft, viaDrop = null;
        const r4 = (v) => Math.round(v * 4) / 4;
        const long = b.tracks.flatMap(t => t.pts.slice(0, -1).map((q, i) => ({ t, a: q, b: t.pts[i + 1] }))).filter(g => Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) > 6);
        if (k % 3 === 0 || !long.length) {
            let x1 = 5 + rnd() * 60, y1 = 5 + rnd() * 40;
            const ang = Math.floor(rnd() * 8) * Math.PI / 4, len = 5 + rnd() * 20;
            draft = [[r4(x1), r4(y1)], [r4(Math.max(2, Math.min(68, x1 + Math.cos(ang) * len))), r4(Math.max(2, Math.min(48, y1 + Math.sin(ang) * len)))]];
        } else {
            // directed: a new segment running alongside an existing one, 0.3-0.45 mm off its centre line (inside the keep-out)
            const g = long[Math.floor(rnd() * long.length)], dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l, off = (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.15);
            layer = g.t.layer;
            const f0 = 0.2 + rnd() * 0.2, f1 = f0 + 0.3 + rnd() * 0.3;
            draft = [[g.a[0] + dx * f0 + nx * off, g.a[1] + dy * f0 + ny * off], [g.a[0] + dx * f1 + nx * off, g.a[1] + dy * f1 + ny * off]];
            if (k % 3 === 2) viaDrop = { x: draft[1][0], y: draft[1][1], d: 0.8, drill: 0.4 };
        }
        const snap = JSON.stringify([b.tracks, b.vias]);
        const res = viaDrop ? Pcb.shoveVia(b, layer, draft, 0.3, null, viaDrop) : Pcb.shove(b, layer, draft, 0.3, null);
        if (!res.ok) { refused++; if (JSON.stringify([b.tracks, b.vias]) !== snap) problems.push(`refused move mutated the board (trial ${trial})`); if (!res.reason) problems.push("refusal without a reason"); continue; }
        const ends = b.tracks.map(t => [t.pts[0], t.pts[t.pts.length - 1]]), padAt = (q, l) => Pcb.pads(b).some(p => p.layers.includes(l) && Math.abs(q[0] - p.x) <= p.w / 2 + 0.02 && Math.abs(q[1] - p.y) <= p.h / 2 + 0.02);
        const anchoredBefore = b.tracks.map((t, i) => [padAt(ends[i][0], t.layer), padAt(ends[i][1], t.layer)]);
        Pcb.applyShove(b, res);
        b.tracks.forEach((t, i) => { if (anchoredBefore[i][0] && JSON.stringify(t.pts[0]) !== JSON.stringify(ends[i][0])) problems.push("a track end on a pad moved"); if (anchoredBefore[i][1] && JSON.stringify(t.pts[t.pts.length - 1]) !== JSON.stringify(ends[i][1])) problems.push("a track end on a pad moved"); });
        const cand = { id: 9000 + trial * 10 + k, layer, w: 0.3, pts: draft };
        b.tracks.push(cand);
        if (viaDrop) b.vias.push({ id: 9500 + trial * 10 + k, ...viaDrop });
        const own = hard(b).filter(i => !(i.ids || []).some(x => x.includes("track " + cand.id)));
        if (own.length > base) problems.push(`violations grew from ${base} to ${own.length} (trial ${trial}): ${own[0].msg}`);
        if (Pcb.ratsnest(b).length > rats) problems.push(`a net lost its connection (trial ${trial})`);
        b.tracks.pop(); if (viaDrop) b.vias.pop(); accepted++; vias += res.vias.length; tracks += res.changes.length;
    }
}
console.log(`  ${accepted} moves accepted (${tracks} track pushes, ${vias} via pushes), ${refused} refused`);
let ok = problems.length === 0 && accepted >= 10 && tracks > 0 && vias > 0;
console.log(ok ? "  ok   shoved boards stay rule-clean and connected; refused moves change nothing" : `  FAIL ${problems.slice(0, 4).join("; ") || "too few accepted moves, or no track / via was ever pushed"}`);
console.log(`\n${ok ? 1 : 0} passed, ${ok ? 0 : 1} failed`);
process.exit(ok ? 0 : 1);

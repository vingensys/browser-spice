// A small two-layer PCB layout kernel: footprints from the schematic's parts, nets, ratsnest, a grid autorouter, a
// design-rule check and Gerber / Excellon / ZIP output. It is deliberately basic (through-hole style pads, no copper
// pours, no silkscreen, no length matching) but the files it writes are standard RS-274X / Excellon.
//
// Units are millimetres. y grows downwards on screen, as on the schematic.
//   pcb = { outline: {w, h}, rules: {clearance, track, via, viaDrill}, parts: [part], tracks: [track], vias: [via], nextId }
//   part  = { ref, kind, fp: {name, w, h, pads: [{n, x, y, w, h, drill, shape}]}, x, y, rot, nets: [net per pad] }
//   track = { id, layer: "F" | "B", w, pts: [[x, y], ...] }       via = { id, x, y, d, drill }
// A track or via takes its net from the pads it touches (see Pcb.connectivity).

class Pcb {

    static DEFAULT_RULES = { clearance: 0.2, track: 0.3, via: 0.8, viaDrill: 0.4, minTrack: 0.15, edge: 0.3 };

    static blank(w = 80, h = 60) {
        return { outline: { w, h }, rules: { ...Pcb.DEFAULT_RULES }, parts: [], tracks: [], vias: [], nextId: 1 };
    }

    // ---------------------------------------------------------------- footprints
    // pads in the part's own frame, centred on the part; pin k of the netlist element is pad k
    static footprint(kind, nPins, ic) {
        const row = (n, pitch, pw, ph, drill, shape = "round") => Array.from({ length: n }, (_, i) => ({ n: i + 1, x: (i - (n - 1) / 2) * pitch, y: 0, w: pw, h: ph, drill, shape: i === 0 && shape === "round" && n > 1 ? "rect" : shape }));
        const wrap = (name, pads, pad = 1.8) => {
            const xs = pads.map(p => p.x), ys = pads.map(p => p.y);
            return { name, pads, w: Math.max(...xs) - Math.min(...xs) + pad + 1, h: Math.max(...ys) - Math.min(...ys) + pad + 1 };
        };
        if (kind === "R" || kind === "L") return wrap("Axial_10.16mm", row(2, 10.16, 1.8, 1.8, 0.9));
        if (kind === "C") return wrap("Radial_5.08mm", row(2, 5.08, 1.8, 1.8, 0.9));
        if (kind === "D") return wrap("Diode_7.62mm", row(2, 7.62, 1.8, 1.8, 0.9));
        if (kind === "Q" || kind === "J") return wrap("TO-92", row(Math.max(nPins, 3), 2.54, 1.6, 1.6, 0.9));
        if (kind === "M") return wrap("TO-220", row(Math.max(nPins, 3), 2.54, 2.0, 2.4, 1.1));
        if (kind === "DIGITAL") {
            const n = Math.max(8, nPins + (nPins % 2)), half = n / 2, pads = [];
            for (let i = 0; i < n; i++) {
                const left = i < half, k = left ? i : n - 1 - i;
                pads.push({ n: i + 1, x: left ? -3.81 : 3.81, y: (k - (half - 1) / 2) * 2.54, w: 1.6, h: 1.6, drill: 0.8, shape: i === 0 ? "rect" : "round" });
            }
            return wrap(`DIP-${n}`, pads, 1.6);
        }
        return wrap(`Header_1x${nPins}`, row(Math.max(1, nPins), 2.54, 1.8, 1.8, 1.0));
    }

    // ---------------------------------------------------------------- schematic -> board
    // elements: the netlist extractor's `info.elements` (name, kind, nodes, ic). Existing placement and routing is kept:
    // parts are matched by reference, new ones are added at the board's top-left, vanished ones are removed along with
    // the tracks that no longer touch anything of theirs.
    static sync(pcb, elements) {
        const byRef = new Map(pcb.parts.map(p => [p.ref, p]));
        const next = [];
        let added = 0;
        for (const e of elements) {
            if (!e.nodes || !e.nodes.length || ["SCOPE", "LOGAN", "VM", "AM"].includes(e.kind) && !e.nodes.length) continue;
            const fp = Pcb.footprint(e.kind, e.nodes.length, e.ic);
            const old = byRef.get(e.name);
            const nets = fp.pads.map((_, i) => (e.nodes[i] === undefined ? "" : String(e.nodes[i])));
            if (old) { old.fp = fp; old.kind = e.kind; old.nets = nets; next.push(old); }
            else { next.push({ ref: e.name, kind: e.kind, fp, x: 0, y: 0, rot: 0, nets, placed: false }); added++; }
        }
        const removed = pcb.parts.length - (next.length - added);
        pcb.parts = next;
        return { added, removed };
    }

    // ---------------------------------------------------------------- geometry
    static padWorld(part, pad) {
        const th = (part.rot * Math.PI) / 180, c = Math.round(Math.cos(th) * 1e9) / 1e9, s = Math.round(Math.sin(th) * 1e9) / 1e9;
        const swap = Math.abs(Math.round(part.rot / 90)) % 2 === 1;
        return { x: part.x + pad.x * c - pad.y * s, y: part.y + pad.x * s + pad.y * c, w: swap ? pad.h : pad.w, h: swap ? pad.w : pad.h, drill: pad.drill, shape: pad.shape };
    }

    static pads(pcb) {
        const out = [];
        for (const part of pcb.parts) part.fp.pads.forEach((pad, i) => out.push({ part, i, net: part.nets[i] || "", ...Pcb.padWorld(part, pad) }));
        return out;
    }

    static segDist(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    static segSegDist(a, b, c, d) {
        // distance between two segments (zero when they cross)
        const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return 0;
        return Math.min(Pcb.segDist(a[0], a[1], c[0], c[1], d[0], d[1]), Pcb.segDist(b[0], b[1], c[0], c[1], d[0], d[1]),
            Pcb.segDist(c[0], c[1], a[0], a[1], b[0], b[1]), Pcb.segDist(d[0], d[1], a[0], a[1], b[0], b[1]));
    }
    static padRadius(p) { return p.shape === "round" ? Math.min(p.w, p.h) / 2 : Math.hypot(p.w, p.h) / 2; }

    // the pad (if any) a point lands on
    static padAt(pcb, x, y, slack = 0) {
        for (const p of Pcb.pads(pcb)) if (Math.abs(x - p.x) <= p.w / 2 + slack && Math.abs(y - p.y) <= p.h / 2 + slack) return p;
        return null;
    }

    // ---------------------------------------------------------------- connectivity
    // Which copper is joined: pads and track ends / vias that touch. Returns the union-find groups, each with its pads,
    // the net it carries (null when empty, "!" when it joins different nets = a short) and the item ids.
    static connectivity(pcb) {
        const items = [];   // {kind, ref, layers, x/y or pts}
        const pads = Pcb.pads(pcb);
        pads.forEach(p => items.push({ kind: "pad", ref: p, layers: ["F", "B"] }));
        pcb.tracks.forEach(t => items.push({ kind: "track", ref: t, layers: [t.layer] }));
        pcb.vias.forEach(v => items.push({ kind: "via", ref: v, layers: ["F", "B"] }));
        const parent = items.map((_, i) => i);
        const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
        const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
        const tol = 0.02;
        const touches = (a, b) => {
            if (!a.layers.some(l => b.layers.includes(l))) return false;
            const shape = (it) => it.kind === "track" ? { pts: it.ref.pts, r: it.ref.w / 2, pad: false } :
                it.kind === "via" ? { pts: [[it.ref.x, it.ref.y]], r: it.ref.d / 2, pad: false } : { pts: [[it.ref.x, it.ref.y]], r: 0, pad: true, p: it.ref };
            const A = shape(a), B = shape(b);
            // a track joins a pad / via / track at its ends (a point inside the other copper); crossing mid-way does not join
            const inside = (pt, S, rr) => {
                if (S.pad) return Math.abs(pt[0] - S.p.x) <= S.p.w / 2 + tol && Math.abs(pt[1] - S.p.y) <= S.p.h / 2 + tol;
                if (S.pts.length === 1) return Math.hypot(pt[0] - S.pts[0][0], pt[1] - S.pts[0][1]) <= S.r + tol;
                for (let i = 0; i + 1 < S.pts.length; i++) if (Pcb.segDist(pt[0], pt[1], S.pts[i][0], S.pts[i][1], S.pts[i + 1][0], S.pts[i + 1][1]) <= S.r + tol) return true;
                return false;
            };
            const ends = (S, it) => it.kind === "track" ? [S.pts[0], S.pts[S.pts.length - 1]] : S.pts;
            if (a.kind === "track" && inside(ends(A, a)[0], B) || a.kind === "track" && inside(ends(A, a)[1], B)) return true;
            if (b.kind === "track" && inside(ends(B, b)[0], A) || b.kind === "track" && inside(ends(B, b)[1], A)) return true;
            if (a.kind === "via" && b.kind === "via") return Math.hypot(a.ref.x - b.ref.x, a.ref.y - b.ref.y) <= (a.ref.d + b.ref.d) / 2 + tol;
            if (a.kind === "via" && b.kind === "pad") return inside([a.ref.x, a.ref.y], B);
            if (a.kind === "pad" && b.kind === "via") return inside([b.ref.x, b.ref.y], A);
            return false;
        };
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (touches(items[i], items[j])) union(i, j);
        const groups = new Map();
        items.forEach((it, i) => {
            const r = find(i);
            if (!groups.has(r)) groups.set(r, { pads: [], tracks: [], vias: [], nets: new Set() });
            const g = groups.get(r);
            if (it.kind === "pad") { g.pads.push(it.ref); if (it.ref.net) g.nets.add(it.ref.net); }
            else if (it.kind === "track") g.tracks.push(it.ref); else g.vias.push(it.ref);
        });
        const out = [...groups.values()];
        for (const g of out) g.net = g.nets.size === 0 ? null : (g.nets.size === 1 ? [...g.nets][0] : "!");
        return out;
    }

    // ---------------------------------------------------------------- ratsnest
    // For every net the joined groups are linked by a minimum spanning tree over the closest pad pairs
    static ratsnest(pcb, conn = Pcb.connectivity(pcb)) {
        const byNet = new Map();
        for (const g of conn) { if (!g.pads.length || !g.net || g.net === "!") continue; if (!byNet.has(g.net)) byNet.set(g.net, []); byNet.get(g.net).push(g); }
        const lines = [];
        for (const [net, gs] of byNet) {
            if (gs.length < 2) continue;
            const inTree = [gs[0]], rest = gs.slice(1);
            while (rest.length) {
                let best = null;
                for (const r of rest) for (const t of inTree) for (const a of r.pads) for (const b of t.pads) {
                    const d = Math.hypot(a.x - b.x, a.y - b.y);
                    if (!best || d < best.d) best = { d, r, a, b };
                }
                lines.push({ net, a: best.a, b: best.b, d: best.d });
                inTree.push(best.r); rest.splice(rest.indexOf(best.r), 1);
            }
        }
        return lines;
    }

    // ---------------------------------------------------------------- auto placement
    static autoPlace(pcb, { margin = 4, gap = 2.5, fit = false } = {}) {
        const parts = pcb.parts.slice();
        // order by connectivity: start from the part with most nets, then keep adding the part sharing most nets with those placed
        const netsOf = (p) => new Set(p.nets.filter(n => n && n !== "0"));
        const order = [];
        const left = parts.slice();
        left.sort((a, b) => netsOf(b).size - netsOf(a).size);
        while (left.length) {
            let bi = 0, bs = -1;
            for (let i = 0; i < left.length; i++) {
                const ns = netsOf(left[i]);
                const sc = order.reduce((s, o) => s + [...ns].filter(n => netsOf(o).has(n)).length, 0) * 10 - i * 0.01;
                if (sc > bs) { bs = sc; bi = i; }
            }
            order.push(left.splice(bi, 1)[0]);
        }
        const maxW = Math.max(fit ? 60 : pcb.outline.w, 60) - 2 * margin;
        let x = margin, y = margin, rowH = 0, usedW = 0;
        for (const p of order) {
            const w = p.fp.w, h = p.fp.h;
            p.rot = 0;
            if (x + w > margin + maxW && x > margin) { x = margin; y += rowH + gap; rowH = 0; }
            p.x = x + w / 2; p.y = y + h / 2; p.placed = true;
            x += w + gap; rowH = Math.max(rowH, h); usedW = Math.max(usedW, x);
        }
        const w = Math.ceil(usedW - gap + margin), h = Math.ceil(y + rowH + margin);
        pcb.outline.w = fit ? Math.max(w, 20) : Math.max(pcb.outline.w, w);
        pcb.outline.h = fit ? Math.max(h, 20) : Math.max(pcb.outline.h, h);
        return pcb;
    }

    // ---------------------------------------------------------------- design-rule check
    static drc(pcb) {
        const R = pcb.rules, issues = [];
        const pads = Pcb.pads(pcb), conn = Pcb.connectivity(pcb);
        const netOfGroup = new Map();
        conn.forEach((g, gi) => { for (const t of g.tracks) netOfGroup.set(t, g); for (const v of g.vias) netOfGroup.set(v, g); for (const p of g.pads) netOfGroup.set(p.part.ref + ":" + p.i, g); });
        const netName = (it, pad) => {
            const g = netOfGroup.get(pad ? it.part.ref + ":" + it.i : it);
            return g && g.net ? g.net : null;
        };
        // copper items on each layer
        const copper = [];
        for (const p of pads) copper.push({ k: "pad", it: p, layers: ["F", "B"], net: p.net || null, label: `${p.part.ref}.${p.i + 1}` });
        for (const t of pcb.tracks) copper.push({ k: "track", it: t, layers: [t.layer], net: netName(t, false), label: `track ${t.id} (${t.layer})` });
        for (const v of pcb.vias) copper.push({ k: "via", it: v, layers: ["F", "B"], net: netName(v, false), label: `via ${v.id}` });
        // exact gap between two pieces of copper (negative when they overlap): pads are rectangles / circles, tracks polylines
        const shape = (c) => c.k === "track" ? { t: "seg", pts: c.it.pts, r: c.it.w / 2 }
            : c.k === "via" ? { t: "circ", x: c.it.x, y: c.it.y, r: c.it.d / 2 }
            : c.it.shape === "round" ? { t: "circ", x: c.it.x, y: c.it.y, r: Math.min(c.it.w, c.it.h) / 2 } : { t: "rect", x: c.it.x, y: c.it.y, hw: c.it.w / 2, hh: c.it.h / 2 };
        const ptRect = (x, y, r) => Math.hypot(Math.max(0, Math.abs(x - r.x) - r.hw), Math.max(0, Math.abs(y - r.y) - r.hh));
        const segRect = (p, q, r) => {
            const inR = (pt) => Math.abs(pt[0] - r.x) <= r.hw && Math.abs(pt[1] - r.y) <= r.hh;
            if (inR(p) || inR(q)) return 0;
            const c = [[r.x - r.hw, r.y - r.hh], [r.x + r.hw, r.y - r.hh], [r.x + r.hw, r.y + r.hh], [r.x - r.hw, r.y + r.hh]];
            let best = Infinity;
            for (let i = 0; i < 4; i++) best = Math.min(best, Pcb.segSegDist(p, q, c[i], c[(i + 1) % 4]));
            return best;
        };
        const polyDist = (A, B, f) => { let best = Infinity; for (let i = 0; i + 1 < A.pts.length; i++) best = Math.min(best, f(A.pts[i], A.pts[i + 1])); return best; };
        const dist = (ca, cb) => {
            let A = shape(ca), B = shape(cb);
            if (A.t === "seg" && B.t !== "seg") [A, B] = [B, A];
            if (A.t === "circ" && B.t === "rect") [A, B] = [B, A];
            if (A.t === "rect" && B.t === "rect") return Math.hypot(Math.max(0, Math.abs(A.x - B.x) - A.hw - B.hw), Math.max(0, Math.abs(A.y - B.y) - A.hh - B.hh));
            if (A.t === "rect" && B.t === "circ") return ptRect(B.x, B.y, A) - B.r;
            if (A.t === "circ" && B.t === "circ") return Math.hypot(A.x - B.x, A.y - B.y) - A.r - B.r;
            if (A.t === "rect" && B.t === "seg") return polyDist(B, A, (p, q) => segRect(p, q, A)) - B.r;
            if (A.t === "circ" && B.t === "seg") return polyDist(B, A, (p, q) => Pcb.segDist(A.x, A.y, p[0], p[1], q[0], q[1])) - A.r - B.r;
            let best = Infinity;                                                  // seg - seg
            for (let i = 0; i + 1 < A.pts.length; i++) for (let j = 0; j + 1 < B.pts.length; j++) best = Math.min(best, Pcb.segSegDist(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]));
            return best - A.r - B.r;
        };
        for (let i = 0; i < copper.length; i++) for (let j = i + 1; j < copper.length; j++) {
            const a = copper[i], b = copper[j];
            if (a.k === "pad" && b.k === "pad" && a.it.part === b.it.part) continue;
            if (!a.layers.some(l => b.layers.includes(l))) continue;
            if (a.net && a.net === b.net) continue;          // same net: touching is the point
            if (a.net === "!" || b.net === "!") { /* a short is reported below */ }
            const d = dist(a, b);
            if (d < R.clearance - 1e-6) issues.push({ type: d < 0 ? "short" : "clearance", msg: `${a.label} and ${b.label}: ${d < 0 ? "touch / overlap" : d.toFixed(2) + " mm apart"} (rule ${R.clearance} mm)`, x: (a.it.x ?? a.it.pts[0][0]), y: (a.it.y ?? a.it.pts[0][1]) });
        }
        for (const g of conn) if (g.net === "!") issues.push({ type: "short", msg: `copper joins different nets (${[...g.nets].join(", ")})`, x: g.pads[0].x, y: g.pads[0].y });
        for (const t of pcb.tracks) if (t.w < R.minTrack - 1e-9) issues.push({ type: "width", msg: `track ${t.id} is ${t.w} mm wide (minimum ${R.minTrack})`, x: t.pts[0][0], y: t.pts[0][1] });
        // inside the board with an edge margin
        const inside = (x, y, r) => x - r >= R.edge - 1e-6 && y - r >= R.edge - 1e-6 && x + r <= pcb.outline.w - R.edge + 1e-6 && y + r <= pcb.outline.h - R.edge + 1e-6;
        for (const c of copper) {
            const pts = c.k === "track" ? c.it.pts : [[c.it.x, c.it.y]];
            const r = c.k === "track" ? c.it.w / 2 : c.k === "via" ? c.it.d / 2 : Pcb.padRadius(c.it);
            for (const p of pts) if (!inside(p[0], p[1], r)) { issues.push({ type: "edge", msg: `${c.label} is outside the board or closer than ${R.edge} mm to its edge`, x: p[0], y: p[1] }); break; }
        }
        for (const l of Pcb.ratsnest(pcb, conn)) issues.push({ type: "unrouted", msg: `net ${l.net}: ${l.a.part.ref}.${l.a.i + 1} to ${l.b.part.ref}.${l.b.i + 1} is not routed`, x: l.a.x, y: l.a.y });
        return issues;
    }

    // ---------------------------------------------------------------- autorouter
    // Grid maze router (A*) on both layers, with vias, one airwire at a time, shortest first. Obstacles are the copper of
    // other nets grown by the clearance and half a track. Tracks come out on the grid (45° moves allowed). Anything it
    // cannot route is left as an airwire; it never rips up what it has already routed.
    static autoRoute(pcb, { grid = 0.25, maxExpand = 400000, onProgress } = {}) {
        const R = pcb.rules, W = pcb.outline.w, H = pcb.outline.h;
        const nx = Math.floor(W / grid) + 1, ny = Math.floor(H / grid) + 1;
        const idx = (l, x, y) => (l * ny + y) * nx + x;
        let routed = 0, failed = 0;
        const half = R.track / 2;

        const build = () => {
            // owner net of each cell per layer (clearance-grown), "" free, "#" blocked, "!x" several nets
            const own = [new Array(nx * ny).fill(""), new Array(nx * ny).fill("")];
            const stamp = (layer, cx, cy, r, net) => {
                const rr = r + R.clearance + half + grid * 0.4, gx0 = Math.max(0, Math.floor((cx - rr) / grid)), gx1 = Math.min(nx - 1, Math.ceil((cx + rr) / grid));
                const gy0 = Math.max(0, Math.floor((cy - rr) / grid)), gy1 = Math.min(ny - 1, Math.ceil((cy + rr) / grid));
                for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
                    if (Math.hypot(gx * grid - cx, gy * grid - cy) > rr) continue;
                    const k = gy * nx + gx;
                    own[layer][k] = own[layer][k] === "" || own[layer][k] === net ? net : "#";
                }
            };
            const stampSeg = (layer, a, b, r, net) => {
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / (grid / 2)));
                for (let i = 0; i <= n; i++) stamp(layer, a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, r, net);
            };
            const conn = Pcb.connectivity(pcb);
            for (const g of conn) {
                const net = g.net || `?${conn.indexOf(g)}`;
                for (const p of g.pads) for (const l of [0, 1]) {
                    // a pad is stamped as its rectangle (corner points) so wide pads block correctly
                    const rx = p.w / 2, ry = p.h / 2;
                    for (let ox = -rx; ox <= rx + 1e-9; ox += grid / 2) for (let oy = -ry; oy <= ry + 1e-9; oy += grid / 2) stamp(l, p.x + ox, p.y + oy, 0.01, net);
                }
                for (const v of g.vias) for (const l of [0, 1]) stamp(l, v.x, v.y, v.d / 2, net);
                for (const t of g.tracks) for (let i = 0; i + 1 < t.pts.length; i++) stampSeg(t.layer === "F" ? 0 : 1, t.pts[i], t.pts[i + 1], t.w / 2, net);
            }
            // board edge margin
            for (let l = 0; l < 2; l++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++)
                if (x * grid < R.edge + half || y * grid < R.edge + half || x * grid > W - R.edge - half || y * grid > H - R.edge - half) own[l][y * nx + x] = "#";
            return { own, stamp, stampSeg };
        };

        const lines = Pcb.ratsnest(pcb).sort((a, b) => a.d - b.d);
        const grid0 = build(), own = grid0.own;
        for (const line of lines) {
            const net = line.net;
            const sx = Math.round(line.a.x / grid), sy = Math.round(line.a.y / grid), tx = Math.round(line.b.x / grid), ty = Math.round(line.b.y / grid);
            const free = (l, x, y) => x >= 0 && y >= 0 && x < nx && y < ny && (own[l][y * nx + x] === "" || own[l][y * nx + x] === net);
            const key = (l, x, y) => idx(l, x, y);
            const open = new Map(), g = new Map(), from = new Map(), closed = new Set();
            const h = (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) + 0.41 * Math.min(Math.abs(x - tx), Math.abs(y - ty));
            const heap = [];
            const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
            const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l].f < heap[m].f) m = l; if (r < heap.length && heap[r].f < heap[m].f) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
            for (const l of [0, 1]) { const k = key(l, sx, sy); g.set(k, 0); push({ l, x: sx, y: sy, f: h(sx, sy), k }); }
            let found = null, expanded = 0;
            const viaCost = 8;
            while (heap.length && expanded < maxExpand) {
                const cur = pop();
                if (closed.has(cur.k)) continue;
                closed.add(cur.k); expanded++;
                if (cur.x === tx && cur.y === ty) { found = cur; break; }
                const gc = g.get(cur.k);
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                    if (!dx && !dy) continue;
                    const x = cur.x + dx, y = cur.y + dy;
                    const endpoint = (x === tx && y === ty);
                    if (!free(cur.l, x, y) && !endpoint) continue;
                    if (dx && dy && (!free(cur.l, cur.x + dx, cur.y) || !free(cur.l, cur.x, cur.y + dy))) continue;   // no corner cutting
                    const k = key(cur.l, x, y), c = gc + (dx && dy ? 1.414 : 1) + (cur.from && cur.dir !== `${dx},${dy}` ? 0.15 : 0) + (cur.l === 1 ? 0.02 : 0);
                    if (!g.has(k) || c < g.get(k)) { g.set(k, c); from.set(k, cur); push({ l: cur.l, x, y, f: c + h(x, y), k, from: cur, dir: `${dx},${dy}` }); }
                }
                // via
                const ol = 1 - cur.l;
                if (free(ol, cur.x, cur.y) && free(cur.l, cur.x, cur.y) && ![[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => !free(0, cur.x + dx, cur.y + dy) || !free(1, cur.x + dx, cur.y + dy))) {
                    const k = key(ol, cur.x, cur.y), c = gc + viaCost;
                    if (!g.has(k) || c < g.get(k)) { g.set(k, c); push({ l: ol, x: cur.x, y: cur.y, f: c + h(cur.x, cur.y), k, from: cur, via: true, dir: "v" }); }
                }
            }
            if (!found) { failed++; continue; }
            // walk back into runs on one layer
            const path = [];
            for (let n = found; n; n = n.from) path.push(n);
            path.reverse();
            const runs = [], madeTracks = [], madeVias = [];
            let run = null;
            for (const n of path) {
                if (!run || run.l !== n.l) {
                    if (run && n.via) { const v = { id: pcb.nextId++, x: n.x * grid, y: n.y * grid, d: R.via, drill: R.viaDrill }; pcb.vias.push(v); madeVias.push(v); }
                    run = { l: n.l, pts: [] }; runs.push(run);
                }
                run.pts.push([n.x * grid, n.y * grid]);
            }
            for (const r of runs) {
                // drop collinear points, anchor the ends on the exact pad centres
                const pts = [];
                for (const p of r.pts) {
                    if (pts.length >= 2) { const a = pts[pts.length - 2], b = pts[pts.length - 1]; if (Math.abs((b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0])) < 1e-9) pts.pop(); }
                    pts.push(p);
                }
                if (pts.length < 2) continue;
                if (r === runs[0]) pts[0] = [line.a.x, line.a.y];
                if (r === runs[runs.length - 1]) pts[pts.length - 1] = [line.b.x, line.b.y];
                const tr = { id: pcb.nextId++, layer: r.l === 0 ? "F" : "B", w: R.track, pts };
                pcb.tracks.push(tr); madeTracks.push(tr);
            }
            routed++;
            for (const v of madeVias) for (const l of [0, 1]) grid0.stamp(l, v.x, v.y, v.d / 2, net);      // the new copper blocks the rest
            for (const t of madeTracks) for (let i = 0; i + 1 < t.pts.length; i++) grid0.stampSeg(t.layer === "F" ? 0 : 1, t.pts[i], t.pts[i + 1], t.w / 2, net);
            if (onProgress) onProgress(routed + failed, lines.length);
        }
        return { routed, failed, total: lines.length };
    }

    // ---------------------------------------------------------------- Gerber / Excellon
    static gerber(pcb, layer) {
        const f = (v) => Math.round(v * 1e6);       // 4.6 format in mm
        const out = ["G04 Browser SPICE*", "%FSLAX46Y46*%", "%MOMM*%", "%LPD*%"];
        const ap = new Map();
        const aperture = (def) => { if (!ap.has(def)) ap.set(def, 10 + ap.size); return ap.get(def); };
        const body = [];
        const Y = (y) => pcb.outline.h - y;         // gerber's y is up
        const at = (x, y) => `X${f(x)}Y${f(Y(y))}`;
        if (layer === "F" || layer === "B") {
            const flash = [];
            for (const p of Pcb.pads(pcb)) {
                const a = aperture(p.shape === "round" ? `C,${p.w.toFixed(4)}` : `R,${p.w.toFixed(4)}X${p.h.toFixed(4)}`);
                flash.push([a, `${at(p.x, p.y)}D03*`]);
            }
            for (const v of pcb.vias) flash.push([aperture(`C,${v.d.toFixed(4)}`), `${at(v.x, v.y)}D03*`]);
            const draws = [];
            for (const t of pcb.tracks) if (t.layer === layer) {
                const a = aperture(`C,${t.w.toFixed(4)}`);
                const cmds = [`${at(t.pts[0][0], t.pts[0][1])}D02*`];
                for (const p of t.pts.slice(1)) cmds.push(`${at(p[0], p[1])}D01*`);
                draws.push([a, cmds.join("\n")]);
            }
            const groups = new Map();
            for (const [a, c] of [...flash, ...draws]) { if (!groups.has(a)) groups.set(a, []); groups.get(a).push(c); }
            body.push("G01*");
            for (const [a, cs] of groups) body.push(`D${a}*`, ...cs);
        } else if (layer === "Edge") {
            const a = aperture("C,0.1000");
            const { w, h } = pcb.outline;
            body.push("G01*", `D${a}*`, `${at(0, 0)}D02*`, `${at(w, 0)}D01*`, `${at(w, h)}D01*`, `${at(0, h)}D01*`, `${at(0, 0)}D01*`);
        }
        for (const [def, n] of ap) out.push(`%ADD${n}${def.startsWith("C") ? "C" : "R"},${def.slice(2)}*%`);
        out.push(...body, "M02*");
        return out.join("\n") + "\n";
    }

    static excellon(pcb) {
        const tools = new Map();
        const holes = [];
        for (const p of Pcb.pads(pcb)) if (p.drill) holes.push([p.drill, p.x, p.y]);
        for (const v of pcb.vias) holes.push([v.drill, v.x, v.y]);
        for (const [d] of holes) if (!tools.has(d)) tools.set(d, tools.size + 1);
        const out = ["M48", "; Browser SPICE", "METRIC,TZ", ...[...tools].map(([d, n]) => `T${n}C${d.toFixed(3)}`), "%", "G90", "G05"];
        for (const [d, n] of tools) { out.push(`T${n}`); for (const h of holes) if (h[0] === d) out.push(`X${h[1].toFixed(3)}Y${(pcb.outline.h - h[2]).toFixed(3)}`); }
        out.push("M30");
        return out.join("\n") + "\n";
    }

    static files(pcb, name = "board") {
        return [
            [`${name}-F_Cu.gtl`, Pcb.gerber(pcb, "F")], [`${name}-B_Cu.gbl`, Pcb.gerber(pcb, "B")],
            [`${name}-Edge_Cuts.gm1`, Pcb.gerber(pcb, "Edge")], [`${name}.drl`, Pcb.excellon(pcb)]
        ];
    }

    // a store-only ZIP (no compression library needed)
    static zip(files) {
        const enc = new TextEncoder();
        const crcT = Pcb._crcT || (Pcb._crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
        const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
        const parts = [], central = [];
        let offset = 0;
        const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
        for (const [name, text] of files) {
            const nb = enc.encode(name), data = typeof text === "string" ? enc.encode(text) : text, c = crc(data);
            const local = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0x21), ...u16(0), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...nb]);
            parts.push(local, data);
            central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nb]));
            offset += local.length + data.length;
        }
        const cdLen = central.reduce((s, c) => s + c.length, 0);
        const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdLen), ...u32(offset), 0, 0]);
        const all = [...parts, ...central, end], total = all.reduce((s, c) => s + c.length, 0), outArr = new Uint8Array(total);
        let o = 0; for (const c of all) { outArr.set(c, o); o += c.length; }
        return outArr;
    }
}

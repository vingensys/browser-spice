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
        return { outline: { w, h }, rules: { ...Pcb.DEFAULT_RULES }, parts: [], tracks: [], vias: [], zones: [], footprints: {}, nextId: 1 };
    }

    // ---------------------------------------------------------------- footprints
    // Footprints are in the part's own frame, centred on the part. A pad is { n, x, y, w, h, drill, shape, smd }: drill 0 and
    // smd true is a surface-mount pad on the part's side only; a drilled pad is copper on both layers. pinMap[i] is the
    // netlist pin that pad i takes (so a TO-92 transistor gets its package order E B C from the schematic's B C E);
    // silk is a list of polylines (the part outline and a pin-1 mark) drawn on the silkscreen.
    static PACKAGES = {
        R: [["axial", "Axial 10.16 mm (through-hole)"], ["0805", "0805 (SMD)"], ["0603", "0603 (SMD)"], ["1206", "1206 (SMD)"]],
        L: [["axial", "Axial 10.16 mm (through-hole)"], ["0805", "0805 (SMD)"], ["1206", "1206 (SMD)"]],
        C: [["radial", "Radial 5.08 mm (through-hole)"], ["0805", "0805 (SMD)"], ["0603", "0603 (SMD)"], ["1206", "1206 (SMD)"]],
        D: [["axial", "Axial 7.62 mm (through-hole)"], ["sod123", "SOD-123 (SMD)"]],
        Q: [["to92", "TO-92 (through-hole)"], ["sot23", "SOT-23 (SMD)"]],
        M: [["to220", "TO-220 (through-hole)"], ["sot23", "SOT-23 (SMD)"]],
        J: [["to92", "TO-92 (through-hole)"], ["sot23", "SOT-23 (SMD)"]],
        DIGITAL: [["dip", "DIP (through-hole)"], ["soic", "SOIC, 1.27 mm (SMD)"]]
    };
    static packages(kind, lib) { return [...(Pcb.PACKAGES[kind] || []), ...Object.keys(lib || {}).sort().map(n => [`user:${n}`, `${n} (user)`])]; }

    static footprint(kind, nPins, ic, pkg, lib) {
        if (typeof pkg === "string" && pkg.startsWith("user:") && lib && lib[pkg.slice(5)]) return Pcb.userFootprint(lib[pkg.slice(5)]);
        const list = Pcb.PACKAGES[kind], id = list && list.some(x => x[0] === pkg) ? pkg : (list ? list[0][0] : "header");
        const bounds = (pads, extra = 1) => {
            const xs = pads.flatMap(p => [p.x - p.w / 2, p.x + p.w / 2]), ys = pads.flatMap(p => [p.y - p.h / 2, p.y + p.h / 2]);
            return { w: Math.max(...xs.map(Math.abs)) * 2 + extra, h: Math.max(...ys.map(Math.abs)) * 2 + extra };
        };
        const wrap = (name, pads, silk, pinMap, extra) => ({ name, pads, silk, pinMap, ...bounds(pads, extra), smd: pads.every(p => p.smd) });
        const th = (n, pitch, pw, ph, drill) => Array.from({ length: n }, (_, i) => ({ n: i + 1, x: (i - (n - 1) / 2) * pitch, y: 0, w: pw, h: ph, drill, shape: i === 0 && n > 1 ? "rect" : "round", smd: false }));
        const smd2 = (cx, w, h) => [{ n: 1, x: -cx, y: 0, w, h, drill: 0, shape: "rect", smd: true }, { n: 2, x: cx, y: 0, w, h, drill: 0, shape: "rect", smd: true }];
        const box = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
        // two short lines above and below the body between two pads (silk never runs over copper)
        const between = (cx, w, h) => { const g = cx - w / 2 - 0.25; return [[[-g, -h / 2 - 0.2], [g, -h / 2 - 0.2]], [[-g, h / 2 + 0.2], [g, h / 2 + 0.2]]]; };
        switch (id) {
            case "axial": { const pitch = kind === "D" ? 7.62 : 10.16, pads = th(2, pitch, 1.8, 1.8, 0.9), bx = pitch / 2 - 1.6;
                const silk = [box(-bx, -1.4, bx, 1.4)]; if (kind === "D") silk.push([[-bx + 0.8, -1.4], [-bx + 0.8, 1.4]]);
                return wrap(kind === "D" ? "Diode_7.62mm" : "Axial_10.16mm", pads, silk, null, 1.4); }
            case "radial": { const pads = th(2, 5.08, 1.8, 1.8, 0.9), r = 3, circ = Array.from({ length: 25 }, (_, i) => [Math.cos((i / 24) * 2 * Math.PI) * r, Math.sin((i / 24) * 2 * Math.PI) * r]);
                return wrap("Radial_5.08mm", pads, [circ], null, 1); }
            case "0805": return wrap("0805", smd2(1.0, 1.0, 1.4), between(1.0, 1.0, 1.25).concat(kind === "C" ? [] : []), null, 0.8);
            case "0603": return wrap("0603", smd2(0.8, 0.8, 0.95), between(0.8, 0.8, 0.8), null, 0.8);
            case "1206": return wrap("1206", smd2(1.5, 1.1, 1.8), between(1.5, 1.1, 1.6), null, 0.8);
            case "sod123": { const pads = smd2(1.6, 0.9, 1.2); return wrap("SOD-123", pads, between(1.6, 0.9, 1.4).concat([[[-1.1, -0.7], [-1.1, 0.7]]]), null, 0.8); }
            case "to92": { const pads = th(3, 2.54, 1.6, 1.6, 0.9).map(p => ({ ...p, shape: p.n === 1 ? "rect" : "round" })), r = 2.4;
                const arc = Array.from({ length: 13 }, (_, i) => { const t = Math.PI + (i / 12) * Math.PI; return [Math.cos(t) * r, Math.sin(t) * r - 0.6]; });
                // package order: transistor E B C (BJT: nodes B C E), JFET D S G (nodes G D S)
                const map = kind === "J" ? [1, 2, 0] : [2, 0, 1];
                return wrap("TO-92", pads, [arc.concat([arc[0]])], map, 1); }
            case "to220": { const pads = th(3, 2.54, 2.0, 2.4, 1.1), t = -5.5;
                return wrap("TO-220", pads, [box(-5, t - 4.5, 5, t), [[-5, t - 1.2], [5, t - 1.2]]], [0, 1, 2], 1); }       // G D S
            case "sot23": { const pads = [{ n: 1, x: -0.95, y: 1.1, w: 0.8, h: 1.0, drill: 0, shape: "rect", smd: true }, { n: 2, x: 0.95, y: 1.1, w: 0.8, h: 1.0, drill: 0, shape: "rect", smd: true }, { n: 3, x: 0, y: -1.1, w: 0.8, h: 1.0, drill: 0, shape: "rect", smd: true }];
                const map = kind === "M" ? [0, 2, 1] : (kind === "J" ? [0, 2, 1] : [0, 2, 1]);                                      // BJT B E C, MOSFET G S D, JFET G S D
                return wrap("SOT-23", pads, [[[-1.5, -0.6], [-1.5, 0.6]], [[1.5, -0.6], [1.5, 0.6]]], map, 0.8); }
            case "dip": {
                const n = Math.max(8, nPins + (nPins % 2)), half = n / 2, pads = [];
                for (let i = 0; i < n; i++) { const left = i < half, k = left ? i : n - 1 - i; pads.push({ n: i + 1, x: left ? -3.81 : 3.81, y: (k - (half - 1) / 2) * 2.54, w: 1.6, h: 1.6, drill: 0.8, shape: i === 0 ? "rect" : "round", smd: false }); }
                const hh = (half - 1) / 2 * 2.54 + 1.4;
                return wrap(`DIP-${n}`, pads, [[[-1.3, -hh], [-0.5, -hh], [0, -hh + 0.9], [0.5, -hh], [1.3, -hh], [1.3, hh], [-1.3, hh], [-1.3, -hh]]], null, 1); }
            case "soic": {
                const n = Math.max(8, nPins + (nPins % 2)), half = n / 2, pads = [];
                for (let i = 0; i < n; i++) { const left = i < half, k = left ? i : n - 1 - i; pads.push({ n: i + 1, x: left ? -2.7 : 2.7, y: (k - (half - 1) / 2) * 1.27, w: 1.55, h: 0.6, drill: 0, shape: "rect", smd: true }); }
                const hh = (half - 1) / 2 * 1.27 + 0.9;
                return wrap(`SOIC-${n}`, pads, [[[-1.7, -hh], [-0.4, -hh], [0, -hh + 0.5], [0.4, -hh], [1.7, -hh], [1.7, hh], [-1.7, hh], [-1.7, -hh]]], null, 0.8); }
            default: {
                const pads = th(Math.max(1, nPins), 2.54, 1.8, 1.8, 1.0), w = pads.length * 2.54 / 2 + 0.4;
                return wrap(`Header_1x${pads.length}`, pads, [box(-w, -1.5, w, 1.5)], null, 1); }
        }
    }

    // ---------------------------------------------------------------- user-defined footprints
    // A user footprint is stored in the design (pcb.footprints[name]) as { name, pads, silk, pinMap? } and written as text:
    //   footprint NAME
    //   pad N X Y W H [round|rect] [drill D]        a pad with a drill is through-hole, one without is surface-mount
    //   line X1 Y1 X2 Y2 [X3 Y3 ...]                a silkscreen polyline
    //   circle X Y R                                a silkscreen circle
    //   map I J K ...                               pad i takes netlist pin map[i] (0-based); default is pad i = pin i
    // Pads are taken by the part's pins in the order they are listed. Lines starting with # are comments.
    static parseFootprint(text) {
        let name = "", pads = [], silk = [], pinMap = null;
        text.split(/\r?\n/).forEach((raw, ln) => {
            const line = raw.replace(/#.*/, "").trim();
            if (!line) return;
            const w = line.split(/\s+/), op = w[0].toLowerCase(), nums = (a) => a.map(Number);
            const bad = (m) => { throw new Error(`line ${ln + 1}: ${m}`); };
            if (op === "footprint") { name = w.slice(1).join("_"); if (!name) bad("a footprint needs a name"); }
            else if (op === "pad") {
                if (w.length < 6) bad("pad needs: pad N X Y W H [round|rect] [drill D]");
                const [x, y, pw, ph] = nums(w.slice(2, 6));
                if (![x, y, pw, ph].every(Number.isFinite) || pw <= 0 || ph <= 0) bad("pad position and size must be numbers (size above 0)");
                const rest = w.slice(6).map(t => t.toLowerCase()), di = rest.indexOf("drill"), drill = di >= 0 ? Number(rest[di + 1]) : 0;
                if (di >= 0 && !(drill > 0)) bad("the drill must be above 0");
                if (drill > Math.min(pw, ph) - 0.2) bad("the drill leaves no copper ring (it must be at least 0.2 mm smaller than the pad)");
                pads.push({ n: w[1], x, y, w: pw, h: ph, drill: drill || 0, shape: rest.includes("rect") ? "rect" : "round", smd: !(drill > 0) });
            } else if (op === "line") {
                const v = nums(w.slice(1));
                if (v.length < 4 || v.length % 2 || !v.every(Number.isFinite)) bad("line needs pairs of coordinates (at least two points)");
                const pts = []; for (let i = 0; i < v.length; i += 2) pts.push([v[i], v[i + 1]]);
                silk.push(pts);
            } else if (op === "circle") {
                const [x, y, r] = nums(w.slice(1, 4));
                if (![x, y, r].every(Number.isFinite) || !(r > 0)) bad("circle needs: circle X Y R");
                silk.push(Array.from({ length: 25 }, (_, i) => [x + Math.cos((i / 24) * 2 * Math.PI) * r, y + Math.sin((i / 24) * 2 * Math.PI) * r]));
            } else if (op === "map") {
                pinMap = nums(w.slice(1));
                if (!pinMap.every(v => Number.isInteger(v) && v >= 0)) bad("map takes pin numbers counting from 0");
            } else bad(`unknown word "${w[0]}"`);
        });
        if (!name) throw new Error("the first line must be: footprint NAME");
        if (!/^[A-Za-z0-9_.+\-]+$/.test(name)) throw new Error("the name may use letters, digits and _ . + - only");
        if (!pads.length) throw new Error("a footprint needs at least one pad");
        if (pinMap && pinMap.length !== pads.length) throw new Error(`map lists ${pinMap.length} pins for ${pads.length} pads`);
        return { name, pads, silk, pinMap };
    }

    static footprintText(fp) {
        const f = (v) => String(Number(v.toFixed(4)));
        const out = [`footprint ${fp.name}`];
        for (const p of fp.pads) out.push(`pad ${p.n} ${f(p.x)} ${f(p.y)} ${f(p.w)} ${f(p.h)} ${p.shape}${p.drill ? ` drill ${f(p.drill)}` : ""}`);
        for (const l of fp.silk || []) out.push(`line ${l.map(q => `${f(q[0])} ${f(q[1])}`).join(" ")}`);
        if (fp.pinMap) out.push(`map ${fp.pinMap.join(" ")}`);
        return out.join("\n") + "\n";
    }

    // the ready-to-use footprint (courtyard size, smd flag) for a stored user footprint
    static userFootprint(def) {
        const pads = def.pads.map(p => ({ ...p }));
        const xs = pads.flatMap(p => [p.x - p.w / 2, p.x + p.w / 2]), ys = pads.flatMap(p => [p.y - p.h / 2, p.y + p.h / 2]);
        for (const l of def.silk || []) for (const q of l) { xs.push(q[0]); ys.push(q[1]); }
        const w = Math.max(...xs.map(Math.abs)) * 2 + 1, h = Math.max(...ys.map(Math.abs)) * 2 + 1;
        return { name: def.name, pads, silk: def.silk || [], pinMap: def.pinMap || null, w, h, smd: pads.every(p => p.smd), user: true };
    }

    // KiCad .kicad_mod (or an old .mod "module"): pads, silkscreen lines / circles / rectangles. Needs KicadImporter.parseSexp.
    static importKicadFootprint(text) {
        const K = KicadImporter, root = K.parseSexp(text), h = K.head(root);
        if (h !== "footprint" && h !== "module") throw new Error("this is not a KiCad footprint (.kicad_mod)");
        const nm = (K.str(root[1]) || "KICAD").replace(/^.*:/, "").replace(/[^A-Za-z0-9_.+\-]/g, "_");
        const pads = [], silk = [];
        const xy = (l, key) => { const k = K.kid(l, key); return k ? [K.num(k[1]), K.num(k[2])] : null; };
        for (const e of root.filter(x => Array.isArray(x))) {
            const hd = K.head(e);
            if (hd === "pad") {
                const num = K.str(e[1]) ?? String(e[1]), type = e[2], shape = e[3], at = K.kid(e, "at"), sz = K.kid(e, "size"), dr = K.kid(e, "drill");
                if (!at || !sz) continue;
                let w = K.num(sz[1]), hgt = K.num(sz[2]);
                const rot = Number(at[3] || 0);
                if (Math.abs(Math.round(rot / 90)) % 2 === 1) [w, hgt] = [hgt, w];
                let drill = 0;
                if (dr) drill = dr[1] === "oval" ? Math.min(K.num(dr[2]), K.num(dr[3])) : K.num(dr[1]);
                if (type === "np_thru_hole") continue;
                pads.push({ n: num, x: K.num(at[1]), y: K.num(at[2]), w, h: hgt, drill: type === "smd" || type === "connect" ? 0 : (drill || 0.8), shape: shape === "circle" ? "round" : "rect", smd: type === "smd" || type === "connect" || !(drill > 0) && type !== "thru_hole" });
            } else if (hd === "fp_line") {
                const layer = K.kid(e, "layer") && K.str(K.kid(e, "layer")[1]);
                if (layer && !/SilkS/.test(layer)) continue;
                const a = xy(e, "start"), b = xy(e, "end"); if (a && b) silk.push([a, b]);
            } else if (hd === "fp_rect") {
                const layer = K.kid(e, "layer") && K.str(K.kid(e, "layer")[1]);
                if (layer && !/SilkS/.test(layer)) continue;
                const a = xy(e, "start"), b = xy(e, "end"); if (a && b) silk.push([a, [b[0], a[1]], b, [a[0], b[1]], a]);
            } else if (hd === "fp_circle") {
                const layer = K.kid(e, "layer") && K.str(K.kid(e, "layer")[1]);
                if (layer && !/SilkS/.test(layer)) continue;
                const c = xy(e, "center"), en = xy(e, "end");
                if (c && en) { const r = Math.hypot(en[0] - c[0], en[1] - c[1]); silk.push(Array.from({ length: 25 }, (_, i) => [c[0] + Math.cos((i / 24) * 2 * Math.PI) * r, c[1] + Math.sin((i / 24) * 2 * Math.PI) * r])); }
            }
        }
        if (!pads.length) throw new Error("that footprint has no pads");
        pads.sort((a, b) => { const x = Number(a.n), y = Number(b.n); return (Number.isFinite(x) ? x : 1e9) - (Number.isFinite(y) ? y : 1e9); });
        return { name: nm, pads, silk, pinMap: null };
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
            if (!e.nodes || !e.nodes.length) continue;
            const old = byRef.get(e.name), part = old || { ref: e.name, x: 0, y: 0, rot: 0, placed: false, flip: false };
            part.kind = e.kind; part.ic = e.ic; part.nodes = e.nodes.map(String);
            Pcb.setPackage(part, part.pkg, pcb.footprints);
            if (!old) added++;
            next.push(part);
        }
        const removed = pcb.parts.length - (next.length - added);
        pcb.parts = next;
        return { added, removed };
    }

    // (re)build a part's footprint and the nets on its pads; an unknown package falls back to the kind's default
    static setPackage(part, pkg, lib) {
        const nodes = part.nodes || [];
        part.pkg = pkg;
        part.fp = Pcb.footprint(part.kind, nodes.length, part.ic, pkg, lib);
        part.nets = part.fp.pads.map((_, i) => { const k = part.fp.pinMap ? part.fp.pinMap[i] : i; return nodes[k] === undefined ? "" : String(nodes[k]); });
        if (!Pcb.packages(part.kind, lib).some(x => x[0] === pkg)) part.pkg = undefined;
        if (!part.fp.smd) part.flip = false;            // only surface-mount parts can go on the back
    }

    // ---------------------------------------------------------------- geometry
    // a point of the footprint frame on the board: mirrored for a part on the back, rotated, then moved
    static xf(part, x, y) {
        if (part.flip) x = -x;
        const th = (part.rot * Math.PI) / 180, c = Math.round(Math.cos(th) * 1e9) / 1e9, sn = Math.round(Math.sin(th) * 1e9) / 1e9;
        return { x: part.x + x * c - y * sn, y: part.y + x * sn + y * c };
    }

    static padWorld(part, pad) {
        const swap = Math.abs(Math.round(part.rot / 90)) % 2 === 1, q = Pcb.xf(part, pad.x, pad.y);
        return { x: q.x, y: q.y, w: swap ? pad.h : pad.w, h: swap ? pad.w : pad.h, drill: pad.drill, shape: pad.shape, smd: !!pad.smd, layers: pad.smd ? [part.flip ? "B" : "F"] : ["F", "B"] };
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
    static connectivity(pcb, withZones = true) {
        const items = [];   // {kind, ref, layers, x/y or pts}
        const pads = Pcb.pads(pcb);
        pads.forEach(p => items.push({ kind: "pad", ref: p, layers: p.layers }));
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
        // a pour joins the pads of its net that sit inside it on its layer
        if (withZones) for (const z of pcb.zones || []) {
            const hits = [];
            items.forEach((it, i) => { if (it.kind === "pad" && it.ref.net && String(it.ref.net) === String(z.net) && it.layers.includes(z.layer) && Pcb.inPoly(it.ref.x, it.ref.y, z.pts)) hits.push(i); });
            for (let k = 1; k < hits.length; k++) union(hits[0], hits[k]);
        }
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

    // ---------------------------------------------------------------- copper pours (zones)
    // zone = { id, layer, net, pts: [[x, y], ...], thermal: true, clearance? }. For the netlist a pour joins every pad of its
    // net on its layer that lies inside the polygon. The copper itself (Pcb.fillZones) is computed on a 0.1 mm grid: the
    // polygon minus a clearance around everything of another net, thermal-relief spokes on its own pads, and only the
    // copper that is actually connected to a pad or via of the net (no islands). Edges therefore step in 0.1 mm.
    static inPoly(x, y, pts) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    static zoneKey(pcb) {
        return JSON.stringify([pcb.outline, pcb.rules, pcb.zones, pcb.tracks, pcb.vias, pcb.parts.map(p => [p.ref, p.x, p.y, p.rot, p.flip, p.fp.name, p.nets])]);
    }

    // [{ zone, rects: [[x1, y1, x2, y2]], connected: [pad...], islands: [pad...], cells }] (cached until the board changes)
    static fillZones(pcb, res = 0.1) {
        const zones = pcb.zones || [];
        if (!zones.length) return [];
        const cache = Pcb._fills || (Pcb._fills = new WeakMap()), key = Pcb.zoneKey(pcb) + res, hit = cache.get(pcb);
        if (hit && hit.key === key) return hit.fills;
        const R = pcb.rules, W = pcb.outline.w, H = pcb.outline.h, nx = Math.ceil(W / res), ny = Math.ceil(H / res);
        const conn = Pcb.connectivity(pcb, false), pads = Pcb.pads(pcb);
        const netOf = new Map();
        conn.forEach((g, gi) => { g.tracks.forEach(t => netOf.set(t, g.net)); g.vias.forEach(v => netOf.set(v, g.net)); });
        const fills = [];
        zones.forEach((z, zi) => {
            const L = z.layer, net = String(z.net), clr = z.clearance || R.clearance, half = res * 0.5;
            const blocked = new Uint8Array(nx * ny), inz = new Uint8Array(nx * ny);
            const edge = R.edge;
            for (let j = 0; j < ny; j++) {
                const y = (j + 0.5) * res;
                for (let i = 0; i < nx; i++) {
                    const x = (i + 0.5) * res;
                    if (x < edge || y < edge || x > W - edge || y > H - edge) continue;
                    if (Pcb.inPoly(x, y, z.pts)) inz[j * nx + i] = 1;
                }
            }
            const disc = (cx, cy, r) => {
                const i0 = Math.max(0, Math.floor((cx - r) / res)), i1 = Math.min(nx - 1, Math.ceil((cx + r) / res)), j0 = Math.max(0, Math.floor((cy - r) / res)), j1 = Math.min(ny - 1, Math.ceil((cy + r) / res));
                for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot((i + 0.5) * res - cx, (j + 0.5) * res - cy) <= r + half) blocked[j * nx + i] = 1;
            };
            const rectGrow = (px, py, hw, hh, grow) => {
                const i0 = Math.max(0, Math.floor((px - hw - grow) / res)), i1 = Math.min(nx - 1, Math.ceil((px + hw + grow) / res)), j0 = Math.max(0, Math.floor((py - hh - grow) / res)), j1 = Math.min(ny - 1, Math.ceil((py + hh + grow) / res));
                for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                    const dx = Math.max(0, Math.abs((i + 0.5) * res - px) - hw), dy = Math.max(0, Math.abs((j + 0.5) * res - py) - hh);
                    if (Math.hypot(dx, dy) <= grow + half) blocked[j * nx + i] = 1;
                }
            };
            const seg = (a, b, r) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (res / 2))); for (let k = 0; k <= n; k++) disc(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, r); };
            const seeds = [];
            for (const p of pads) {
                if (!p.layers.includes(L)) continue;
                const hw = p.w / 2, hh = p.h / 2;
                if (String(p.net) === net && p.net) {
                    seeds.push({ kind: "pad", ref: p, x: p.x, y: p.y });
                    if (z.thermal !== false) {
                        // a ring of clearance around the pad with four spokes left open (relief)
                        const gap = 0.3, spoke = 0.2;
                        const i0 = Math.max(0, Math.floor((p.x - hw - gap) / res)), i1 = Math.min(nx - 1, Math.ceil((p.x + hw + gap) / res)), j0 = Math.max(0, Math.floor((p.y - hh - gap) / res)), j1 = Math.min(ny - 1, Math.ceil((p.y + hh + gap) / res));
                        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                            const cx = (i + 0.5) * res - p.x, cy = (j + 0.5) * res - p.y;
                            const d = p.shape === "round" ? Math.max(0, Math.hypot(cx, cy) - Math.min(hw, hh)) : Math.hypot(Math.max(0, Math.abs(cx) - hw), Math.max(0, Math.abs(cy) - hh));
                            if (d > half && d <= gap + half && Math.abs(cx) > spoke && Math.abs(cy) > spoke) blocked[j * nx + i] = 1;
                        }
                    }
                } else if (p.shape === "round") disc(p.x, p.y, Math.min(hw, hh) + clr); else rectGrow(p.x, p.y, hw, hh, clr);
            }
            for (const t of pcb.tracks) {
                if (t.layer !== L) continue;
                const tn = netOf.get(t);
                if (tn && String(tn) === net) { for (const q of t.pts) seeds.push({ kind: "track", ref: t, x: q[0], y: q[1] }); continue; }
                for (let k = 0; k + 1 < t.pts.length; k++) seg(t.pts[k], t.pts[k + 1], t.w / 2 + clr);
            }
            for (const v of pcb.vias) {
                const vn = netOf.get(v);
                if (vn && String(vn) === net) { seeds.push({ kind: "via", ref: v, x: v.x, y: v.y }); continue; }
                disc(v.x, v.y, v.d / 2 + clr);
            }
            // zones that come earlier win where they overlap: keep out of another net's pour
            for (let k = 0; k < zi; k++) {
                const o = zones[k];
                if (o.layer !== L || String(o.net) === net) continue;
                for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (Pcb.inPoly((i + 0.5) * res, (j + 0.5) * res, o.pts)) blocked[j * nx + i] = 1;
                for (let m = 0; m < o.pts.length; m++) seg(o.pts[m], o.pts[(m + 1) % o.pts.length], clr);
            }
            // keep only copper connected to a pad / via / track of the net; every region is its own component
            const keep = new Uint16Array(nx * ny), stack = [];
            const free = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && inz[j * nx + i] && !blocked[j * nx + i];
            const seedCell = new Map();
            let comps = 0;
            for (const sd of seeds) {
                // the seed may sit on blocked copper of its own pad (spokes keep the centre open); search a few cells around
                const ci = Math.floor(sd.x / res), cj = Math.floor(sd.y / res);
                let found = null;
                for (let r = 0; r <= 12 && !found; r++) for (let dj = -r; dj <= r && !found; dj++) for (let di = -r; di <= r; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && free(ci + di, cj + dj)) { found = [ci + di, cj + dj]; break; }
                seedCell.set(sd, found);
                if (!found || keep[found[1] * nx + found[0]]) continue;
                const id = ++comps;
                keep[found[1] * nx + found[0]] = id; stack.push(found);
                while (stack.length) {
                    const [i, j] = stack.pop();
                    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a2 = i + di, b2 = j + dj; if (free(a2, b2) && !keep[b2 * nx + a2]) { keep[b2 * nx + a2] = id; stack.push([a2, b2]); } }
                }
            }
            // the largest region (by pads) is the pour proper; a pad in another region is cut off unless a track joins it to the pour
            const padsIn = new Map();
            for (const sd of seeds) if (sd.kind === "pad") { const c = seedCell.get(sd), id = c ? keep[c[1] * nx + c[0]] : 0; if (!padsIn.has(id)) padsIn.set(id, []); padsIn.get(id).push(sd.ref); }
            let mainId = 0, best = -1;
            for (const [id, list] of padsIn) if (id && list.length > best) { best = list.length; mainId = id; }
            const pk = (p) => `${p.part.ref}:${p.i}`, groupOf = new Map(); conn.forEach((g, gi) => g.pads.forEach(p => groupOf.set(pk(p), gi)));
            const mainGroups = new Set((padsIn.get(mainId) || []).map(p => groupOf.get(pk(p))));
            const connected = [], islands = [];
            for (const sd of seeds) {
                if (sd.kind !== "pad") continue;
                const c = seedCell.get(sd), id = c ? keep[c[1] * nx + c[0]] : 0;
                (id === mainId && id || mainGroups.has(groupOf.get(pk(sd.ref))) ? connected : islands).push(sd.ref);
            }
            // rows of runs, merged downwards into rectangles
            const rects = [];
            let open = new Map(), cells = 0;
            for (let j = 0; j <= ny; j++) {
                const next = new Map();
                if (j < ny) {
                    let i = 0;
                    while (i < nx) {
                        if (!keep[j * nx + i]) { i++; continue; }
                        let e = i; while (e < nx && keep[j * nx + e]) e++;
                        const k = `${i}:${e}`;
                        next.set(k, open.has(k) ? open.get(k) : { i0: i, i1: e, j0: j });
                        cells += e - i; i = e;
                    }
                }
                for (const [k, r] of open) if (!next.has(k) || next.get(k) !== r) rects.push([r.i0 * res, r.j0 * res, r.i1 * res, j * res]);
                open = next;
            }
            fills.push({ zone: z, rects, connected, islands, cells });
        });
        cache.set(pcb, { key, fills });
        return fills;
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
    static drc(pcb, { zones = true } = {}) {
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
        for (const p of pads) copper.push({ k: "pad", it: p, layers: p.layers, net: p.net || null, label: `${p.part.ref}.${p.i + 1}` });
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
            if (d < R.clearance - 1e-6) issues.push({ type: d < 0 ? "short" : "clearance", ids: [a.label, b.label], msg: `${a.label} and ${b.label}: ${d < 0 ? "touch / overlap" : d.toFixed(2) + " mm apart"} (rule ${R.clearance} mm)`, x: (a.it.x ?? a.it.pts[0][0]), y: (a.it.y ?? a.it.pts[0][1]) });
        }
        for (const g of conn) if (g.net === "!") issues.push({ type: "short", msg: `copper joins different nets (${[...g.nets].join(", ")})`, x: g.pads[0].x, y: g.pads[0].y });
        for (const t of pcb.tracks) if (t.w < R.minTrack - 1e-9) issues.push({ type: "width", msg: `track ${t.id} is ${t.w} mm wide (minimum ${R.minTrack})`, x: t.pts[0][0], y: t.pts[0][1] });
        // inside the board with an edge margin
        const inside = (x, y, r) => x - r >= R.edge - 1e-6 && y - r >= R.edge - 1e-6 && x + r <= pcb.outline.w - R.edge + 1e-6 && y + r <= pcb.outline.h - R.edge + 1e-6;
        for (const c of copper) {
            const pts = c.k === "track" ? c.it.pts : [[c.it.x, c.it.y]];
            const r = c.k === "track" ? c.it.w / 2 : c.k === "via" ? c.it.d / 2 : Pcb.padRadius(c.it);
            for (const p of pts) if (!inside(p[0], p[1], r)) { issues.push({ type: "edge", ids: [c.label], msg: `${c.label} is outside the board or closer than ${R.edge} mm to its edge`, x: p[0], y: p[1] }); break; }
        }
        for (const part of pcb.parts) if (part.pkg && String(part.pkg).startsWith("user:") && part.kind !== "M" && (part.nodes || []).length > part.fp.pads.length) issues.push({ type: "pins", msg: `${part.ref}: footprint ${part.fp.name} has ${part.fp.pads.length} pad(s) but the part has ${part.nodes.length} pin(s)`, x: part.x, y: part.y });
        const zs = zones ? (pcb.zones || []) : [];
        zs.forEach((z, i) => {
            if (!pads.some(p => String(p.net) === String(z.net))) issues.push({ type: "zone", msg: `pour ${z.id} (${z.layer}.Cu) is on net ${z.net}, which has no pad on the board`, x: z.pts[0][0], y: z.pts[0][1] });
            for (let k = 0; k < i; k++) { const o = zs[k]; if (o.layer === z.layer && String(o.net) !== String(z.net) && z.pts.some(q => Pcb.inPoly(q[0], q[1], o.pts)) ) issues.push({ type: "zone", msg: `pours ${o.id} and ${z.id} (different nets) overlap on ${z.layer}.Cu; the earlier one wins`, x: z.pts[0][0], y: z.pts[0][1] }); }
        });
        if (zones) for (const f of Pcb.fillZones(pcb)) for (const p of f.islands) issues.push({ type: "zone", msg: `${p.part.ref}.${p.i + 1} is inside pour ${f.zone.id} but cut off from it (islanded by clearance to other nets)`, x: p.x, y: p.y });
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
                for (const p of g.pads) for (const l of p.layers.map(x => (x === "F" ? 0 : 1))) {
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
            const lay = (pd) => pd.layers.map(x => (x === "F" ? 0 : 1));
            const endLayers = lay(line.b);
            for (const l of lay(line.a)) { const k = key(l, sx, sy); g.set(k, 0); push({ l, x: sx, y: sy, f: h(sx, sy), k }); }
            let found = null, expanded = 0;
            const viaCost = 8;
            while (heap.length && expanded < maxExpand) {
                const cur = pop();
                if (closed.has(cur.k)) continue;
                closed.add(cur.k); expanded++;
                if (cur.x === tx && cur.y === ty && endLayers.includes(cur.l)) { found = cur; break; }
                const gc = g.get(cur.k);
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                    if (!dx && !dy) continue;
                    const x = cur.x + dx, y = cur.y + dy;
                    const endpoint = (x === tx && y === ty && endLayers.includes(cur.l));
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

    // ---------------------------------------------------------------- silkscreen text
    // a 3 x 5 stroke font (columns 0..2, rows 0..4 downwards); lower case is drawn as capitals
    static FONT = (() => {
        const P = { 0: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]], 1: [[[0, 1], [1, 0], [1, 4]]], 2: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 4], [2, 4]]],
            3: [[[0, 0], [2, 0], [2, 4], [0, 4]], [[0, 2], [2, 2]]], 4: [[[0, 0], [0, 2], [2, 2]], [[2, 0], [2, 4]]], 5: [[[2, 0], [0, 0], [0, 2], [2, 2], [2, 4], [0, 4]]],
            6: [[[2, 0], [0, 0], [0, 4], [2, 4], [2, 2], [0, 2]]], 7: [[[0, 0], [2, 0], [2, 4]]], 8: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]], [[0, 2], [2, 2]]], 9: [[[2, 2], [0, 2], [0, 0], [2, 0], [2, 4], [0, 4]]],
            A: [[[0, 4], [0, 0], [2, 0], [2, 4]], [[0, 2], [2, 2]]], B: [[[0, 0], [1.5, 0], [2, 0.5], [2, 1.5], [1.5, 2], [0, 2], [0, 0]], [[1.5, 2], [2, 2.5], [2, 3.5], [1.5, 4], [0, 4], [0, 2]]],
            C: [[[2, 0], [0, 0], [0, 4], [2, 4]]], D: [[[0, 0], [1.5, 0], [2, 0.5], [2, 3.5], [1.5, 4], [0, 4], [0, 0]]], E: [[[2, 0], [0, 0], [0, 4], [2, 4]], [[0, 2], [1.5, 2]]],
            F: [[[2, 0], [0, 0], [0, 4]], [[0, 2], [1.5, 2]]], G: [[[2, 0], [0, 0], [0, 4], [2, 4], [2, 2], [1, 2]]], H: [[[0, 0], [0, 4]], [[2, 0], [2, 4]], [[0, 2], [2, 2]]],
            I: [[[0, 0], [2, 0]], [[1, 0], [1, 4]], [[0, 4], [2, 4]]], J: [[[2, 0], [2, 4], [0, 4], [0, 3]]], K: [[[0, 0], [0, 4]], [[2, 0], [0, 2], [2, 4]]], L: [[[0, 0], [0, 4], [2, 4]]],
            M: [[[0, 4], [0, 0], [1, 2], [2, 0], [2, 4]]], N: [[[0, 4], [0, 0], [2, 4], [2, 0]]], P: [[[0, 4], [0, 0], [2, 0], [2, 2], [0, 2]]], Q: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]], [[1, 3], [2, 4]]],
            R: [[[0, 4], [0, 0], [2, 0], [2, 2], [0, 2]], [[1, 2], [2, 4]]], T: [[[0, 0], [2, 0]], [[1, 0], [1, 4]]], U: [[[0, 0], [0, 4], [2, 4], [2, 0]]], V: [[[0, 0], [1, 4], [2, 0]]],
            W: [[[0, 0], [0, 4], [1, 2], [2, 4], [2, 0]]], X: [[[0, 0], [2, 4]], [[2, 0], [0, 4]]], Y: [[[0, 0], [1, 2], [2, 0]], [[1, 2], [1, 4]]], Z: [[[0, 0], [2, 0], [0, 4], [2, 4]]],
            "-": [[[0, 2], [2, 2]]], "_": [[[0, 4], [2, 4]]], ".": [[[1, 3.9], [1, 4]]], "+": [[[0, 2], [2, 2]], [[1, 1], [1, 3]]], "/": [[[0, 4], [2, 0]]] };
        P.O = P[0]; P.S = P[5];
        return P;
    })();

    // polylines (board coordinates) for a string, its left end at (x, y) = the middle of the text, `h` mm tall;
    // mirror writes it reversed, as it must read through the board from the back
    static text(str, x, y, h, mirror = false) {
        const u = h / 4, adv = 3 * u, s = String(str).toUpperCase(), total = s.length * adv - u, out = [];
        [...s].forEach((ch, i) => {
            for (const line of Pcb.FONT[ch] || (ch === " " ? [] : Pcb.FONT["-"])) {
                out.push(line.map(([cx, cy]) => { const px = i * adv + cx * u - total / 2; return [x + (mirror ? -px : px), y + (cy - 2) * u]; }));
            }
        });
        return out;
    }

    // silkscreen polylines of one side: part outlines, a pin-1 mark and the reference
    static silk(pcb, side) {
        const out = [];
        for (const part of pcb.parts) {
            if (!part.fp.silk || (part.fp.smd ? (part.flip ? "B" : "F") : "F") !== side) continue;
            for (const line of part.fp.silk) out.push(line.map(([x, y]) => { const q = Pcb.xf(part, x, y); return [q.x, q.y]; }));
            // pin 1: a small square just beyond the first pad
            const p1 = part.fp.pads[0];
            if (p1) {
                const q = Pcb.xf(part, p1.x, p1.y - Math.max(p1.w, p1.h) / 2 - 0.55);
                out.push([[q.x - 0.2, q.y - 0.2], [q.x + 0.2, q.y - 0.2], [q.x + 0.2, q.y + 0.2], [q.x - 0.2, q.y + 0.2], [q.x - 0.2, q.y - 0.2]]);
            }
            const swapH = Math.abs(Math.round(part.rot / 90)) % 2 === 1, hh = swapH ? part.fp.w : part.fp.h;
            out.push(...Pcb.text(part.ref, part.x, part.y - hh / 2 - 1.1, 1.0, side === "B"));
        }
        return out;
    }

    // ---------------------------------------------------------------- push-and-shove
    // Lays a new segment of a track and pushes the tracks of other nets on the same layer out of its way instead of
    // violating the clearance. shove(pcb, layer, draft, w, net) -> { ok, changes: [{ track, pts }], reason }
    //   draft = the polyline being routed (its last segment is the one being laid; the earlier ones are already placed),
    //   net   = its net (null when unknown). Tracks of the same net are not moved. Pads, vias and the board edge are fixed;
    //   an end of a track that sits on a pad or via, or joins another track, stays where it is (the track pivots about it).
    // The result is checked with the rule check: if anything new would be violated the whole move is refused (ok false) and
    // nothing changes. Nothing is applied here; Pcb.applyShove writes the changes.
    static shove(pcb, layer, draft, w, net, { maxPush = 60 } = {}) {
        const R = pcb.rules, clr = R.clearance, last = [draft[draft.length - 2], draft[draft.length - 1]];
        if (!last[0] || !last[1] || Math.hypot(last[1][0] - last[0][0], last[1][1] - last[0][1]) < 1e-6) return { ok: true, changes: [] };
        const conn = Pcb.connectivity(pcb, false), netOf = new Map();
        conn.forEach(g => g.tracks.forEach(t => netOf.set(t, g.net)));
        const pads = Pcb.pads(pcb);
        const sameNet = (n) => net !== null && net !== undefined && n !== null && n !== undefined && String(n) === String(net);
        // which track ends cannot move: on a pad, a via, or touching another track of the layer
        const anchored = (t, i) => {
            const q = t.pts[i];
            for (const p of pads) if (p.layers.includes(layer) && Math.abs(q[0] - p.x) <= p.w / 2 + 0.02 && Math.abs(q[1] - p.y) <= p.h / 2 + 0.02) return true;
            for (const v of pcb.vias) if (Math.hypot(q[0] - v.x, q[1] - v.y) <= v.d / 2 + 0.02) return true;
            for (const o of pcb.tracks) if (o !== t && o.layer === layer) for (let k = 0; k + 1 < o.pts.length; k++) if (Pcb.segDist(q[0], q[1], o.pts[k][0], o.pts[k][1], o.pts[k + 1][0], o.pts[k + 1][1]) <= o.w / 2 + 0.02) return true;
            return false;
        };
        // working copies of the tracks that may move
        const work = new Map();
        for (const t of pcb.tracks) if (t.layer === layer && !sameNet(netOf.get(t))) work.set(t, { pts: t.pts.map(q => [q[0], q[1]]), fixed: new Set([...(anchored(t, 0) ? [0] : []), ...(anchored(t, t.pts.length - 1) ? ["end"] : [])]), moved: false, by: [] });
        const pusherOf = (pts, pw, pnet, self) => ({ pts, w: pw, net: pnet, self });
        const queue = [pusherOf(last, w, net, null)];
        let steps = 0, blocked = null;
        const segDistP = (P, a, b) => { let best = Infinity; for (let k = 0; k + 1 < P.length; k++) best = Math.min(best, Pcb.segSegDist(P[k], P[k + 1], a, b)); return best; };
        const ptDistP = (P, x, y) => { let best = Infinity, q = null; for (let k = 0; k + 1 < P.length; k++) { const a = P[k], b = P[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); const px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(x - px, y - py); if (d < best) { best = d; q = [px, py]; } } return { d: best, q }; };
        const crosses = (P, a, b) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); for (let k = 0; k + 1 < P.length; k++) { const c = P[k], d = P[k + 1]; if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true; } return false; };
        while (queue.length && !blocked && steps++ < maxPush) {
            const P = queue.shift();
            for (const [t, wk] of work) {
                if (t === P.self || blocked) continue;
                const tNet = netOf.get(t);
                if (P.net !== null && P.net !== undefined && tNet !== null && tNet !== undefined && String(tNet) === String(P.net)) continue;
                const D = P.w / 2 + t.w / 2 + clr + 0.02;
                let changed = false;
                wk.by.push({ pts: P.pts, D });
                for (let pass = 0; pass < 10; pass++) {
                    const pts = wk.pts;
                    // segments of T that are too close; a crossing cannot be pushed aside
                    const bad = [];
                    for (let j = 0; j + 1 < pts.length; j++) {
                        if (crosses(P.pts, pts[j], pts[j + 1])) { blocked = `track ${t.id} crosses the new track; push-and-shove cannot move it across`; break; }
                        if (segDistP(P.pts, pts[j], pts[j + 1]) < D - 1e-6) bad.push(j);
                    }
                    if (blocked || !bad.length) break;
                    // add vertices where the track comes closest and where it leaves the keep-out zone, then push those inside it
                    const ins = [];
                    for (const j of bad) {
                        const a = pts[j], b = pts[j + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                        const add = (f) => { if (f * len > 0.05 && (1 - f) * len > 0.05) ins.push({ j, f, pt: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] }); };
                        const at = (f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
                        const dAt = (f) => ptDistP(P.pts, at(f)[0], at(f)[1]).d;
                        // the stretch of this segment that is inside the keep-out zone, found by sampling and bisection
                        const N = 48, inside = [];
                        for (let k = 0; k <= N; k++) if (dAt(k / N) < D) inside.push(k / N);
                        const step = 1 / N;
                        let fe = Math.min(...inside), fx = Math.max(...inside);
                        if (fe > 0) { let lo = fe, hi = fe - step; for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (dAt(mid) < D) lo = mid; else hi = mid; } fe = hi; }
                        if (fx < 1) { let lo = fx, hi = fx + step; for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (dAt(mid) < D) lo = mid; else hi = mid; } fx = hi; }
                        add(fe); add(fx); add((fe + fx) / 2);
                        // under every bend / end of the pusher, so the push follows its shape
                        for (const e of P.pts) {
                            const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
                            const f = l2 ? Math.max(0, Math.min(1, ((e[0] - a[0]) * dx + (e[1] - a[1]) * dy) / l2)) : 0;
                            if (f >= fe - 1e-9 && f <= fx + 1e-9 && dAt(f) < D) add(f);
                        }
                    }
                    ins.sort((x, y) => (y.j - x.j) || (y.f - x.f));
                    const seen = new Set();
                    for (const { j, f, pt } of ins) {
                        const key = `${j}:${f.toFixed(3)}`; if (seen.has(key)) continue; seen.add(key);
                        pts.splice(j + 1, 0, pt);          // largest f first, so each lands before the ones already inserted
                    }
                    // push every vertex that is inside the zone
                    let movedAny = false;
                    for (let i = 0; i < pts.length; i++) {
                        const { d, q } = ptDistP(P.pts, pts[i][0], pts[i][1]);
                        if (d >= D - 1e-6) continue;
                        const isEnd = i === pts.length - 1, fixed = (i === 0 && wk.fixed.has(0)) || (isEnd && wk.fixed.has("end"));
                        if (fixed) { blocked = `an end of track ${t.id} is fixed on a pad or via and sits inside the keep-out of the new track`; break; }
                        let dx = pts[i][0] - q[0], dy = pts[i][1] - q[1], dl = Math.hypot(dx, dy);
                        if (dl < 1e-9) {                                      // exactly on the pusher: step to the side the track's neighbour lies on
                            const nb = pts[i + 1] || pts[i - 1], seg = P.pts[0], sg = P.pts[1], nx = -(sg[1] - seg[1]), ny = sg[0] - seg[0], nl = Math.hypot(nx, ny) || 1;
                            const sgn = ((nb[0] - q[0]) * nx + (nb[1] - q[1]) * ny) >= 0 ? 1 : -1;
                            dx = (nx / nl) * sgn; dy = (ny / nl) * sgn; dl = 1;
                        }
                        pts[i] = [q[0] + (dx / dl) * (D + 0.01), q[1] + (dy / dl) * (D + 0.01)];
                        movedAny = true;
                    }
                    if (blocked) break;
                    if (movedAny) { changed = true; wk.moved = true; }
                    else break;
                }
                if (blocked) break;
                if (changed) queue.push(pusherOf(wk.pts, t.w, tNet, t));          // what it now touches has to move too
            }
        }
        // tidy: drop vertices that are not needed to stay clear of what pushed the track
        for (const [, wk] of work) {
            if (!wk.moved) continue;
            let again = true;
            while (again) {
                again = false;
                for (let i = 1; i + 1 < wk.pts.length; i++) {
                    const a = wk.pts[i - 1], b = wk.pts[i + 1];
                    if (wk.by.every(pu => segDistP(pu.pts, a, b) >= pu.D - 1e-6 && !crosses(pu.pts, a, b))) { wk.pts.splice(i, 1); again = true; break; }
                }
            }
        }
        if (!blocked && queue.length) blocked = "the pushed tracks keep pushing each other (too crowded)";
        if (blocked) return { ok: false, reason: blocked, changes: [] };
        const changes = [...work].filter(([, wk]) => wk.moved).map(([t, wk]) => ({ track: t, pts: wk.pts }));
        // validate with the rule check: nothing new may be violated
        const trial = (list) => ({ ...pcb, zones: [], tracks: list });
        const cand = { id: -1, layer, w, pts: draft.map(q => [q[0], q[1]]) };
        const key = (i) => `${i.type}|${[...(i.ids || [i.msg])].sort().join("|")}`;
        const before = new Set(Pcb.drc(trial(draft.length >= 3 ? pcb.tracks.concat([{ ...cand, pts: draft.slice(0, -1) }]) : pcb.tracks), { zones: false }).filter(i => i.type !== "unrouted").map(key));
        const moved = new Map(changes.map(c => [c.track, c.pts]));
        const after = Pcb.drc(trial(pcb.tracks.map(t => (moved.has(t) ? { ...t, pts: moved.get(t) } : t)).concat([cand])), { zones: false }).filter(i => i.type !== "unrouted");
        const fresh = after.filter(i => !before.has(key(i)));
        if (fresh.length) return { ok: false, reason: `would violate the rules: ${fresh[0].msg}`, changes: [] };
        return { ok: true, changes };
    }

    static applyShove(pcb, result) { for (const c of result.changes) c.track.pts = c.pts.map(q => [q[0], q[1]]); }

    // ---------------------------------------------------------------- Gerber / Excellon
    // layer: "F" / "B" copper, "SilkF" / "SilkB", "MaskF" / "MaskB" (pad openings, 0.1 mm larger), "PasteF" (SMD pads on the
    // top), "Edge"
    static gerber(pcb, layer) {
        const f = (v) => Math.round(v * 1e6);       // 4.6 format in mm
        const out = ["G04 Browser SPICE*", "%FSLAX46Y46*%", "%MOMM*%", "%LPD*%"];
        const ap = new Map();
        const aperture = (def) => { if (!ap.has(def)) ap.set(def, 10 + ap.size); return ap.get(def); };
        const body = [];
        const Y = (y) => pcb.outline.h - y;         // gerber's y is up
        const at = (x, y) => `X${f(x)}Y${f(Y(y))}`;
        const side = layer.endsWith("B") && layer !== "Edge" ? "B" : "F";
        const padAp = (p, grow) => aperture(p.shape === "round" ? `C,${(p.w + grow).toFixed(4)}` : `R,${(p.w + grow).toFixed(4)}X${(p.h + grow).toFixed(4)}`);
        const regions = [];
        const groups = new Map();
        const add = (a, c) => { if (!groups.has(a)) groups.set(a, []); groups.get(a).push(c); };
        const draw = (a, pts) => add(a, [`${at(pts[0][0], pts[0][1])}D02*`, ...pts.slice(1).map(p => `${at(p[0], p[1])}D01*`)].join("\n"));
        if (layer === "F" || layer === "B") {
            for (const p of Pcb.pads(pcb)) if (p.layers.includes(layer)) add(padAp(p, 0), `${at(p.x, p.y)}D03*`);
            for (const v of pcb.vias) add(aperture(`C,${v.d.toFixed(4)}`), `${at(v.x, v.y)}D03*`);
            for (const t of pcb.tracks) if (t.layer === layer) draw(aperture(`C,${t.w.toFixed(4)}`), t.pts);
            for (const fz of Pcb.fillZones(pcb)) if (fz.zone.layer === layer) for (const [x1, y1, x2, y2] of fz.rects) regions.push(`G36*\n${at(x1, y1)}D02*\nG01*\n${at(x2, y1)}D01*\n${at(x2, y2)}D01*\n${at(x1, y2)}D01*\n${at(x1, y1)}D01*\nG37*`);
        } else if (layer === "MaskF" || layer === "MaskB") {
            for (const p of Pcb.pads(pcb)) if (p.layers.includes(side)) add(padAp(p, 0.1), `${at(p.x, p.y)}D03*`);     // vias stay covered (tented)
        } else if (layer === "PasteF") {
            for (const p of Pcb.pads(pcb)) if (p.smd && p.layers.includes("F")) add(padAp(p, 0), `${at(p.x, p.y)}D03*`);
        } else if (layer === "SilkF" || layer === "SilkB") {
            const a = aperture("C,0.1500");
            for (const line of Pcb.silk(pcb, side)) draw(a, line);
        } else if (layer === "Edge") {
            const a = aperture("C,0.1000"), { w, h } = pcb.outline;
            draw(a, [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]);
        }
        body.push("G01*", ...regions);
        for (const [a, cs] of groups) body.push(`D${a}*`, ...cs);
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
        const files = [
            [`${name}-F_Cu.gtl`, Pcb.gerber(pcb, "F")], [`${name}-B_Cu.gbl`, Pcb.gerber(pcb, "B")],
            [`${name}-Edge_Cuts.gm1`, Pcb.gerber(pcb, "Edge")], [`${name}.drl`, Pcb.excellon(pcb)],
            [`${name}-F_Silkscreen.gto`, Pcb.gerber(pcb, "SilkF")], [`${name}-B_Silkscreen.gbo`, Pcb.gerber(pcb, "SilkB")],
            [`${name}-F_Mask.gts`, Pcb.gerber(pcb, "MaskF")], [`${name}-B_Mask.gbs`, Pcb.gerber(pcb, "MaskB")]
        ];
        if (Pcb.pads(pcb).some(p => p.smd && p.layers.includes("F"))) files.push([`${name}-F_Paste.gtp`, Pcb.gerber(pcb, "PasteF")]);
        return files;
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

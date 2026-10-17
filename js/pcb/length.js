// Track lengths, length-match groups (buses, differential pairs) and length tuning by meander.
//
//   PcbLength.netLengths(pcb)            -> Map net -> { length (mm of copper), tracks, vias }
//   PcbLength.report(pcb)                -> [{ group, rows: [{ net, length, delta }], target, spread, ok }]
//   PcbLength.tune(pcb, net, extra)      -> { ok, added, reason } adds `extra` mm of serpentine to the net's longest straight run
//   PcbLength.tuneGroup(pcb, group)      -> brings every shorter net up to the group's target
//
// pcb.groups = [{ name, nets: ["3", "7"], target: null (the longest net) | mm, tol: mm, pair: bool }]
// A net's length is all the copper of its tracks (for a net with several branches that is the sum, not the longest path).

class PcbLength {
    static segLen(pts) { let L = 0; for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; }

    static netLengths(pcb) {
        const out = new Map(), nets = PcbLength.assign(pcb);
        const at = (net) => { if (!out.has(net)) out.set(net, { length: 0, tracks: 0, vias: 0 }); return out.get(net); };
        for (const t of pcb.tracks || []) { if (!nets.has(t)) continue; const e = at(nets.get(t)); e.length += PcbLength.segLen(t.pts); e.tracks++; }
        for (const v of pcb.vias || []) if (nets.has(v)) at(nets.get(v)).vias++;
        return out;
    }

    // net of every track and via from the connectivity groups
    static assign(pcb) {
        const map = new Map();
        for (const g of Pcb.connectivity(pcb, false)) {
            if (!g.net || g.net === "!") continue;
            for (const t of g.tracks) map.set(t, g.net);
            for (const v of g.vias) map.set(v, g.net);
        }
        return map;
    }

    static report(pcb) {
        const lens = PcbLength.netLengths(pcb), out = [];
        for (const g of pcb.groups || []) {
            const rows = (g.nets || []).map(net => ({ net, length: (lens.get(String(net)) || { length: 0 }).length }));
            const routed = rows.filter(r => r.length > 0);
            const longest = routed.length ? Math.max(...routed.map(r => r.length)) : 0;
            const target = Number.isFinite(g.target) && g.target > 0 ? g.target : longest;
            rows.forEach(r => { r.delta = r.length - target; });
            const tol = Number.isFinite(g.tol) && g.tol >= 0 ? g.tol : (g.pair ? 0.1 : 0.5);
            const spread = routed.length > 1 ? Math.max(...routed.map(r => r.length)) - Math.min(...routed.map(r => r.length)) : 0;
            out.push({ group: g, rows, target, spread, tol, ok: rows.every(r => r.length > 0 && Math.abs(r.delta) <= tol + 1e-9) });
        }
        return out;
    }

    // rule-check lines for groups that are out of tolerance
    static issues(pcb) {
        const out = [];
        for (const r of PcbLength.report(pcb)) {
            if (r.ok) continue;
            const unrouted = r.rows.filter(x => x.length <= 0).map(x => x.net);
            if (unrouted.length) { out.push({ type: "length", msg: `${r.group.pair ? "pair" : "group"} ${r.group.name}: net ${unrouted.join(", ")} has no track yet`, x: 0, y: 0 }); continue; }
            const worst = r.rows.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
            out.push({ type: "length", msg: `${r.group.pair ? "pair" : "group"} ${r.group.name}: net ${worst.net} is ${worst.delta > 0 ? "+" : ""}${worst.delta.toFixed(2)} mm off the target ${r.target.toFixed(2)} mm (tolerance ${r.tol} mm)`, x: 0, y: 0 });
        }
        return out;
    }

    // ---------------------------------------------------------------- tuning
    // Serpentine of n square bumps on a straight run: each bump is up A, across g, down A (g = leg gap), then g of straight, so it
    // uses 2g of the run and adds 2A of copper. `side` is +1 / -1 (which way the bumps stand off the run).
    static bumps(a, b, extra, w, side, gap) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-6) return null;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy * side, ny = ux * side;
        const g = gap, room = L - 2 * g;                          // a gap of straight at both ends
        const nMax = Math.floor((room - g) / (2 * g)) + 1;
        if (nMax < 1) return null;
        const Amax = 8, Amin = Math.max(2 * w, 0.5);
        let n = Math.max(1, Math.ceil(extra / (2 * Amax)));
        if (extra / (2 * n) < Amin) n = Math.max(1, Math.floor(extra / (2 * Amin)));
        if (n > nMax) return null;
        const A = extra / (2 * n);
        const P = (s, h) => [a[0] + ux * s + nx * h, a[1] + uy * s + ny * h];
        const span = 2 * g * (n - 1) + g, lead = (L - span) / 2;       // the serpentine sits in the middle of the run
        const pts = [a.slice(), P(lead, 0)];
        let s = lead;
        for (let i = 0; i < n; i++) {
            pts.push(P(s, A), P(s + g, A), P(s + g, 0));
            if (i < n - 1) { s += 2 * g; pts.push(P(s, 0)); }
        }
        pts.push(b.slice());
        return pts;
    }

    static issueCount(pcb) { return Pcb.drc(pcb, { zones: false }).filter(i => i.type === "clearance" || i.type === "short" || i.type === "edge").length; }

    // add `extra` mm to the net: the longest straight runs are tried in turn, on each side, and the first that adds no rule violation wins
    static tune(pcb, net, extra) {
        net = String(net);
        if (!(extra > 0)) return { ok: true, added: 0, reason: "already long enough" };
        const nets = PcbLength.assign(pcb);
        const tracks = pcb.tracks.filter(t => nets.get(t) === net);
        if (!tracks.length) return { ok: false, added: 0, reason: `net ${net} has no track` };
        const runs = [];
        for (const t of tracks) for (let i = 0; i + 1 < t.pts.length; i++) runs.push({ t, i, L: Math.hypot(t.pts[i + 1][0] - t.pts[i][0], t.pts[i + 1][1] - t.pts[i][1]) });
        runs.sort((x, y) => y.L - x.L);
        const base = PcbLength.issueCount(pcb);
        for (const run of runs.slice(0, 6)) {
            const { t, i } = run, old = t.pts;
            const gap = Math.max(3 * t.w, t.w + pcb.rules.clearance + 0.05);
            for (const side of [1, -1]) {
                const piece = PcbLength.bumps(old[i], old[i + 1], extra, t.w, side, gap);
                if (!piece) continue;
                t.pts = [...old.slice(0, i), ...piece, ...old.slice(i + 2)];
                if (PcbLength.issueCount(pcb) <= base) { return { ok: true, added: extra, reason: "", track: t, side }; }
                t.pts = old;
            }
        }
        return { ok: false, added: 0, reason: `no straight run on net ${net} has room for ${extra.toFixed(2)} mm of serpentine without a rule violation (try a longer run or more space)` };
    }

    static tuneGroup(pcb, group) {
        const rep = PcbLength.report({ ...pcb, groups: [group] })[0];
        const results = [];
        for (const r of rep.rows) {
            if (r.length <= 0) { results.push({ net: r.net, ok: false, reason: "no track" }); continue; }
            const need = rep.target - r.length;
            if (need > (rep.tol || 0) * 0.5) results.push({ net: r.net, ...PcbLength.tune(pcb, r.net, need) });
        }
        return results;
    }
}

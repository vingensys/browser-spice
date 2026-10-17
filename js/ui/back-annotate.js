// PCB -> schematic. Two things flow back from the board:
//   * references: number the parts by where they sit on the board (left to right in rows, or top to bottom in columns),
//     so R1, R2, R3 read in order across the silkscreen. The schematic's parts are renamed with the board's.
//   * footprints: the package each part has on the board is written to the part's Footprint field.
// Only parts whose reference is unique in the design and that are not inside a sub-sheet are matched; the rest are listed as skipped.

class BackAnnotate {
    // find the schematic part behind every board part by reference
    static match(editor, pcb) {
        const byName = new Map();
        for (const sh of editor.sheets) {
            const st = editor.sheetState(sh.id);
            if (!st) continue;
            for (const c of st.components) {
                if (Annotator.SKIP.has(c.type) || editor.isOverlay(c)) continue;
                const k = String(c.name || "");
                if (!byName.has(k)) byName.set(k, []);
                byName.get(k).push({ comp: c, sheetId: sh.id });
            }
        }
        const matched = [], skipped = [];
        for (const part of pcb.parts) {
            const hits = byName.get(part.ref);
            if (hits && hits.length === 1) matched.push({ part, comp: hits[0].comp, sheetId: hits[0].sheetId });
            else skipped.push({ part, why: hits && hits.length > 1 ? "its reference is used more than once" : "it is inside a sub-sheet or has no matching part" });
        }
        return { matched, skipped };
    }

    // -> { renames: [{ part, comp, sheetId, from, to }], footprints: [{ comp, from, to }], skipped }
    static plan(editor, pcb, { renumber = true, footprints = true, order = "across" } = {}) {
        const { matched, skipped } = BackAnnotate.match(editor, pcb);
        const renames = [], fps = [];
        if (renumber) {
            const band = 6, groups = new Map();
            for (const m of matched) {
                const pre = Annotator.prefixOf(m.comp);
                if (!groups.has(pre)) groups.set(pre, []);
                groups.get(pre).push(m);
            }
            const reserved = new Set(skipped.map(s => s.part.ref));       // references of parts we cannot rename stay taken
            for (const [pre, list] of groups) {
                const key = (m) => order === "down" ? [Math.round(m.part.x / band), m.part.y] : [Math.round(m.part.y / band), m.part.x];
                list.sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || String(a.part.ref).localeCompare(String(b.part.ref), undefined, { numeric: true }); });
                let n = 0;
                list.forEach((m) => {
                    let to; do { to = `${pre}${++n}`; } while (reserved.has(to));
                    if (m.part.ref !== to) renames.push({ part: m.part, comp: m.comp, sheetId: m.sheetId, from: m.part.ref, to });
                });
            }
        }
        if (footprints) for (const m of matched) {
            const want = m.part.fp && m.part.fp.name ? m.part.fp.name : "";
            if (want && String(m.comp.footprint || "") !== want) fps.push({ comp: m.comp, from: m.comp.footprint || "", to: want });
        }
        return { renames, footprints: fps, skipped, parts: matched.length };
    }

    // do it: the schematic is saved for undo first (the caller snapshots the board)
    static apply(editor, plan) {
        if (!plan.renames.length && !plan.footprints.length) return { renamed: 0, footprints: 0 };
        if (plan.renames.length) {
            Annotator.apply(editor, { changes: plan.renames.map(r => ({ sheetId: r.sheetId, comp: r.comp, from: r.from, to: r.to })) });
            for (const r of plan.renames) r.part.ref = r.to;
        } else editor.saveState();
        for (const f of plan.footprints) f.comp.footprint = f.to;
        editor.draw();
        editor.notify();
        return { renamed: plan.renames.length, footprints: plan.footprints.length };
    }
}

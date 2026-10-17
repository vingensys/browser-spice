// Design > Auto-Annotate: give every part a reference designator (R1, R2, C1 ...) in drawing order across the whole design, sheet
// after sheet. Either number everything again, or only fix what is wrong (duplicates and parts that have no number) and leave the rest.

class Annotator {
    static SKIP = new Set(["GND", "TEXT", "NODEIC", "POWER", "NETLABEL", "PORT", "OFFSHEET", "SHEET", "BUSTAP"]);

    // the letters a part's reference starts with: its own, if it has one, else the standard one for its type
    static prefixOf(comp) {
        const m = /^([A-Za-z]+)\d*$/.exec(String(comp.name || ""));
        return m ? m[1] : (SchematicEditor.REF_PREFIX[comp.type] || comp.type);
    }

    // Plan the renames without doing them. opts: order "across" (left to right, then down) or "down" (top to bottom, then right), mode "all" or "fix".
    // -> { changes: [{ sheetId, comp, from, to }], parts }
    static plan(editor, { order = "across", mode = "all" } = {}) {
        const band = 80, groups = new Map();
        let parts = 0;
        editor.sheets.forEach((sh, si) => {
            const st = editor.sheetState(sh.id);
            if (!st) return;
            const list = st.components.filter(c => !Annotator.SKIP.has(c.type) && !editor.isOverlay(c));
            const key = (c) => order === "down" ? [Math.round(c.x / band), c.y] : [Math.round(c.y / band), c.x];
            list.sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || a.id - b.id; });
            for (const comp of list) {
                parts++;
                const pre = Annotator.prefixOf(comp);
                if (!groups.has(pre)) groups.set(pre, []);
                groups.get(pre).push({ comp, sheetId: sh.id });
            }
        });
        const changes = [];
        for (const [pre, list] of groups) {
            const num = (c) => { const m = new RegExp(`^${pre}(\\d+)$`).exec(String(c.name || "")); return m ? Number(m[1]) : 0; };
            if (mode === "all") list.forEach((m, i) => { const to = `${pre}${i + 1}`; if (m.comp.name !== to) changes.push({ sheetId: m.sheetId, comp: m.comp, from: m.comp.name, to }); });
            else {
                const taken = new Set(), keep = [], fix = [];
                for (const m of list) { const n = num(m.comp); if (n > 0 && !taken.has(n)) { taken.add(n); keep.push(m); } else fix.push(m); }
                let next = 1;
                for (const m of fix) { while (taken.has(next)) next++; taken.add(next); const to = `${pre}${next}`; changes.push({ sheetId: m.sheetId, comp: m.comp, from: m.comp.name, to }); }
            }
        }
        return { changes, parts };
    }

    // do the renames; current-probe labels that were made from the old name follow it
    static apply(editor, plan) {
        if (!plan.changes.length) return 0;
        editor.saveState();
        // every change at once: names move to their new value (a swap R1 <-> R2 must not trip over itself)
        const probesOf = (sheetId) => { const st = editor.sheetState(sheetId); return st ? st.probes : []; };
        for (const ch of plan.changes) {
            for (const p of probesOf(ch.sheetId)) if (p.type === "I" && p.target === ch.comp.id) { if (p.label === `I(${ch.from})`) p.label = `I(${ch.to})`; p.targetName = ch.to; }
            ch.comp.name = ch.to;
        }
        editor.draw();
        editor.notify();
        return plan.changes.length;
    }

    static open(editor, runner) {
        const wrap = document.createElement("div");
        wrap.style.minWidth = "420px";
        const render = () => {
            const mode = wrap.querySelector('input[name="an-mode"]:checked').value, order = wrap.querySelector('input[name="an-order"]:checked').value;
            const plan = Annotator.plan(editor, { mode, order });
            const shown = plan.changes.slice(0, 14).map(c => `${PropertiesPanel.esc(c.from)} → ${PropertiesPanel.esc(c.to)}`).join(", ");
            wrap.querySelector('[data-role="preview"]').innerHTML = plan.changes.length ? `${plan.changes.length} of ${plan.parts} parts get a new reference: ${shown}${plan.changes.length > 14 ? ", …" : ""}` : `Nothing to change: all ${plan.parts} references are already in order.`;
        };
        wrap.innerHTML = `<div class="property"><label>What to do</label>
                <label class="checkrow"><input type="radio" name="an-mode" value="fix" checked> Fix only duplicates and parts without a number (keep the others)</label>
                <label class="checkrow"><input type="radio" name="an-mode" value="all"> Number every part again, in drawing order</label></div>
            <div class="property"><label>Order</label>
                <label class="checkrow"><input type="radio" name="an-order" value="across" checked> Left to right, then down</label>
                <label class="checkrow"><input type="radio" name="an-order" value="down"> Top to bottom, then right</label></div>
            <div class="prop-note" data-role="preview" style="min-height:3em"></div>
            <div class="prop-note">Numbers continue from sheet to sheet, so every reference in the design is different. Current probes follow their part.</div>`;
        wrap.addEventListener("change", render);
        render();
        Dialog.open({
            title: "Auto-Annotate", content: wrap,
            buttons: [{ label: "Annotate", primary: true, onClick: () => {
                const plan = Annotator.plan(editor, { mode: wrap.querySelector('input[name="an-mode"]:checked').value, order: wrap.querySelector('input[name="an-order"]:checked').value });
                const n = Annotator.apply(editor, plan);
                if (runner) runner.toast(n ? `Renamed ${n} part${n === 1 ? "" : "s"}.` : "Nothing to rename.", "info");
            } }, { label: "Cancel" }]
        });
    }
}

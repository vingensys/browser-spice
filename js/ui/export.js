// Exports that are not netlists: the bill of materials (grouped, as CSV) and the schematic as a PNG picture.

const Exporter = {
    // ---- bill of materials ------------------------------------------------------------------------------------------
    NOT_PARTS: ["GND", "TEXT", "NODEIC", "POWER", "NETLABEL", "PORT", "SHEET"],

    typeName(comp) {
        if (!Exporter.names) {
            Exporter.names = {};
            for (const e of DeviceCatalog.all()) if (!(e.type in Exporter.names) || (!e.model && !e.props.model)) Exporter.names[e.type] = e.name;
        }
        const entry = comp.model ? DeviceCatalog.all().find(e => e.type === comp.type && e.model === comp.model) : null;
        return entry ? entry.name : (Exporter.names[comp.type] || comp.type);
    },

    describe(comp) {
        const part = typeof PartLib !== "undefined" ? PartLib.defs[comp.type] : null;
        if (comp.type === "V" || comp.type === "I") {
            const st = comp.sourceType || "DC", u = comp.type === "V" ? "V" : "A";
            if (st === "DC") return Units.formatSI(Units.parseSI(comp.dcVoltage !== undefined ? comp.dcVoltage : comp.value) || 0, u);
            if (st === "AC") return `sine ${Units.formatSI(Units.parseSI(comp.acMagnitude) || 0, u)} ${Units.formatSI(Units.parseSI(comp.frequency) || 1000, "Hz")}`;
            return st.toLowerCase();
        }
        const v = comp.value === undefined || comp.value === null ? "" : String(comp.value);
        return (comp.model && !v.includes(comp.model) ? [comp.model, v] : [v]).filter(Boolean).join(" ");
    },

    // [{ refs: ["R1","R2"], qty, value, part, tol }] grouped by part type + value, sorted by reference
    bom(editor) {
        const groups = new Map();
        for (const { comp: c, ref } of Hierarchy.flatComponents(editor)) {
            if (Exporter.NOT_PARTS.includes(c.type)) continue;
            const part = Exporter.typeName(c), value = Exporter.describe(c);
            const tol = ["R", "C", "L", "POT", "RHEO"].includes(c.type) && c.tol ? `${c.tol}%` : "";
            const key = [c.type, part, value, tol].join("|");
            if (!groups.has(key)) groups.set(key, { refs: [], value, part, tol, type: c.type });
            groups.get(key).refs.push(ref);
        }
        const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true });
        const rows = [...groups.values()];
        rows.forEach(r => { r.refs.sort(nat); r.qty = r.refs.length; });
        rows.sort((a, b) => nat(a.refs[0].replace(/\d+$/, "") + "0", b.refs[0].replace(/\d+$/, "") + "0") || nat(a.refs[0], b.refs[0]));
        return rows;
    },

    bomCsv(editor) {
        const q = (v) => PlotMath.csvCell(v);
        const rows = Exporter.bom(editor);
        return ["Item,Reference,Quantity,Value,Part,Tolerance",
            ...rows.map((r, i) => [i + 1, r.refs.join(" "), r.qty, r.value, r.part, r.tol].map(q).join(","))].join("\r\n") + "\r\n";
    },

    openBom(editor) {
        const rows = Exporter.bom(editor), esc = PropertiesPanel.esc;
        const wrap = document.createElement("div");
        wrap.className = "bom";
        const total = rows.reduce((n, r) => n + r.qty, 0);
        wrap.innerHTML = rows.length
            ? `<table class="results-table"><thead><tr><th>#</th><th>Reference</th><th>Qty</th><th>Value</th><th>Part</th><th>Tol.</th></tr></thead><tbody>${
                rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.refs.join(", "))}</td><td>${r.qty}</td><td>${esc(r.value)}</td><td>${esc(r.part)}</td><td>${esc(r.tol)}</td></tr>`).join("")}</tbody></table>
               <div class="prop-note">${rows.length} line${rows.length === 1 ? "" : "s"}, ${total} part${total === 1 ? "" : "s"} (ground symbols, notes and probes are not parts).</div>`
            : `<div class="no-selection">There are no parts on the sheet yet.</div>`;
        Dialog.open({
            title: "Bill of Materials", content: wrap, width: "720px",
            buttons: [
                { label: "Copy", onClick: () => { try { navigator.clipboard.writeText(Exporter.bomCsv(editor)); } catch (e) { /* no clipboard */ } return false; } },
                { label: "Download CSV", primary: true, onClick: () => { window.downloadFile("bom.csv", Exporter.bomCsv(editor), "text/csv"); return false; } },
                { label: "Close" }
            ]
        });
    },

    // ---- picture ---------------------------------------------------------------------------------------------------------

    // render the whole design (no grid, selection or hover marks) onto a new canvas at `scale` pixels per sheet unit
    renderImage(editor, scale = 2, margin = 40) {
        if (!editor.components.length && !editor.wires.length) return null;
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        const grow = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
        for (const c of editor.components) { const b = editor.getComponentBox(c); grow(b.x1, b.y1, b.x2, b.y2); }
        for (const w of editor.wires) for (const p of w.route || []) grow(p.x, p.y, p.x, p.y);
        for (const p of editor.probes) grow(p.x - 40, p.y - 30, p.x + 60, p.y + 10);
        x1 -= margin; y1 -= margin; x2 += margin; y2 += margin;
        const W = Math.ceil((x2 - x1) * scale), H = Math.ceil((y2 - y1) * scale);
        if (W * H > 64e6) throw new Error("The picture would be too large. Try again with a smaller scale.");
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;

        const keep = { ctx: editor.ctx, width: editor.width, height: editor.height, panX: editor.panX, panY: editor.panY, zoom: editor.zoom, selection: editor.selection, selectedWire: editor.selectedWire, selectedProbe: editor.selectedProbe, showGrid: editor.showGrid, box: editor.box, hoverSnap: editor.hoverSnap, mouseInside: editor.mouseInside, ercMarks: editor.ercMarks, netHighlight: editor.netHighlight, exporting: editor.exporting };
        try {
            editor.ctx = cv.getContext("2d");
            editor.width = W; editor.height = H;
            editor.zoom = scale; editor.panX = -x1 * scale; editor.panY = -y1 * scale;
            Object.assign(editor, { selection: [], selectedWire: null, selectedProbe: null, showGrid: false, box: null, hoverSnap: null, mouseInside: false, ercMarks: [], netHighlight: null, exporting: true });
            editor.draw();
        } finally {
            Object.assign(editor, keep);
            editor.draw();
        }
        return cv;
    },

    savePng(editor, scale = 2) {
        const cv = Exporter.renderImage(editor, scale);
        if (!cv) { if (window.runner) window.runner.toast("There is nothing on the sheet to export.", "info"); return false; }
        cv.toBlob(b => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b); a.download = "schematic.png";
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        });
        return true;
    }
};

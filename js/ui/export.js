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
,

    // ---- vector picture (SVG) ----------------------------------------------------------------------------------------

    // render the design onto an SvgContext (a recording canvas) and return the SVG text
    renderSvg(editor, margin = 40) {
        if (!editor.components.length && !editor.wires.length) return null;
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        const grow = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
        for (const c of editor.components) { const b = editor.getComponentBox(c); grow(b.x1, b.y1, b.x2, b.y2); }
        for (const w of editor.wires) for (const p of w.route || []) grow(p.x, p.y, p.x, p.y);
        for (const p of editor.probes) grow(p.x - 40, p.y - 30, p.x + 60, p.y + 10);
        x1 -= margin; y1 -= margin; x2 += margin; y2 += margin;
        const W = Math.ceil(x2 - x1), H = Math.ceil(y2 - y1);
        const svg = new SvgContext(W, H, editor.ctx);
        const keep = { ctx: editor.ctx, width: editor.width, height: editor.height, panX: editor.panX, panY: editor.panY, zoom: editor.zoom, selection: editor.selection, selectedWire: editor.selectedWire, selectedProbe: editor.selectedProbe, showGrid: editor.showGrid, box: editor.box, hoverSnap: editor.hoverSnap, mouseInside: editor.mouseInside, ercMarks: editor.ercMarks, netHighlight: editor.netHighlight, exporting: editor.exporting };
        try {
            editor.ctx = svg;
            editor.width = W; editor.height = H; editor.zoom = 1; editor.panX = -x1; editor.panY = -y1;
            Object.assign(editor, { selection: [], selectedWire: null, selectedProbe: null, showGrid: false, box: null, hoverSnap: null, mouseInside: false, ercMarks: [], netHighlight: null, exporting: true });
            editor.draw();
        } finally {
            Object.assign(editor, keep);
            editor.draw();
        }
        return svg.toString();
    },

    saveSvg(editor) {
        const svg = Exporter.renderSvg(editor);
        if (!svg) { if (window.runner) window.runner.toast("There is nothing on the sheet to export.", "info"); return false; }
        window.downloadFile("schematic.svg", svg, "image/svg+xml");
        return true;
    },

    // ---- KiCad netlist ------------------------------------------------------------------------------------------------

    // a KiCad "export" netlist (.net) of the open sheet: every part with its pin numbers / names and the nets they join
    kicadNetlist(editor) {
        const nets = NetlistExtractor.nets(editor);
        const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        const comps = editor.components.filter(c => !Exporter.NOT_PARTS.includes(c.type) && !editor.isOverlay(c));
        const byNet = new Map();
        for (const c of comps) for (const t of editor.getTerminals(c)) {
            const id = nets.terminalNode(c, t.name);
            if (id === null || id === undefined) continue;
            if (!byNet.has(id)) byNet.set(id, []);
            byNet.get(id).push({ ref: c.name, pin: t.name });
        }
        const out = ["(export (version D)", `  (design (source ${q("Browser SPICE")}) (date ${q(new Date().toISOString())}) (tool ${q("Browser SPICE")}))`, "  (components"];
        for (const c of comps) out.push(`    (comp (ref ${q(c.name)}) (value ${q(Exporter.describe(c) || c.type)}) (libsource (lib ${q("browser_spice")}) (part ${q(Exporter.typeName(c))})))`);
        out.push("  )", "  (nets");
        let code = 1;
        for (const [id, pins] of byNet) out.push(`    (net (code ${code++}) (name ${q(id === "0" ? "GND" : nets.displayName(id))})${pins.map(p => ` (node (ref ${q(p.ref)}) (pin ${q(p.pin)}))`).join("")})`);
        out.push("  )", ")");
        return out.join("\n") + "\n";
    }
};

// A recording stand-in for a canvas 2D context that writes SVG: enough of the API for the schematic drawing code.
class SvgContext {
    constructor(width, height, measureCtx) {
        this.width = width; this.height = height; this.measureCtx = measureCtx;
        this.out = []; this.path = []; this.stack = [];
        this.m = [1, 0, 0, 1, 0, 0];                     // a b c d e f
        this.fillStyle = "#000"; this.strokeStyle = "#000"; this.lineWidth = 1; this.font = "10px sans-serif";
        this.textAlign = "start"; this.textBaseline = "alphabetic"; this.globalAlpha = 1; this.lineCap = "butt"; this.lineJoin = "miter"; this.dash = [];
    }

    f(n) { return Number(n.toFixed(2)); }
    pt(x, y) { const [a, b, c, d, e, f] = this.m; return [this.f(a * x + c * y + e), this.f(b * x + d * y + f)]; }
    scaleOf() { return Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2])); }
    static esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
    color(c) { return /^rgba?\(/.test(c) || c.startsWith("#") || /^[a-z]+$/i.test(c) || c.startsWith("hsl") ? c : "#000"; }

    save() { this.stack.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, globalAlpha: this.globalAlpha, dash: this.dash.slice() }); }
    restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }
    setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
    translate(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f]; }
    scale(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a * x, b * x, c * y, d * y, e, f]; }
    rotate(t) { const [a, b, c, d, e, f] = this.m, cs = Math.cos(t), sn = Math.sin(t); this.m = [a * cs + c * sn, b * cs + d * sn, -a * sn + c * cs, -b * sn + d * cs, e, f]; }
    setLineDash(d) { this.dash = d || []; }

    beginPath() { this.path = []; this.cur = null; }
    moveTo(x, y) { const [px, py] = this.pt(x, y); this.path.push(`M${px} ${py}`); this.cur = [x, y]; }
    lineTo(x, y) { const [px, py] = this.pt(x, y); this.path.push(`${this.path.length ? "L" : "M"}${px} ${py}`); this.cur = [x, y]; }
    closePath() { this.path.push("Z"); }
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
    arc(cx, cy, r, a0, a1, ccw = false) {
        const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
        const pts = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 12)));
        for (let i = 0; i <= pts; i++) {
            const a = full ? a0 + ((ccw ? -1 : 1) * i * Math.PI * 2) / pts : a0 + ((a1 - a0) * i) / pts;
            const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
            if (i === 0 && !this.path.length) this.moveTo(x, y); else this.lineTo(x, y);
        }
        if (full) this.closePath();
    }

    style(fill) {
        const alpha = this.globalAlpha < 1 ? ` opacity="${this.f(this.globalAlpha)}"` : "";
        if (fill) return `fill="${SvgContext.esc(this.color(this.fillStyle))}" stroke="none"${alpha}`;
        const dash = this.dash.length ? ` stroke-dasharray="${this.dash.map(d => this.f(d * this.scaleOf())).join(" ")}"` : "";
        return `fill="none" stroke="${SvgContext.esc(this.color(this.strokeStyle))}" stroke-width="${this.f(this.lineWidth * this.scaleOf())}" stroke-linecap="${this.lineCap === "butt" ? "butt" : this.lineCap}" stroke-linejoin="${this.lineJoin}"${dash}${alpha}`;
    }
    stroke() { if (this.path.length) this.out.push(`<path d="${this.path.join("")}" ${this.style(false)}/>`); }
    fill() { if (this.path.length) this.out.push(`<path d="${this.path.join("")}" ${this.style(true)} fill-rule="evenodd"/>`); }
    fillRect(x, y, w, h) { const keep = this.path; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.path = keep; }
    strokeRect(x, y, w, h) { const keep = this.path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.path = keep; }
    clearRect() { }
    clip() { }

    measureText(t) { this.measureCtx.font = this.font; return this.measureCtx.measureText(t); }
    fillText(text, x, y) {
        const [px, py] = this.pt(x, y), size = /(\d+(?:\.\d+)?)px/.exec(this.font), px_ = size ? Number(size[1]) * this.scaleOf() : 10;
        const anchor = { left: "start", start: "start", right: "end", end: "end", center: "middle" }[this.textAlign] || "start";
        const base = { top: "text-before-edge", hanging: "hanging", middle: "central", alphabetic: "alphabetic", ideographic: "ideographic", bottom: "text-after-edge" }[this.textBaseline] || "alphabetic";
        const bold = /bold/.test(this.font) ? ' font-weight="bold"' : "", italic = /italic/.test(this.font) ? ' font-style="italic"' : "";
        const rot = Math.atan2(this.m[1], this.m[0]) * 180 / Math.PI;
        const tr = Math.abs(rot) > 0.01 ? ` transform="rotate(${this.f(rot)} ${px} ${py})"` : "";
        this.out.push(`<text x="${px}" y="${py}" font-family="system-ui, sans-serif" font-size="${this.f(px_)}"${bold}${italic} text-anchor="${anchor}" dominant-baseline="${base}"${tr} ${this.style(true)}>${SvgContext.esc(text)}</text>`);
    }

    toString() {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">\n${this.out.join("\n")}\n</svg>\n`;
    }
}

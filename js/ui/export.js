// Exports that are not netlists: the bill of materials (grouped, as CSV) and the schematic as a PNG picture.

const Exporter = {
    // ---- bill of materials ------------------------------------------------------------------------------------------
    NOT_PARTS: ["GND", "TEXT", "NODEIC", "POWER", "NETLABEL", "PORT", "OFFSHEET", "SHEET", "BUSTAP"],

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

    // the footprint a part is bought as: the one typed in its properties, else the package it has on the PCB (if a board exists)
    footprintOf(editor, comp, ref) {
        const own = String(comp.footprint || "").trim();
        if (own) return own;
        const pcb = editor.pcb;
        const part = pcb && Array.isArray(pcb.parts) ? pcb.parts.find(p => p.ref === ref || p.ref === comp.name) : null;
        return part && part.fp && part.fp.name ? part.fp.name : "";
    },

    // [{ refs: ["R1","R2"], qty, value, part, tol, footprint, mpn, mfr }] grouped by part type + value (+ footprint, MPN, maker), sorted by reference
    bom(editor) {
        const groups = new Map();
        for (const { comp: c, ref } of Hierarchy.flatComponents(editor)) {
            if (Exporter.NOT_PARTS.includes(c.type)) continue;
            const part = Exporter.typeName(c), value = Exporter.describe(c);
            const tol = ["R", "C", "L", "POT", "RHEO"].includes(c.type) && c.tol ? `${c.tol}%` : "";
            const mpn = String(c.mpn || "").trim(), mfr = String(c.mfr || "").trim(), footprint = Exporter.footprintOf(editor, c, ref);
            const key = [c.type, part, value, tol, footprint, mpn, mfr].join("|");
            if (!groups.has(key)) groups.set(key, { refs: [], value, part, tol, type: c.type, footprint, mpn, mfr });
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
        return ["Item,Reference,Quantity,Value,Part,Tolerance,Footprint,MPN,Manufacturer",
            ...rows.map((r, i) => [i + 1, r.refs.join(" "), r.qty, r.value, r.part, r.tol, r.footprint, r.mpn, r.mfr].map(q).join(","))].join("\r\n") + "\r\n";
    },

    // the bill of materials as an Excel workbook (.xlsx): one sheet, a bold frozen header row, column widths, quantities as numbers
    bomXlsx(editor, title = "BOM") {
        const rows = Exporter.bom(editor);
        const head = ["Item", "Reference", "Quantity", "Value", "Part", "Tolerance", "Footprint", "MPN", "Manufacturer"];
        const table = [head, ...rows.map((r, i) => [i + 1, r.refs.join(" "), r.qty, r.value, r.part, r.tol, r.footprint, r.mpn, r.mfr])];
        return Xlsx.build(table, { sheet: title, boldHeader: true, widths: [6, 28, 10, 18, 22, 10, 18, 22, 18] });
    },

    openBom(editor) {
        const rows = Exporter.bom(editor), esc = PropertiesPanel.esc;
        const wrap = document.createElement("div");
        wrap.className = "bom";
        const total = rows.reduce((n, r) => n + r.qty, 0);
        wrap.innerHTML = rows.length
            ? `<table class="results-table"><thead><tr><th>#</th><th>Reference</th><th>Qty</th><th>Value</th><th>Part</th><th>Tol.</th><th>Footprint</th><th>MPN</th><th>Maker</th></tr></thead><tbody>${
                rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.refs.join(", "))}</td><td>${r.qty}</td><td>${esc(r.value)}</td><td>${esc(r.part)}</td><td>${esc(r.tol)}</td><td>${esc(r.footprint)}</td><td>${esc(r.mpn)}</td><td>${esc(r.mfr)}</td></tr>`).join("")}</tbody></table>
               <div class="prop-note">${rows.length} line${rows.length === 1 ? "" : "s"}, ${total} part${total === 1 ? "" : "s"} (ground symbols, notes and probes are not parts).</div>`
            : `<div class="no-selection">There are no parts on the sheet yet.</div>`;
        Dialog.open({
            title: "Bill of Materials", content: wrap, width: "720px",
            buttons: [
                { label: "Copy", onClick: () => { try { navigator.clipboard.writeText(Exporter.bomCsv(editor)); } catch (e) { /* no clipboard */ } return false; } },
                { label: "Download CSV", onClick: () => { window.downloadFile("bom.csv", Exporter.bomCsv(editor), "text/csv"); return false; } },
                { label: "Download XLSX", primary: true, onClick: () => { window.downloadFile("bom.xlsx", new Blob([Exporter.bomXlsx(editor)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); return false; } },
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

    // ---- PDF -----------------------------------------------------------------------------------------------------------

    // The open sheet as a vector PDF on one page (A4 or Letter, landscape or portrait by the drawing's shape), a recorded drawing like the SVG:
    // lines and text stay sharp at any zoom and the text is selectable. Returns { bytes: Uint8Array, text: string } or null for an empty sheet.
    renderPdf(editor, { paper = "a4", margin = 40, title = "" } = {}) {
        if (!editor.components.length && !editor.wires.length) return null;
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        const grow = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
        for (const c of editor.components) { const b = editor.getComponentBox(c); grow(b.x1, b.y1, b.x2, b.y2); }
        for (const w of editor.wires) for (const p of w.route || []) grow(p.x, p.y, p.x, p.y);
        for (const p of editor.probes) grow(p.x - 40, p.y - 30, p.x + 60, p.y + 10);
        x1 -= margin; y1 -= margin; x2 += margin; y2 += margin;
        const W = Math.ceil(x2 - x1), H = Math.ceil(y2 - y1);
        const sizes = { a4: [595.28, 841.89], letter: [612, 792], a3: [841.89, 1190.55] }, [pw0, ph0] = sizes[paper] || sizes.a4;
        const landscape = W >= H, pageW = landscape ? ph0 : pw0, pageH = landscape ? pw0 : ph0, pm = 28;
        const fit = Math.min((pageW - 2 * pm) / W, (pageH - 2 * pm) / H, 1.5);
        const pdf = new PdfContext(W, H, editor.ctx, { pageW, pageH, scale: fit, ox: (pageW - W * fit) / 2, oy: (pageH - H * fit) / 2 });
        const keep = { ctx: editor.ctx, width: editor.width, height: editor.height, panX: editor.panX, panY: editor.panY, zoom: editor.zoom, selection: editor.selection, selectedWire: editor.selectedWire, selectedProbe: editor.selectedProbe, showGrid: editor.showGrid, box: editor.box, hoverSnap: editor.hoverSnap, mouseInside: editor.mouseInside, ercMarks: editor.ercMarks, netHighlight: editor.netHighlight, exporting: editor.exporting };
        try {
            editor.ctx = pdf;
            editor.width = W; editor.height = H; editor.zoom = 1; editor.panX = -x1; editor.panY = -y1;
            Object.assign(editor, { selection: [], selectedWire: null, selectedProbe: null, showGrid: false, box: null, hoverSnap: null, mouseInside: false, ercMarks: [], netHighlight: null, exporting: true });
            editor.draw();
        } finally {
            Object.assign(editor, keep);
            editor.draw();
        }
        const text = pdf.toString(title || (editor.titleBlock && editor.titleBlock.title) || "Schematic");
        return { text, bytes: Uint8Array.from(text, ch => ch.charCodeAt(0) & 255) };
    },

    savePdf(editor, paper = "a4") {
        const pdf = Exporter.renderPdf(editor, { paper });
        if (!pdf) { if (window.runner) window.runner.toast("There is nothing on the sheet to export.", "info"); return false; }
        window.downloadFile("schematic.pdf", new Blob([pdf.bytes], { type: "application/pdf" }));
        return true;
    },

    // ---- KiCad schematic (.kicad_sch, KiCad 7 format) ----------------------------------------------------------------

    // The open sheet as a KiCad schematic: every part becomes a symbol (a box with its pins; the parts KiCad can simulate carry Sim.* fields
    // too), wires and junctions keep their geometry, ground / power / net labels / ports / off-sheet connectors become power symbols and
    // labels, notes become text. One sheet only (hierarchical sheets are not followed). 20 px = 0.1 in = 2.54 mm.
    kicadSch(editor) {
        const K = 0.127, mm = (v) => Number((v * K).toFixed(3)), q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
        let seed = 12345;
        const uuid = () => { const h = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed.toString(16).padStart(8, "0"); }; const a = h(), b = h(), c = h(), d = h(); return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-8${c.slice(0, 3)}-${c.slice(3)}${d.slice(0, 4)}`; };
        const fx = (size = 1.27) => `(effects (font (size ${size} ${size})))`;
        const spice = (v, unit = "") => Units.formatSI(Units.parseSI(v) || 0, unit).replace(/\s/g, "").replace("µ", "u");
        const SKIP_SYMBOL = new Set(["GND", "POWER", "NETLABEL", "PORT", "OFFSHEET", "TEXT", "BUSTAP", "NODEIC"]);
        const libs = new Map(), out = [];
        const body = [];

        // a symbol from the part's pins and box (the pin names double as numbers; y is up in a library symbol)
        const libSymbol = (comp) => {
            const def = editor.getSymbolDef(comp), key = `${comp.type}|${def.pins.map(p => p[0]).join(",")}`;
            if (libs.has(key)) return libs.get(key).id;
            const id = `Browser_SPICE:${comp.type}${libs.size ? "_" + libs.size : ""}`, short = id.split(":")[1];
            const [x1, y1, x2, y2] = def.box;
            const pins = def.pins.map(([name, x, y, dx, dy]) => {
                const ang = ((Math.round(Math.atan2(dy, -dx) * 180 / Math.PI) % 360) + 360) % 360;       // from the connection point toward the body, y up
                return `      (pin passive line (at ${mm(x)} ${mm(-y)} ${ang}) (length 2.54) (name ${q(name)} ${fx()}) (number ${q(name)} ${fx()}))`;
            });
            const text = [
                `    (symbol ${q(id)} (in_bom yes) (on_board yes)`,
                `      (property "Reference" ${q(SchematicEditor.REF_PREFIX[comp.type] || "U")} (at 0 ${mm(-y1 + 8)} 0) ${fx()})`,
                `      (property "Value" ${q(comp.type)} (at 0 ${mm(-y2 - 8)} 0) ${fx()})`,
                `      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))`,
                `      (symbol ${q(short + "_0_1")} (rectangle (start ${mm(x1 + 12)} ${mm(-y1 - 8)}) (end ${mm(x2 - 12)} ${mm(-y2 + 8)}) (stroke (width 0.254) (type default)) (fill (type background))))`,
                `      (symbol ${q(short + "_1_1")}`, ...pins, "      )", "    )"
            ].join("\n");
            libs.set(key, { id, text });
            return id;
        };
        const powerSymbol = (net) => {
            const id = net === "GND" ? "power:GND" : `power:${net}`;
            if (!libs.has(id)) libs.set(id, { id, text: [
                `    (symbol ${q(id)} (power) (pin_names (offset 0) hide) (in_bom no) (on_board no)`,
                `      (property "Reference" "#PWR" (at 0 -3.81 0) (effects (font (size 1.27 1.27)) hide))`,
                `      (property "Value" ${q(net)} (at 0 3.81 0) ${fx()})`,
                `      (symbol ${q(id.split(":")[1] + "_1_1")} (pin power_in line (at 0 0 ${net === "GND" ? 90 : 270}) (length 0) hide (name ${q(net)} ${fx()}) (number "1" ${fx()})))`,
                "    )"].join("\n") });
            return id;
        };
        // model fields KiCad's ngspice understands (the importer reads the same ones)
        const simFields = (comp) => {
            const f = [], P = (k, v) => f.push(`    (property ${q(k)} ${q(v)} (at 0 0 0) (effects (font (size 1.27 1.27)) hide))`);
            const t = comp.type;
            if (t === "R" || t === "C" || t === "L") P("Sim.Device", t);
            else if (t === "V" || t === "I") {
                const st = comp.sourceType || "DC", u = t === "V" ? "V" : "A";
                P("Sim.Device", t); P("Sim.Pins", "2=+ 1=-");
                if (st === "DC") { P("Sim.Type", "DC"); P("Sim.Params", `dc=${spice(comp.dcVoltage !== undefined ? comp.dcVoltage : comp.value, u)}`); }
                else if (st === "AC") { P("Sim.Type", "SIN"); P("Sim.Params", `dc=${spice(comp.dcOffset || 0)} ampl=${spice(comp.acMagnitude === undefined ? 1 : comp.acMagnitude)} f=${spice(comp.frequency || 1000)}`); }
                else if (st === "PULSE") { const p = comp.pulse || {}; P("Sim.Type", "PULSE"); P("Sim.Params", `y1=${spice(p.v1 || 0)} y2=${spice(p.v2 === undefined ? 5 : p.v2)} td=${spice(p.delay || 0)} tr=${spice(p.rise || 1e-6)} tf=${spice(p.fall || 1e-6)} tw=${spice(p.width || 5e-4)} per=${spice(p.period || 1e-3)}`); }
                else if (st === "SQUARE") { const g = comp.gen || {}, T = 1 / (Units.parseSI(g.freq) || 1000), duty = (Units.parseSI(g.duty) || 50) / 100; P("Sim.Type", "PULSE"); P("Sim.Params", `y1=${spice(g.low || 0)} y2=${spice(g.high === undefined ? 5 : g.high)} td=0 tr=1n tf=1n tw=${spice(T * duty)} per=${spice(T)}`); }
            } else if (t === "D" || t === "LED" || t === "DZ") { P("Sim.Device", "D"); P("Sim.Pins", "1=A 2=K"); if (comp.model) P("Sim.Name", comp.model); }
            else if (t === "BJT_NPN" || t === "BJT_PNP") { P("Sim.Device", t === "BJT_NPN" ? "NPN" : "PNP"); if (comp.model) P("Sim.Name", comp.model); }
            else if (t === "NMOS" || t === "PMOS") { P("Sim.Device", t); if (comp.model) P("Sim.Name", comp.model); }
            return f;
        };

        // parts
        const comps = editor.components.filter(c => !editor.isOverlay(c));
        for (const c of comps) {
            const X = mm(c.x), Y = mm(c.y);
            if (c.type === "GND" || c.type === "POWER") {
                const net = c.type === "GND" ? "GND" : String(c.net || "VCC").trim().toUpperCase();
                const lib = powerSymbol(net);
                const p = editor.getTerminalPosition(c, editor.getTerminals(c)[0]);
                body.push(`  (symbol (lib_id ${q(lib)}) (at ${mm(p.x)} ${mm(p.y)} 0) (unit 1) (in_bom no) (on_board no) (uuid ${q(uuid())})\n    (property "Reference" "#PWR${body.length}" (at ${mm(p.x)} ${mm(p.y)} 0) (effects (font (size 1.27 1.27)) hide))\n    (property "Value" ${q(net)} (at ${mm(p.x)} ${mm(p.y + 12)} 0) ${fx()})\n    (pin "1" (uuid ${q(uuid())})))`);
                continue;
            }
            if (c.type === "NETLABEL" || c.type === "PORT" || c.type === "OFFSHEET") {
                const p = editor.getTerminalPosition(c, editor.getTerminals(c)[0]), name = String(c.net || "NET").trim();
                if (c.type === "NETLABEL") body.push(`  (label ${q(name)} (at ${mm(p.x)} ${mm(p.y)} 0) ${fx()} (uuid ${q(uuid())}))`);
                else {
                    const shape = c.type === "PORT" ? "bidirectional" : ({ in: "input", out: "output", bidir: "bidirectional", passive: "passive" }[c.dir || "bidir"]);
                    body.push(`  (global_label ${q(name)} (shape ${shape}) (at ${mm(p.x)} ${mm(p.y)} 0) ${fx()} (uuid ${q(uuid())})\n    (property "Intersheet References" "\${INTERSHEET_REFS}" (at 0 0 0) (effects (font (size 1.27 1.27)) hide)))`);
                }
                continue;
            }
            if (c.type === "TEXT") { body.push(`  (text ${q(c.text || c.value || "")} (at ${X} ${Y} 0) ${fx()} (uuid ${q(uuid())}))`); continue; }
            if (SKIP_SYMBOL.has(c.type)) continue;
            const lib = libSymbol(c), ang = ((360 - ((c.rotation || 0) % 360)) % 360);
            const value = ["R", "C", "L"].includes(c.type) ? spice(c.value) : (Exporter.describe(c) || c.type);
            const props = [`    (property "Reference" ${q(c.name)} (at ${X} ${mm(c.y - 28)} 0) ${fx()})`, `    (property "Value" ${q(value)} (at ${X} ${mm(c.y + 28)} 0) ${fx()})`,
                `    (property "Footprint" ${q(c.footprint || "")} (at ${X} ${Y} 0) (effects (font (size 1.27 1.27)) hide))`];
            if (c.mpn) props.push(`    (property "MPN" ${q(c.mpn)} (at ${X} ${Y} 0) (effects (font (size 1.27 1.27)) hide))`);
            if (c.mfr) props.push(`    (property "Manufacturer" ${q(c.mfr)} (at ${X} ${Y} 0) (effects (font (size 1.27 1.27)) hide))`);
            props.push(`    (property "BrowserSpiceType" ${q(c.type)} (at ${X} ${Y} 0) (effects (font (size 1.27 1.27)) hide))`, ...simFields(c));
            const pins = editor.getSymbolDef(c).pins.map(p => `    (pin ${q(p[0])} (uuid ${q(uuid())}))`);
            body.push(`  (symbol (lib_id ${q(lib)}) (at ${X} ${Y} ${ang})${c.mirror ? " (mirror y)" : ""} (unit 1) (in_bom yes) (on_board yes) (uuid ${q(uuid())})\n${props.join("\n")}\n${pins.join("\n")})`);
        }
        // wires (one segment at a time) and junction dots
        for (const w of editor.wires) {
            const r = w.route || [];
            for (let i = 0; i < r.length - 1; i++) {
                if (r[i].x === r[i + 1].x && r[i].y === r[i + 1].y) continue;
                body.push(`  (${w.bus ? "bus" : "wire"} (pts (xy ${mm(r[i].x)} ${mm(r[i].y)}) (xy ${mm(r[i + 1].x)} ${mm(r[i + 1].y)})) (stroke (width 0) (type default)) (uuid ${q(uuid())}))`);
            }
        }
        for (const key of editor.computeJunctions()) { const [x, y] = key.split(",").map(Number); body.push(`  (junction (at ${mm(x)} ${mm(y)}) (diameter 0) (color 0 0 0 0) (uuid ${q(uuid())}))`); }

        const tb = editor.titleBlock || {};
        out.push(`(kicad_sch (version 20230121) (generator "Browser SPICE") (uuid ${q(uuid())})`, `  (paper "A3")`);
        if (tb.title || tb.company || tb.author || tb.date || tb.rev) out.push(`  (title_block${tb.title ? ` (title ${q(tb.title)})` : ""}${tb.date ? ` (date ${q(tb.date)})` : ""}${tb.rev ? ` (rev ${q(tb.rev)})` : ""}${tb.company ? ` (company ${q(tb.company)})` : ""})`);
        out.push("  (lib_symbols", ...[...libs.values()].map(l => l.text), "  )", ...body, `  (sheet_instances (path "/" (page "1")))`, ")");
        return out.join("\n") + "\n";
    },

    saveKicadSch(editor) {
        if (!editor.components.length && !editor.wires.length) { if (window.runner) window.runner.toast("There is nothing on the sheet to export.", "info"); return false; }
        window.downloadFile("schematic.kicad_sch", Exporter.kicadSch(editor), "text/plain");
        if (window.runner) window.runner.toast(editor.sheets && editor.sheets.length > 1 ? "Exported the open sheet only (hierarchical sheets are not followed)." : "Exported a KiCad 7 schematic.", "info");
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


// A recording stand-in for a canvas 2D context that writes a PDF content stream (single page, base-14 Helvetica fonts, no compression).
// The same slice of the canvas API as SvgContext; coordinates go through the canvas transform, then a uniform scale and a flip into PDF space.
class PdfContext {
    constructor(width, height, measureCtx, { pageW, pageH, scale = 1, ox = 0, oy = 0 } = {}) {
        this.width = width; this.height = height; this.measureCtx = measureCtx;
        Object.assign(this, { pageW, pageH, k: scale, ox, oy });
        this.ops = []; this.path = []; this.stack = []; this.gstates = new Map(); this.usedFonts = new Set(["F1"]);
        this.m = [1, 0, 0, 1, 0, 0];
        this.fillStyle = "#000"; this.strokeStyle = "#000"; this.lineWidth = 1; this.font = "10px sans-serif";
        this.textAlign = "start"; this.textBaseline = "alphabetic"; this.globalAlpha = 1; this.lineCap = "butt"; this.lineJoin = "miter"; this.dash = [];
        this.colorCache = new Map();
    }

    n(v) { return (Math.round(v * 100) / 100).toString(); }
    pt(x, y) { const [a, b, c, d, e, f] = this.m; return [this.ox + this.k * (a * x + c * y + e), this.pageH - (this.oy + this.k * (b * x + d * y + f))]; }
    scaleOf() { return Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2])) * this.k; }

    // any CSS colour -> [r, g, b, a] in 0..1 (the browser normalises it to #rrggbb or rgba(...))
    rgba(css) {
        if (this.colorCache.has(css)) return this.colorCache.get(css);
        let out = [0, 0, 0, 1];
        try {
            const keep = this.measureCtx.fillStyle;
            this.measureCtx.fillStyle = "#000"; this.measureCtx.fillStyle = css;
            const v = String(this.measureCtx.fillStyle);
            this.measureCtx.fillStyle = keep;
            let m;
            if ((m = /^#([0-9a-f]{6})$/i.exec(v))) out = [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255, 1];
            else if ((m = /^rgba?\(([^)]+)\)$/.exec(v))) { const p = m[1].split(",").map(Number); out = [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1]; }
        } catch (e) { /* keep black */ }
        this.colorCache.set(css, out);
        return out;
    }

    save() { this.stack.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, globalAlpha: this.globalAlpha, dash: this.dash.slice(), lineCap: this.lineCap, lineJoin: this.lineJoin }); }
    restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }
    setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
    translate(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f]; }
    scale(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a * x, b * x, c * y, d * y, e, f]; }
    rotate(t) { const [a, b, c, d, e, f] = this.m, cs = Math.cos(t), sn = Math.sin(t); this.m = [a * cs + c * sn, b * cs + d * sn, -a * sn + c * cs, -b * sn + d * cs, e, f]; }
    setLineDash(d) { this.dash = d || []; }

    beginPath() { this.path = []; }
    moveTo(x, y) { const [px, py] = this.pt(x, y); this.path.push(`${this.n(px)} ${this.n(py)} m`); }
    lineTo(x, y) { const [px, py] = this.pt(x, y); this.path.push(`${this.n(px)} ${this.n(py)} ${this.path.length ? "l" : "m"}`); }
    closePath() { this.path.push("h"); }
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

    // transparency needs an ExtGState: one per alpha value
    alpha(a) {
        const key = this.n(a);
        if (!this.gstates.has(key)) this.gstates.set(key, `GS${this.gstates.size + 1}`);
        return `/${this.gstates.get(key)} gs`;
    }

    paint(fill) {
        if (!this.path.length) return;
        const css = fill ? this.fillStyle : this.strokeStyle, [r, g, b, a0] = this.rgba(css), a = a0 * this.globalAlpha;
        const ops = ["q", this.alpha(a)];
        if (fill) ops.push(`${this.n(r)} ${this.n(g)} ${this.n(b)} rg`);
        else {
            ops.push(`${this.n(r)} ${this.n(g)} ${this.n(b)} RG`, `${this.n(Math.max(this.lineWidth * this.scaleOf(), 0.05))} w`, `${{ butt: 0, round: 1, square: 2 }[this.lineCap] || 0} J`, `${{ miter: 0, round: 1, bevel: 2 }[this.lineJoin] || 0} j`);
            ops.push(this.dash.length ? `[${this.dash.map(d => this.n(Math.max(d * this.scaleOf(), 0.1))).join(" ")}] 0 d` : "[] 0 d");
        }
        ops.push(...this.path, fill ? "f*" : "S", "Q");
        this.ops.push(ops.join("\n"));
    }
    stroke() { this.paint(false); }
    fill() { this.paint(true); }
    fillRect(x, y, w, h) { const keep = this.path; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.path = keep; }
    strokeRect(x, y, w, h) { const keep = this.path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.path = keep; }
    clearRect() { }
    clip() { }

    measureText(t) { this.measureCtx.font = this.font; return this.measureCtx.measureText(t); }

    // text in the PDF's own Helvetica (WinAnsi); the ohm sign comes from Symbol, anything else outside Latin-1 becomes "?"
    fillText(text, x, y) {
        text = String(text);
        if (!text) return;
        const size = (/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 10])[1] * this.scaleOf();
        const bold = /bold/.test(this.font), italic = /italic/.test(this.font);
        const font = bold ? (italic ? "F4" : "F2") : (italic ? "F3" : "F1");
        const w = this.measureText(text).width * this.scaleOf();
        const shiftX = { left: 0, start: 0, right: -w, end: -w, center: -w / 2 }[this.textAlign] || 0;
        const base = { top: 0.8, hanging: 0.75, middle: 0.35, alphabetic: 0, ideographic: -0.1, bottom: -0.2 }[this.textBaseline] || 0;
        const [px, py] = this.pt(x, y);
        const ang = -Math.atan2(this.m[1], this.m[0]), cs = Math.cos(ang), sn = Math.sin(ang);
        // along the baseline by shiftX, then down (in PDF: -y of the text's own frame) by base * size
        const tx = px + cs * shiftX + sn * base * size;
        const ty = py + sn * shiftX - cs * base * size;
        const [r, g, b, a0] = this.rgba(this.fillStyle), a = a0 * this.globalAlpha;
        const runs = [];
        for (const ch of text) {
            const sym = ch === "Ω" || ch === "\u2126";
            const code = ch.charCodeAt(0);
            const out = sym ? "W" : (code < 256 ? ch : ch === "−" ? "-" : "?");
            const f = sym ? "F5" : font;
            if (runs.length && runs[runs.length - 1].f === f) runs[runs.length - 1].s += out; else runs.push({ f, s: out });
        }
        const esc = (s) => s.replace(/[\\()]/g, "\\$&");
        let ops = `q\n${this.alpha(a)}\n${this.n(r)} ${this.n(g)} ${this.n(b)} rg\nBT\n${this.n(cs)} ${this.n(sn)} ${this.n(-sn)} ${this.n(cs)} ${this.n(tx)} ${this.n(ty)} Tm`;
        for (const run of runs) { this.usedFonts.add(run.f); ops += `\n/${run.f} ${this.n(size)} Tf\n(${esc(run.s)}) Tj`; }
        this.ops.push(ops + "\nET\nQ");
    }

    // the whole file as a Latin-1 string (every character is one byte, so offsets are string offsets)
    toString(title = "Schematic") {
        const content = this.ops.join("\n") + "\n";
        const objs = [];
        const add = (body) => { objs.push(body); return objs.length; };
        const fonts = { F1: "Helvetica", F2: "Helvetica-Bold", F3: "Helvetica-Oblique", F4: "Helvetica-BoldOblique", F5: "Symbol" };
        // 1 catalog, 2 pages, 3 page, 4 contents, 5.. fonts, then graphics states
        const fontIds = {}, gsIds = {};
        add("<< /Type /Catalog /Pages 2 0 R >>");
        add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
        add("PAGE");
        add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
        for (const [k, name] of Object.entries(fonts)) fontIds[k] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name}${k === "F5" ? "" : " /Encoding /WinAnsiEncoding"} >>`);
        for (const [alpha, name] of this.gstates) gsIds[name] = add(`<< /Type /ExtGState /ca ${alpha} /CA ${alpha} >>`);
        const res = `<< /Font << ${Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(" ")} >> /ExtGState << ${Object.entries(gsIds).map(([k, id]) => `/${k} ${id} 0 R`).join(" ")} >> >>`;
        objs[2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.n(this.pageW)} ${this.n(this.pageH)}] /Contents 4 0 R /Resources ${res} >>`;
        const info = add(`<< /Title (${String(title).replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&")}) /Producer (Browser SPICE) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);
        let out = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
        const offsets = [];
        objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
        const xref = out.length;
        out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
        out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        return out;
    }
}


// A minimal .xlsx writer: one worksheet of text and numbers (inline strings), a bold frozen header row and column widths, in a store-only ZIP.
const Xlsx = {
    esc: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""),
    col(i) { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; },

    // rows: arrays of strings / numbers -> Uint8Array
    build(rows, { sheet = "Sheet1", boldHeader = true, widths = [] } = {}) {
        const e = Xlsx.esc;
        const cell = (v, r, c) => {
            const ref = `${Xlsx.col(c)}${r + 1}`, style = boldHeader && r === 0 ? ' s="1"' : "";
            if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
            return v === "" || v === undefined || v === null ? `<c r="${ref}"${style}/>` : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${e(v)}</t></is></c>`;
        };
        const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
            `<sheetViews><sheetView workbookViewId="0">${boldHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ""}</sheetView></sheetViews>` +
            (widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "") +
            `<sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join("")}</row>`).join("")}</sheetData></worksheet>`;
        const files = [
            ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
            ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
            ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${e(String(sheet).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "Sheet1")}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
            ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
            ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`],
            ["xl/worksheets/sheet1.xml", sheetXml]
        ];
        return Pcb.zip(files);
    }
};

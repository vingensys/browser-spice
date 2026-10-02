// File > Export Report: one self-contained HTML page with the schematic, the parts list, the parameters, the latest
// graphs and measurements, and the SPICE netlist. Open it anywhere, print it to PDF, attach it to a review.

const Report = {
    esc: (s) => PropertiesPanel.esc(String(s === undefined || s === null ? "" : s)),

    // a PNG data URL of each graph the user has run (the plotter is restored afterwards)
    graphs(plotter) {
        const out = [];
        const keep = plotter.data;
        const names = { tran: "Transient", ac: "Frequency response", noise: "Noise", sweep: "DC sweep", step: "Study", fft: "Spectrum", live: "Live run" };
        for (const [kind, label] of Object.entries(names)) {
            const d = plotter.cache && plotter.cache[kind];
            if (!d || !d.xValues || !d.xValues.length) continue;
            plotter.clearCursors();
            plotter.data = d;
            try { plotter.draw(); out.push({ label, url: plotter.canvas.toDataURL("image/png"), series: d.series.map(s => ({ name: s.name, color: s.color })) }); } catch (e) { /* skip a graph that cannot be drawn */ }
        }
        plotter.data = keep;
        plotter.draw();
        return out;
    },

    async build(editor, runner, plotter, doc) {
        const e = Report.esc, tb = editor.titleBlock, date = new Date().toLocaleString();
        const parts = [];
        const title = tb.title || (doc && doc.name) || "Circuit design";
        let image = "";
        try { const cv = Exporter.renderImage(editor, 2); if (cv) image = cv.toDataURL("image/png"); } catch (err) { /* too large to draw */ }
        const bom = Exporter.bom(editor);
        const total = bom.reduce((n, r) => n + r.qty, 0);
        let meas = [];
        if (editor.measures.length) { try { meas = await MeasureDialog.evaluate(editor, runner, false); } catch (err) { meas = []; } }
        let netlist = "";
        try { netlist = runner.spiceText().text; } catch (err) { netlist = `* ${err.message}`; }
        const graphs = Report.graphs(plotter);
        const rows = (r) => r.map(x => `<tr>${x.map(c => `<td>${e(c)}</td>`).join("")}</tr>`).join("");

        parts.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(title)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:980px;margin:2em auto;padding:0 1em;color:#1a1a1a}h1{margin-bottom:0}h2{margin-top:2em;border-bottom:1px solid #ccc;padding-bottom:.2em}
table{border-collapse:collapse;margin:.6em 0}td,th{border:1px solid #ccc;padding:.25em .7em;text-align:left}th{background:#f1f1f1}img{max-width:100%;border:1px solid #ddd}pre{background:#f6f6f6;padding:1em;overflow:auto;font-size:12px}.dim{color:#777}@media print{h2{break-after:avoid}img{break-inside:avoid}}</style></head><body>`);
        parts.push(`<h1>${e(title)}</h1><div class="dim">${[tb.company, tb.doc && `doc ${tb.doc}`, tb.rev && `rev ${tb.rev}`, tb.author, tb.date].filter(Boolean).map(e).join(" · ")}${tb.company || tb.author ? " · " : ""}report made ${e(date)} with Browser SPICE</div>`);
        parts.push(`<h2>Schematic</h2>${image ? `<img alt="schematic" src="${image}">` : "<p>The sheet is empty.</p>"}`);
        if (editor.sheets.length > 1) parts.push(`<p class="dim">The design has ${editor.sheets.length} sheets: ${editor.sheets.map(s => e(s.name)).join(", ")}. Only the open sheet is drawn above; the parts list and the netlist cover all sheets.</p>`);
        if (editor.params.length) parts.push(`<h2>Parameters</h2><table><tr><th>Name</th><th>Value</th></tr>${rows(editor.params.map(p => [p.name, p.value]))}</table>`);
        parts.push(`<h2>Parts list</h2>${bom.length ? `<table><tr><th>Reference</th><th>Qty</th><th>Value</th><th>Part</th><th>Tolerance</th></tr>${rows(bom.map(r => [r.refs.join(", "), r.qty, r.value, r.part, r.tol]))}</table><div class="dim">${total} parts</div>` : "<p>No parts.</p>"}`);
        if (meas.length) parts.push(`<h2>Measurements</h2><table><tr><th>Name</th><th>Measurement</th><th>Signal</th><th>Value</th></tr>${rows(editor.measures.map((m, i) => [m.name, Measure.FUNCS[m.kind][m.fn] || m.fn, m.sig, meas[i] && meas[i].error ? meas[i].error : Units.formatSI(meas[i].value, Measure.unit(m))]))}</table>`);
        for (const g of graphs) parts.push(`<h2>${e(g.label)}</h2><img alt="${e(g.label)}" src="${g.url}"><div class="dim">${g.series.map(s => `<span style="color:${e(s.color)}">■</span> ${e(s.name)}`).join(" &nbsp; ")}</div>`);
        parts.push(`<h2>SPICE netlist</h2><pre>${e(netlist)}</pre></body></html>`);
        return parts.join("\n");
    }
};

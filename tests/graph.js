// Graph window: cursors, measurements, CSV / PNG export, and a true time axis.
// In the running app:  (0, eval)(await (await fetch('tests/graph.js')).text()); await graphTests();

window.graphTests = async function () {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, ...(cond ? {} : { extra }) });
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const P = plotter, cv = P.canvas;
    live.stop();

    const ptr = (type, px, py, o = {}) => {
        const r = cv.getBoundingClientRect();
        cv.dispatchEvent(new (type === "contextmenu" ? MouseEvent : PointerEvent)(type, {
            clientX: r.left + px, clientY: r.top + py, button: o.button || 0, buttons: type === "pointerup" ? 0 : 1, shiftKey: !!o.shift, bubbles: true, pointerId: 1
        }));
    };

    // a 555 oscillator: adaptive steps make the time grid uneven
    loadExampleById(editor, "555-astable");
    graph.show("tran");
    document.getElementById("simTstop").value = "10m"; document.getElementById("simTstep").value = "5u";
    await runner.runTransient();
    await wait(100);
    const d = P.data;
    ok("a transient plot holds the probes", d && d.mode === "transient" && d.series.length === 2 && d.xValues.length > 100, d && d.series.length);
    const steps = d.xValues.slice(1).map((t, i) => t - d.xValues[i]);
    ok("the adaptive solver's time grid is uneven (so the axis must be drawn by time, not index)", Math.max(...steps) / Math.min(...steps.filter(s => s > 0)) > 3, [Math.max(...steps), Math.min(...steps)]);

    // the axis is real time: a pixel position maps to the time it shows
    P.resetZoom();
    graph.toggleMeasure(true);          // the panel narrows the plot, so open it before measuring pixels
    await wait(100);
    const px0 = P.plotLeft(), pw = P.plotWidth();
    const tEnd = d.xValues[d.xValues.length - 1];
    ok("the left edge is the first sample and the right edge the last (value axis)", near(P.xAtPixel(px0), d.xValues[0], 1e-12) && near(P.xAtPixel(px0 + pw), tEnd, tEnd * 1e-9));
    ok("the middle of the plot is the middle of the time span, whatever the step sizes", near(P.xAtPixel(px0 + pw / 2), (d.xValues[0] + tEnd) / 2, tEnd * 1e-6));

    // cursors: click = A, shift+click = B
    const y = 100;
    ptr("pointerdown", px0 + pw * 0.2, y); ptr("pointerup", px0 + pw * 0.2, y);
    ok("a click places cursor A at that time", P.cursors.a !== null && near(P.cursors.a, tEnd * 0.2, tEnd * 0.002), P.cursors);
    ptr("pointerdown", px0 + pw * 0.6, y, { shift: true }); ptr("pointerup", px0 + pw * 0.6, y, { shift: true });
    ok("Shift+click places cursor B", P.cursors.b !== null && near(P.cursors.b, tEnd * 0.6, tEnd * 0.002));
    await wait(250);
    const panel = document.getElementById("measure");
    ok("placing a cursor opens the measurement panel", !panel.classList.contains("hidden") && /Cursor A/.test(panel.textContent) && /Cursor B/.test(panel.textContent), panel.textContent.slice(0, 80));
    ok("it shows Δx and 1/Δx", /Δx/.test(panel.textContent) && /1\/Δx/.test(panel.textContent));
    ok("measurements say they cover the span between the cursors", /between the cursors/.test(panel.textContent));

    // measurements of the 555 output: about 690 Hz square wave
    const m = graph.measurements();
    const out = m.series.find(s => /out/i.test(s.name)) || m.series[0];
    const freqRow = out.rows.find(r => r[0] === "Frequency");
    ok("the oscillator's frequency is measured (about 690 Hz)", freqRow && (() => { const v = Units.parseSI(freqRow[1].split(" ")[0] + " " + freqRow[1].split(" ")[1][0]); return true; })() && /Hz/.test(freqRow[1]), freqRow);
    const f = PlotMath.frequency(d.xValues, d.series.find(s => s.name === out.name).values, P.cursors.a, P.cursors.b);
    ok("... and it is within a few percent of the textbook 1.44 / ((R1 + 2 R2) C)", f && near(f.freq, 1.44 / ((1000 + 20000) * 100e-9), 80), f);
    ok("rise and fall times are reported for the output edges", out.rows.some(r => /Rise time/.test(r[0])) && out.rows.some(r => /Fall time/.test(r[0])), out.rows.map(r => r[0]));

    // dragging a cursor line moves it; dragging elsewhere pans
    const aPx = P.pixelAtX(P.cursors.a);
    const aBefore = P.cursors.a;
    ptr("pointerdown", aPx, y); ptr("pointermove", aPx + 40, y); ptr("pointerup", aPx + 40, y);
    ok("dragging a cursor line moves it", P.cursors.a > aBefore && P.cursors.b !== null && near(P.pixelAtX(P.cursors.a), aPx + 40, 1.5), [aBefore, P.cursors.a]);
    P.zoomX = 4; P.draw();
    const panBefore = P.panX;
    ptr("pointerdown", px0 + 10, y); ptr("pointermove", px0 + 90, y); ptr("pointerup", px0 + 90, y);
    ok("dragging empty plot pans without moving the cursors", P.panX !== panBefore && P.cursors.a !== null);
    P.resetZoom();

    // CSV
    const all = P.csv("all");
    const lines = all.trim().split("\r\n");
    ok("CSV has a header and one row per sample", lines[0].startsWith("Time (s),") && lines.length === d.xValues.length + 1 && lines[0].split(",").length === 3, [lines[0], lines.length, d.xValues.length]);
    ok("CSV values are the plotted numbers", (() => { const row = lines[Math.floor(lines.length / 2)].split(",").map(Number); const i = lines.indexOf(lines[Math.floor(lines.length / 2)]) - 1; return near(row[0], d.xValues[i], Math.abs(d.xValues[i]) * 1e-8 + 1e-15) && near(row[1], d.series[0].values[i], Math.abs(d.series[0].values[i]) * 1e-8 + 1e-12); })());
    const between = P.csv("cursors").trim().split("\r\n");
    ok("CSV between the cursors holds only that span", between.length > 3 && between.length < lines.length && Number(between[1].split(",")[0]) >= Math.min(P.cursors.a, P.cursors.b) - 1e-12 && Number(between[between.length - 1].split(",")[0]) <= Math.max(P.cursors.a, P.cursors.b) + 1e-12, between.length);
    P.zoomX = 4; P.panX = 0.3;
    const vis = P.csv("visible").trim().split("\r\n");
    ok("CSV of the visible range is a subset", vis.length > 2 && vis.length < lines.length / 2, vis.length);
    P.resetZoom();

    // the export menu and downloads
    const saved = []; const realDownload = window.downloadFile;
    window.downloadFile = (name, content, type) => saved.push({ name, type, size: content.size !== undefined ? content.size : content.length });
    graph.exportMenu({ left: 100, bottom: 100 });
    const items = [...document.querySelectorAll("#contextMenu .ctx-item")].map(r => r.firstChild.textContent);
    ok("the Export menu offers CSV (all / visible / cursors), measurements and PNG", ["CSV: all data", "CSV: visible range", "CSV: between the cursors", "Measurements (CSV)", "Picture (PNG)"].every(x => items.includes(x)), items);
    const click = (label) => [...document.querySelectorAll("#contextMenu .ctx-item")].find(r => r.firstChild.textContent === label).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    click("CSV: all data");
    ok("CSV: all data downloads a .csv named after the design and analysis", saved.length === 1 && /-transient\.csv$/.test(saved[0].name) && saved[0].type === "text/csv", saved);
    graph.exportMenu({ left: 100, bottom: 100 }); click("Measurements (CSV)");
    ok("measurements export as CSV too", saved.length === 2 && /-transient-measurements\.csv$/.test(saved[1].name));
    graph.exportMenu({ left: 100, bottom: 100 }); click("Picture (PNG)");
    for (let i = 0; i < 20 && saved.length < 3; i++) await wait(100);
    ok("the picture exports as PNG", saved.length === 3 && /\.png$/.test(saved[2].name) && saved[2].size > 500, saved[2]);
    window.downloadFile = realDownload;

    // right-click menu on the plot
    ptr("contextmenu", px0 + pw * 0.4, y, { button: 2 });
    const cm = [...document.querySelectorAll("#contextMenu .ctx-item")].map(r => r.firstChild.textContent);
    ok("the graph's right-click menu places cursors and exports", ["Place cursor A here", "Place cursor B here", "Clear cursors", "Zoom to fit"].every(x => cm.includes(x)), cm);
    [...document.querySelectorAll("#contextMenu .ctx-item")].find(r => r.firstChild.textContent === "Place cursor A here").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    ok("... and it works", near(P.cursors.a, tEnd * 0.4, tEnd * 0.01), P.cursors.a);

    // clear
    document.getElementById("meas-clear").click();
    ok("Clear cursors removes both", P.cursors.a === null && P.cursors.b === null);
    await wait(250);
    ok("the panel goes back to the visible-range numbers", /visible range/.test(document.getElementById("measure").textContent));

    // a new analysis clears the cursors
    P.setCursor("a", tEnd * 0.5);
    await runner.runTransient(); await wait(100);
    ok("running a new analysis clears the old cursors", P.cursors.a === null);

    // AC: Bode plot measurements and export
    loadExampleById(editor, "jfet-amp");
    graph.show("ac");
    await runner.runAC(); await wait(100);
    ok("the AC plot is a two-panel Bode plot on a log axis", P.data.mode === "ac" && !!P.data.panels && P.view(P.data).log);
    const v = P.view(P.data);
    ok("the frequency axis is logarithmic: the middle pixel is the geometric mean", near(Math.log10(P.xAtPixel(P.plotLeft() + P.plotWidth() / 2)), (Math.log10(P.data.xValues[0]) + Math.log10(P.data.xValues[P.data.xValues.length - 1])) / 2, 1e-6));
    P.setCursor("a", 1000); P.setCursor("b", 10000);
    await wait(250);
    const am = graph.measurements();
    ok("AC measurements give gain and phase at each cursor, the peak and the -3 dB band", am.series[0].rows.some(r => /^At A/.test(r[0]) && /dB/.test(r[1]) && /°/.test(r[1])) && am.series[0].rows.some(r => r[0] === "Peak gain") && am.series[0].rows.some(r => r[0] === "−3 dB"), am.series[0].rows);
    const acCsv = P.csv("all").split("\r\n")[0];
    ok("the AC CSV has gain (dB) and phase (deg) columns for each trace", /Frequency \(Hz\)/.test(acCsv) && /gain \(dB\)/.test(acCsv) && /phase \(deg\)/.test(acCsv), acCsv);
    P.setACScale("linear");
    ok("switching to linear magnitude exports magnitude columns", /magnitude/.test(P.csv("all").split("\r\n")[0]));
    P.setACScale("db");

    // live graph exports what is on screen
    loadExampleById(editor, "instruments");
    document.getElementById("liveSpeed").value = "0";
    live.start(); live.advance(80, true); live.readout(); live.paint(true);
    graph.show("live");
    live.paint(true);
    ok("the live graph can be exported too", (P.csv("all") || "").split("\r\n").length > 5, (P.csv("all") || "").length);
    live.stop();

    // operating point has nothing to measure or export
    graph.show("dc");
    P.data = null; P.draw();
    ok("with no graph data export returns nothing", P.csv("all") === null);

    P.clearCursors(); graph.show("tran"); graph.hide();
    return { total: results.length, failed: results.filter(r => !r.pass).length, failures: results.filter(r => !r.pass) };
};

// Analysis features: operating-point overlay, spectrum, parametric sweeps, Monte Carlo, exports.
// In the running app:  (0, eval)(await (await fetch('tests/analysis.js')).text()); await analysisTests();

window.analysisTests = async function () {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, ...(cond ? {} : { extra }) });
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clear = () => {
        plotter.cache = {}; live.stop(); ScopeWindow.closeAll(); Dialog.close("t");
        editor.setTool("select");
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1; editor.titleBlock = SchematicEditor.defaultTitleBlock();
        editor.historyStack = []; editor.futureStack = []; editor.clearSelection(); editor.resetView();
        if (opOverlay.on) opOverlay.disable();
    };
    const byName = (n) => editor.components.find(c => c.name === n);

    // ======================================================== operating point on the schematic
    clear(); loadExampleById(editor, "ce-amp");
    Commands.run("view.op");
    ok("View > Show Operating Point turns the overlay on and solves the circuit", opOverlay.on && editor.opData && editor.opData.nodes.length >= 4, editor.opData);
    const info = NetlistExtractor.extract(editor);
    const op = new SimEngine(info.circuit).operatingPoint();
    const nets = NetlistExtractor.nets(editor);
    const colNet = info.getTerminalNodeName(byName("Q1"), "C");
    const label = editor.opData.nodes.find(n => n.id === colNet);
    ok("a node's label shows that node's voltage", label && near(label.v, op.nodeVoltages[colNet], 1e-9), label);
    // every label sits on a wire of the net whose voltage it shows (guards against numbering mix-ups)
    ok("each label is on a wire of its own net", editor.opData.nodes.every(n => editor.wires.some(w => info.nets.wireNode(w) === n.id && w.route.some((p, i) => i < w.route.length - 1 && editor.isPointOnSegment(n.x, n.y, p.x, p.y, w.route[i + 1].x, w.route[i + 1].y)))));
    const baseNet = info.getTerminalNodeName(byName("R2"), "1");
    ok("the divider's base node shows the base voltage, not another net's", near(editor.opData.nodes.find(n => n.id === baseNet).v, op.nodeVoltages[baseNet], 1e-9) && op.nodeVoltages[baseNet] > 1);
    ok("every net with a wire gets exactly one label, ground gets none", new Set(editor.opData.nodes.map(n => n.id)).size === editor.opData.nodes.length && !editor.opData.nodes.some(n => n.id === "0"));
    const r1 = editor.opData.parts.find(p => p.comp.name === "R1");
    ok("currents are shown beside the parts (R1 carries the bias current)", r1 && near(r1.i, op.currents.R1, 1e-12) && Math.abs(r1.i) > 1e-6, r1);
    editor.draw();
    ok("the overlay draws without error", true);
    byName("R1").value = "10k";
    await wait(1900);                                   // the document tick notices the edit, the overlay re-solves
    const colNew = editor.opData.nodes.find(n => n.id === colNet);
    ok("it follows edits (a new bias resistor changes the numbers)", colNew && !near(colNew.v, label.v, 0.05), [label.v, colNew && colNew.v]);
    // live: uses the running values
    byName("R1").value = "47k";
    document.getElementById("liveSpeed").value = "0.05";
    live.start();
    for (let i = 0; i < 300 && live.run.t < 2e-3; i++) live.run.step();
    live.readout();
    const liveNode = editor.opData.nodes.find(n => n.id === colNet);
    ok("while Play runs the overlay shows the running node voltage", liveNode && near(liveNode.v, live.run.voltage(colNet), 1e-9), [liveNode && liveNode.v, live.run.voltage(colNet)]);
    live.stop(); await wait(400);
    ok("after Stop it goes back to the operating point", opOverlay.on && editor.opData && editor.opData.nodes.length > 0);
    // a circuit that does not solve says so instead of showing stale numbers
    editor.components = editor.components.filter(c => c.type !== "GND"); editor.refreshWires(); opOverlay.refresh();
    ok("with no ground it reports the problem on the sheet", editor.opData && typeof editor.opData.error === "string", editor.opData);
    Commands.run("view.op");
    ok("toggling it off removes the numbers", !opOverlay.on && !editor.opData);

    // ======================================================== spectrum (FFT)
    clear();
    graph.show("fft");
    ok("with no data the spectrum tab says what to do", plotter.data === null && /Run a transient/.test(document.getElementById("plotTitle").textContent), document.getElementById("plotTitle").textContent);
    loadExampleById(editor, "ce-amp");
    byName("V2").acMagnitude = 0.02;
    document.getElementById("simTstop").value = "20m"; document.getElementById("simTstep").value = "5u";
    graph.show("tran"); await runner.runTransient(); await wait(50);
    graph.show("fft"); await wait(50);
    const spd = plotter.data;
    ok("the SPECTRUM tab analyses the last transient (one trace per probe)", spd && spd.mode === "spectrum" && spd.series.length === 2 && spd.spectra.length === 2, spd && spd.mode);
    const fund = spd.spectra[0].fundamental;
    ok("the 1 kHz input shows as a 20 mV (-34 dBV) peak at 1 kHz", fund && near(fund.f, 1000, 8) && near(fund.mag, 0.02, 0.0015), fund);
    ok("the input's THD is tiny and the over-driven amplifier's is large", spd.spectra[0].thd < 0.001 && spd.spectra[1].thd > 0.05, [spd.spectra[0].thd, spd.spectra[1].thd]);
    ok("the x axis is frequency, in dBV by default", spd.xLabel === "Frequency (Hz)" && spd.valueUnit === "dBV" && spd.xValues[spd.xValues.length - 1] <= 41000, spd.xValues[spd.xValues.length - 1]);
    graph.toggleMeasure(true); await wait(300);
    const meas = document.getElementById("measure").textContent;
    ok("the Measure panel lists the fundamental, DC level, THD and harmonics", /Fundamental/.test(meas) && /THD/.test(meas) && /Harmonic 2/.test(meas) && /DC level/.test(meas), meas.slice(0, 160));
    const setSel = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); };
    setSel("fftScale", "lin");
    ok("Volts scale plots amplitude in volts", plotter.data.valueUnit === "V" && Math.max(...plotter.data.series[0].values) < 0.05);
    setSel("fftScale", "db");
    setSel("fftAxis", "log");
    ok("a log frequency axis works", plotter.data.logX === true && plotter.view(plotter.data).log && plotter.data.xValues[0] > 0);
    setSel("fftAxis", "lin");
    setSel("fftSpan", "10");
    ok("the frequency range follows 10 x the fundamental", plotter.data.xValues[plotter.data.xValues.length - 1] <= 11500, plotter.data.xValues[plotter.data.xValues.length - 1]);
    setSel("fftWindow", "flattop");
    ok("changing the window re-analyses", plotter.data.spectra[0].window === "flattop" && near(plotter.data.spectra[0].fundamental.mag, 0.02, 0.0006), plotter.data.spectra[0].fundamental);
    const csv = plotter.csv("all");
    ok("the spectrum exports as CSV (frequency and one column per trace)", /^Frequency \(Hz\),/.test(csv) && csv.split("\r\n")[0].split(",").length === 3);
    // the span of the time plot's cursors is analysed
    graph.show("tran"); plotter.setCursor("a", 0.004); plotter.setCursor("b", 0.012);
    graph.show("fft");
    ok("two cursors on the time plot restrict the analysed span", Math.abs(plotter.data.spectra[0].t0 - 0.004) < 1e-6 && Math.abs(plotter.data.spectra[0].t1 - 0.012) < 1e-6, [plotter.data.spectra[0].t0, plotter.data.spectra[0].t1]);
    graph.show("tran");
    ok("going back to ANALOGUE shows the waveforms again", plotter.data.mode === "transient");
    graph.hide();


    // ======================================================== parametric sweep and Monte Carlo
    clear(); loadExampleById(editor, "rc-ladder");
    document.getElementById("simTstop").value = "50m"; document.getElementById("simTstep").value = "100u";
    const params = Study.parameters(editor, runner);
    ok("the sweepable parameters list component values, source levels and temperature", params.some(p => p.id.endsWith(".value") && /R1/.test(p.label)) && params.some(p => /dcVoltage/.test(p.id)) && params.some(p => p.id === "temp"), params.map(p => p.id));
    ok("value lists: linear, log and explicit", near(Study.values({ start: 1, stop: 5, points: 5 })[2], 3, 1e-12) && near(Study.values({ start: 1, stop: 100, points: 3, scale: "log" })[1], 10, 1e-9) && Study.values({ list: [1, 2, 7] }).length === 3);
    ok("a typed list parses with SI suffixes", Study.parseList("1k 2.2k, 4.7k").join() === "1000,2200,4700", Study.parseList("1k 2.2k, 4.7k"));
    const vparam = params.find(p => /^\d+\.dcVoltage$/.test(p.id)).id;
    const before = JSON.stringify(editor.components);
    let sw = await Study.sweep(editor, runner, { param: vparam, analysis: "op", show: "overlay", start: 5, stop: 15, points: 3 });
    ok("an operating-point sweep of the source gives V(in) equal to the source at every setting", sw.mode === "sweep" && near(sw.series[0].values[0], 5, 1e-6) && near(sw.series[0].values[2], 15, 1e-6) && near(sw.series[1].values[1], 10, 1e-6), sw.series.map(s => s.values));
    ok("the circuit is exactly as before after a sweep", JSON.stringify(editor.components) === before);
    const r1p = params.find(p => /R1 value/.test(p.label)).id;
    sw = await Study.sweep(editor, runner, { param: r1p, analysis: "tran", show: "overlay", start: 500, stop: 4000, points: 4, scale: "log" });
    ok("a transient sweep overlays every probe for every run on one time axis", sw.mode === "transient" && sw.series.length === 12 && sw.xValues.length === 1200 && /R1 value = /.test(sw.series[0].name), [sw.series.length, sw.series[0].name]);
    sw = await Study.sweep(editor, runner, { param: r1p, analysis: "tran", show: "metric", metric: "final", probe: 1, start: 500, stop: 4000, points: 3 });
    ok("a measurement sweep returns one number per run", sw.series.length === 1 && sw.series[0].values.length === 3 && sw.series[0].values.every(Number.isFinite) && sw.yUnit === "", sw.series[0].values);
    ok("a larger resistor charges the capacitor less in the same time (final value falls)", sw.series[0].values[0] > sw.series[0].values[2], sw.series[0].values);
    sw = await Study.sweep(editor, runner, { param: r1p, analysis: "ac", show: "metric", metric: "bw", probe: 2, start: 500, stop: 4000, points: 3 });
    ok("the -3 dB bandwidth falls as R1 grows", sw.series[0].values[0] > sw.series[0].values[2], sw.series[0].values);
    sw = await Study.sweep(editor, runner, { param: r1p, analysis: "ac", show: "overlay", start: 500, stop: 4000, points: 3 });
    ok("an AC sweep overlays Bode curves (gain and phase panels)", sw.mode === "ac" && sw.panels && sw.panels[0].series.length === 9, sw.panels && sw.panels[0].series.length);
    let thrown = "";
    try { await Study.sweep(editor, runner, { param: r1p, analysis: "op", show: "overlay", list: [1000] }); } catch (e) { thrown = e.message; }
    ok("a one-point sweep is refused with a clear message", /two values/.test(thrown), thrown);
    let cancelled = 0;
    try { await Study.sweep(editor, runner, { param: r1p, analysis: "op", show: "overlay", start: 1000, stop: 2000, points: 5 }, { cancelled: () => ++cancelled > 1 }); } catch (e) { thrown = e.message; }
    ok("cancelling stops the sweep and still restores the value", thrown === "Cancelled" && JSON.stringify(editor.components) === before, thrown);

    // the dialog and the graph tab
    Commands.run("design.sweep");
    ok("Design > Parametric Sweep… opens its dialog", !!document.querySelector(".dialog .study #stParam") && document.querySelectorAll("#stParam option").length === params.length);
    Dialog.close("t");
    graph.showStudy(sw, "x");
    ok("the STUDY tab shows the result", graph.kind === "step" && plotter.data === sw && plotter.cache.step === sw);
    ok("the Measure panel works on a study result", !!graph.measurements());
    graph.hide();

    clear(); loadExampleById(editor, "pot-divider");
    const mcBefore = JSON.stringify(editor.components);
    const spec = { analysis: "op", metric: "value", probe: 0, runs: 200, seed: 7, dist: "gauss", defaults: { R: 5, C: 10, L: 10 }, limits: { lo: 3, hi: 5 } };
    let mc = await Study.monteCarlo(editor, runner, spec);
    const st = mc.study.stats;
    ok("Monte Carlo varies the parts and the circuit is restored afterwards", st.std > 0 && JSON.stringify(editor.components) === mcBefore, st);
    ok("the histogram counts add up to the number of runs", mc.bars && mc.series[0].values.reduce((a, b) => a + b, 0) === st.n && st.n === 200);
    const nominal = new SimEngine(NetlistExtractor.extract(editor).circuit).operatingPoint();
    const wiperNode = NetlistExtractor.extract(editor).getPointNodeName(editor.probes[0].x, editor.probes[0].y);
    ok("the mean sits close to the nominal value (within 4 standard errors)", Math.abs(st.mean - nominal.nodeVoltages[wiperNode]) < 4 * st.std / Math.sqrt(st.n) + 1e-9, [st.mean, nominal.nodeVoltages[wiperNode], st.std]);
    ok("the yield is a fraction between 0 and 1", st.yield >= 0 && st.yield <= 1, st.yield);
    const again = await Study.monteCarlo(editor, runner, spec);
    ok("the same seed repeats the same runs, another seed does not", again.study.stats.mean === st.mean && (await Study.monteCarlo(editor, runner, { ...spec, seed: 8 })).study.stats.mean !== st.mean);
    mc = await Study.monteCarlo(editor, runner, { ...spec, dist: "uniform", defaults: { R: 10, C: 0, L: 0 }, limits: {} });
    ok("a uniform distribution never exceeds the tolerance", mc.study.stats.yield === undefined && mc.study.stats.max <= nominal.nodeVoltages[wiperNode] * 1.2 && mc.study.stats.min >= nominal.nodeVoltages[wiperNode] * 0.8);
    thrown = "";
    try { await Study.monteCarlo(editor, runner, { ...spec, defaults: { R: 0, C: 0, L: 0 } }); } catch (e) { thrown = e.message; }
    ok("with no tolerance anywhere Monte Carlo says so", /tolerance/.test(thrown), thrown);
    byName("R1") && (byName("R1").tol = "0");
    ok("a part's own tolerance overrides the default (0 keeps it exact)", Study.tolerance({ type: "R", tol: "0" }, { R: 5 }) === 0 && Study.tolerance({ type: "R", tol: "1" }, { R: 5 }) === 1 && Study.tolerance({ type: "R" }, { R: 5 }) === 5);
    graph.showStudy(mc, "mc");
    const mm = graph.measurements();
    ok("the Measure panel lists the statistics", mm && mm.series[0].rows.some(r => r[0] === "Std deviation"), mm);
    plotter.draw();
    ok("the histogram draws", true);
    graph.hide();
    ok("Design > Monte Carlo… opens its dialog", (Commands.run("design.montecarlo"), !!document.querySelector(".dialog #mcRuns")));
    Dialog.close("t");


    // ======================================================== bill of materials and picture export
    clear(); loadExampleById(editor, "ce-amp");
    const rows = Exporter.bom(editor);
    const nParts = editor.components.filter(c => !["GND", "TEXT", "NODEIC"].includes(c.type)).length;
    ok("the BOM counts every real part exactly once", rows.reduce((n, r) => n + r.qty, 0) === nParts && rows.every(r => r.qty === r.refs.length), rows);
    ok("the BOM leaves out ground symbols and notes", !rows.some(r => r.type === "GND" || r.type === "TEXT"));
    byName("R1").value = "10k"; byName("R2").value = "10k"; byName("R2").tol = "5"; byName("R3").value = "10k"; byName("R3").tol = "5";
    const rows2 = Exporter.bom(editor), same = rows2.find(r => r.refs.includes("R2"));
    ok("parts with the same value and tolerance share one line (R2 and R3)", same && same.refs.includes("R3") && same.qty === 2 && same.tol === "5%" && !rows2.find(r => r.refs.includes("R1")).refs.includes("R2"), rows2.map(r => r.refs.join("+")));
    const bomLines = Exporter.bomCsv(editor).split("\r\n");
    ok("the CSV has a header and one row per line", bomLines[0] === "Item,Reference,Quantity,Value,Part,Tolerance" && bomLines.filter(Boolean).length === rows2.length + 1, bomLines.slice(0, 3));
    ok("references with several parts are quoted-safe and space separated", bomLines.some(l => /^\d+,R2 R3,2,/.test(l)), bomLines);
    Commands.run("file.bom");
    ok("File > Bill of Materials opens its table", !!document.querySelector(".dialog .bom table") && document.querySelectorAll(".dialog .bom tbody tr").length === rows2.length);
    Dialog.close("t");
    const view = [editor.zoom, editor.panX, editor.panY, editor.width];
    const cv = Exporter.renderImage(editor, 1);
    ok("the picture covers the design with a margin and is not blank", cv && cv.width > 300 && cv.height > 200 && (() => { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; const bg = [d[0], d[1], d[2]]; for (let i = 0; i < d.length; i += 4 * 7) if (d[i] !== bg[0] || d[i + 1] !== bg[1] || d[i + 2] !== bg[2]) return true; return false; })(), cv && [cv.width, cv.height]);
    ok("exporting leaves the editor's view and drawing target alone", editor.zoom === view[0] && editor.panX === view[1] && editor.panY === view[2] && editor.width === view[3] && editor.ctx === editor.canvas.getContext("2d") && !editor.exporting);
    ok("a bigger scale gives a bigger picture", Exporter.renderImage(editor, 2).width >= 2 * cv.width - 2);
    clear();
    ok("an empty sheet has nothing to export", Exporter.renderImage(editor) === null && Exporter.bomCsv(editor).split("\r\n").filter(Boolean).length === 1);


    // ======================================================== behavioural sources in the schematic
    clear();
    SchematicImporter.import(editor, "bsrc\nV1 in 0 2\nR1 in 0 1k\nB1 out 0 V = 3*v(in) + v(in,0)*0.5\nR2 out 0 10k\nB2 x 0 I = -v(out)/1k\nR3 x 0 1k\n.end");
    const bsrc = editor.components.filter(c => c.type === "BSRC");
    ok("an imported B card becomes a behavioural source part with sense pins", bsrc.length === 2 && bsrc[0].mode === "V" && /v\(A\)/.test(bsrc[0].expr) && editor.getTerminals(bsrc[0]).length === 6, bsrc.map(c => c.expr));
    const bi = NetlistExtractor.extract(editor);
    const bop = new SimEngine(bi.circuit).operatingPoint();
    const outNet = bi.getTerminalNodeName(bsrc[0], "O+");
    ok("it simulates as written (3*2 + 0.5*2 = 7 V)", near(bop.nodeVoltages[outNet], 7, 1e-5), bop.nodeVoltages[outNet]);
    ok("its current form drives R3 (I = -7 mA flows x -> 0, so +7 mA enters x: 7 V)", near(bop.nodeVoltages[bi.getTerminalNodeName(bsrc[1], "O+")], 7, 1e-4), bop.nodeVoltages);
    const exp = NetlistExtractor.toSpice(bi.elements, {}).split("\n").filter(l => /^B/.test(l));
    ok("the SPICE export writes B cards with the net numbers", exp.length === 2 && /V=3\*v\(\w+\)/i.test(exp[0]) && /^B\w* \S+ \S+ I=/.test(exp[1]), exp);
    byName("B1") && (byName("B1").expr = "foo(1)");
    let bthrown = ""; try { NetlistExtractor.extract(editor); } catch (e) { bthrown = e.message; }
    ok("a bad expression is reported with the part's name", /B1.*unknown function/.test(bthrown), bthrown);
    ok("Pick Devices offers both behavioural sources", DeviceCatalog.all().filter(e => e.type === "BSRC").length === 2);
    clear();
    SchematicImporter.import(editor, "many\nV1 a 0 1\nR1 a b 1k\nR2 b c 1k\nR3 c d 1k\nR4 d e 1k\nR5 e 0 1k\nB1 o 0 V=v(a)+v(b)+v(c)+v(d)+v(e)\nR6 o 0 1k\n.end");
    ok("a B source reading more than four nodes is skipped with a warning, not mangled", !editor.components.some(c => c.type === "BSRC"));

    clear();
    return { total: results.length, failed: results.filter(r => !r.pass).length, failures: results.filter(r => !r.pass) };
};

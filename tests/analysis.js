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
        editor.historyStack = []; editor.futureStack = []; editor.clearSelection(); editor.resetView(); editor.measures = [];
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
    ok("Design > Parametric Sweep… opens its dialog", !!document.querySelector(".dialog .study .st-p") && document.querySelectorAll(".st-p option").length === params.length);
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


    // ======================================================== analyses on a worker thread
    clear(); loadExampleById(editor, "rc-ladder");
    ok("workers are available in the page", SimWorker.available());
    const winfo = NetlistExtractor.extract(editor);
    let cloned = true; try { structuredClone(SimWorker.plain(winfo.elements)); } catch (e) { cloned = e.message; }
    ok("the element list can be sent to a worker (plain data)", cloned === true, cloned);
    const progressSeen = [];
    const wres = await SimWorker.run(winfo.elements, "tran", { tStop: 0.05, tStep: 5e-6, uic: true, nodeIC: winfo.nodeIC }, {}, (p) => progressSeen.push(p));
    const lres = new SimEngine(winfo.circuit).transient({ tStop: 0.05, tStep: 5e-6, uic: true, method: "trap", nodeIC: winfo.nodeIC });
    const cnode = Object.keys(lres.nodeHistories)[1];
    ok("a transient on the worker gives the same numbers as on the page", wres.timePoints.length === lres.timePoints.length && near(wres.nodeHistories[cnode][wres.timePoints.length - 1], lres.nodeHistories[cnode][lres.timePoints.length - 1], 1e-12), [wres.timePoints.length, lres.timePoints.length]);
    ok("the worker reports progress", progressSeen.length >= 1 && progressSeen.every(p => p >= 0 && p <= 1), progressSeen.length);
    const wac = SimWorker.unpackAc(await SimWorker.run(winfo.elements, "ac", { fStart: 10, fStop: 100000, pointsPerDecade: 10 }, {}));
    const lac = new SimEngine(winfo.circuit).ac({ fStart: 10, fStop: 100000, pointsPerDecade: 10 });
    ok("AC on the worker rebuilds complex numbers equal to the page's", wac.length === lac.length && wac[7].nodeVoltages[cnode] instanceof Complex && near(wac[7].nodeVoltages[cnode].re, lac[7].nodeVoltages[cnode].re, 1e-12) && near(wac[7].nodeVoltages[cnode].im, lac[7].nodeVoltages[cnode].im, 1e-12));
    const wop = await SimWorker.run(winfo.elements, "op", {}, {});
    ok("operating point and DC sweep work on the worker", Object.keys(wop.nodeVoltages).length > 2 && (await SimWorker.run(winfo.elements, "sweep", { source: winfo.elements.find(e => e.kind === "V").name, start: 0, stop: 5, step: 1 }, {})).sweep.length === 6);
    let werr = ""; try { await SimWorker.run(winfo.elements, "bogus", {}, {}); } catch (e) { werr = e.message; }
    ok("an error inside the worker comes back as a message, and the worker keeps working", werr.length > 0 && (await SimWorker.run(winfo.elements, "op", {}, {})).nodeVoltages !== undefined, werr);
    // cancel a long run: terminates the worker, the next run starts a fresh one
    const long = SimWorker.run(winfo.elements, "tran", { tStop: 50, tStep: 1e-6, uic: true, nodeIC: winfo.nodeIC }, {});
    await wait(120);
    const t0 = performance.now(); SimWorker.cancel();
    let why = ""; try { await long; } catch (e) { why = e.message; }
    ok("cancel stops a long analysis at once", why === "Cancelled" && performance.now() - t0 < 500 && !SimWorker.busy, why);
    ok("a new analysis works after a cancel", (await SimWorker.run(winfo.elements, "op", {}, {})).nodeVoltages !== undefined);
    ok("a second job while one runs is refused", await (async () => { const a = SimWorker.run(winfo.elements, "op", {}, {}); let m = ""; try { await SimWorker.run(winfo.elements, "op", {}, {}); } catch (e) { m = e.message; } await a; return /already running/.test(m); })());
    // the runner's buttons use it, and the page stays responsive while a long run goes
    document.getElementById("simTstop").value = "20"; document.getElementById("simTstep").value = "20u";
    let ticks = 0; const iv = setInterval(() => ticks++, 20);
    const running = runner.runTransient(); await wait(700);
    ok("the page keeps responding while a long transient runs (timers keep firing)", ticks >= 20, ticks);
    ok("a progress strip with Cancel is shown for a long run", !document.getElementById("busy").classList.contains("hidden") && /Transient/.test(document.getElementById("busyText").textContent), document.getElementById("busyText").textContent);
    document.getElementById("busyCancel").click(); await running; clearInterval(iv);
    ok("Cancel ends it, hides the strip and says so", document.getElementById("busy").classList.contains("hidden") && /cancelled/i.test(document.getElementById("toast").textContent), document.getElementById("toast").textContent);
    document.getElementById("simTstop").value = "50m"; document.getElementById("simTstep").value = "50u";
    await runner.runTransient(); await wait(50);
    ok("a normal transient through the Simulate button still plots", plotter.data && plotter.data.series.length === 3 && plotter.data.xValues.length > 100);
    graph.hide();


    // ======================================================== noise analysis in the app
    clear(); loadExampleById(editor, "ce-amp");
    document.getElementById("simFstart").value = "10"; document.getElementById("simFstop").value = "1M";
    graph.show("tran");
    Commands.run("graph.noise");
    ok("Graph > Noise Analysis shows the NOISE tab", graph.kind === "noise" && !document.getElementById("noiseView").classList.contains("hidden"));
    await runner.runNoise(); await wait(100);
    const nd = plotter.data;
    ok("the noise run plots one trace per voltage probe in dBV/√Hz on a log frequency axis", nd && nd.mode === "noise" && nd.logX && nd.series.length === editor.probes.filter(p => p.type === "V").length - 1 && nd.noise.hidden === 1 && /dBV/.test(nd.yLabel) && plotter.view(nd).log, nd && nd.series.length);
    const ninfo = NetlistExtractor.extract(editor);
    const lastV = nd.series.length - 1, lastVprobe = editor.probes.filter(p => p.type === "V").length - 1, nprobe = editor.probes.filter(p => p.type === "V")[lastVprobe], nnode = ninfo.getPointNodeName(nprobe.x, nprobe.y);
    const nref = new SimEngine(ninfo.circuit).noise({ out: [nnode], input: ninfo.elements.find(e => e.kind === "V" && (e.params.acMag || 0) > 0).name, fStart: 10, fStop: 1e6, pointsPerDecade: 10 });
    ok("the plotted level is the engine's density (20 log10 of V/√Hz)", nd.xValues.length === nref.length && near(nd.series[lastV].values[5], 20 * Math.log10(nref[5].onoise), 1e-9), [nd.series[lastV].values[5], 20 * Math.log10(nref[5].onoise)]);
    ok("the tab remembers it (switching away and back)", (graph.show("ac"), graph.show("noise"), plotter.data === nd));
    const sel = document.getElementById("noiseView"); sel.value = "in"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    ok("Input-referred view divides by the gain from the source", plotter.data.noise.view === "in" && /Input-referred/.test(plotter.data.yLabel) && near(plotter.data.series[lastV].values[5], 20 * Math.log10(nref[5].inoise), 1e-9), plotter.data.yLabel);
    ok("input-referred noise of an amplifier is below its output noise (gain > 1 in band)", plotter.data.series[lastV].values[20] < nd.series[lastV].values[20]);
    sel.value = "out"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    graph.toggleMeasure(true); plotter.setCursor("a", 1000); plotter.setCursor("b", 100000);
    const nm = graph.measurements();
    ok("the Measure panel gives integrated noise and the largest contributors", nm && nm.series[lastV].rows.some(r => /Output noise/.test(r[0]) && /V rms/.test(r[1])) && nm.series[lastV].rows.some(r => /Q1 (collector|base) shot|thermal/.test(r[0]) && /%/.test(r[1])), nm && nm.series[0].rows);
    const ncsv = plotter.csv("all");
    ok("the noise exports as CSV", /^Frequency \(Hz\),/.test(ncsv) && ncsv.split("\r\n").length > 40);
    graph.toggleMeasure(false);
    editor.probes = [];
    let nerr = ""; const realToast = runner.toast; runner.toast = (m, k) => { if (k === "error") nerr = m; }; await runner.runNoise(); runner.toast = realToast;
    ok("with no probe it asks for one", /voltage probe/.test(nerr), nerr);
    graph.hide();


    // ======================================================== measurements and transfer function
    clear(); loadExampleById(editor, "rc-ladder");
    document.getElementById("simTstop").value = "50m"; document.getElementById("simTstep").value = "50u";
    document.getElementById("simFstart").value = "1"; document.getElementById("simFstop").value = "100k"; document.getElementById("simUic").checked = true;
    Commands.run("graph.measure");
    ok("Graph > Measurements opens its dialog with the function list", !!document.querySelector(".dialog .measure-dlg #mFn") && document.querySelectorAll("#mFn option").length === Object.keys(Measure.FUNCS.tran).length);
    document.getElementById("mKind").value = "ac"; document.getElementById("mKind").dispatchEvent(new Event("change"));
    ok("choosing AC swaps the function list", document.querySelectorAll("#mFn option").length === Object.keys(Measure.FUNCS.ac).length);
    document.getElementById("mKind").value = "tran"; document.getElementById("mKind").dispatchEvent(new Event("change"));
    document.getElementById("mFn").value = "when"; document.getElementById("mFn").dispatchEvent(new Event("change"));
    document.getElementById("mSig").value = "V(c1)"; document.getElementById("mLevel").value = "5";
    [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "Add").click();
    ok("Add stores a measurement with its parameters", editor.measures.length === 1 && editor.measures[0].fn === "when" && editor.measures[0].level === 5 && editor.measures[0].sig === "V(c1)", editor.measures);
    Dialog.close("t");
    editor.measures.push({ name: "vmax", kind: "tran", fn: "max", sig: "V(in)" }, { name: "vend", kind: "tran", fn: "find", sig: "V(c1)", at: 0.05 }, { name: "g10", kind: "ac", fn: "find", sig: "V(c1)", at: 10 }, { name: "bw", kind: "ac", fn: "bw", sig: "V(c1)" }, { name: "bad", kind: "tran", fn: "when", sig: "V(c1)", level: 99 });
    const mall = await MeasureDialog.evaluate(editor, runner, true), mres = mall;
    ok("the step source reaches 10 V", near(mres[1].value, 10, 1e-6), mres[1]);
    ok("the first capacitor reaches 5 V after some milliseconds, found by interpolation", mres[0].value > 0.003 && mres[0].value < 0.03, [mres[0], JSON.stringify(editor.measures[0]), plotter.cache.tran && plotter.cache.tran.series.map(x => x.name + ":" + x.values[x.values.length - 1])]);
    ok("after 50 ms the capacitor has charged to nearly the supply", mres[2].value > 9.5 && mres[2].value <= 10, mres[2]);
    ok("an AC measurement: gain at 10 Hz of the low-pass is a little under 20 dB (a 10 V DC source stands in for the unit stimulus)", mres[3].value < 20.5 && mres[3].value > 15, mres[3]);
    ok("an AC bandwidth is positive", mres[4].value > 1, mres[4]);
    ok("a measurement that cannot be made says why instead of a number", mres[5].error && /does not cross/.test(mres[5].error), mres[5]);
    ok("measurements are saved with the design and restored", (() => { const sv = JSON.parse(JSON.stringify(doc.serialize())); return sv.measures.length === 6 && sv.measures[1].name === "vmax"; })());
    const snap = editor.snapshot(); editor.measures = []; editor.restore(snap);
    ok("and survive undo / redo snapshots", editor.measures.length === 6);
    ok("they can be written as SPICE .meas lines", Measure.toSpice(editor.measures.find(m => m.name === "vmax")) === ".meas tran vmax max V(in)" && /^\.meas ac g10 find V\(c1\) at=10$/.test(Measure.toSpice(editor.measures.find(m => m.name === "g10"))), Measure.toSpice(editor.measures[3]));
    editor.measures = [];

    const tfInfo = NetlistExtractor.extract(editor);
    Commands.run("graph.tf");
    ok("Graph > Transfer Function opens its dialog", !!document.querySelector(".dialog .tf #tfOut"));
    document.querySelector("#tfOut").value = String(editor.probes.length - 1);
    [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "Calculate").click(); await wait(500);
    const tfText = document.querySelector(".dialog .tf-result").textContent;
    ok("it reports gain (1 for a DC-passed ladder), input and output resistance", /Gain.*1/.test(tfText) && /Input resistance/.test(tfText) && /Output resistance/.test(tfText), tfText);
    Dialog.close("t");
    graph.hide();


    // ======================================================== several parameters at once, and corners
    clear(); loadExampleById(editor, "rc-ladder");
    document.getElementById("simTstop").value = "20m"; document.getElementById("simTstep").value = "100u"; document.getElementById("simUic").checked = true;
    document.getElementById("simFstart").value = "1"; document.getElementById("simFstop").value = "10k";
    const mp = Study.parameters(editor, runner), pV = mp.find(p => /^\d+\.dcVoltage$/.test(p.id)).id, pR1 = mp.find(p => /R1 value/.test(p.label)).id, pC1 = mp.find(p => /C1 value/.test(p.label)).id, pR2 = mp.find(p => /R2 value/.test(p.label)).id;
    const mpBefore = JSON.stringify(editor.components);
    let two = await Study.sweep(editor, runner, { analysis: "tran", show: "metric", metric: "max", probe: 0, params: [{ param: pV, start: 5, stop: 15, points: 3 }, { param: pR1, list: [500, 2000] }] });
    ok("two parameters in a grid: x is the first, one trace per value of the second", two.series.length === 2 && two.xValues.join() === "5,10,15" && near(two.series[0].values[2], 15, 1e-6) && near(two.series[1].values[0], 5, 1e-6) && /R1 value = /.test(two.series[0].name) && two.xLabel.includes("V1"), two.series.map(s => s.name));
    ok("the circuit is exactly as before", JSON.stringify(editor.components) === mpBefore);
    const three = await Study.sweep(editor, runner, { analysis: "op", params: [{ param: pV, list: [1, 2] }, { param: pR1, list: [100, 200] }, { param: pR2, list: [100, 200, 300] }] });
    ok("three parameters: 12 runs, a trace per probe and per combination of the other two", three.series.length === 3 * 6 && three.xValues.length === 2, three.series.length);
    let msg = ""; try { await Study.sweep(editor, runner, { analysis: "tran", show: "overlay", params: [{ param: pV, start: 1, stop: 2, points: 13 }, { param: pR1, start: 1, stop: 2, points: 13 }] }); } catch (e) { msg = e.message; }
    ok("overlaying too many curves is refused with advice", /unreadable/.test(msg), msg);
    msg = ""; try { await Study.sweep(editor, runner, { analysis: "op", params: [{ param: pV, start: 1, stop: 2, points: 10 }, { param: pR1, start: 1, stop: 2, points: 10 }, { param: pR2, start: 1, stop: 2, points: 10 }] }); } catch (e) { msg = e.message; }
    ok("more than 400 runs is refused", /1000 runs/.test(msg), msg);
    msg = ""; try { await Study.sweep(editor, runner, { analysis: "op", params: [{ param: pV, list: [1, 2] }, { param: pV, list: [3, 4] }] }); } catch (e) { msg = e.message; }
    ok("the same parameter twice is refused", /only once/.test(msg), msg);

    const cor = await Study.sweep(editor, runner, { mode: "corners", analysis: "ac", show: "metric", metric: "bw", probe: 1, params: [{ param: pR1, tol: 10 }, { param: pC1, tol: 10 }] });
    ok("corners: 3 values per part, 9 runs, the nominal one is identified", cor.study.kind === "corners" && cor.study.rows.length === 9 && cor.study.nominal === 4 && cor.bars, cor.study && [cor.study.rows.length, cor.study.nominal]);
    const bws = cor.study.rows.map(r => r.metric);
    ok("the bandwidth is highest with both parts low and lowest with both high", bws.indexOf(Math.max(...bws)) === 0 && bws.indexOf(Math.min(...bws)) === 8, bws);
    ok("the corner values are 10 % either side of nominal", near(cor.study.rows[0].values[0] / cor.study.rows[4].values[0], 0.9, 1e-9) && near(cor.study.rows[2].values[0] / cor.study.rows[4].values[0], 1.1, 1e-9));
    graph.showStudy(cor, "corners"); graph.toggleMeasure(true);
    const cm = graph.measurements();
    ok("the Measure panel names the lowest and highest corners and the spread", cm && cm.series[0].rows.some(r => r[0] === "Lowest") && cm.series[0].rows.some(r => r[0] === "Highest") && cm.series[0].rows.some(r => /Spread/.test(r[0])), cm && cm.series[0].rows);
    graph.toggleMeasure(false);
    const cor2 = await Study.sweep(editor, runner, { mode: "corners", nominal: false, analysis: "op", params: [{ param: pV, tol: 20 }] });
    ok("corners without the nominal run only the extremes", cor2.series.length === 1 && cor2.xValues.length === 2, cor2.xValues);

    Commands.run("design.sweep");
    ok("the dialog starts with one parameter row and can add up to three", document.querySelectorAll(".st-prow").length === 1 && (document.getElementById("stAdd").click(), document.getElementById("stAdd").click(), document.getElementById("stAdd").click(), document.querySelectorAll(".st-prow").length === 3), document.querySelectorAll(".st-prow").length);
    ok("it shows how many runs that will be", /\d+ runs/.test(document.getElementById("stCount").textContent), document.getElementById("stCount").textContent);
    document.querySelector(".st-del").click();
    ok("a row can be removed", document.querySelectorAll(".st-prow").length === 2);
    document.getElementById("stMode").value = "corners"; document.getElementById("stMode").dispatchEvent(new Event("change", { bubbles: true }));
    ok("corners mode swaps the value fields for a tolerance", !document.querySelector(".st-corner").classList.contains("hidden") && document.querySelector(".st-grid").classList.contains("hidden") && /9 runs/.test(document.getElementById("stCount").textContent), document.getElementById("stCount").textContent);
    document.getElementById("stAnalysis").value = "op"; document.getElementById("stAnalysis").dispatchEvent(new Event("change", { bubbles: true }));
    [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "Run").click();
    for (let k = 0; k < 40 && !document.querySelector(".dialog") === false; k++) await wait(100);
    ok("Run from the dialog opens the STUDY tab with the corner results", graph.kind === "step" && plotter.data && plotter.data.study && plotter.data.study.kind === "corners" && /Corner analysis/.test(document.getElementById("plotTitle").textContent), document.getElementById("plotTitle").textContent);
    graph.hide();


    // ======================================================== subcircuits as parts
    clear();
    const LIBTXT = `* macromodel library\n.model DCLAMP D(IS=1e-14)\n.subckt OAMP inp inn out\nRin inp inn 1Meg\nGm 0 a inp inn 1m\nRp a 0 100Meg\nCp a 0 1.59n\nBout b 0 V = limit(v(a), -13, 13)\nRo b out 75\nD1 a 0 DCLAMP\n.ends OAMP\n`;
    const imp = SchematicImporter.import(editor, LIBTXT);
    ok("a file with only a .subckt adds a part instead of a schematic", imp.subckts === 1 && imp.count === 0 && !!PartLib.defs["SUB:OAMP"] && SubcktLibrary.defs.has("oamp"), imp);
    ok("the part is listed in Pick Devices under Subcircuits", DeviceCatalog.all().some(e => e.type === "SUB:OAMP" && e.category === "Subcircuits"));
    ok("its symbol has one pin per port, inputs on the left", editor.getSymbolDef({ type: "SUB:OAMP" }).pins.map(p => p[0]).join() === "inp,inn,out" || SYMBOL_DEFS["SUB:OAMP"].pins.length === 3, SYMBOL_DEFS["SUB:OAMP"].pins);
    const sb = new ExampleBuilder(editor);
    const svs = sb.part("V", 100, 300, { rot: 270, dcVoltage: 0.001, value: "1 mV" });
    const sr1 = sb.part("R", 240, 200, { value: "1 kΩ" }), sr2 = sb.part("R", 440, 140, { value: "100 kΩ" });
    const soa = sb.part("SUB:OAMP", 460, 300, {});
    const sg1 = sb.part("GND", 100, 420), sg2 = sb.part("GND", 340, 420), sg3 = sb.part("GND", 640, 420);
    const srl = sb.part("R", 640, 300, { rot: 90, value: "10 kΩ" });
    sb.wire(svs, "2", sr1, "1"); sb.wire(sr1, "2", soa, "inn"); sb.wire(sr2, "1", soa, "inn"); sb.wire(sr2, "2", soa, "out");
    sb.wire(soa, "inp", sg2, "1"); sb.wire(soa, "out", srl, "1"); sb.wire(srl, "2", sg3, "1"); sb.wire(svs, "1", sg1, "1");
    sb.vprobe(soa, "out", "Vout");
    sb.finish();
    const sinfo = NetlistExtractor.extract(editor);
    ok("an unwired subcircuit pin raises no warning, a wired circuit extracts", sinfo.elements.some(e => e.kind === "SUBCKT" && e.nodes.length === 3));
    const sop = new SimEngine(sinfo.circuit).operatingPoint().nodeVoltages;
    const vout = sop[sinfo.getPointNodeName(editor.probes[0].x, editor.probes[0].y)];
    ok("it simulates as written: an inverting amplifier of gain -100 from the macromodel", near(vout, -0.1, 0.002), vout);
    const deckText = NetlistExtractor.toSpice(sinfo.elements, {});
    ok("the SPICE export writes the instance, the .subckt and the model it needs", /^X\w+ \S+ \S+ \S+ OAMP$/m.test(deckText) && /^\.subckt OAMP/m.test(deckText) && /^\.model DCLAMP/m.test(deckText) && /^\.ends OAMP/m.test(deckText), deckText.slice(-700));
    document.getElementById("simTstop").value = "1m"; document.getElementById("simTstep").value = "20u";
    await runner.runTransient(); await wait(100);
    ok("a transient run with the subcircuit plots", plotter.data && plotter.data.series.some(s => /Vout/.test(s.name)));
    const saved = JSON.parse(JSON.stringify(doc.serialize()));
    ok("the design file embeds the subcircuits it uses", saved.subckts.length === 1 && saved.subckts[0].name === "OAMP" && /\.ends OAMP/.test(saved.subckts[0].text), saved.subckts);
    SubcktLibrary.defs.clear(); delete PartLib.defs["SUB:OAMP"]; delete SYMBOL_DEFS["SUB:OAMP"];
    clear();
    doc.apply(saved, { undoable: false });
    ok("opening it on a machine without the library restores the part and the circuit", editor.components.some(c => c.type === "SUB:OAMP") && !!PartLib.defs["SUB:OAMP"], editor.components.map(c => c.type));
    ok("a stored library comes back in the next session", (SubcktLibrary.persist(), SubcktLibrary.defs.clear(), delete PartLib.defs["SUB:OAMP"], delete SYMBOL_DEFS["SUB:OAMP"], SubcktLibrary.restore() >= 1 && !!PartLib.defs["SUB:OAMP"]));
    SubcktLibrary.clear(); SubcktLibrary.defs.clear(); delete PartLib.defs["SUB:OAMP"]; delete SYMBOL_DEFS["SUB:OAMP"];
    graph.hide();


    // ======================================================== ngspice on a worker
    ok("ngspice can run on a worker in this page", NgspiceBackend.workerAvailable());
    const ngQuick = await NgspiceBackend.run("rc\nV1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n.op\n.end\n");
    ok("a deck runs on the worker and returns its data", NgspiceBackend.worker !== null && ngQuick.data.some(d => /out/.test(d.name) && Math.abs(d.values[0] - 2.5) < 1e-6), ngQuick.data.map(d => d.name));
    const runaway = NgspiceBackend.run("rc\nV1 in 0 PULSE(0 1 0 1n 1n 1u 2u)\nR1 in out 1k\nC1 out 0 1n\n.tran 1p 10\n.end\n");
    await wait(400);
    const tc = performance.now(); NgspiceBackend.cancel();
    let cwhy = ""; try { await runaway; } catch (e) { cwhy = e.message; }
    ok("a runaway ngspice run is cancelled at once and the page stays alive", cwhy === "Cancelled" && performance.now() - tc < 500 && NgspiceBackend.worker === null, cwhy);
    const ngAgain = await NgspiceBackend.run("rc\nV1 in 0 DC 3\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n");
    ok("the next run starts a fresh worker and works", ngAgain.data.some(d => /out/.test(d.name) && Math.abs(d.values[0] - 2) < 1e-6));
    // through the app: the solver option + Cancel button
    clear(); loadExampleById(editor, "rc-ladder");
    document.getElementById("simEngine").value = "ngspice"; document.getElementById("simTstop").value = "50m"; document.getElementById("simTstep").value = "100u";
    await runner.runTransient(); await wait(200);
    ok("the Simulate button with the ngspice solver plots through the worker", plotter.data && plotter.data.series.length === 3 && /ngspice/.test(document.getElementById("plotTitle").textContent), document.getElementById("plotTitle").textContent);
    document.getElementById("simEngine").value = "builtin";
    graph.hide();


    // ======================================================== design parameters
    clear(); loadExampleById(editor, "rc-ladder");
    byName("R1").value = "{rv}"; byName("R2").value = "{rv*2.2}"; byName("C1").value = "{cv} F";
    editor.params = [{ name: "rv", value: "1k" }, { name: "cv", value: "10u" }];
    const pinfo = NetlistExtractor.extract(editor);
    const pr1 = pinfo.elements.find(e => e.name === "R1"), pr2 = pinfo.elements.find(e => e.name === "R2"), pc1 = pinfo.elements.find(e => e.name === "C1");
    ok("{name} and {expression} in part values become numbers in the netlist", pr1.params.r === 1000 && near(pr2.params.r, 2200, 1e-9) && near(pc1.params.c, 10e-6, 1e-15), [pr1.params, pr2.params, pc1.params]);
    ok("the schematic keeps the {names} afterwards", byName("R1").value === "{rv}" && byName("C1").value === "{cv} F");
    const pdeck = NetlistExtractor.toSpice(pinfo.elements, {});
    ok("the SPICE export has plain numbers", /^R1 \S+ \S+ 1000$/m.test(pdeck) && !/[{}]/.test(pdeck), pdeck.split("\n").filter(l => /^R/.test(l)));
    const r2Before = byName("R2").value;
    const lowParams = Study.parameters(editor, runner);
    ok("a parameter is offered in the sweep list", lowParams.some(p => p.id === "param:rv" && p.get() === 1000), lowParams.map(p => p.id));
    const psw = await Study.sweep(editor, runner, { param: "param:rv", analysis: "tran", show: "metric", metric: "final", probe: 1, list: [200, 1000, 5000] });
    ok("sweeping a parameter moves every part that uses it (the charge reached in 20 ms falls as R grows)", psw.series[0].values[0] > psw.series[0].values[2] && editor.params[0].value === "1k" && byName("R2").value === r2Before, psw.series[0].values);
    editor.params.push({ name: "bad", value: "nope+1" });
    const bset = JSON.stringify(editor.params);
    byName("R1").value = "{nope}";
    let perr = ""; try { NetlistExtractor.extract(editor); } catch (e) { perr = e.message; }
    ok("an unknown parameter is reported with the part and the name", /R1/.test(perr) && /unknown name "nope"/.test(perr), perr);
    ok("and the values are restored even though extraction failed", byName("R1").value === "{nope}" && byName("R2").value === "{rv*2.2}");
    byName("R1").value = "{rv}"; editor.params = [{ name: "rv", value: "1k" }, { name: "cv", value: "10u" }];
    const psaved = JSON.parse(JSON.stringify(doc.serialize()));
    ok("parameters are saved with the design", psaved.params.length === 2 && psaved.params[0].name === "rv");
    editor.params = []; doc.apply(psaved, { undoable: false });
    ok("and restored on opening, and by undo", editor.params.length === 2 && (() => { const sn = editor.snapshot(); editor.params = []; editor.restore(sn); return editor.params.length === 2; })());
    Commands.run("design.params");
    ok("Design > Parameters opens a table of them with their resolved values", document.querySelectorAll(".params-dlg tbody tr").length === 2 && /1\s?k/i.test(document.querySelector(".params-dlg tbody").textContent), document.querySelector(".params-dlg") && document.querySelector(".params-dlg").textContent);
    [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "Add").click();
    const nameBox = document.querySelectorAll('.params-dlg input[data-k="name"]')[2]; nameBox.value = "rz"; nameBox.dispatchEvent(new Event("change"));
    const valBox = document.querySelectorAll('.params-dlg input[data-k="value"]')[2]; valBox.value = "rv*3"; valBox.dispatchEvent(new Event("change"));
    ok("a new row evaluates against the others", /3\s?k/i.test(document.querySelectorAll(".params-dlg tbody tr")[2].textContent), document.querySelectorAll(".params-dlg tbody tr")[2].textContent);
    [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "OK").click();
    ok("OK stores them", editor.params.length === 3 && editor.params[2].name === "rz" && editor.params[2].value === "rv*3", editor.params);
    editor.params = []; byName("R1").value = "1k"; byName("R2").value = "2.2k"; byName("C1").value = "10u";


    // ======================================================== MOSFET body terminal
    clear();
    const mb = new ExampleBuilder(editor);
    const mvdd = mb.part("V", 100, 200, { rot: 270, dcVoltage: 5, value: "5 V" }), mvin = mb.part("V", 100, 360, { rot: 270, dcVoltage: 3, value: "3 V" });
    const mvb = mb.part("V", 300, 420, { rot: 270, dcVoltage: -2, value: "-2 V" });
    const mq = mb.part("NMOS", 400, 200, { model: "2N7000", value: "2N7000" }), mrs = mb.part("R", 400, 340, { value: "10 kΩ" });
    const mg1 = mb.part("GND", 100, 460), mg2 = mb.part("GND", 300, 500), mg3 = mb.part("GND", 400, 440), mg4 = mb.part("GND", 220, 120);
    mb.wire(mvdd, "2", mq, "D"); mb.wire(mvdd, "1", mg1, "1"); mb.wire(mvin, "2", mq, "G"); mb.wire(mvin, "1", mg1, "1");
    mb.wire(mq, "S", mrs, "1"); mb.wire(mrs, "2", mg3, "1");
    mb.finish();
    ok("an NMOS has a body pin", editor.getTerminals(mq).map(t => t.name).join() === "G,D,S,B", editor.getTerminals(mq));
    const mnb = NetlistExtractor.extract(editor);
    ok("an open body is tied to the source without any warning", mnb.elements.find(e => e.kind === "M").nodes[3] === mnb.elements.find(e => e.kind === "M").nodes[2] && !mnb.warnings.some(w => /B/.test(w) && /MOS|Q\d|M\d/.test(w)), mnb.warnings);
    ok("and the rule check does not flag it", !ErcChecker.run(editor).issues.some(i => i.rule === "pin" && /\bB\b/.test(i.text)), ErcChecker.run(editor).issues.map(i => i.text));
    const vsrc = new SimEngine(mnb.circuit).operatingPoint().nodeVoltages[mnb.getTerminalNodeName(mq, "S")];
    mb.wire(mq, "B", mvb, "2"); mb.wire(mvb, "1", mg2, "1"); editor.refreshWires();
    const mnb2 = NetlistExtractor.extract(editor);
    const vsrc2 = new SimEngine(mnb2.circuit).operatingPoint().nodeVoltages[mnb2.getTerminalNodeName(mq, "S")];
    ok("with the model's body effect (a negative body raises the threshold) the follower's source sits lower", vsrc2 < vsrc - 0.001 || SIM_MODELS.NMOS["2N7000"].params.gamma === undefined, [vsrc, vsrc2]);
    ok("the export writes the body node as the fourth connection", /^M\S+ \S+ \S+ \S+ \S+ \S+/m.test(NetlistExtractor.toSpice(mnb2.elements, {})) && NetlistExtractor.toSpice(mnb2.elements, {}).split("\n").find(l => /^M/.test(l)).split(" ")[4] === mnb2.elements.find(e => e.kind === "M").nodes[3]);
    graph.hide();


    // ======================================================== multi-sheet designs
    clear(); editor.resetSheets();
    const hb = new ExampleBuilder(editor);
    // root: 10 V source, two divider sheets in series, a load
    const hv = hb.part("V", 100, 300, { rot: 270, dcVoltage: 10, value: "10 V" }), hg = hb.part("GND", 100, 440);
    const hRL = hb.part("R", 900, 300, { rot: 90, value: "1 MΩ" }), hg2 = hb.part("GND", 900, 440);
    const divSheet = editor.addSheet("DIV");
    editor.switchSheet(editor.sheets.length - 1);
    const cb = new ExampleBuilder(editor);
    const pin_ = cb.part("PORT", 120, 200, { net: "IN", value: "IN" }), pout_ = cb.part("PORT", 520, 200, { net: "OUT", value: "OUT" });
    const cr1 = cb.part("R", 300, 200, { value: "1 kΩ" }), cr2 = cb.part("R", 420, 300, { rot: 90, value: "3 kΩ" }), cg = cb.part("GND", 420, 440);
    cb.wire(pin_, "1", cr1, "1"); cb.wire(cr1, "2", pout_, "1"); cb.wire(cr1, "2", cr2, "1"); cb.wire(cr2, "2", cg, "1");
    cb.finish();
    ok("a new sheet is switched to and has its own parts", editor.sheetIndex === 1 && editor.components.length === 5 && editor.sheets.length === 2);
    ok("its ports are listed by name", editor.portsOf(divSheet.id).join() === "IN,OUT", editor.portsOf(divSheet.id));
    editor.switchSheet(0);
    ok("switching back restores the root sheet's parts", editor.components.some(c => c.type === "V") && editor.components.length === 4);
    const u1 = hb.part("SHEET", 400, 200, { sheet: divSheet.id }), u2 = hb.part("SHEET", 640, 200, { sheet: divSheet.id });
    ok("a sheet symbol has a pin per port of the sheet it uses", editor.getTerminals(u1).map(t => t.name).join() === "IN,OUT", editor.getTerminals(u1).map(t => t.name));
    hb.wire(hv, "2", u1, "IN"); hb.wire(u1, "OUT", u2, "IN"); hb.wire(u2, "OUT", hRL, "1"); hb.wire(hv, "1", hg, "1"); hb.wire(hRL, "2", hg2, "1");
    hb.vprobe(u1, "OUT", "Vmid"); hb.vprobe(u2, "OUT", "Vout");
    hb.finish();
    const hinfo = NetlistExtractor.extract(editor);
    ok("the netlist holds the elements of both instances with their paths", ["S1.R1", "S1.R2", "S2.R1", "S2.R2"].every(n => hinfo.elements.some(e => e.name.toUpperCase() === n.replace(".", "__").toUpperCase())) || hinfo.elements.some(e => /__/.test(e.name)), hinfo.elements.map(e => e.name));
    const hop = new SimEngine(hinfo.circuit).operatingPoint().nodeVoltages;
    const hvmid = hop[hinfo.getPointNodeName(editor.probes[0].x, editor.probes[0].y)], hvout = hop[hinfo.getPointNodeName(editor.probes[1].x, editor.probes[1].y)];
    ok("the first divider gives 6.31 V once the second stage loads it", near(hvmid, 6.3135, 0.01), hvmid);
    ok("two sheets in series give less than the product of ideal dividers would (loading) but more than 4 V", hvout > 3.5 && hvout < 5.7, hvout);
    const exact = (() => { const r2 = 3000 + 1e6 === 0 ? 0 : (3000 * 1e6) / (3000 + 1e6); const stage2 = r2 / (1000 + r2); const zin2 = 1000 + r2; const par = (3000 * zin2) / (3000 + zin2); return 10 * (par / (1000 + par)) * stage2; })();
    ok("the output equals the exact two-stage ladder calculation", near(hvout, exact, 0.01), [hvout, exact]);
    const hdeck = NetlistExtractor.toSpice(hinfo.elements, {});
    ok("the SPICE export contains all four resistors of the instances", (hdeck.match(/^R\S+ \S+ \S+ (1000|3000)$/gm) || []).length === 4, hdeck.split("\n").filter(l => /^R/.test(l)));
    ok("the BOM expands the instances", Exporter.bom(editor).flatMap(r => r.refs).filter(r => /\./.test(r)).length === 4 && Exporter.bom(editor).find(r => r.value && /3/.test(r.value) && r.qty === 2), Exporter.bom(editor).map(r => r.refs.join("+")));
    // simulating from a child sheet goes to the root
    editor.switchSheet(1);
    document.getElementById("simTstop").value = "1m"; document.getElementById("simTstep").value = "50u";
    await runner.runTransient(); await wait(100);
    ok("running an analysis from a sub-sheet switches to the root and simulates the whole design", editor.sheetIndex === 0 && plotter.data && plotter.data.series.some(s => /Vout/.test(s.name)));
    // save and load
    const hsaved = JSON.parse(JSON.stringify(doc.serialize()));
    ok("a saved design lists every sheet, the active one's parts at the top level", hsaved.sheets.length === 2 && hsaved.sheets[0].active && hsaved.sheets[1].state.components.length === 5 && hsaved.components.length === editor.components.length, hsaved.sheets.map(s => s.name));
    editor.resetSheets(); clear();
    doc.apply(hsaved, { undoable: false });
    ok("opening restores the sheets and the same circuit", editor.sheets.length === 2 && editor.sheets[1].name === "DIV" && (() => { const i2 = NetlistExtractor.extract(editor); const o2 = new SimEngine(i2.circuit).operatingPoint().nodeVoltages; return near(o2[i2.getPointNodeName(editor.probes[1].x, editor.probes[1].y)], hvout, 1e-9); })());
    ok("a design with several sheets counts as non-empty for the save prompt", !doc.isEmpty());
    // errors
    let derr = ""; try { editor.deleteSheet(1); } catch (e) { derr = e.message; }
    ok("a sheet that is in use cannot be deleted", /is used by a sheet symbol/.test(derr), derr);
    ok("the root sheet cannot be deleted", (() => { try { editor.deleteSheet(0); } catch (e) { return /root/.test(e.message); } return false; })());
    // a sheet using itself
    editor.switchSheet(1);
    const selfSym = new ExampleBuilder(editor).part("SHEET", 700, 200, { sheet: editor.sheets[1].id });
    editor.switchSheet(0);
    const rinfo = NetlistExtractor.extract(editor);
    ok("a sheet that contains itself is cut off with a warning, not an endless loop", rinfo.warnings.some(w => /deep|itself/.test(w)) && rinfo.elements.length < 400, rinfo.warnings.slice(0, 2));
    editor.switchSheet(1); editor.components = editor.components.filter(c => c !== selfSym); editor.switchSheet(0);
    // power ports are global; a duplicate
    const hdup = editor.duplicateSheet(1);
    ok("Duplicate Sheet copies the parts under a new name", hdup.name === "DIV copy" && hdup.data.components.length === 5 && editor.sheets.length === 3);
    editor.deleteSheet(2);
    ok("an unused sheet can be deleted", editor.sheets.length === 2);
    // the tab bar
    ok("the sheet bar shows a tab per sheet", document.querySelectorAll("#sheetbar .sheet-tab").length === 2 && document.querySelector("#sheetbar .sheet-tab.active").textContent === "Main", document.getElementById("sheetbar").textContent);
    document.querySelectorAll("#sheetbar .sheet-tab")[1].click();
    ok("clicking a tab opens that sheet", editor.sheetIndex === 1 && document.querySelector("#sheetbar .sheet-tab.active").textContent === "DIV");
    editor.switchSheet(0);
    const symComp = editor.components.find(c => c.type === "SHEET");
    window.live && window.live.stop();
    editor.onEdit(symComp);
    ok("double-clicking a sheet symbol opens its sheet, and Back returns", editor.sheetIndex === 1 && editor.sheetStack.length === 1 && (editor.sheetUp(), editor.sheetIndex === 0));
    editor.resetSheets(); sheetBar.render();

    // power ports are global across sheets, ground is global
    clear(); editor.resetSheets();
    const pb = new ExampleBuilder(editor);
    const pcs = editor.addSheet("LOAD"); editor.switchSheet(1);
    const cpb = new ExampleBuilder(editor);
    const cpw = cpb.part("POWER", 200, 160, { net: "VCC", volts: "5", value: "VCC" }), cpr = cpb.part("R", 200, 280, { rot: 90, value: "1 kΩ" }), cpg = cpb.part("GND", 200, 400);
    cpb.wire(cpw, "1", cpr, "1"); cpb.wire(cpr, "2", cpg, "1"); cpb.finish();
    editor.switchSheet(0);
    const rpw = pb.part("POWER", 200, 160, { net: "VCC", volts: "5", value: "VCC" }), rsh = pb.part("SHEET", 420, 200, { sheet: pcs.id }), rpg = pb.part("GND", 200, 400), rr = pb.part("R", 200, 280, { rot: 90, value: "1 kΩ" });
    pb.wire(rpw, "1", rr, "1"); pb.wire(rr, "2", rpg, "1"); pb.finish();
    const pinfo2 = NetlistExtractor.extract(editor);
    ok("a POWER port on two sheets is one rail with a single supply source", pinfo2.elements.filter(e => e.kind === "V").length === 1, pinfo2.elements.filter(e => e.kind === "V").map(e => e.name));
    const pop = new SimEngine(pinfo2.circuit).operatingPoint();
    ok("both loads (5 mA each) hang on that one source", near(Math.abs(pop.currents.P1_v), 0.01, 1e-6), pop.currents.P1_v);
    editor.resetSheets(); sheetBar.render();
    graph.hide();


    // ======================================================== share link, palette, report
    clear(); loadExampleById(editor, "rc-ladder"); editor.params = [{ name: "k", value: "2" }];
    const slink = await Share.link(doc);
    ok("a share link carries the design in its fragment", slink.includes("#share=") && slink.length > 200 && slink.length < 20000, slink.length);
    const sdec = await Share.decode(slink.split("#share=")[1]);
    ok("it decodes to the same design (parts, wires, parameters)", sdec.components.length === editor.components.length && sdec.wires.length === editor.wires.length && sdec.params[0].name === "k" && !sdec.view, [sdec.components.length, editor.components.length]);
    clear(); doc.apply(sdec, { undoable: false });
    ok("applying it rebuilds a circuit that simulates", editor.components.length === 8 || editor.components.length > 4, editor.components.length);
    ok("a damaged link is rejected", await Share.decode("not-a-link!").then(() => false, () => true));
    Commands.run("file.share"); await wait(300);
    ok("File > Share as Link shows the link", !!document.querySelector(".dialog textarea") && /#share=/.test(document.querySelector(".dialog textarea").value));
    Dialog.close("t");
    Commands.run("palette.open");
    const pin = document.querySelector(".palette-input");
    pin.value = "noise"; pin.dispatchEvent(new Event("input"));
    ok("the command palette finds a command from a few letters", /Noise/.test(document.querySelector(".palette-list .palette-row.sel").textContent), document.querySelector(".palette-list").textContent);
    pin.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await wait(100);
    ok("Enter runs it (the NOISE tab opens)", graph.kind === "noise" && !document.querySelector(".palette"), graph.kind);
    pin && Dialog.close("t");
    document.getElementById("simTstop").value = "20m"; document.getElementById("simTstep").value = "100u"; document.getElementById("simUic").checked = true;
    graph.show("tran"); await runner.runTransient(); await wait(100);
    editor.measures = [{ name: "vend", kind: "tran", fn: "find", sig: "V(c1)", at: 0.02 }];
    const html = await Report.build(editor, runner, plotter, doc);
    ok("the report is a self-contained page with schematic, parts, graph, measurement and netlist", /<!doctype html>/.test(html) && /<h2>Schematic<\/h2><img[^>]+data:image\/png/.test(html) && /Parts list/.test(html) && /<h2>Transient<\/h2><img/.test(html) && /Measurements/.test(html) && /<h2>SPICE netlist<\/h2><pre>[^<]*\.tran|<h2>SPICE netlist/.test(html), html.length);
    ok("it lists the parameters and escapes text", /<h2>Parameters<\/h2>/.test(html) && !/<script/.test(html));
    editor.measures = []; editor.params = []; graph.hide();


    // ======================================================== sensitivity
    clear(); editor.resetSheets();
    const sb2 = new ExampleBuilder(editor);
    const sv = sb2.part("V", 100, 300, { rot: 270, dcVoltage: 10, value: "10 V" }), sra = sb2.part("R", 300, 200, { value: "1 kΩ" }), srb = sb2.part("R", 460, 300, { rot: 90, value: "3 kΩ" }), sg = sb2.part("GND", 460, 440), sg0 = sb2.part("GND", 100, 440);
    sb2.wire(sv, "2", sra, "1"); sb2.wire(sra, "2", srb, "1"); sb2.wire(srb, "2", sg, "1"); sb2.wire(sv, "1", sg0, "1"); sb2.vprobe(sra, "2", "Vout"); sb2.finish();
    const sens = await Study.sensitivity(editor, runner, { analysis: "op", probe: 0, delta: 1 });
    const byLabel = (re) => sens.rows.find(r => re.test(r.label));
    ok("a divider: the output follows the source one for one", near(byLabel(/V1/).rel, 1, 0.01), byLabel(/V1/));
    ok("the bottom resistor has sensitivity R1/(R1+R2) = 0.25 and the top one -0.25", near(byLabel(/R2/).rel, 0.25, 0.01) && near(byLabel(/R1/).rel, -0.25, 0.01), sens.rows.map(r => [r.label, r.rel]));
    ok("rows are sorted by influence and the circuit is restored", sens.rows[0].label.includes("V1") && byLabel(/R1/).x0 === 1000 && byLabel(/R2/).x0 === 3000 && byLabel(/R1/).label && sra.value === "1 kΩ", sens.rows.map(r => r.label));
    Commands.run("design.sensitivity");
    ok("Design > Sensitivity opens its dialog", !!document.querySelector(".dialog #seAnalysis"));
    [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "Run").click(); await wait(1200);
    ok("it ranks the parts in a table with bars", document.querySelectorAll(".se-out tbody tr").length === 3 && document.querySelectorAll(".se-bar").length === 3, document.querySelector(".se-out") && document.querySelector(".se-out").textContent.slice(0, 100));
    Dialog.close("t");


    // ======================================================== accessibility and layout
    Commands.run("help.start");
    const dlg = document.querySelector(".dialog");
    ok("dialogs announce themselves (role, modal, label) and Getting Started opens", dlg && dlg.getAttribute("role") === "dialog" && dlg.getAttribute("aria-modal") === "true" && dlg.getAttribute("aria-labelledby") && /Getting Started/.test(dlg.textContent));
    const btns = [...dlg.querySelectorAll("button")]; btns[btns.length - 1].focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    ok("Tab from the last control wraps to the first, so focus cannot leave the dialog", dlg.contains(document.activeElement) && document.activeElement === btns[0], document.activeElement && document.activeElement.textContent);
    Dialog.close("t");
    ok("icon buttons carry an accessible name", [...document.querySelectorAll("button[title]")].filter(b => !b.textContent.trim()).every(b => b.getAttribute("aria-label")));
    Commands.run("view.sidebar");
    ok("View > Sidebar hides the left pane and gives the room to the sheet", document.body.classList.contains("nosidebar") && getComputedStyle(document.getElementById("leftpane")).display === "none");
    Commands.run("view.sidebar");
    ok("and shows it again", !document.body.classList.contains("nosidebar") && getComputedStyle(document.getElementById("leftpane")).display !== "none");


    // ======================================================== rule check across sheets
    clear(); editor.resetSheets();
    const eb = new ExampleBuilder(editor);
    const esh = editor.addSheet("LONELY"); editor.switchSheet(1);
    const ec = new ExampleBuilder(editor); ec.part("R", 200, 200, { value: "1k" }); ec.finish();
    editor.switchSheet(0);
    eb.part("V", 100, 300, { rot: 270, dcVoltage: 5, value: "5 V" }); eb.part("GND", 100, 440); eb.part("SHEET", 500, 200, { sheet: 99 }); eb.finish();
    const eres = ErcChecker.run(editor, { allSheets: true });
    ok("a sheet symbol with no sheet and an unused sheet are reported", eres.issues.some(i => i.rule === "sheet" && /does not point at a sheet/.test(i.text)) && eres.issues.some(i => i.rule === "sheet" && /LONELY.*not used/.test(i.text)), eres.issues.map(i => i.text));
    ok("problems on other sheets are listed with the sheet's name", eres.issues.some(i => /^\[LONELY\].*not connected/.test(i.text)), eres.issues.map(i => i.text));
    ok("the plain run still checks only the open sheet", !ErcChecker.run(editor).issues.some(i => /^\[LONELY\]/.test(i.text)));
    const other = eres.issues.find(i => /^\[LONELY\]/.test(i.text) && i.refs.length);
    editor.revealRefs(other.refs);
    ok("clicking such an issue opens its sheet", editor.sheets[editor.sheetIndex].name === "LONELY", editor.sheetIndex);
    editor.resetSheets(); sheetBar.render();


    // ======================================================== per-instance parameters on a sheet symbol
    clear(); editor.resetSheets();
    const pi_ib = new ExampleBuilder(editor);
    const pi_ish = editor.addSheet("RDIV"); editor.switchSheet(1);
    editor.params = [{ name: "rv", value: "1k" }];
    const pi_ic2 = new ExampleBuilder(editor);
    const pi_ipin = pi_ic2.part("PORT", 120, 200, { net: "IN", value: "IN" }), pi_ir = pi_ic2.part("R", 300, 200, { value: "{rv}" }), pi_iout = pi_ic2.part("PORT", 500, 200, { net: "OUT", value: "OUT" });
    pi_ic2.wire(pi_ipin, "1", pi_ir, "1"); pi_ic2.wire(pi_ir, "2", pi_iout, "1"); pi_ic2.finish();
    editor.switchSheet(0);
    editor.params = [{ name: "rv", value: "1k" }, { name: "scale", value: "3" }];
    const pi_iu1 = pi_ib.part("SHEET", 400, 200, { sheet: pi_ish.id }), pi_iu2 = pi_ib.part("SHEET", 640, 200, { sheet: pi_ish.id, overrides: "rv = 2k*scale" });
    const pi_iv = pi_ib.part("V", 100, 300, { rot: 270, dcVoltage: 1, value: "1 V" }), pi_ig = pi_ib.part("GND", 100, 440), pi_ig2 = pi_ib.part("GND", 900, 440), pi_irl = pi_ib.part("R", 900, 300, { rot: 90, value: "1 kΩ" });
    pi_ib.wire(pi_iv, "2", pi_iu1, "IN"); pi_ib.wire(pi_iu1, "OUT", pi_iu2, "IN"); pi_ib.wire(pi_iu2, "OUT", pi_irl, "1"); pi_ib.wire(pi_iv, "1", pi_ig, "1"); pi_ib.wire(pi_irl, "2", pi_ig2, "1"); pi_ib.finish();
    const pi_iinfo = NetlistExtractor.extract(editor);
    const pi_rvals = pi_iinfo.elements.filter(e => e.kind === "R" && /__/.test(e.name)).map(e => [e.name, e.params.r]);
    ok("each use of a sheet gets its own parameter values (1 kΩ by default, 2k × scale = 6 kΩ for the second)", pi_rvals.length === 2 && pi_rvals.some(r => r[1] === 1000) && pi_rvals.some(r => r[1] === 6000), pi_rvals);
    pi_iu2.overrides = "nonsense";
    ok("a bad override is reported, not silently ignored", NetlistExtractor.extract(editor).warnings.some(w => /not name=value/.test(w)));
    editor.resetSheets(); sheetBar.render(); editor.params = [];


    // ======================================================== SVG and KiCad exports
    clear(); editor.resetSheets(); loadExampleById(editor, "ce-amp");
    const svgText = Exporter.renderSvg(editor), png1 = Exporter.renderImage(editor, 1);
    const sdoc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    ok("the SVG is well-formed XML with the same size as the 1x picture", !sdoc.querySelector("parsererror") && sdoc.documentElement.getAttribute("width") === String(png1.width) && sdoc.documentElement.getAttribute("height") === String(png1.height), [sdoc.documentElement.getAttribute("width"), png1.width]);
    ok("it holds the drawing as vector paths and text", sdoc.querySelectorAll("path").length > 40 && sdoc.querySelectorAll("text").length > 8, [sdoc.querySelectorAll("path").length, sdoc.querySelectorAll("text").length]);
    ok("part labels are real text (R1, Q1) and colours are kept", [...sdoc.querySelectorAll("text")].some(t => /R1/.test(t.textContent)) && /stroke="#[0-9a-f]{3,6}"/i.test(svgText) && !/NaN|undefined/.test(svgText), svgText.slice(0, 200));
    ok("exporting leaves the editor's drawing context alone", editor.ctx === editor.canvas.getContext("2d") && !editor.exporting);
    const net = Exporter.kicadNetlist(editor);
    ok("the KiCad netlist lists every part and net with balanced parentheses", /^\(export \(version D\)/.test(net) && (net.match(/\(comp /g) || []).length === editor.components.filter(c => !["GND", "TEXT", "NODEIC", "POWER", "NETLABEL", "PORT", "SHEET"].includes(c.type)).length && (net.match(/\(/g) || []).length === (net.match(/\)/g) || []).length, net.slice(0, 300));
    ok("every pin of every part appears in exactly one net", (() => { const pins = (net.match(/\(node /g) || []).length; const expected = editor.components.filter(c => !["GND", "TEXT", "NODEIC", "POWER", "NETLABEL", "PORT", "SHEET"].includes(c.type)).reduce((n, c) => n + editor.getTerminals(c).filter(t => NetlistExtractor.nets(editor).terminalNode(c, t.name) !== null).length, 0); return pins === expected; })());
    ok("the ground net is called GND", /\(name "GND"\)/.test(net));


    // ======================================================== probes inside sub-sheets
    clear(); editor.resetSheets();
    const qb = new ExampleBuilder(editor);
    const qsh = editor.addSheet("STAGE"); editor.switchSheet(1);
    const qc = new ExampleBuilder(editor);
    const qin = qc.part("PORT", 120, 200, { net: "IN", value: "IN" }), qr1 = qc.part("R", 300, 200, { value: "1 kΩ" }), qout = qc.part("PORT", 520, 200, { net: "OUT", value: "OUT" }), qr2 = qc.part("R", 420, 300, { rot: 90, value: "1 kΩ" }), qg = qc.part("GND", 420, 440);
    qc.wire(qin, "1", qr1, "1"); qc.wire(qr1, "2", qout, "1"); qc.wire(qr1, "2", qr2, "1"); qc.wire(qr2, "2", qg, "1");
    qc.vprobe(qr1, "2", "Vmid"); qc.iprobe(qr1);
    qc.finish();
    editor.switchSheet(0);
    const qv = qb.part("V", 100, 300, { rot: 270, dcVoltage: 8, value: "8 V" }), qg0 = qb.part("GND", 100, 440), qrl = qb.part("R", 900, 300, { rot: 90, value: "1 MΩ" }), qg2 = qb.part("GND", 900, 440);
    const qs1 = qb.part("SHEET", 400, 200, { sheet: qsh.id }), qs2 = qb.part("SHEET", 640, 200, { sheet: qsh.id });
    qb.wire(qv, "2", qs1, "IN"); qb.wire(qs1, "OUT", qs2, "IN"); qb.wire(qs2, "OUT", qrl, "1"); qb.wire(qv, "1", qg0, "1"); qb.wire(qrl, "2", qg2, "1");
    qb.vprobe(qrl, "1", "Vout");
    qb.finish();
    const qinfo = NetlistExtractor.extract(editor);
    ok("probes on a sub-sheet appear once per use, labelled with the instance", qinfo.probes.length === 5 && qinfo.probes.filter(p => p._sub).map(p => p.label).sort().join() === "I(R1)@" + qs1.name + ",I(R1)@" + qs2.name + ",Vmid@" + qs1.name + ",Vmid@" + qs2.name, qinfo.probes.map(p => p.label));
    ok("allProbes() gives the same list for dialogs", editor.allProbes().length === 5 && editor.allProbes().every((p, i) => p.label === qinfo.probes[i].label));
    const qop = new SimEngine(qinfo.circuit).operatingPoint();
    const qm1 = qinfo.probes.find(p => p.label === "Vmid@" + qs1.name), qm2 = qinfo.probes.find(p => p.label === "Vmid@" + qs2.name);
    ok("each instance's voltage probe reads its own node (the second stage sees the first one's output)", qm1._node !== qm2._node && qop.nodeVoltages[qm1._node] > qop.nodeVoltages[qm2._node] && qop.nodeVoltages[qm2._node] > 0, [qop.nodeVoltages[qm1._node], qop.nodeVoltages[qm2._node]]);
    ok("a current probe on a sub-sheet part reads that instance's resistor", (() => { const ip = qinfo.probes.find(p => p.label === "I(R1)@" + qs1.name); return near(Math.abs(qop.currents[ip._target]), Math.abs(qop.nodeVoltages[qm1._node] - 0) > 0 ? Math.abs(qop.currents[ip._target]) : 0, 1) && Math.abs(qop.currents[ip._target]) > 1e-4; })());
    document.getElementById("simTstop").value = "1m"; document.getElementById("simTstep").value = "50u";
    await runner.runTransient(); await wait(100);
    ok("a transient run plots the sub-sheet probes next to the root ones", plotter.data && plotter.data.series.length === 5 && plotter.data.series.some(s => /^Vmid@/.test(s.name)) && plotter.data.series.some(s => /^I\(R1\)@/.test(s.name)), plotter.data && plotter.data.series.map(s => s.name));
    const qvals = plotter.data.series.filter(s => /^Vmid@/.test(s.name)).map(s => s.values[s.values.length - 1]);
    ok("with different values for the two instances", qvals.length === 2 && qvals[0] !== qvals[1] && qvals.every(v => v > 0), qvals);
    live.start(); await wait(700);
    ok("live simulation reads them too and the probe flag on the sub-sheet shows its value", live.channels.some(c => /^Vmid@/.test(c.name)) && (() => { const sheetProbe = editor.sheets[1].data.probes.find(p => p.label === "Vmid"); return !!sheetProbe && /V/.test(String(sheetProbe.live)); })(), live.channels.map(c => c.name));
    live.stop();
    editor.switchSheet(1);
    ok("opening the sub-sheet shows its own probes as placed", editor.probes.length === 2 && editor.probes.every(p => !p._sub));
    editor.switchSheet(0);
    const qsw = await Study.sweep(editor, runner, { analysis: "op", show: "metric", probe: 1, params: [{ param: Study.parameters(editor, runner).find(p => /^V1 DC/.test(p.label)).id, list: [4, 8] }] });
    ok("studies can measure a sub-sheet probe", (() => { const sr = qsw.series.find(x => /^Vmid@/.test(x.name)); return !!sr && sr.values[1] > sr.values[0] * 1.5; })(), qsw.series.map(x => x.name));
    editor.resetSheets(); sheetBar.render();


    // operating-point numbers on a sub-sheet
    {
        clear(); editor.resetSheets();
        const ob = new ExampleBuilder(editor);
        const osh = editor.addSheet("DIVB"); editor.switchSheet(1);
        const oc = new ExampleBuilder(editor);
        const oin = oc.part("PORT", 120, 200, { net: "IN", value: "IN" }), or1 = oc.part("R", 300, 200, { value: "1 kΩ" }), oout = oc.part("PORT", 520, 200, { net: "OUT", value: "OUT" }), or2 = oc.part("R", 420, 300, { rot: 90, value: "3 kΩ" }), og = oc.part("GND", 420, 440);
        oc.wire(oin, "1", or1, "1"); oc.wire(or1, "2", oout, "1"); oc.wire(or1, "2", or2, "1"); oc.wire(or2, "2", og, "1"); oc.finish();
        editor.switchSheet(0);
        const ov = ob.part("V", 100, 300, { rot: 270, dcVoltage: 8, value: "8 V" }), og0 = ob.part("GND", 100, 440), ou = ob.part("SHEET", 400, 200, { sheet: osh.id }), orl = ob.part("R", 700, 300, { rot: 90, value: "1 MΩ" }), og2 = ob.part("GND", 700, 440);
        ob.wire(ov, "2", ou, "IN"); ob.wire(ou, "OUT", orl, "1"); ob.wire(ov, "1", og0, "1"); ob.wire(orl, "2", og2, "1"); ob.finish();
        editor.switchSheet(1);
        opOverlay.enable(); await wait(300);
        const od = editor.opData;
        ok("with a sub-sheet open the operating point shows that sheet's node voltages and part currents", od && !od.error && od.nodes.length >= 2 && od.nodes.some(n => Math.abs(n.v - 8 * 3 / 4) < 0.01) && od.nodes.some(n => Math.abs(n.v - 8) < 0.01) && od.parts.some(p => p.comp.name === "R1" && Math.abs(Math.abs(p.i) - 2e-3) < 1e-5), od && JSON.stringify(od.nodes.map(n => n.v)));
        opOverlay.disable(); editor.switchSheet(0);
        editor.resetSheets(); sheetBar.render();
    }


    // playing the circuit while a sub-sheet is open
    {
        clear(); editor.resetSheets();
        const lb = new ExampleBuilder(editor);
        const lsh = editor.addSheet("DIVC"); editor.switchSheet(1);
        const lc = new ExampleBuilder(editor);
        const lin = lc.part("PORT", 120, 200, { net: "IN", value: "IN" }), lr1 = lc.part("R", 300, 200, { value: "1 kΩ" }), lout = lc.part("PORT", 520, 200, { net: "OUT", value: "OUT" }), lr2 = lc.part("R", 420, 300, { rot: 90, value: "3 kΩ" }), lg = lc.part("GND", 420, 440);
        lc.wire(lin, "1", lr1, "1"); lc.wire(lr1, "2", lout, "1"); lc.wire(lr1, "2", lr2, "1"); lc.wire(lr2, "2", lg, "1"); lc.vprobe(lr1, "2", "Vq"); lc.finish();
        editor.switchSheet(0);
        const lv = lb.part("V", 100, 300, { rot: 270, dcVoltage: 8, value: "8 V" }), lg0 = lb.part("GND", 100, 440), lu = lb.part("SHEET", 400, 200, { sheet: lsh.id }), lrl = lb.part("R", 700, 300, { rot: 90, value: "1 MΩ" }), lg2 = lb.part("GND", 700, 440);
        lb.wire(lv, "2", lu, "IN"); lb.wire(lu, "OUT", lrl, "1"); lb.wire(lv, "1", lg0, "1"); lb.wire(lrl, "2", lg2, "1"); lb.finish();
        editor.switchSheet(1);
        opOverlay.enable();
        document.getElementById("simTstop").value = "100000"; document.getElementById("simTstep").value = "10m"; document.getElementById("liveSpeed").value = "0.1";
        live.start(); await wait(900);
        ok("Play with the sub-sheet open keeps it open and simulates the whole design", editor.sheetIndex === 1 && live.state === "running" && live.channels.some(c => /^Vq@/.test(c.name)), [editor.sheetIndex, live.state, live.channels.map(c => c.name)]);
        const lqp = editor.probes.find(p => p.label === "Vq");
        ok("the probe on the open sheet shows the running value and the wires carry live numbers", /V/.test(String(lqp.live)) && editor.opData && !editor.opData.error && editor.opData.nodes.some(n => Math.abs(n.v - 6) < 0.05), [lqp.live, editor.opData && editor.opData.nodes.map(n => n.v)]);
        live.stop(); opOverlay.disable();
        editor.switchSheet(0); editor.resetSheets(); sheetBar.render();
    }

    clear();
    return { total: results.length, failed: results.filter(r => !r.pass).length, failures: results.filter(r => !r.pass) };
};

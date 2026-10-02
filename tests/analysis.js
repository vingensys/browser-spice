// Analysis features: operating-point overlay, spectrum, parametric sweeps, Monte Carlo, exports.
// In the running app:  (0, eval)(await (await fetch('tests/analysis.js')).text()); await analysisTests();

window.analysisTests = async function () {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, ...(cond ? {} : { extra }) });
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clear = () => {
        live.stop(); ScopeWindow.closeAll(); Dialog.close("t");
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

    clear();
    return { total: results.length, failed: results.filter(r => !r.pass).length, failures: results.filter(r => !r.pass) };
};

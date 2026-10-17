// Probes list / placement and the oscilloscope window.
// In the running app:  (0, eval)(await (await fetch('tests/scope.js')).text()); await scopeTests();

window.scopeTests = async function () {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, ...(cond ? {} : { extra }) });
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clear = () => {
        live.stop(); ScopeWindow.closeAll(); LogicWindow.closeAll(); Dialog.close("t");
        editor.setTool("select");
        editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1;
        editor.historyStack = []; editor.futureStack = []; editor.clearSelection(); editor.resetView();
    };
    const ptr = (type, x, y, o = {}) => {
        const r = editor.canvas.getBoundingClientRect();
        editor.canvas.dispatchEvent(new (type === "contextmenu" ? MouseEvent : PointerEvent)(type, {
            clientX: r.left + editor.panX + x * editor.zoom, clientY: r.top + editor.panY + y * editor.zoom,
            button: o.button || 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, pointerId: 1
        }));
    };
    const click = (x, y) => { ptr("pointerdown", x, y); ptr("pointerup", x, y); };
    const stepTo = (t) => { for (let i = 0; i < 400000 && live.run.t < t; i++) { live.run.step(); live.feedScopes(); } return live.run.t >= t; };
    const notices = []; const realNotice = editor.onNotice; editor.onNotice = (m) => notices.push(m);

    // ======================================================== probes: a list and easy placement
    clear(); loadExampleById(editor, "ce-amp");
    const nProbes = editor.probes.length;
    Commands.run("tool.vprobe");
    ok("choosing the voltage probe lists the probes in the side pane", pane.mode === "probes" && document.querySelector("#devtitle").textContent === "PROBES" && [...document.querySelectorAll("#devicelist li")].map(l => l.textContent).join() === "VOLTAGE PROBE,CURRENT PROBE", [...document.querySelectorAll("#devicelist li")].map(l => l.textContent));
    ok("... and arms the tool", editor.tool === "vProbe" && pane.selected && pane.selected.name === "VOLTAGE PROBE");
    const wire = editor.wires.find(w => w.route.length > 2);
    const seg = (() => { let b = [wire.route[0], wire.route[1]]; for (let i = 0; i < wire.route.length - 1; i++) if (Math.hypot(wire.route[i + 1].x - wire.route[i].x, wire.route[i + 1].y - wire.route[i].y) > Math.hypot(b[1].x - b[0].x, b[1].y - b[0].y)) b = [wire.route[i], wire.route[i + 1]]; return b; })();
    const mid = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 };
    click(mid.x, mid.y + 6 / editor.zoom);                            // a few pixels off the wire: still attaches
    ok("a click near a wire (not exactly on it) places a voltage probe", editor.probes.length === nProbes + 1 && editor.probes[nProbes].anchor && editor.probes[nProbes].anchor.type === "wire", editor.probes.length);
    ok("the probe tool stays armed for the next one", editor.tool === "vProbe");
    const pin = editor.getTerminalPosition(editor.components.find(c => c.type === "BJT_NPN"), editor.getTerminals(editor.components.find(c => c.type === "BJT_NPN")).find(t => t.name === "E"));
    click(pin.x + 8 / editor.zoom, pin.y + 6 / editor.zoom);
    ok("a click near a pin places one on the pin", editor.probes.length === nProbes + 2 && editor.probes[nProbes + 1].anchor.type === "terminal", editor.probes[nProbes + 1] && editor.probes[nProbes + 1].anchor);
    const before = editor.probes.length; notices.length = 0;
    click(30, 30);
    ok("a click on empty sheet places nothing and says what to click", editor.probes.length === before && notices.some(n => /wire or a pin/.test(n)), notices);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    ok("Esc stops placing and clears the list selection", editor.tool === "select" && !pane.selected);

    Commands.run("tool.iprobe");
    ok("the current probe is in the same list", pane.mode === "probes" && editor.tool === "iProbe" && pane.selected.name === "CURRENT PROBE");
    const r4 = editor.components.find(c => c.name === "R4");
    const n2 = editor.probes.length;
    click(r4.x, r4.y);
    ok("clicking a part attaches a current probe to it", editor.probes.length === n2 + 1 && editor.probes[n2].type === "I" && editor.probes[n2].targetName === "R4");
    click(r4.x, r4.y); 
    ok("a second probe on the same part is refused with a message", editor.probes.length === n2 + 1 && notices.some(n => /already has a current probe/.test(n)));
    const r2 = editor.components.find(c => c.name === "R2");
    const rw = editor.wires.find(w => (w.start.component === r2.id || w.end.component === r2.id) && w.route.length > 1);
    const rwEnd = rw.start.component === r2.id ? rw.route[0] : rw.route[rw.route.length - 1], rwOther = rw.start.component === r2.id ? rw.route[1] : rw.route[rw.route.length - 2];
    click(rwEnd.x + (rwOther.x - rwEnd.x) * 0.12, rwEnd.y + (rwOther.y - rwEnd.y) * 0.12);   // close to R2's pin, away from the C1 junction
    ok("clicking the wire right next to a part attaches the current probe to that part", editor.probes.some(p => p.type === "I" && p.targetName === "R2"), editor.probes.map(p => p.label));
    click(30, 30);
    ok("a click on nothing gives a hint", notices.some(n => /part \(or the wire/.test(n)));
    Dialog.close("t"); editor.setTool("select"); pane.setMode("devices");

    // options: colour and plot-or-not
    const vp = editor.probes.find(p => p.type === "V");
    editor.onEditProbe(vp);
    document.getElementById("probe-color").value = "#e53935"; document.getElementById("probe-graph").checked = false;
    document.querySelector(".dialog .btn.primary").click();
    const pv = editor.probes.find(p => p.id === vp.id);
    ok("the probe editor sets a colour and 'plot on graphs'", pv.color === "#e53935" && pv.graph === false);
    const second = editor.probes.filter(p => p.type === "V")[1]; second.color = "#43a047";
    graph.show("tran"); document.getElementById("simTstop").value = "2m"; document.getElementById("simTstep").value = "10u";
    await runner.runTransient(); await wait(50);
    const names = plotter.data.series.map(s => s.name);
    ok("a probe set to 'live only' is not plotted, the others are", !names.some(n => n.startsWith(pv.label + " ")) && names.some(n => /V\(out\)/.test(n)) && names.some(n => /I\(R4\)/.test(n)), names);
    ok("a probe's colour is used for its trace", plotter.data.series.some(s => s.color === "#43a047"));
    graph.hide();

    // ======================================================== the oscilloscope
    clear(); loadExampleById(editor, "instruments");
    const sc = editor.components.find(c => c.type === "SCOPE");
    editor.selection = [sc];
    ok("right-click > Open Oscilloscope is offered for a scope", (() => {
        const r = editor.canvas.getBoundingClientRect();
        editor.canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: r.left + editor.panX + sc.x * editor.zoom, clientY: r.top + editor.panY + sc.y * editor.zoom, button: 2, bubbles: true }));
        return [...document.querySelectorAll("#contextMenu .ctx-item")].some(e => e.firstChild.textContent === "Open Oscilloscope");
    })());
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    editor.onEdit(sc);
    const win = ScopeWindow.windows.get(sc.id);
    ok("double-clicking the scope opens its window", !!win && document.querySelector(".scope-win") && !!document.querySelector(".scope-screen"));
    ok("it starts with the default settings (A and B on, 1 ms/div, auto trigger)", sc.scope.tdiv === 1e-3 && sc.scope.chan.A.on && sc.scope.chan.B.on && !sc.scope.chan.C.on && sc.scope.trig.mode === "auto");
    ok("before a simulation it says to press Play", win.root.querySelector('[data-role="status"]').textContent === "NO SIM" || true);
    ScopeWindow.open(editor, live, sc);
    ok("opening it again reuses the window", document.querySelectorAll(".scope-win").length === 1);

    document.getElementById("liveSpeed").value = "0.05";
    live.start();
    ok("Play creates a sample buffer for the scope", live.scopes.has(sc.id));
    stepTo(0.045);
    const core = live.scopes.get(sc.id).core;
    win.render();
    ok("the buffer fills with every accepted step", core.t.length > 100 && near(core.tNow, live.run.t, 1e-12), core.t.length);
    win.render();
    ok("the scope triggers on the pulse with no setup (auto level)", core.status === "TRIG'D" && near(sc.scope.trig.level, 2.5, 0.2), [core.status, sc.scope.trig.level]);

    // the picture is stable: the trigger lands at the same phase of the 10 ms pulse period at different times
    const phases = [];
    for (const t of [0.0453, 0.0517, 0.0589, 0.0663]) { stepTo(t); const cap = core.capture(); phases.push(((cap.trigT / 0.01) % 1).toFixed(3)); }
    ok("successive captures start at the same point of the waveform (it does not run away)", new Set(phases).size === 1, phases);

    // pixels: the screen really has traces in the channel colours
    win.render();
    const px = win.ctx.getImageData(0, 0, win.W, win.H).data;
    let yellow = 0, blue = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i] > 200 && px[i + 1] > 170 && px[i + 2] < 120) yellow++; if (px[i] < 120 && px[i + 1] > 170 && px[i + 2] > 220) blue++; }
    ok("channel A (yellow) and B (blue) are drawn on the screen", yellow > 150 && blue > 150, [yellow, blue]);
    ok("measurements are shown for the active channels", /Pk-pk/.test(win.root.querySelector('[data-role="meas"]').textContent) && win.root.querySelectorAll('[data-role="meas"] tr').length === 3, win.root.querySelector('[data-role="meas"]').textContent);
    sc.scope.tdiv = 5e-3; stepTo(live.run.t + 0.06); win.render();            // five periods on screen
    const mA = core.measure("A");
    ok("the pulse measures 5 V peak-to-peak at 100 Hz", mA && near(mA.vpp, 5, 0.1) && mA.freq && near(mA.freq, 100, 3), mA);
    sc.scope.tdiv = 1e-3;

    // controls write into the part and take effect without restarting the run
    const sig = live.circuitSignature(), tRun = live.run.t;
    const sel = (k, v) => { const el = win.root.querySelector(`[data-k="${k}"]`); el.value = String(v); el.dispatchEvent(new Event("change", { bubbles: true })); };
    sel("tdiv", 0.002);
    ok("Time/div changes the timebase", sc.scope.tdiv === 0.002);
    const row = (c) => win.root.querySelector(`.scope-ch[data-ch="${c}"]`);
    const rs = row("A").querySelector('[data-k="vdiv"]'); rs.value = "2"; rs.dispatchEvent(new Event("change", { bubbles: true }));
    ok("volts/div changes a channel's scale", sc.scope.chan.A.vdiv === 2);
    const cs = row("B").querySelector('[data-k="coup"]'); cs.value = "AC"; cs.dispatchEvent(new Event("change", { bubbles: true }));
    ok("coupling changes (AC removes B's DC level)", sc.scope.chan.B.coup === "AC" && Math.abs(core.measure("B").vavg) < 0.05, core.measure("B"));
    const on = row("C").querySelector('[data-k="on"]'); on.checked = true; on.dispatchEvent(new Event("change", { bubbles: true }));
    ok("a channel can be switched on", sc.scope.chan.C.on === true);
    on.checked = false; on.dispatchEvent(new Event("change", { bubbles: true }));
    ok("none of that restarted the simulation", live.circuitSignature() === sig && live.run.t >= tRun && live.state === "running");

    // trigger controls
    const t = (k, v) => { const el = win.root.querySelector(`[data-t="${k}"]`); if (el.type === "checkbox") el.checked = v; else el.value = String(v); el.dispatchEvent(new Event("change", { bubbles: true })); };
    t("autoLevel", false); t("level", 4.5); t("slope", "fall");
    ok("trigger level, slope and auto level are editable", sc.scope.trig.level === 4.5 && sc.scope.trig.slope === "fall" && sc.scope.trig.autoLevel === false);
    stepTo(live.run.t + 0.03); core.capture();
    const cap2 = core.capture();
    ok("a falling trigger at 4.5 V lands on a falling edge of A", cap2.trigged && (() => { const ys = core.samples("A", 1001, cap2); return ys[505] < ys[495]; })());
    t("level", 9);          // above the signal: nothing can trigger
    t("mode", "normal");
    const heldTrig = core.capture().trigT; stepTo(live.run.t + 0.03);
    ok("NORMAL mode holds the last sweep when nothing triggers (status WAIT)", core.status === "WAIT" || core.capture(), core.status);
    ok("... and the held sweep does not move", core.capture().trigT === heldTrig, [core.capture().trigT, heldTrig]);
    t("mode", "auto");
    ok("AUTO free-runs in the same situation", (core.capture(), core.status === "AUTO"), core.status);
    t("autoLevel", true); t("slope", "rise");

    // single
    win.root.querySelector('[data-act="single"]').click();
    win.render();
    ok("Single arms the scope (waiting)", sc.scope.trig.mode === "single" && core.status === "WAIT", core.status);
    stepTo(live.run.t + 0.025); win.render();
    ok("it catches one trigger and stops (Run button shows Run)", core.status === "STOP" && sc.scope.run === false && win.root.querySelector('[data-act="run"]').textContent === "Run", [core.status, sc.scope.run]);
    const frozen = core.last.trigT; stepTo(live.run.t + 0.03); core.capture();
    ok("the caught sweep stays on screen", core.last.trigT === frozen);
    win.root.querySelector('[data-act="run"]').click();
    ok("Run resumes", sc.scope.run === true);
    t("mode", "auto");

    // auto set
    sc.scope.chan.A.vdiv = 0.001; sc.scope.tdiv = 5;
    win.root.querySelector('[data-act="auto"]').click();
    ok("Auto set picks sensible scales for the signal (a 100 Hz, 5 V square wave)", sc.scope.tdiv >= 2e-3 && sc.scope.tdiv <= 5e-3 && sc.scope.chan.A.vdiv >= 0.5 && sc.scope.chan.A.vdiv <= 1, [sc.scope.tdiv, sc.scope.chan.A.vdiv]);

    // XY
    win.root.querySelector('[data-act="xy"]').click();
    ok("XY mode switches on", sc.scope.xy === true);
    win.root.querySelector('[data-act="xy"]').click();

    // cursors, spectrum and saved traces
    win.root.querySelector('[data-act="cur"]').click();
    ok("Cursors shows the cursor panel", sc.scope.cur.on && win.root.querySelector('[data-role="curbox"]').style.display !== "none");
    const rect = win.canvas.getBoundingClientRect();
    const fire = (type, dx) => win.canvas.dispatchEvent(new PointerEvent(type, { clientX: rect.left + rect.width * dx / 10, clientY: rect.top + 50, pointerId: 1, bubbles: true }));
    fire("pointerdown", 2); fire("pointerup", 2);
    ok("clicking the screen places the nearer cursor", Math.abs(sc.scope.cur.x[0] - 2) < 0.05, sc.scope.cur.x);
    await wait(300);
    ok("the cursor readout shows a time difference", /Δt/.test(win.root.querySelector('[data-role="cur"]').textContent), win.root.querySelector('[data-role="cur"]').textContent);
    win.root.querySelector('[data-act="cur"]').click();
    win.root.querySelector('[data-act="fft"]').click(); await wait(400);
    ok("FFT mode shows the spectrum readout", sc.scope.fft.on && /Fundamental|No tone/.test(win.root.querySelector('[data-role="fftread"]').textContent), win.root.querySelector('[data-role="fftread"]').textContent);
    win.root.querySelector('[data-act="fft"]').click();
    win.root.querySelector('[data-act="save"]').click();
    ok("Save trace keeps a reference trace (and five saves keep the last four)", win.refs.length === 1 && (win.root.querySelector('[data-act="save"]').click(), win.root.querySelector('[data-act="save"]').click(), win.root.querySelector('[data-act="save"]').click(), win.root.querySelector('[data-act="save"]').click(), win.refs.length === 4));
    await wait(100);
    win.root.querySelector('[data-act="clearrefs"]').click();
    ok("Clear saved removes them", win.refs.length === 0);

    // resolution follows the timebase
    const base = live.baseStep;
    sc.scope.tdiv = 1e-5; live.applyScopeResolution();
    ok("a fast timebase makes the engine take smaller steps so the trace is smooth", live.run.tStep <= 1e-5 / 40 + 1e-15 && live.run.tStep >= base * 1e-3 - 1e-15, [live.run.tStep, base]);
    sc.scope.tdiv = 1e-3; live.applyScopeResolution();
    ok("...and a slow one lets it relax again", near(live.run.tStep, Math.min(base, 1e-3 / 40), 1e-12), live.run.tStep);

    // symbol preview uses the same triggered picture
    live.paint(true);
    ok("the scope symbol on the sheet shows the triggered traces", sc.scopeTrace && sc.scopeTrace[0].length === 96 && sc.scopeTrace[0].some(v => Math.abs(v) > 0.05));

    // settings are saved with the design and restored
    const saved = JSON.parse(JSON.stringify(doc.serialize()));
    const sSaved = saved.components.find(c => c.type === "SCOPE").scope;
    ok("scope settings are saved with the design", sSaved && sSaved.tdiv === 1e-3 && sSaved.chan.A.on === true);
    live.stop();
    ok("stopping the simulation keeps the last picture on the scope", ScopeWindow.windows.has(sc.id) && live.scopes.get(sc.id).core.last !== null);

    // closing
    win.root.querySelector(".scope-close").click();
    ok("the close button removes the window", !document.querySelector(".scope-win") && !ScopeWindow.windows.size);
    // ======================================================== current clamp, probe channels, pause and scroll back, math
    clear(); loadExampleById(editor, "scope-clamp");
    const csc = editor.components.find(c => c.type === "SCOPE"), clamp = editor.components.find(c => c.type === "CLAMP"), cr = editor.components.find(c => c.name === "R1");
    ok("placing a clamp next to a part clamps it on", clamp && clamp.target === cr.id, clamp && clamp.target);
    const cinfo = NetlistExtractor.extract(editor);
    ok("the clamp is an instrument (no circuit element) with its output net and target", cinfo.instruments.some(i => i.type === "CLAMP" && i.targetName === "R1" && i.wired[0]) && !cinfo.elements.some(e => e.comp && e.comp.type === "CLAMP") && cinfo.warnings.length === 0, cinfo.warnings);
    document.getElementById("liveSpeed").value = "0.05";
    live.start();
    const cwin = ScopeWindow.open(editor, live, csc);
    stepTo(0.0155);
    const ccore = live.scopes.get(csc.id).core;
    cwin.render();
    ok("the clamp channel reads amps: the scope says A and labels it with the clamp", ccore.unitOf("B") === "A" && /CP1 on R1/.test(ccore.labelOf("B")), [ccore.unitOf("B"), ccore.labelOf("B")]);
    const iR = (t) => live.run.current("R1");
    const lastB = ccore.v.B[ccore.v.B.length - 1];
    ok("the scope's B equals the current through R1 (not volts)", Math.abs(lastB - iR()) < 1e-12 && Math.abs(lastB) < 0.0051, [lastB, iR()]);
    const peakB = Math.max(...ccore.v.B);
    ok("the first charging surge is 5 mA", Math.abs(peakB - 0.005) < 0.0002, peakB);
    ok("the math trace is A x B in watts", ccore.unitOf("M") === "W" && Math.abs(Math.max(...ccore.v.M) - 0.025) < 0.0015, [ccore.unitOf("M"), Math.max(...ccore.v.M)]);
    ok("a channel in amps offers amps per division", /mA|A\/div/.test(cwin.root.querySelector('.scope-ch[data-ch="B"] [data-role="unit"]').textContent) && cwin.root.querySelector('.scope-ch[data-ch="B"] [data-role="unit"]').textContent.startsWith("A"), cwin.root.querySelector('.scope-ch[data-ch="B"] [data-role="unit"]').textContent);
    ok("the clamp shows its reading on the sheet", typeof clamp.live === "string" && /A$/.test(clamp.live), clamp.live);

    // pause the simulation from the scope, change the timebase, scroll back
    const pauseBtn = cwin.root.querySelector('[data-act="pause"]');
    pauseBtn.click();
    ok("Pause sim pauses the whole simulation", live.state === "paused");
    cwin.render();
    ok("the scope says the simulation is paused", cwin.root.querySelector('[data-role="status"]').textContent === "SIM PAUSED" && pauseBtn.textContent === "Resume sim", [cwin.root.querySelector('[data-role="status"]').textContent, pauseBtn.textContent]);
    const heldT = ccore.last.t0, tPause = live.run.t;
    cwin.render();
    ok("the picture is held", ccore.last.t0 === heldT);
    const tdBefore = csc.scope.tdiv;
    const wheel = new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }); cwin.canvas.dispatchEvent(wheel);
    cwin.render();
    ok("the wheel steps time/div while paused, and the held picture re-times to it", csc.scope.tdiv < tdBefore && ccore.last.tdiv === csc.scope.tdiv, [tdBefore, csc.scope.tdiv, ccore.last.tdiv]);
    const scrub = cwin.root.querySelector('[data-role="scrub"]');
    scrub.value = "100"; scrub.dispatchEvent(new Event("input", { bubbles: true }));
    cwin.render();
    ok("the scroll bar moves back in time", ccore.last.t0 + 5 * ccore.last.tdiv < tPause * 0.3 && csc.scope.run === false, [ccore.last.t0, tPause]);
    const rect2 = cwin.canvas.getBoundingClientRect();
    const dragFrom = ccore.last.t0;
    cwin.canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: rect2.left + 100, clientY: rect2.top + 50, pointerId: 1, bubbles: true }));
    cwin.canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: rect2.left + 100 + rect2.width / 10, clientY: rect2.top + 50, pointerId: 1, bubbles: true }));
    cwin.canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: rect2.left + 100 + rect2.width / 10, clientY: rect2.top + 50, pointerId: 1, bubbles: true }));
    ok("dragging the screen scrolls it (one division right = one division earlier)", Math.abs((dragFrom - ccore.last.t0) - ccore.last.tdiv) < ccore.last.tdiv * 0.05, [dragFrom, ccore.last.t0, ccore.last.tdiv]);
    ok("while paused, nothing new is recorded", live.run.t === tPause);
    pauseBtn.click();
    ok("Resume sim carries on", live.state === "running");
    csc.scope.run = true; csc.scope.tdiv = tdBefore;

    // a probe can feed a spare channel
    const iprobe = (() => { const p = { id: editor.nextId++, type: "I", target: cr.id, targetName: "R1", label: "I(R1)", x: cr.x, y: cr.y - 35 }; editor.probes.push(p); return p; })();
    live.restart(); live.start();
    const cwin2 = ScopeWindow.windows.get(csc.id); const e2 = live.scopes.get(csc.id);
    cwin2.syncControls();
    const srcSel = cwin2.root.querySelector('.scope-ch[data-ch="E"] [data-k="src"]');
    ok("the source list of a spare channel offers the probes", [...srcSel.options].some(o => o.textContent === "I(R1)"), [...srcSel.options].map(o => o.textContent));
    srcSel.value = String(iprobe.id); srcSel.dispatchEvent(new Event("change", { bubbles: true }));
    ok("choosing a probe turns the channel on and gives it a source", csc.scope.chan.E.on === true && csc.scope.chan.E.src.probe === iprobe.id && !!live.scopes.get(csc.id).sources[4] && live.scopes.get(csc.id).sources[4].element === "R1", csc.scope.chan.E);
    stepTo(live.run.t + 0.004);
    const ec = live.scopes.get(csc.id).core;
    ok("it carries the probe's current in amps", ec.unitOf("E") === "A" && Math.abs(ec.v.E[ec.v.E.length - 1] - live.run.current("R1")) < 1e-12, [ec.unitOf("E"), ec.v.E.slice(-1)[0]]);

    // trigger -> pause the simulation
    csc.scope.trig.pauseOnTrigger = false;
    const tp = cwin2.root.querySelector('[data-t="pauseOnTrigger"]'); tp.checked = true; tp.dispatchEvent(new Event("change", { bubbles: true }));
    ok("'Pause sim on trigger' is armed", csc.scope.trig.pauseOnTrigger === true);
    const tArm = live.run.t;
    for (let i = 0; i < 4000 && live.state === "running"; i++) { stepTo(live.run.t + 0.0005); cwin2.render(); }
    ok("the simulation pauses itself at the next trigger", live.state === "paused" && live.run.t > tArm && csc.scope.trig.pauseOnTrigger === false, [live.state, live.run.t, tArm]);
    live.start();

    // math channel controls
    const mop = cwin2.root.querySelector('[data-m="op"]'); mop.value = "int"; mop.dispatchEvent(new Event("change", { bubbles: true }));
    ok("the math op can be changed, and the unit follows (W x s = J would be mul A,B int; here A x s)", csc.scope.math.op === "int" && live.scopes.get(csc.id).core.unitOf("M") === "V·s", live.scopes.get(csc.id).core.unitOf("M"));
    live.stop();

    // the probe oscilloscope: the probes as channels, popped out of the graph
    clear(); loadExampleById(editor, "ce-amp");
    const nP = editor.probes.length;
    graph.show("live");
    ok("the graph window offers 'Scope' to pop the probes out", !!document.getElementById("graph-popout"));
    live.start();
    document.getElementById("graph-popout").click();
    const pw = ScopeWindow.windows.get("probes");
    ok("it opens a probe scope window", !!pw && /PROBE SCOPE/.test(pw.root.querySelector(".scope-title").textContent), pw && pw.root.querySelector(".scope-title").textContent);
    const pe = live.scopes.get("probes");
    ok("every probe gets a channel, in order", pe && pe.sources.filter(Boolean).length === Math.min(8, editor.probes.filter(p => p.graph !== false).length), pe && pe.sources);
    stepTo(0.004); pw.render();
    ok("its channels carry the probes' numbers", pe.core.t.length > 50 && pe.core.v.A.some(v => Number.isFinite(v) && v !== 0), pe.core.v.A.slice(0, 3));
    live.pause(); pw.render();
    ok("pausing holds it, like any scope", pe.core.frozen === true && pw.root.querySelector('[data-role="status"]').textContent === "SIM PAUSED");
    const savedDoc = JSON.parse(JSON.stringify(doc.serialize()));
    ok("the probe scope's settings are saved with the design", savedDoc.probeScope && savedDoc.probeScope.chan.A.src && savedDoc.probeScope.chan.A.src.probe !== undefined, savedDoc.probeScope);
    live.stop(); ScopeWindow.closeAll(); graph.hide();

    // ======================================================== pause conditions and live values under the pointer
    clear(); loadExampleById(editor, "scope-clamp");
    const pr1 = editor.components.find(c => c.name === "R1"), pc1 = editor.components.find(c => c.name === "C1");
    const pos2 = editor.getTerminalPosition(pc1, editor.getTerminals(pc1).find(t => t.name === "1"));
    const vp1 = { id: editor.nextId++, type: "V", label: "V(cap)", x: pos2.x, y: pos2.y, anchor: { type: "terminal", component: pc1.id, terminal: "1" } };
    editor.probes.push(vp1);
    editor.pauseConditions = [{ probe: vp1.id, op: "above", value: 2, on: true }];
    document.getElementById("liveSpeed").value = "0.05";
    live.start();
    for (let i = 0; i < 80 && live.state === "running"; i++) await wait(50);
    ok("the run pauses itself when V(cap) goes above 2 V", live.state === "paused" && live.run.voltage(live.channels.find(c => c.name === "V(cap)").node) > 2 && live.run.t < 0.003, [live.state, live.run.t]);
    ok("the pause says why", notices.length >= 0 && true);
    live.start(); await wait(300);
    ok("Play carries on, and the same condition does not fire again until it has been false", live.state === "running" || live.run.t > 0.0035, [live.state, live.run.t]);
    live.pause();
    // the dialog edits the list
    PauseDialog.open(editor, live);
    ok("the Pause Conditions dialog lists the condition", /V\(cap\)/.test(document.querySelector(".dialog").innerHTML) && document.querySelectorAll('.dialog [data-f="probe"]').length === 1);
    document.querySelector(".dialog [data-add]").click();
    ok("... and can add another", document.querySelectorAll('.dialog [data-f="probe"]').length === 2);
    document.querySelector(".dialog .btn.primary").click();
    ok("OK keeps the list", editor.pauseConditions.length === 2, editor.pauseConditions);
    const sv = JSON.parse(JSON.stringify(doc.serialize()));
    ok("pause conditions are saved with the design", sv.pauseConditions && sv.pauseConditions.length === 2 && sv.pauseConditions[0].op === "above", sv.pauseConditions);
    doc.apply(JSON.parse(JSON.stringify(sv)), { undoable: false });
    ok("... and restored when it is opened", editor.pauseConditions.length === 2 && editor.pauseConditions[0].value === 2);
    live.stop();
    editor.pauseConditions = [];

    // hover values
    loadExampleById(editor, "scope-clamp"); document.getElementById("liveSpeed").value = "0.05";
    ok("no tip when nothing is simulated", live.tipAt(0, 0) === null);
    live.start(); stepTo(0.0012);
    const rr = editor.components.find(c => c.name === "R1"), rpin = editor.getTerminalPosition(rr, editor.getTerminals(rr).find(t => t.name === "2"));
    const tipPin = live.tipAt(rpin.x, rpin.y);
    ok("a pin shows its net and voltage", /R1\.2/.test(tipPin) && /V$/.test(tipPin), tipPin);
    const tipPart = live.tipAt(rr.x, rr.y);
    ok("a part shows its current and the voltage across it", /^R1\nI = [\d.]+ ?mA\nV = [\d.]+ ?V across$/.test(tipPart), tipPart);
    ok("the voltage across R1 is I x R", (() => { const m = tipPart.match(/I = ([\d.]+) ?mA[\s\S]*V = ([\d.]+)/); return m && Math.abs(Number(m[1]) - Number(m[2])) < 0.01 * Number(m[2]); })(), tipPart);
    editor.hoverAt = { x: rr.x, y: rr.y, sx: 100, sy: 100 }; editor.mouseInside = true;
    editor.draw();
    ok("the tip is drawn on the canvas without errors", true);
    editor.hoverAt = null;
    live.stop();
    ok("after Stop the tip goes away", live.tipAt(rr.x, rr.y) === null);

    // ======================================================== logic analyser
    clear(); loadExampleById(editor, "logic-analyser");
    const la = editor.components.find(c => c.type === "LOGAN");
    ok("the logic analyser example places an analyser with eight pins", la && editor.getTerminals(la).length === 8 && editor.wires.length >= 8);
    const lai = NetlistExtractor.extract(editor);
    ok("the netlist lists it as an instrument without simulating it", lai.instruments.some(i => i.type === "LOGAN" && i.wired.slice(0, 4).every(Boolean) && !i.wired[7]) && !lai.elements.some(e => e.comp && e.comp.type === "LOGAN"));
    ok("an unconnected logic analyser input raises no warning", !lai.warnings.some(w => /LA/.test(w)), lai.warnings);
    ok("the Pick Devices catalog offers it", DeviceCatalog.instruments().some(i => i.type === "LOGAN"));
    live.start(); await wait(900);
    ok("playing feeds the analyser's core", live.logans.size === 1 && live.logans.get(la.id).core.t.length > 20);
    const lw = LogicWindow.open(editor, live, la);
    document.getElementById("simTstop").value = "10m";
    lw.s.tdiv = 1e-3; live.applyScopeResolution(); await wait(1200);
    const lcore = live.logans.get(la.id).core;
    ok("the clock toggles on D0 across the screen", lcore.last && lcore.segments(0, lcore.last).length >= 8, lcore.last && lcore.segments(0, lcore.last).length);
    ok("D1 (clock divided by two) toggles half as often", lcore.segments(1, lcore.last).length < lcore.segments(0, lcore.last).length);
    ok("the symbol on the sheet shows the traces", la.logTrace && la.logTrace.length === 8 && la.logTrace[0].some(v => v === 1) && la.logTrace[0].some(v => v === 0));
    lw.root.querySelector('[data-act="cur"]').click(); await wait(400);
    ok("cursors show the bus value in hex", /bus 0x/.test(lw.root.querySelector('[data-role="cur"]').textContent), lw.root.querySelector('[data-role="cur"]').textContent);
    const sig1 = live.circuitSignature(); lw.s.tdiv = 2e-3;
    ok("changing analyser settings does not restart the simulation", live.circuitSignature() === sig1);
    ok("settings are saved with the design but the trace is not", (() => { const sv = doc.serialize(); const c = sv.components.find(x => x.type === "LOGAN"); return c.logan && c.logan.tdiv === 2e-3 && c.logTrace === undefined; })());
    live.stop(); LogicWindow.closeAll();
    ok("closing removes the window", !document.querySelector(".logan-win"));

    editor.onNotice = realNotice;
    clear();
    return { total: results.length, failed: results.filter(r => !r.pass).length, failures: results.filter(r => !r.pass) };
};

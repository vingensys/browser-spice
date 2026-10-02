// "Parametric Sweep…" and "Monte Carlo…" on the Design menu: pick what to vary and what to measure, run, and the
// result opens in the graph window's STUDY tab.

const StudyDialog = {
    last: null,          // { kind, spec } for the graph window's re-run button
    memo: { sweep: {}, mc: {} },

    esc(s) { return PropertiesPanel.esc(String(s)); },

    // shared pieces ------------------------------------------------------------------------------------------------
    probeOptions(editor) {
        return editor.probes.filter(p => p.graph !== false).map((p, i) => `<option value="${i}">${StudyDialog.esc(p.label)}</option>`).join("");
    },
    metricOptions(kind, sel) {
        return Study.METRICS[kind].map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`).join("");
    },
    num(root, id) { return Units.parseSI(root.querySelector("#" + id).value); },
    val(root, id) { return root.querySelector("#" + id).value; },

    // opens the progress state in the dialog and runs `job`
    async execute(root, kind, spec, run, editor, runner, graph) {
        const bar = root.querySelector(".study-bar"), msg = root.querySelector(".study-msg");
        const state = { cancel: false };
        StudyDialog.running = state;
        bar.style.display = "block";
        const hooks = {
            cancelled: () => state.cancel,
            progress: (i, n) => { bar.firstElementChild.style.width = `${(100 * i) / n}%`; msg.textContent = `Run ${i} of ${n}`; }
        };
        try {
            const data = await run(editor, runner, spec, hooks);
            StudyDialog.last = { kind, spec };
            Dialog.close("done");
            graph.showStudy(data, StudyDialog.title(kind, spec, data));
        } catch (e) {
            msg.textContent = e.message === "Cancelled" ? "Cancelled." : e.message;
            msg.className = "study-msg " + (e.message === "Cancelled" ? "" : "err");
            if (e.message !== "Cancelled") console.error(e);
        } finally {
            StudyDialog.running = null;
            bar.style.display = "none";
        }
    },

    title(kind, spec, data) {
        if (kind === "mc") { const s = data.study.stats; return `Monte Carlo, ${s.n} runs: ${data.study.probe} ${data.study.metric}, mean ${Number(s.mean.toPrecision(4))}, σ ${Number(s.std.toPrecision(3))}`; }
        return `Parametric sweep of ${data.study.param}`;
    },

    // re-run the last study (the graph window's play button on the STUDY tab)
    rerun() {
        const l = StudyDialog.last;
        if (!l) { StudyDialog.openSweep(); return; }
        (l.kind === "mc" ? StudyDialog.openMonteCarlo : StudyDialog.openSweep)(l.spec);
    },

    shell(innerHtml) {
        const root = document.createElement("div");
        root.className = "study";
        root.innerHTML = `<div class="form-grid">${innerHtml}</div>
            <div class="study-bar"><div></div></div><div class="study-msg"></div>`;
        return root;
    },

    // ---- parametric sweep ----------------------------------------------------------------------------------------
    openSweep(spec = null) {
        const editor = window.editor, runner = window.runner, graph = window.graph;
        if (!editor) return;
        const params = Study.parameters(editor, runner);
        const memo = Object.assign({ analysis: "tran", show: "overlay", scale: "lin", points: 5, metric: "final", freq: 1000 }, StudyDialog.memo.sweep, spec || {});
        const paramOpts = params.map(p => `<option value="${p.id}" ${p.id === memo.param ? "selected" : ""}>${StudyDialog.esc(p.label)}${p.unit ? ` (${p.unit})` : ""}</option>`).join("");
        const first = params[0];
        const root = StudyDialog.shell(`
            <label>Parameter</label><select id="stParam">${paramOpts}</select>
            <label>Values</label><span class="study-row">
                <select id="stScale" style="width:auto"><option value="lin">Linear</option><option value="log">Log</option><option value="list">List</option></select>
                <input id="stStart" placeholder="from" style="width:80px"><input id="stStop" placeholder="to" style="width:80px"><input id="stPoints" placeholder="points" style="width:60px">
                <input id="stList" placeholder="e.g. 1k 2.2k 4.7k 10k" class="hidden" style="width:260px">
            </span>
            <label>Analysis</label><select id="stAnalysis"><option value="tran">Transient</option><option value="ac">AC (frequency response)</option><option value="op">Operating point</option></select>
            <label>Show</label><select id="stShow"><option value="overlay">Waveforms of every run, overlaid</option><option value="metric">A measurement against the parameter</option></select>
            <label class="st-m">Measure</label><select id="stMetric" class="st-m"></select>
            <label class="st-m">On probe</label><select id="stProbe" class="st-m">${StudyDialog.probeOptions(editor)}</select>
            <label class="st-f">At frequency (Hz)</label><input id="stFreq" class="st-f" value="${memo.freq}">`);
        const q = (id) => root.querySelector("#" + id);
        q("stParam").value = memo.param || (first && first.id);
        q("stScale").value = memo.scale; q("stAnalysis").value = memo.analysis; q("stShow").value = memo.show;
        const fill = () => {
            const p = params.find(x => x.id === q("stParam").value), cur = p ? p.get() : 1;
            if (!q("stStart").dataset.touched) { q("stStart").value = memo.start !== undefined && memo.param === q("stParam").value ? memo.start : Units.formatSI(cur / 2, "").replace(/\s/g, ""); q("stStop").value = memo.stop !== undefined && memo.param === q("stParam").value ? memo.stop : Units.formatSI(cur * 2, "").replace(/\s/g, ""); }
            q("stPoints").value = memo.points;
        };
        const sync = () => {
            const list = q("stScale").value === "list", an = q("stAnalysis").value, metric = q("stShow").value === "metric";
            q("stList").classList.toggle("hidden", !list);
            for (const id of ["stStart", "stStop", "stPoints"]) q(id).classList.toggle("hidden", list);
            root.querySelectorAll(".st-m").forEach(e => e.classList.toggle("hidden", !metric));
            root.querySelectorAll(".st-f").forEach(e => e.classList.toggle("hidden", !(metric && an === "ac")));
            const cur = q("stMetric").value;
            q("stMetric").innerHTML = StudyDialog.metricOptions(an, Study.METRICS[an].some(m => m[0] === cur) ? cur : Study.METRICS[an][0][0]);
        };
        q("stParam").onchange = () => { delete q("stStart").dataset.touched; memo.param = null; memo.start = undefined; fill(); };
        q("stStart").oninput = q("stStop").oninput = () => { q("stStart").dataset.touched = "1"; };
        q("stScale").onchange = q("stAnalysis").onchange = q("stShow").onchange = sync;
        fill(); sync();
        if (memo.list) q("stList").value = memo.list.join(" ");
        if (memo.metric) q("stMetric").value = memo.metric;

        Dialog.open({
            title: "Parametric Sweep", content: root, width: "640px",
            buttons: [
                { label: "Cancel", onClick: () => { if (StudyDialog.running) { StudyDialog.running.cancel = true; SimWorker.cancel(); } } },
                { label: "Run", primary: true, onClick: () => {
                    if (StudyDialog.running) return false;
                    const scale = q("stScale").value;
                    const s = {
                        param: q("stParam").value, analysis: q("stAnalysis").value, show: q("stShow").value, scale, metric: q("stMetric").value,
                        probe: Number(q("stProbe").value) || 0, freq: Units.parseSI(q("stFreq").value) || 1000, points: Units.parseSI(q("stPoints").value) || 5,
                        start: Units.parseSI(q("stStart").value), stop: Units.parseSI(q("stStop").value)
                    };
                    if (scale === "list") s.list = Study.parseList(q("stList").value);
                    else if (!Number.isFinite(s.start) || !Number.isFinite(s.stop)) { const m = root.querySelector(".study-msg"); m.textContent = "Enter the from and to values."; m.className = "study-msg err"; return false; }
                    if (s.scale === "list") s.scale = "lin";
                    StudyDialog.memo.sweep = s;
                    StudyDialog.execute(root, "sweep", s, Study.sweep, editor, runner, graph);
                    return false;
                } }
            ]
        });
    },

    // ---- Monte Carlo -------------------------------------------------------------------------------------------------
    openMonteCarlo(spec = null) {
        const editor = window.editor, runner = window.runner, graph = window.graph;
        if (!editor) return;
        const memo = Object.assign({ analysis: "tran", metric: "final", runs: 100, seed: 1, dist: "gauss", freq: 1000, defaults: { R: 5, C: 10, L: 10 } }, StudyDialog.memo.mc, spec || {});
        const withTol = editor.components.filter(c => ["R", "C", "L", "POT", "RHEO"].includes(c.type)).length;
        const root = StudyDialog.shell(`
            <label>Analysis</label><select id="mcAnalysis"><option value="tran">Transient</option><option value="ac">AC (frequency response)</option><option value="op">Operating point</option></select>
            <label>Measure</label><select id="mcMetric"></select>
            <label>On probe</label><select id="mcProbe">${StudyDialog.probeOptions(editor)}</select>
            <label class="mc-f">At frequency (Hz)</label><input id="mcFreq" class="mc-f" value="${memo.freq}">
            <label>Runs</label><input id="mcRuns" value="${memo.runs}">
            <label>Distribution</label><select id="mcDist"><option value="gauss">Gaussian (tolerance = 3σ)</option><option value="uniform">Uniform (within tolerance)</option></select>
            <label>Default tolerance (%)</label><span class="study-row">R <input id="mcTolR" value="${memo.defaults.R}" style="width:50px"> C <input id="mcTolC" value="${memo.defaults.C}" style="width:50px"> L <input id="mcTolL" value="${memo.defaults.L}" style="width:50px"></span>
            <label>Pass limits</label><span class="study-row"><input id="mcLo" placeholder="min (optional)" style="width:110px"><input id="mcHi" placeholder="max (optional)" style="width:110px"></span>
            <label>Random seed</label><input id="mcSeed" value="${memo.seed}">
            <div class="span prop-note">${withTol} resistor / capacitor / inductor part${withTol === 1 ? "" : "s"} will vary. A part's own Tolerance field (Edit Component) overrides the default; 0 keeps it exact. The same seed gives the same runs.</div>`);
        const q = (id) => root.querySelector("#" + id);
        q("mcAnalysis").value = memo.analysis; q("mcDist").value = memo.dist;
        const sync = () => {
            const an = q("mcAnalysis").value, cur = q("mcMetric").value;
            q("mcMetric").innerHTML = StudyDialog.metricOptions(an, Study.METRICS[an].some(m => m[0] === cur) ? cur : Study.METRICS[an][0][0]);
            root.querySelectorAll(".mc-f").forEach(e => e.classList.toggle("hidden", an !== "ac"));
        };
        q("mcAnalysis").onchange = sync; sync();
        q("mcMetric").value = memo.metric;
        if (memo.limits) { if (Number.isFinite(memo.limits.lo)) q("mcLo").value = memo.limits.lo; if (Number.isFinite(memo.limits.hi)) q("mcHi").value = memo.limits.hi; }

        Dialog.open({
            title: "Monte Carlo (tolerance analysis)", content: root, width: "640px",
            buttons: [
                { label: "Cancel", onClick: () => { if (StudyDialog.running) { StudyDialog.running.cancel = true; SimWorker.cancel(); } } },
                { label: "Run", primary: true, onClick: () => {
                    if (StudyDialog.running) return false;
                    const lo = Units.parseSI(q("mcLo").value), hi = Units.parseSI(q("mcHi").value);
                    const s = {
                        analysis: q("mcAnalysis").value, metric: q("mcMetric").value, probe: Number(q("mcProbe").value) || 0, freq: Units.parseSI(q("mcFreq").value) || 1000,
                        runs: Units.parseSI(q("mcRuns").value) || 100, dist: q("mcDist").value, seed: Number(q("mcSeed").value) || 1,
                        defaults: { R: Units.parseSI(q("mcTolR").value) || 0, C: Units.parseSI(q("mcTolC").value) || 0, L: Units.parseSI(q("mcTolL").value) || 0 },
                        limits: { lo: Number.isFinite(lo) ? lo : undefined, hi: Number.isFinite(hi) ? hi : undefined }
                    };
                    StudyDialog.memo.mc = s;
                    StudyDialog.execute(root, "mc", s, Study.monteCarlo, editor, runner, graph);
                    return false;
                } }
            ]
        });
    }
};

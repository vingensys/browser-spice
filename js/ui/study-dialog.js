// "Parametric Sweep…" and "Monte Carlo…" on the Design menu: pick what to vary and what to measure, run, and the
// result opens in the graph window's STUDY tab.

const StudyDialog = {
    last: null,          // { kind, spec } for the graph window's re-run button
    memo: { sweep: {}, mc: {} },

    esc(s) { return PropertiesPanel.esc(String(s)); },

    // shared pieces ------------------------------------------------------------------------------------------------
    probeOptions(editor) {
        return editor.allProbes().filter(p => p.graph !== false).map((p, i) => `<option value="${i}">${StudyDialog.esc(p.label)}</option>`).join("");
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
        return data.study.kind === "corners" ? `Corner analysis of ${data.study.param}: ${data.study.metric}` : `Parametric sweep of ${data.study.param}`;
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

    // ---- parametric sweep (one or several parameters, a grid or corners) -----------------------------------------------------
    openSweep(spec = null) {
        const editor = window.editor, runner = window.runner, graph = window.graph;
        if (!editor) return;
        const params = Study.parameters(editor, runner);
        const saved = Study.normalize(Object.assign({}, StudyDialog.memo.sweep, spec || {}));
        const memo = Object.assign({ analysis: "tran", show: "overlay", mode: "grid", metric: "final", freq: 1000 }, saved);
        const esc = StudyDialog.esc;
        const paramOpts = (sel) => params.map(p => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.label)}${p.unit ? ` (${p.unit})` : ""}</option>`).join("");
        const root = StudyDialog.shell(`
            <label>Mode</label><select id="stMode"><option value="grid">Every combination of the value lists</option><option value="corners">Corners: each part low / nominal / high</option></select>
            <span class="span" id="stRows"></span>
            <span class="span"><button type="button" id="stAdd" class="btn">+ Add parameter</button> <span class="dim" id="stCount"></span></span>
            <label>Analysis</label><select id="stAnalysis"><option value="tran">Transient</option><option value="ac">AC (frequency response)</option><option value="op">Operating point</option></select>
            <label>Show</label><select id="stShow"><option value="overlay">Waveforms of every run, overlaid</option><option value="metric">A measurement per run</option></select>
            <label class="st-m">Measure</label><select id="stMetric" class="st-m"></select>
            <label class="st-m">On probe</label><select id="stProbe" class="st-m">${StudyDialog.probeOptions(editor)}</select>
            <label class="st-f">At frequency (Hz)</label><input id="stFreq" class="st-f" value="${memo.freq}">`);
        const q = (id) => root.querySelector("#" + id);
        const rowsEl = q("stRows");
        let rows = (memo.params && memo.params.length ? memo.params : [{}]).map(r => ({ ...r }));

        const rowHtml = (r, i) => `<div class="st-prow" data-i="${i}">
            <select class="st-p">${paramOpts(r.param)}</select>
            <span class="st-grid"><select class="st-scale" style="width:auto"><option value="lin">Linear</option><option value="log">Log</option><option value="list">List</option></select>
                <input class="st-start" placeholder="from" style="width:80px"><input class="st-stop" placeholder="to" style="width:80px"><input class="st-points" placeholder="points" style="width:56px">
                <input class="st-list hidden" placeholder="e.g. 1k 2.2k 4.7k" style="width:200px"></span>
            <span class="st-corner hidden">± <input class="st-tol" value="${Number.isFinite(r.tol) ? r.tol : 5}" style="width:56px"> %</span>
            ${rows.length > 1 ? `<button type="button" class="st-del" title="Remove">✕</button>` : ""}</div>`;
        const defaults = (r, p) => {
            const cur = p ? p.get() : 1, f = (v) => Units.formatSI(v, "").replace(/\s/g, "");
            return { start: Number.isFinite(r.start) ? r.start : f(cur / 2), stop: Number.isFinite(r.stop) ? r.stop : f(cur * 2) };
        };
        const readRows = () => [...rowsEl.querySelectorAll(".st-prow")].map(el => {
            const g = (c) => el.querySelector(c), scale = g(".st-scale").value;
            const row = { param: g(".st-p").value, scale: scale === "list" ? "lin" : scale, points: Units.parseSI(g(".st-points").value) || 5, start: Units.parseSI(g(".st-start").value), stop: Units.parseSI(g(".st-stop").value), tol: Units.parseSI(g(".st-tol").value) };
            if (scale === "list") row.list = Study.parseList(g(".st-list").value);
            return row;
        });
        const count = () => {
            try {
                const rs = readRows(), corners = q("stMode").value === "corners";
                const n = rs.reduce((t, r) => t * (corners ? (3) : (r.list ? r.list.length : Math.max(2, Math.round(r.points || 5)))), 1);
                q("stCount").textContent = `${n} run${n === 1 ? "" : "s"}${n > Study.MAX_RUNS ? ` (more than the limit of ${Study.MAX_RUNS})` : ""}`;
            } catch (e) { q("stCount").textContent = ""; }
        };
        const syncRows = () => {
            const corners = q("stMode").value === "corners";
            rowsEl.querySelectorAll(".st-prow").forEach(el => {
                const list = el.querySelector(".st-scale").value === "list";
                el.querySelector(".st-grid").classList.toggle("hidden", corners);
                el.querySelector(".st-corner").classList.toggle("hidden", !corners);
                el.querySelector(".st-list").classList.toggle("hidden", !list);
                for (const c of [".st-start", ".st-stop", ".st-points"]) el.querySelector(c).classList.toggle("hidden", list);
            });
            q("stAdd").style.display = rows.length >= 3 ? "none" : "";
            count();
        };
        const build = () => {
            rowsEl.innerHTML = rows.map(rowHtml).join("");
            rowsEl.querySelectorAll(".st-prow").forEach((el, i) => {
                const r = rows[i], p = params.find(x => x.id === (r.param || (el.querySelector(".st-p").value)));
                if (!r.param && p) r.param = p.id;
                el.querySelector(".st-p").value = r.param || (params[0] && params[0].id);
                const d = defaults(r, params.find(x => x.id === el.querySelector(".st-p").value));
                el.querySelector(".st-scale").value = r.list ? "list" : (r.scale || "lin");
                el.querySelector(".st-start").value = d.start; el.querySelector(".st-stop").value = d.stop; el.querySelector(".st-points").value = r.points || 5;
                if (r.list) el.querySelector(".st-list").value = r.list.join(" ");
                el.querySelector(".st-p").onchange = () => { const dd = defaults({}, params.find(x => x.id === el.querySelector(".st-p").value)); el.querySelector(".st-start").value = dd.start; el.querySelector(".st-stop").value = dd.stop; };
                const del = el.querySelector(".st-del");
                if (del) del.onclick = () => { rows = readRows(); rows.splice(i, 1); build(); };
            });
            rowsEl.oninput = rowsEl.onchange = syncRows;
            syncRows();
        };
        q("stAdd").onclick = () => {
            rows = readRows();
            if (rows.length >= 3) return;
            const used = new Set(rows.map(r => r.param)), next = params.find(p => !used.has(p.id));
            if (next) rows.push({ param: next.id });
            build();
        };
        const sync = () => {
            const an = q("stAnalysis").value, metric = q("stShow").value === "metric", corners = q("stMode").value === "corners";
            if (corners && !metric && an !== "op") { /* overlaying corner waveforms is allowed */ }
            root.querySelectorAll(".st-m").forEach(e => e.classList.toggle("hidden", !metric));
            root.querySelectorAll(".st-f").forEach(e => e.classList.toggle("hidden", !(metric && an === "ac")));
            const cur = q("stMetric").value;
            q("stMetric").innerHTML = StudyDialog.metricOptions(an, Study.METRICS[an].some(m => m[0] === cur) ? cur : Study.METRICS[an][0][0]);
            syncRows();
        };
        q("stMode").value = memo.mode; q("stAnalysis").value = memo.analysis; q("stShow").value = memo.show;
        q("stMode").onchange = q("stAnalysis").onchange = q("stShow").onchange = sync;
        build(); sync();
        if (memo.metric) q("stMetric").value = memo.metric;

        Dialog.open({
            title: "Parametric Sweep", content: root, width: "720px",
            buttons: [
                { label: "Cancel", onClick: () => { if (StudyDialog.running) { StudyDialog.running.cancel = true; SimWorker.cancel(); } } },
                { label: "Run", primary: true, onClick: () => {
                    if (StudyDialog.running) return false;
                    const rs = readRows(), corners = q("stMode").value === "corners";
                    const bad = rs.find(r => !corners && !r.list && (!Number.isFinite(r.start) || !Number.isFinite(r.stop)));
                    if (bad) { const m = root.querySelector(".study-msg"); m.textContent = "Enter the from and to values."; m.className = "study-msg err"; return false; }
                    const s = {
                        mode: q("stMode").value, params: rs, analysis: q("stAnalysis").value, show: q("stShow").value, metric: q("stMetric").value,
                        probe: Number(q("stProbe").value) || 0, freq: Units.parseSI(q("stFreq").value) || 1000
                    };
                    StudyDialog.memo.sweep = s;
                    StudyDialog.execute(root, "sweep", s, Study.sweep, editor, runner, graph);
                    return false;
                } }
            ]
        });
    },

    // ---- sensitivity ---------------------------------------------------------------------------------------------------------
    openSensitivity() {
        const editor = window.editor, runner = window.runner;
        if (!editor) return;
        const esc = StudyDialog.esc;
        const memo = Object.assign({ analysis: "op", metric: "final", freq: 1000, delta: 1 }, StudyDialog.memo.sens || {});
        const root = StudyDialog.shell(`
            <label>Analysis</label><select id="seAnalysis"><option value="op">Operating point</option><option value="tran">Transient</option><option value="ac">AC (frequency response)</option></select>
            <label>On probe</label><select id="seProbe">${StudyDialog.probeOptions(editor)}</select>
            <label class="se-m">Measure</label><select id="seMetric" class="se-m"></select>
            <label class="se-f">At frequency (Hz)</label><input id="seFreq" class="se-f" value="${memo.freq}">
            <label>Change each part by (%)</label><input id="seDelta" value="${memo.delta}">
            <div class="span se-out"></div>`);
        const q = (id) => root.querySelector("#" + id);
        const sync = () => {
            const an = q("seAnalysis").value;
            root.querySelectorAll(".se-m").forEach(e => e.classList.toggle("hidden", an === "op"));
            root.querySelectorAll(".se-f").forEach(e => e.classList.toggle("hidden", an !== "ac"));
            if (an !== "op") { const cur = q("seMetric").value; q("seMetric").innerHTML = StudyDialog.metricOptions(an, Study.METRICS[an].some(m => m[0] === cur) ? cur : Study.METRICS[an][0][0]); }
        };
        q("seAnalysis").value = memo.analysis; q("seAnalysis").onchange = sync; sync();
        let last = null;
        const show = (res) => {
            last = res;
            const f = (v) => (Number.isFinite(v) ? Number(v.toPrecision(4)).toString() : "—");
            const max = Math.max(...res.rows.map(r => Math.abs(r.rel || 0)), 1e-12);
            root.querySelector(".se-out").innerHTML = `<div class="prop-note">${esc(res.probe)}: ${esc(res.analysis === "op" ? "operating point value" : (Study.METRICS[res.analysis].find(m => m[0] === res.metric) || [0, res.metric])[1])}, nominal ${f(res.nominal)}. Each part changed by ${res.delta}%.</div>
              <table class="results-table"><thead><tr><th>Part value</th><th>Nominal</th><th>% result per % part</th><th></th><th>d(result)/d(part)</th></tr></thead><tbody>${
                res.rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(Units.formatSI(r.x0, r.unit || ""))}</td><td class="val">${Number.isFinite(r.rel) ? (r.rel >= 0 ? "+" : "") + r.rel.toFixed(3) : "—"}</td><td><span class="se-bar" style="width:${Math.round(100 * Math.abs(r.rel || 0) / max)}px;background:${(r.rel || 0) >= 0 ? "#2e7d32" : "#c62828"}"></span></td><td>${f(r.abs)}</td></tr>`).join("")}</tbody></table>`;
        };
        Dialog.open({
            title: "Sensitivity", content: root, width: "720px",
            buttons: [
                { label: "Cancel", onClick: () => { if (StudyDialog.running) { StudyDialog.running.cancel = true; SimWorker.cancel(); } } },
                { label: "Copy CSV", onClick: () => { if (last) { try { navigator.clipboard.writeText(["part,nominal,relative,absolute", ...last.rows.map(r => `${PlotMath.csvCell(r.label)},${r.x0},${r.rel},${r.abs}`)].join("\n")); } catch (e) { /* no clipboard */ } } return false; } },
                { label: "Run", primary: true, onClick: () => {
                    if (StudyDialog.running) return false;
                    const s = { analysis: q("seAnalysis").value, metric: q("seMetric").value, probe: Number(q("seProbe").value) || 0, freq: Units.parseSI(q("seFreq").value) || 1000, delta: Units.parseSI(q("seDelta").value) || 1 };
                    StudyDialog.memo.sens = s;
                    const bar = root.querySelector(".study-bar"), msg = root.querySelector(".study-msg"), state = { cancel: false };
                    StudyDialog.running = state; bar.style.display = "block"; msg.className = "study-msg"; msg.textContent = "";
                    Study.sensitivity(editor, runner, s, { cancelled: () => state.cancel, progress: (i, n) => { bar.firstElementChild.style.width = `${(100 * i) / n}%`; msg.textContent = `Part ${i} of ${n}`; } })
                        .then((res) => { show(res); msg.textContent = `${res.rows.length} part values ranked.`; })
                        .catch((e) => { msg.textContent = e.message === "Cancelled" ? "Cancelled." : e.message; msg.className = "study-msg " + (e.message === "Cancelled" ? "" : "err"); })
                        .finally(() => { StudyDialog.running = null; bar.style.display = "none"; });
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

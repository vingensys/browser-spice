// Graph > Measurements…: named measurements ("max of V(out) between 1 ms and 5 ms", "-3 dB frequency", "delay from
// V(in) to V(out)") that are saved with the design and re-evaluated on the latest analysis results.
// The same specs read and write SPICE ".meas" lines (see Measure).

const MeasureDialog = {
    esc: (s) => PropertiesPanel.esc(String(s)),

    // the signal source for a spec: the plotted probe series of the last analysis of its kind
    signals(kind) {
        const p = window.plotter;
        if (kind === "tran") {
            const d = p.cache && p.cache.tran;
            if (!d || !d.series) return null;
            return (name) => {
                const s = d.series.find(x => x.name.toLowerCase().startsWith(String(name).toLowerCase()));
                if (!s) throw new Error(`no probe ${name} in the last transient run`);
                return { xs: d.xValues, ys: s.values };
            };
        }
        const l = p.lastPhasors;
        if (!l) return null;
        return (name) => {
            const ph = l[1].find(x => x.label.toLowerCase().startsWith(String(name).toLowerCase()));
            if (!ph) throw new Error(`no probe ${name} in the last AC run`);
            return Measure.acSignal(l[0], ph.z);
        };
    },

    // evaluate every measurement; analyses are run first when `fresh` or when a kind has no results yet
    async evaluate(editor, runner, fresh) {
        const out = [];
        for (const kind of ["tran", "ac"]) {
            if (!editor.measures.some(m => m.kind === kind)) continue;
            if (fresh || !MeasureDialog.signals(kind)) await (kind === "tran" ? runner.runTransient() : runner.runAC());
        }
        for (const m of editor.measures) {
            try {
                const get = MeasureDialog.signals(m.kind);
                if (!get) throw new Error(`run the ${m.kind === "tran" ? "transient" : "AC"} analysis first`);
                out.push({ value: Measure.compute(m, get) });
            } catch (e) { out.push({ error: e.message }); }
        }
        return out;
    },

    describe(m) {
        const bits = [];
        const f = (v) => Units.formatSI(v, "");
        if (Number.isFinite(m.from) || Number.isFinite(m.to)) bits.push(`${Number.isFinite(m.from) ? f(m.from) : "start"} … ${Number.isFinite(m.to) ? f(m.to) : "end"}`);
        if (Number.isFinite(m.td)) bits.push(`after ${f(m.td)}`);
        if (Number.isFinite(m.at)) bits.push(`at ${f(m.at)}`);
        if (Number.isFinite(m.level)) bits.push(`level ${f(m.level)}${m.edge ? " " + m.edge : ""}${m.nth > 1 ? ` #${m.nth}` : ""}`);
        if (m.sig2) bits.push(`to ${m.sig2}${Number.isFinite(m.level2) ? ` level ${f(m.level2)}` : ""}${m.edge2 ? " " + m.edge2 : ""}`);
        if (Number.isFinite(m.lo) || Number.isFinite(m.hi)) bits.push(`${Number.isFinite(m.lo) ? m.lo * 100 : 10}–${Number.isFinite(m.hi) ? m.hi * 100 : 90} %`);
        return bits.join(", ");
    },

    open(editor, runner, graph) {
        const probes = editor.probes.filter(p => p.graph !== false);
        const wrap = document.createElement("div");
        wrap.className = "measure-dlg";
        const probeOpts = probes.map(p => `<option>${MeasureDialog.esc(p.label)}</option>`).join("");
        const render = (results = []) => {
            const rows = editor.measures.map((m, i) => {
                const r = results[i];
                const val = !r ? "" : r.error ? `<span class="err" title="${MeasureDialog.esc(r.error)}">${MeasureDialog.esc(r.error)}</span>` : `<b>${MeasureDialog.esc(Units.formatSI(r.value, Measure.unit(m)))}</b>`;
                return `<tr><td>${MeasureDialog.esc(m.name)}</td><td>${m.kind === "tran" ? "Transient" : "AC"}</td><td>${MeasureDialog.esc(Measure.FUNCS[m.kind][m.fn] || m.fn)}</td><td>${MeasureDialog.esc(m.sig)}</td><td class="dim">${MeasureDialog.esc(MeasureDialog.describe(m))}</td><td class="val">${val}</td><td><button data-del="${i}" title="Delete">✕</button></td></tr>`;
            }).join("");
            wrap.querySelector(".meas-list").innerHTML = editor.measures.length
                ? `<table class="results-table"><thead><tr><th>Name</th><th>Analysis</th><th>Measurement</th><th>Signal</th><th></th><th>Value</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
                : `<div class="no-selection">No measurements yet. Add one below.</div>`;
            wrap.querySelectorAll("[data-del]").forEach(b => { b.onclick = () => { editor.saveState(); editor.measures.splice(Number(b.dataset.del), 1); editor.notify(); render(); }; });
        };
        wrap.innerHTML = `<div class="meas-list"></div>
            <fieldset class="meas-add"><legend>Add</legend><div class="form-grid">
                <label>Name</label><input id="mName" value="m${editor.measures.length + 1}">
                <label>Analysis</label><select id="mKind"><option value="tran">Transient</option><option value="ac">AC (frequency response)</option></select>
                <label>Measurement</label><select id="mFn"></select>
                <label>Signal</label><select id="mSig">${probeOpts}</select>
                <span id="mExtra" class="span"></span>
            </div></fieldset><div class="meas-msg prop-note"></div>`;
        const q = (id) => wrap.querySelector("#" + id);
        const fillFns = () => { q("mFn").innerHTML = Object.entries(Measure.FUNCS[q("mKind").value]).map(([k, l]) => `<option value="${k}">${l}</option>`).join(""); extra(); };
        const extra = () => {
            const kind = q("mKind").value, fn = q("mFn").value;
            const need = Measure.PARAMS[`${kind}:${fn}`] || [];
            const time = kind === "tran" ? "time (s)" : "frequency (Hz)";
            const inp = (id, label, ph = "") => `<label>${label}</label><input id="${id}" placeholder="${ph}">`;
            const edge = (id, label) => `<label>${label}</label><select id="${id}"><option value="rise">rising</option><option value="fall">falling</option><option value="either">either</option></select>`;
            let h = "";
            if (Measure.RANGED.includes(fn)) h += inp("mFrom", `From ${time}`, "start") + inp("mTo", `To ${time}`, "end");
            if (need.includes("at")) h += inp("mAt", `At ${time}`);
            if (need.includes("level")) h += inp("mLevel", fn === "delay" ? "Trigger level" : kind === "ac" ? "Level (dB)" : "Level") + edge("mEdge", "Edge") + inp("mNth", "Occurrence", "1");
            if (need.includes("sig2")) h += `<label>Target signal</label><select id="mSig2">${probeOpts}</select>` + inp("mLevel2", "Target level", "same") + edge("mEdge2", "Target edge") + inp("mNth2", "Target occurrence", "1");
            if (need.includes("lo")) h += inp("mLo", "Low level (%)", "10") + inp("mHi", "High level (%)", "90");
            q("mExtra").innerHTML = `<div class="form-grid">${h}</div>`;
        };
        q("mKind").onchange = fillFns; q("mFn").onchange = extra; fillFns();
        render();

        const read = () => {
            const n = (id) => (q(id) && q(id).value.trim() !== "" ? Units.parseSI(q(id).value) : undefined);
            const spec = { name: q("mName").value.trim().replace(/\s+/g, "_") || `m${editor.measures.length + 1}`, kind: q("mKind").value, fn: q("mFn").value, sig: q("mSig").value };
            const set = (k, v) => { if (Number.isFinite(v)) spec[k] = v; };
            set("from", n("mFrom")); set("to", n("mTo")); set("at", n("mAt")); set("level", n("mLevel")); set("level2", n("mLevel2"));
            if (q("mEdge")) spec.edge = q("mEdge").value;
            if (q("mEdge2")) spec.edge2 = q("mEdge2").value;
            set("nth", n("mNth")); set("nth2", n("mNth2"));
            if (q("mSig2")) spec.sig2 = q("mSig2").value;
            if (Number.isFinite(n("mLo"))) spec.lo = n("mLo") / 100;
            if (Number.isFinite(n("mHi"))) spec.hi = n("mHi") / 100;
            return spec;
        };
        const msg = (t) => { wrap.querySelector(".meas-msg").textContent = t; };
        const add = () => {
            if (!probes.length) { msg("Add a voltage or current probe first: measurements read the probed signals."); return false; }
            const spec = read();
            const need = Measure.PARAMS[`${spec.kind}:${spec.fn}`] || [];
            if (need.includes("at") && !Number.isFinite(spec.at)) { msg("Enter the position (At)."); return false; }
            if (need.includes("level") && !Number.isFinite(spec.level)) { msg("Enter the level."); return false; }
            if (editor.measures.some(m => m.name === spec.name)) { msg(`There is already a measurement called ${spec.name}.`); return false; }
            editor.saveState(); editor.measures.push(spec); editor.notify();
            q("mName").value = `m${editor.measures.length + 1}`; msg(""); render();
            return false;
        };
        const run = (fresh) => async () => { msg("Measuring…"); const res = await MeasureDialog.evaluate(editor, runner, fresh); render(res); msg(res.some(r => r.error) ? "Some measurements could not be made (hover the message)." : ""); return false; };
        Dialog.open({
            title: "Measurements", content: wrap, width: "860px",
            buttons: [
                { label: "Add", onClick: add },
                { label: "Measure (latest results)", onClick: () => { run(false)(); return false; } },
                { label: "Run analyses and measure", primary: true, onClick: () => { run(true)(); return false; } },
                { label: "Copy as .meas", onClick: () => { try { navigator.clipboard.writeText(editor.measures.map(m => Measure.toSpice(m)).join("\n")); msg("Copied."); } catch (e) { msg("The clipboard is not available."); } return false; } },
                { label: "Close" }
            ]
        });
        MeasureDialog.last = { render };
    }
};

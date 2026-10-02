// Parametric sweeps (".step") and Monte Carlo tolerance analysis.
//
// A study changes one or more component values on the live schematic, solves the circuit for each setting with
// the built-in engine, and collects either overlaid waveforms or a single number per run (a "metric": peak-to-peak,
// RMS, gain at a frequency, bandwidth ...). The values are always put back afterwards, even if the study is
// cancelled or fails. Results come back as plain plot data for the graph window.

class Study {

    // ---- parameters you can sweep -------------------------------------------------------------------------

    static NUMERIC_SOURCE_FIELDS = [["dcVoltage", "DC level"], ["acMagnitude", "amplitude"], ["frequency", "frequency"], ["dcOffset", "offset"]];

    // [{ id, label, unit, get(), set(v) }]; set() writes a plain number into the component
    static parameters(editor, runner) {
        const out = [];
        const num = (v) => { const x = Units.parseSI(v); return Number.isFinite(x) ? x : 0; };
        const add = (id, label, unit, get, set) => out.push({ id, label, unit, get, set });
        for (const c of editor.components) {
            const t = c.type;
            if (["R", "C", "L", "POT", "RHEO"].includes(t)) {
                const unit = { R: "Ω", C: "F", L: "H", POT: "Ω", RHEO: "Ω" }[t];
                add(`${c.id}.value`, `${c.name} value`, unit, () => num(c.value), (v) => { c.value = String(v); });
                if (t === "POT" || t === "RHEO") add(`${c.id}.position`, `${c.name} wiper position`, "", () => (c.position === undefined ? 0.5 : c.position), (v) => { c.position = Math.min(1, Math.max(0, v)); });
            } else if (t === "V" || t === "I") {
                const unit = t === "V" ? "V" : "A";
                const st = c.sourceType || "DC";
                for (const [field, what] of Study.NUMERIC_SOURCE_FIELDS) {
                    const relevant = (field === "dcVoltage" && st === "DC") || (st === "AC" && field !== "dcVoltage") || false;
                    if (relevant) add(`${c.id}.${field}`, `${c.name} ${what}`, field === "frequency" ? "Hz" : unit, () => num(c[field] !== undefined ? c[field] : (field === "dcVoltage" ? c.value : 0)), (v) => { c[field] = String(v); });
                }
            } else if (t === "BATTERY") {
                add(`${c.id}.volts`, `${c.name} voltage`, "V", () => num(c.volts), (v) => { c.volts = String(v); });
            } else if (t === "POWER") {
                add(`${c.id}.volts`, `${c.name} voltage`, "V", () => num(c.volts), (v) => { c.volts = String(v); });
            } else {
                const def = typeof PartLib !== "undefined" ? PartLib.defs[t] : null;
                for (const k of (def && def.tweak) || []) {
                    if (k === "position") continue;
                    add(`${c.id}.${k}`, `${c.name} ${k}`, "", () => num(c[k]), (v) => { c[k] = String(v); });
                }
            }
        }
        const tempEl = () => document.getElementById("simTemp");
        add("temp", "Temperature", "°C", () => (tempEl() && tempEl().value !== "" ? Number(tempEl().value) : 27), (v) => { if (tempEl()) tempEl().value = String(v); });
        return out;
    }

    // run fn with the parameter changed, always restoring the original
    static async withRestore(editor, params, fn) {
        const snapshot = params.map(p => ({ p, comp: Study.compOf(editor, p.id), prev: Study.stateOf(editor, p.id) }));
        try { return await fn(); }
        finally { for (const s of snapshot) Study.restoreState(editor, s.p.id, s.prev); editor.refreshWires(); }
    }

    static compOf(editor, id) { const n = Number(String(id).split(".")[0]); return Number.isNaN(n) ? null : editor.components.find(c => c.id === n); }
    static stateOf(editor, id) {
        if (id === "temp") { const t = document.getElementById("simTemp"); return { temp: t ? t.value : undefined }; }
        const c = Study.compOf(editor, id), field = String(id).split(".")[1];
        return c ? { value: c[field], had: field in c } : null;
    }
    static restoreState(editor, id, prev) {
        if (!prev) return;
        if (id === "temp") { const t = document.getElementById("simTemp"); if (t && prev.temp !== undefined) t.value = prev.temp; return; }
        const c = Study.compOf(editor, id), field = String(id).split(".")[1];
        if (!c) return;
        if (prev.had) c[field] = prev.value; else delete c[field];
    }

    // ---- value lists ----------------------------------------------------------------------------------------

    static values(spec) {
        if (spec.list) return spec.list.map(Number).filter(Number.isFinite);
        const { start, stop, points } = spec, n = Math.max(2, Math.round(points || 5));
        if (spec.scale === "log" && start > 0 && stop > 0) return Array.from({ length: n }, (_, i) => start * Math.pow(stop / start, i / (n - 1)));
        return Array.from({ length: n }, (_, i) => start + ((stop - start) * i) / (n - 1));
    }

    static parseList(text) { return String(text).split(/[\s,;]+/).filter(Boolean).map(t => Units.parseSI(t)); }

    // ---- analyses and metrics -----------------------------------------------------------------------------------

    static METRICS = {
        tran: [["final", "Final value"], ["max", "Maximum"], ["min", "Minimum"], ["pkpk", "Peak-to-peak"], ["mean", "Mean"], ["rms", "RMS"], ["freq", "Frequency"], ["rise", "Rise time (10–90 %)"]],
        ac: [["gainf", "Gain at a frequency (dB)"], ["peak", "Peak gain (dB)"], ["bw", "−3 dB bandwidth (Hz)"], ["unity", "Unity-gain frequency (Hz)"], ["phasef", "Phase at a frequency (°)"]],
        op: [["value", "Value"]]
    };

    // Solve the circuit as it is now. Returns { kind, items, ...data } where items map the graph probes to series.
    static async solve(editor, runner, kind) {
        const info = NetlistExtractor.extract(editor);
        const probes = editor.probes.filter(p => p.graph !== false);
        const items = runner.plotter.buildProbeSeriesMap(probes, info);
        const s = runner.settings();
        if (kind === "tran") {
            const res = await runner.solve(info, "tran", { tStop: s.tStop, tStep: s.tStep, uic: s.uic, nodeIC: info.nodeIC }, "Study run");
            return { kind, info, items, t: res.timePoints, series: items.map(it => (it.type === "V" ? res.nodeHistories[it.node] : res.currentHistories[it.targetName]) || res.timePoints.map(() => 0)) };
        }
        if (kind === "ac") {
            const res = await runner.solve(info, "ac", { fStart: s.fStart, fStop: s.fStop, pointsPerDecade: 20 }, "Study run");
            const zero = new Complex(0, 0);
            return { kind, info, items, f: res.map(r => r.frequency), z: items.map(it => res.map(r => (it.type === "V" ? r.nodeVoltages[it.node] : r.sourceCurrents[it.targetName]) || zero)) };
        }
        const op = await runner.solve(info, "op", {}, "Study run");
        return { kind, info, items, values: items.map(it => (it.type === "V" ? op.nodeVoltages[it.node] : op.currents[it.targetName]) || 0) };
    }

    // one number from one probe's result
    static metric(solved, probeIndex, metric, f) {
        if (solved.kind === "op") return solved.values[probeIndex];
        if (solved.kind === "tran") {
            const xs = solved.t, ys = solved.series[probeIndex], last = xs[xs.length - 1];
            switch (metric) {
                case "final": return ys[ys.length - 1];
                case "max": return Math.max(...ys);
                case "min": return Math.min(...ys);
                case "pkpk": return Math.max(...ys) - Math.min(...ys);
                case "mean": { const st = PlotMath.stats(xs, ys, xs[0], last); return st ? st.mean : NaN; }
                case "rms": { const st = PlotMath.stats(xs, ys, xs[0], last); return st ? st.rms : NaN; }
                case "freq": { const r = PlotMath.frequency(xs, ys, xs[0], last); return r ? r.freq : NaN; }
                case "rise": { const e = PlotMath.edges(xs, ys, xs[0], last); return e && e.rise !== null ? e.rise : NaN; }
                default: return NaN;
            }
        }
        const fr = solved.f, z = solved.z[probeIndex];
        const db = z.map(v => 20 * Math.log10(Math.max(v.magnitude(), 1e-20))), ph = z.map(v => v.phaseDegrees());
        const at = (arr, fx) => PlotMath.valueAt(fr, arr, fx, true);
        switch (metric) {
            case "gainf": return at(db, f);
            case "phasef": return at(ph, f);
            case "peak": return Math.max(...db);
            case "bw": { const a = PlotMath.ac(fr, db, ph); return a && a.bw.high !== null ? a.bw.high : NaN; }
            case "unity": { const a = PlotMath.ac(fr, db, ph); return a && a.unity ? a.unity.x : NaN; }
            default: return NaN;
        }
    }

    // ---- parametric sweep ---------------------------------------------------------------------------------------------

    static async sweep(editor, runner, spec, hooks = {}) {
        const params = Study.parameters(editor, runner);
        const p = params.find(x => x.id === spec.param);
        if (!p) throw new Error("Pick a parameter to sweep.");
        const values = Study.values(spec);
        if (values.length < 2) throw new Error("A sweep needs at least two values.");
        if (values.length > 400) throw new Error("That is more than 400 runs. Use fewer points.");
        const probes = editor.probes.filter(pr => pr.graph !== false);
        if (!probes.length && spec.show !== "metric") throw new Error("Add voltage or current probes: the sweep plots what they measure.");
        if (!probes.length) throw new Error("Add a probe to measure.");

        const solved = [];
        await Study.withRestore(editor, [p], async () => {
            for (let i = 0; i < values.length; i++) {
                if (hooks.cancelled && hooks.cancelled()) throw new Error("Cancelled");
                p.set(values[i]);
                editor.refreshWires();
                solved.push(await Study.solve(editor, runner, spec.analysis));
                if (hooks.progress) hooks.progress(i + 1, values.length);
                if (i % 2 === 1) await new Promise(r => setTimeout(r));     // let the page breathe (and the cancel button work)
            }
        });
        return Study.sweepData(runner, spec, p, values, solved);
    }

    static fmtParam(p, v) { return Units.formatSI(v, p.unit || ""); }

    // colours from cool to warm across the runs
    static runColor(i, n) { return `hsl(${Math.round(220 - (200 * i) / Math.max(n - 1, 1))}, 75%, 55%)`; }

    static sweepData(runner, spec, p, values, solved) {
        const plotter = runner.plotter, n = values.length, kind = spec.analysis;
        const items = solved[0].items;
        const tag = (v) => `${p.label} = ${Study.fmtParam(p, v)}`;
        if (spec.show === "metric" && kind !== undefined) {
            const probeIdx = Math.min(Math.max(spec.probe || 0, 0), items.length - 1);
            const label = (Study.METRICS[kind].find(m => m[0] === spec.metric) || [spec.metric, spec.metric])[1];
            const series = (spec.allProbes ? items.map((_, i) => i) : [probeIdx]).map((pi, k) => ({
                name: items[pi].label, color: plotter.colors[k % plotter.colors.length],
                values: solved.map(sv => Study.metric(sv, pi, spec.metric, spec.freq))
            }));
            return { mode: "sweep", logX: spec.scale === "log", xLabel: `${p.label}${p.unit ? ` (${p.unit})` : ""}`, xUnit: p.unit || "", yLabel: label, yUnit: "", xValues: values, series, study: { kind: "metric", param: p.label, metric: label } };
        }
        if (kind === "ac") {
            const fr = solved[0].f, phasors = [];
            solved.forEach((sv, i) => items.forEach((it, k) => phasors.push({ label: `${it.label} @ ${tag(values[i])}`, color: items.length === 1 ? Study.runColor(i, n) : undefined, z: sv.z[k] })));
            const data = plotter.acData(fr, phasors);
            data.study = { kind: "overlay", param: p.label };
            return data;
        }
        if (kind === "op") {
            const series = items.map((it, k) => ({ name: it.label, color: plotter.colors[k % plotter.colors.length], values: solved.map(sv => sv.values[k]) }));
            return { mode: "sweep", logX: spec.scale === "log", xLabel: `${p.label}${p.unit ? ` (${p.unit})` : ""}`, xUnit: p.unit || "", yLabel: "Voltage (V) / Current (A)", xValues: values, series, study: { kind: "op", param: p.label } };
        }
        // transient overlay on one uniform time grid
        const tEnd = Math.max(...solved.map(sv => sv.t[sv.t.length - 1])), N = 1200;
        const grid = Array.from({ length: N }, (_, i) => (tEnd * i) / (N - 1));
        const series = [];
        solved.forEach((sv, i) => items.forEach((it, k) => series.push({
            name: `${it.label} @ ${tag(values[i])}`,
            color: items.length === 1 ? Study.runColor(i, n) : plotter.colors[(k + i) % plotter.colors.length],
            values: grid.map(t => PlotMath.valueAt(sv.t, sv.series[k], t))
        })));
        return { mode: "transient", xLabel: "Time", yLabel: "Voltage (V) / Current (A)", xValues: grid, series, study: { kind: "overlay", param: p.label } };
    }

    // ---- Monte Carlo ----------------------------------------------------------------------------------------------------

    static rng(seed) {      // mulberry32
        let a = seed >>> 0;
        return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    static gauss(rand) { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

    // tolerance (percent) of a part: its own "tol" field, else the default for its kind
    static tolerance(comp, defaults) {
        const own = Units.parseSI(comp.tol);
        if (comp.tol !== undefined && comp.tol !== "" && Number.isFinite(own)) return own;
        return defaults[comp.type] || 0;
    }

    static async monteCarlo(editor, runner, spec, hooks = {}) {
        const runs = Math.round(spec.runs || 50);
        if (runs < 2 || runs > 2000) throw new Error("Use between 2 and 2000 runs.");
        const probes = editor.probes.filter(pr => pr.graph !== false);
        if (!probes.length) throw new Error("Add a probe to measure.");
        const rand = Study.rng(spec.seed === undefined ? 1 : spec.seed);
        const defaults = Object.assign({ R: 5, C: 10, L: 10 }, spec.defaults || {});
        const parts = editor.components.filter(c => ["R", "C", "L", "POT", "RHEO"].includes(c.type) && Study.tolerance(c, defaults) > 0);
        if (!parts.length) throw new Error("No part has a tolerance. Set a tolerance on the parts (Edit Component) or in the defaults.");
        const saved = parts.map(c => ({ c, value: c.value }));
        const nominal = parts.map(c => Units.parseSI(c.value));
        const probe = Math.min(Math.max(spec.probe || 0, 0), probes.length - 1);
        const values = [];
        try {
            for (let i = 0; i < runs; i++) {
                if (hooks.cancelled && hooks.cancelled()) throw new Error("Cancelled");
                parts.forEach((c, k) => {
                    const tol = Study.tolerance(c, defaults) / 100;
                    const d = spec.dist === "uniform" ? (rand() * 2 - 1) * tol : Math.max(-tol, Math.min(tol, (Study.gauss(rand) * tol) / 3));
                    c.value = String(nominal[k] * (1 + d));
                });
                editor.refreshWires();
                values.push(Study.metric(await Study.solve(editor, runner, spec.analysis), probe, spec.metric, spec.freq));
                if (hooks.progress) hooks.progress(i + 1, runs);
                if (i % 2 === 1) await new Promise(r => setTimeout(r));
            }
        } finally {
            for (const s of saved) s.c.value = s.value;
            editor.refreshWires();
        }
        return Study.monteCarloData(runner, spec, values, parts.length, probes[probe]);
    }

    static monteCarloData(runner, spec, vals, partCount, probe) {
        const v = vals.filter(Number.isFinite).sort((a, b) => a - b), n = v.length;
        if (n < 2) throw new Error("The metric could not be measured in the runs (no result).");
        const mean = v.reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
        const stats = { n, runs: vals.length, mean, std, min: v[0], max: v[n - 1], median: v[n >> 1], parts: partCount };
        const lo = spec.limits && Number.isFinite(spec.limits.lo) ? spec.limits.lo : -Infinity, hi = spec.limits && Number.isFinite(spec.limits.hi) ? spec.limits.hi : Infinity;
        if (lo > -Infinity || hi < Infinity) stats.yield = v.filter(x => x >= lo && x <= hi).length / n;
        // histogram: Sturges bins, always at least a few
        const bins = Math.max(5, Math.min(40, Math.ceil(Math.log2(n)) + 1));
        const span = stats.max - stats.min || Math.abs(mean) * 1e-6 || 1;
        const w = span / bins, counts = new Array(bins).fill(0);
        for (const x of v) counts[Math.min(bins - 1, Math.floor((x - stats.min) / w))]++;
        const centres = counts.map((_, i) => stats.min + (i + 0.5) * w);
        const label = ((Study.METRICS[spec.analysis] || []).find(m => m[0] === spec.metric) || [spec.metric, spec.metric])[1];
        return {
            mode: "hist", bars: true, xLabel: `${probe.label}: ${label}`, xUnit: "", yLabel: "Runs", xValues: centres,
            series: [{ name: `${n} runs`, color: "#6ea8fe", values: counts }], study: { kind: "montecarlo", stats, values: vals, binWidth: w, probe: probe.label, metric: label }
        };
    }
}

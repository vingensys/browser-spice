// .measure: named, repeatable measurements on analysis results (SPICE ".meas", as a table in the app).
//
//   Measure.compute(spec, getSignal)  ->  { value, unit }   or throws Error("why it could not be measured")
//     spec        { name, kind: "tran" | "ac", fn, sig, from, to, td, at, level, edge, nth, ... see FUNCS }
//     getSignal   (name) -> tran: { xs, ys }   ac: { xs (Hz), db, ph (degrees, unwrapped), mag }
//
//   Measure.parse(".meas tran vpk max v(out) from=1m to=5m")  ->  spec | null      (SPICE syntax)
//   Measure.toSpice(spec)                                       ->  ".meas ..." line
//
// Functions (tran): max min pp avg rms integ maxat minat find when delay rise fall period freq duty
//           (ac):   max min maxat minat find findph when bw unity pm

class Measure {
    static FUNCS = {
        tran: {
            max: "Maximum", min: "Minimum", pp: "Peak-to-peak", avg: "Average", rms: "RMS", integ: "Integral",
            maxat: "Time of maximum", minat: "Time of minimum", find: "Value at a time", when: "Time when it crosses a level",
            delay: "Delay to another signal", rise: "Rise time", fall: "Fall time", period: "Period", freq: "Frequency", duty: "Duty cycle"
        },
        ac: {
            max: "Peak gain (dB)", min: "Minimum gain (dB)", maxat: "Frequency of peak gain", minat: "Frequency of minimum gain", find: "Gain at a frequency (dB)",
            findph: "Phase at a frequency (°)", when: "Frequency where gain crosses a level (dB)", bw: "−3 dB bandwidth", unity: "Unity-gain frequency", pm: "Phase margin (°)"
        }
    };

    // which parameters each function reads (for the dialog)
    static PARAMS = {
        "tran:find": ["at"], "tran:when": ["level", "edge", "nth"], "tran:delay": ["sig2", "level", "edge", "nth", "level2", "edge2", "nth2"],
        "tran:rise": ["lo", "hi"], "tran:fall": ["lo", "hi"], "ac:find": ["at"], "ac:findph": ["at"], "ac:when": ["level", "edge", "nth"]
    };
    static RANGED = ["max", "min", "pp", "avg", "rms", "integ", "maxat", "minat", "rise", "fall", "period", "freq", "duty", "when"];

    static unit(spec) {
        const f = spec.fn;
        if (spec.kind === "ac") return { max: "dB", min: "dB", find: "dB", findph: "°", pm: "°", maxat: "Hz", minat: "Hz", when: "Hz", bw: "Hz", unity: "Hz" }[f] || "";
        if (["maxat", "minat", "when", "delay", "rise", "fall", "period"].includes(f)) return "s";
        if (f === "freq") return "Hz";
        if (f === "duty") return "";
        const i = /^i\(/i.test(spec.sig || "") ? "A" : "V";
        return f === "integ" ? `${i}·s` : i;
    }

    static edgeDir(e) { return e === "fall" ? -1 : e === "rise" ? 1 : 0; }

    static compute(spec, getSignal) {
        const f = spec.fn, ac = spec.kind === "ac";
        const sg = getSignal(spec.sig);
        if (!sg || !sg.xs || sg.xs.length < 2) throw new Error(`signal ${spec.sig} has no data`);
        const xs = sg.xs;
        const ys = ac ? sg.db : sg.ys;
        const lo = Number.isFinite(spec.from) ? Math.max(spec.from, spec.td || -Infinity) : (Number.isFinite(spec.td) ? spec.td : xs[0]);
        const hi = Number.isFinite(spec.to) ? spec.to : xs[xs.length - 1];
        if (!(hi > lo)) throw new Error("the measuring window is empty (check from / to)");
        const nth = Math.max(1, Math.round(spec.nth || 1));
        const ok = (v, what) => { if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) throw new Error(what); return v; };
        const clipped = () => { const c = PlotMath.clip(xs, ys, lo, hi, ac); if (!c.xs.length) throw new Error("no data in the window"); return c; };
        const extreme = (sign) => { const c = clipped(); let k = 0; for (let i = 1; i < c.xs.length; i++) if (sign * c.ys[i] > sign * c.ys[k]) k = i; return { x: c.xs[k], y: c.ys[k] }; };

        if (f === "max") return extreme(1).y;
        if (f === "min") return extreme(-1).y;
        if (f === "maxat") return extreme(1).x;
        if (f === "minat") return extreme(-1).x;
        if (f === "find" || f === "findph") {
            const x = ok(spec.at, "no position given (at=)");
            if (x < xs[0] - 1e-18 || x > xs[xs.length - 1] + 1e-18) throw new Error("the position is outside the data");
            return PlotMath.valueAt(xs, f === "findph" ? sg.ph : ys, x, ac);
        }
        if (f === "when") {
            const level = ok(spec.level, "no level given");
            const hits = PlotMath.crossings(xs, ys, level, lo, hi, Measure.edgeDir(spec.edge));
            return ok(hits[nth - 1], `the signal does not cross ${level} ${nth} time${nth > 1 ? "s" : ""} in the window`);
        }
        if (ac) {
            const m = PlotMath.ac(xs, sg.db, sg.ph);
            if (f === "bw") return ok(m.bw.high !== null ? (m.bw.low !== null ? m.bw.high - m.bw.low : m.bw.high) : null, "the response never falls 3 dB");
            if (f === "unity") return ok(m.unity && m.unity.x, "the gain never crosses 0 dB");
            if (f === "pm") return ok(m.unity && m.unity.margin, "the gain never crosses 0 dB");
            throw new Error(`unknown AC measurement ${f}`);
        }
        // transient
        if (f === "avg" || f === "rms" || f === "pp" || f === "integ") {
            const st = ok(PlotMath.stats(xs, ys, lo, hi), "no data in the window");
            return f === "avg" ? st.mean : f === "rms" ? st.rms : f === "pp" ? st.pkpk : st.mean * st.span;
        }
        if (f === "rise" || f === "fall") {
            const st = ok(PlotMath.stats(xs, ys, lo, hi), "no data in the window");
            if (!(st.pkpk > 1e-12)) throw new Error("the signal does not move");
            const a = Number.isFinite(spec.lo) ? spec.lo : 0.1, b = Number.isFinite(spec.hi) ? spec.hi : 0.9;
            const vl = st.min + a * st.pkpk, vh = st.min + b * st.pkpk;
            if (f === "rise") {
                for (const t0 of PlotMath.crossings(xs, ys, vl, lo, hi, 1)) { const t1 = PlotMath.crossings(xs, ys, vh, t0, hi, 1)[0]; if (t1 !== undefined) return t1 - t0; }
            } else {
                for (const t0 of PlotMath.crossings(xs, ys, vh, lo, hi, -1)) { const t1 = PlotMath.crossings(xs, ys, vl, t0, hi, -1)[0]; if (t1 !== undefined) return t1 - t0; }
            }
            throw new Error(`no complete ${f === "rise" ? "rising" : "falling"} edge in the window`);
        }
        if (f === "period" || f === "freq" || f === "duty") {
            const r = ok(PlotMath.frequency(xs, ys, lo, hi), "no repeating signal in the window");
            return f === "period" ? r.period : f === "freq" ? r.freq : ok(r.duty, "no duty cycle (no falling edge)");
        }
        if (f === "delay") {
            const s2 = getSignal(spec.sig2 || spec.sig);
            if (!s2) throw new Error(`signal ${spec.sig2} has no data`);
            const l1 = ok(spec.level, "no trigger level given"), l2 = Number.isFinite(spec.level2) ? spec.level2 : l1;
            const t1 = PlotMath.crossings(xs, ys, l1, lo, hi, Measure.edgeDir(spec.edge))[nth - 1];
            ok(t1, "the trigger never happens");
            const n2 = Math.max(1, Math.round(spec.nth2 || 1));
            const t2 = PlotMath.crossings(s2.xs, s2.ys, l2, t1, hi, Measure.edgeDir(spec.edge2 || spec.edge))[n2 - 1];
            return ok(t2, "the target never happens after the trigger") - t1;
        }
        throw new Error(`unknown measurement ${f}`);
    }

    // ---- SPICE syntax ------------------------------------------------------------------------------------------------
    // .meas tran name MAX v(out) from=1m to=5m | FIND v(out) AT=1m | WHEN v(out)=2.5 rise=2 |
    //       TRIG v(a) VAL=1 RISE=1 TARG v(b) VAL=1 RISE=1
    static parse(line) {
        const N = (t) => SpiceParser.number(t);
        const src = String(line).trim().replace(/\s*=\s*/g, "=").toLowerCase();
        const tok = src.split(/\s+/);
        if (!/^\.meas(ure)?$/.test(tok[0])) return null;
        const kind = tok[1];
        if (!["tran", "ac"].includes(kind) || tok.length < 4) return null;
        const spec = { name: tok[2], kind };
        const word = tok[3];
        const kv = (arr) => { const o = {}; for (const t of arr) { const i = t.indexOf("="); if (i > 0) o[t.slice(0, i)] = t.slice(i + 1); } return o; };
        const take = (o, s) => {
            if (o.from !== undefined) s.from = N(o.from);
            if (o.to !== undefined) s.to = N(o.to);
            if (o.td !== undefined) s.td = N(o.td);
        };
        if (["max", "min", "pp", "avg", "rms", "integ"].includes(word)) { spec.fn = word; spec.sig = tok[4]; take(kv(tok.slice(5)), spec); return spec.sig ? spec : null; }
        if (word === "find") {
            spec.fn = kind === "ac" && /^vp\(/.test(tok[4]) ? "findph" : "find"; spec.sig = tok[4];
            const o = kv(tok.slice(5)); if (o.at === undefined) return null; spec.at = N(o.at); take(o, spec); return spec;
        }
        if (word === "when") {
            const m = /^([^=]+)=(.+)$/.exec(tok[4] || ""); if (!m) return null;
            spec.fn = "when"; spec.sig = m[1]; spec.level = N(m[2]);
            const o = kv(tok.slice(5)); take(o, spec);
            for (const e of ["rise", "fall", "cross"]) if (o[e] !== undefined) { spec.edge = e === "cross" ? "either" : e; spec.nth = N(o[e]); }
            return spec;
        }
        if (word === "trig") {
            const k = tok.indexOf("targ"); if (k < 0) return null;
            const a = kv(tok.slice(4, k)), b = kv(tok.slice(k + 1)), sa = tok[4], sb = tok[k + 1];
            Object.assign(spec, { fn: "delay", sig: sa, sig2: sb, level: N(a.val), level2: N(b.val) });
            if (a.td !== undefined) spec.td = N(a.td);
            for (const e of ["rise", "fall", "cross"]) { if (a[e] !== undefined) { spec.edge = e === "cross" ? "either" : e; spec.nth = N(a[e]); } if (b[e] !== undefined) { spec.edge2 = e === "cross" ? "either" : e; spec.nth2 = N(b[e]); } }
            return Number.isFinite(spec.level) ? spec : null;
        }
        return null;
    }

    static toSpice(s) {
        const f = (v) => Number(v.toPrecision(6)).toString();
        const win = `${Number.isFinite(s.from) ? ` from=${f(s.from)}` : ""}${Number.isFinite(s.to) ? ` to=${f(s.to)}` : ""}${Number.isFinite(s.td) ? ` td=${f(s.td)}` : ""}`;
        const edge = (e, n) => (e ? ` ${e === "either" ? "cross" : e}=${n || 1}` : "");
        const head = `.meas ${s.kind} ${s.name}`;
        if (["max", "min", "pp", "avg", "rms", "integ"].includes(s.fn)) return `${head} ${s.fn} ${s.sig}${win}`;
        if (s.fn === "find" || s.fn === "findph") return `${head} find ${s.sig} at=${f(s.at)}`;
        if (s.fn === "when") return `${head} when ${s.sig}=${f(s.level)}${edge(s.edge, s.nth)}${win}`;
        if (s.fn === "delay") return `${head} trig ${s.sig} val=${f(s.level)}${edge(s.edge, s.nth)} targ ${s.sig2 || s.sig} val=${f(Number.isFinite(s.level2) ? s.level2 : s.level)}${edge(s.edge2 || s.edge, s.nth2)}`;
        return `* ${s.name}: ${s.fn} has no SPICE .meas form`;
    }

    // ---- signals from engine results (decks) -----------------------------------------------------------------------------

    // getSignal for a transient result: v(node), i(element)
    static tranSignals(res) {
        return (expr) => {
            const m = /^([vi])\(\s*([^),\s]+)\s*\)$/i.exec(String(expr).trim());
            if (!m) throw new Error(`cannot read signal "${expr}"`);
            const key = m[2].toLowerCase();
            const pool = m[1].toLowerCase() === "v" ? res.nodeHistories : res.currentHistories;
            const name = Object.keys(pool).find(k => k.toLowerCase() === key);
            if (!name) throw new Error(`no signal ${expr}`);
            return { xs: res.timePoints, ys: pool[name] };
        };
    }

    // getSignal for an AC result: vdb(node), vm(node), vp(node), v(node) (all as dB / phase pairs)
    static acSignals(results) {
        return (expr) => {
            const m = /^(vdb|vm|vp|v|idb|i)\(\s*([^),\s]+)\s*\)$/i.exec(String(expr).trim());
            if (!m) throw new Error(`cannot read signal "${expr}"`);
            const key = m[2].toLowerCase(), cur = m[1].toLowerCase().startsWith("i");
            const zs = results.map(r => {
                const pool = cur ? r.sourceCurrents : r.nodeVoltages;
                const name = Object.keys(pool).find(k => k.toLowerCase() === key);
                if (!name) throw new Error(`no signal ${expr}`);
                return pool[name];
            });
            return Measure.acSignal(results.map(r => r.frequency), zs);
        };
    }

    // { xs, db, ph (unwrapped degrees), mag } from complex responses
    static acSignal(xs, zs) {
        const ph = []; let off = 0, prev = null;
        for (const z of zs) { let p = z.phaseDegrees(); if (prev !== null) { while (p + off - prev > 180) off -= 360; while (p + off - prev < -180) off += 360; } p += off; ph.push(p); prev = p; }
        return { xs, db: zs.map(z => 20 * Math.log10(Math.max(z.magnitude(), 1e-20))), ph, mag: zs.map(z => z.magnitude()) };
    }
}

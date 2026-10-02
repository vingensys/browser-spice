// The tools of the Browser SPICE MCP server: plain functions from JSON arguments to JSON results, so they can be
// tested without the protocol around them.

const { SimEngine, SpiceParser, Measure, PlotMath, Spectrum, Units, SIM_MODELS, simModelCardFromParams } = require("./engine.cjs");
const { spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const num = (v, fallback) => { if (v === undefined || v === null || v === "") return fallback; const x = typeof v === "number" ? v : Units.parseSI(String(v)); if (!Number.isFinite(x)) throw new Error(`"${v}" is not a number`); return x; };
const round = (x, d = 6) => (Number.isFinite(x) ? Number(x.toPrecision(d)) : x === Infinity ? "inf" : x === -Infinity ? "-inf" : null);
const arr = (a, d = 6) => Array.from(a, x => round(x, d));

function parseDeck(netlist) {
    if (typeof netlist !== "string" || !netlist.trim()) throw new Error("netlist must be the text of a SPICE deck");
    const deck = SpiceParser.parse(netlist);
    const { circuit, warnings } = SpiceParser.build(deck);
    return { deck, circuit, warnings };
}

// a deck must be rebuilt for every run (elements keep state)
function engineFor(netlist) {
    const { deck, circuit, warnings } = parseDeck(netlist);
    return { deck, warnings, engine: new SimEngine(circuit, Object.assign({ temp: deck.temp === undefined ? 27 : deck.temp }, deck.options || {})), circuit };
}

function pickAnalysis(deck, args) {
    const want = args.analysis;
    const a = deck.analyses.find(x => !want || x.type === want || (want === "dc" && x.type === "dc"));
    return { type: want || (a ? a.type : "op"), card: a || {} };
}

function resample(xs, ys, n) {
    if (xs.length <= n) return { x: xs.slice(), y: ys.slice() };
    const x = [], y = [];
    for (let i = 0; i < n; i++) { const t = xs[0] + ((xs[xs.length - 1] - xs[0]) * i) / (n - 1); x.push(t); y.push(PlotMath.valueAt(xs, ys, t)); }
    return { x, y };
}

function defaultSignals(circuit, kind) {
    const nodes = circuit.names.filter(n => !n.includes("#") && !n.includes("."));
    return nodes.slice(0, 8).map(n => (kind === "ac" ? `vdb(${n})` : `v(${n})`));
}

// ------------------------------------------------------------------------------------------------ operating-point measurements
// ".meas op vout find v(out)" / ".meas op iq i(vcc)": a node voltage or a source current at the DC operating point
function parseOpMeas(line) {
    const m = /^\s*\.meas(?:ure)?\s+op\s+(\w+)\s+(?:find\s+)?([vi])\(\s*([^)\s]+)\s*\)(?:\s+at\s*=\s*\S+)?\s*$/i.exec(String(line));
    return m ? { name: m[1], kind: "op", type: m[2].toLowerCase(), sig: m[3] } : null;
}
function opValue(sp, op) {
    const table = sp.type === "v" ? op.nodeVoltages : op.currents;
    const key = Object.keys(table).find(k => k.toLowerCase() === sp.sig.toLowerCase());
    if (key === undefined) throw new Error(`unknown ${sp.type === "v" ? "node" : "source"} ${sp.sig}`);
    return table[key];
}
const opToSpice = (sp) => `.meas op ${sp.name} find ${sp.type}(${sp.sig})`;

// ------------------------------------------------------------------------------------------------ simulate
function simulate(args) {
    const { deck, engine, circuit, warnings } = engineFor(args.netlist);
    const { type, card } = pickAnalysis(deck, args);
    const out = { analysis: type, warnings: warnings.slice(0, 10), nodes: circuit.names.filter(n => !n.includes("#") && !n.includes(".")) };
    const maxPoints = Math.min(Math.max(Math.round(num(args.maxPoints, 100)), 2), 2000);
    const opSpecs = [], measures = [];
    for (const m of args.measures || []) { const o = parseOpMeas(m); if (o) opSpecs.push(o); else { const sp = Measure.parse(m); if (!sp) throw new Error(`cannot read measurement: ${m}`); measures.push(sp); } }
    for (const line of String(args.netlist).split("\n")) { const o = parseOpMeas(line); if (o) opSpecs.push(o); }
    const measure = (specs, getSignal) => specs.map(sp => { try { return { name: sp.name, value: round(Measure.compute(sp, getSignal), 8), spec: Measure.toSpice(sp) }; } catch (e) { return { name: sp.name, error: e.message }; } });

    if (type === "op") {
        const op = engine.operatingPoint({ nodeset: deck.nodeset });
        out.nodeVoltages = Object.fromEntries(Object.entries(op.nodeVoltages).map(([k, v]) => [k, round(v)]));
        out.branchCurrents = Object.fromEntries(Object.entries(op.currents).filter(([k]) => !k.includes(".")).map(([k, v]) => [k, round(v)]));
        out.method = op.method;
        if (opSpecs.length) out.measures = opSpecs.map(sp => { try { return { name: sp.name, value: round(opValue(sp, op), 8), spec: opToSpice(sp) }; } catch (e) { return { name: sp.name, error: e.message }; } });
    } else if (type === "tran") {
        const tStop = num(args.tran && args.tran.tStop, card.tStop), tStep = num(args.tran && args.tran.tStep, card.tStep);
        if (!(tStop > 0) || !(tStep > 0)) throw new Error("a transient run needs tStop and tStep (in the deck's .tran card or the tran argument)");
        if (tStop / tStep > 5e6) throw new Error("too many time steps: increase tStep");
        const uic = args.tran && args.tran.uic !== undefined ? !!args.tran.uic : (card.uic !== undefined ? card.uic : true);
        const res = engine.transient({ tStop, tStep, uic, method: "trap", nodeIC: deck.ic });
        const get = Measure.tranSignals(res);
        out.steps = res.steps; out.rejectedSteps = res.rejected;
        out.signals = {};
        for (const s of (args.signals && args.signals.length ? args.signals : defaultSignals(circuit, "tran"))) {
            const sg = get(s), st = PlotMath.stats(sg.xs, sg.ys, sg.xs[0], sg.xs[sg.xs.length - 1]), rs = resample(sg.xs, sg.ys, maxPoints);
            out.signals[s] = { min: round(st.min), max: round(st.max), mean: round(st.mean), rms: round(st.rms), final: round(sg.ys[sg.ys.length - 1]), t: arr(rs.x), v: arr(rs.y) };
        }
        out.measures = measure(measures.concat((deck.measures || []).filter(m => m.kind === "tran")), get);
    } else if (type === "ac") {
        const fStart = num(args.ac && args.ac.fStart, card.fStart || 10), fStop = num(args.ac && args.ac.fStop, card.fStop || 1e6), ppd = num(args.ac && args.ac.pointsPerDecade, card.points || 20);
        const res = engine.ac({ fStart, fStop, pointsPerDecade: ppd });
        const get = Measure.acSignals(res);
        out.frequency = arr(resample(res.map(r => r.frequency), res.map(r => r.frequency), maxPoints).y);
        out.signals = {};
        for (const s of (args.signals && args.signals.length ? args.signals : defaultSignals(circuit, "ac"))) {
            const m = /^(vdb|vm|vp|v)\((.+)\)$/i.exec(s.trim());
            const sig = get(m ? `vdb(${m[2]})` : s);
            const f = sig.xs, rs = resample(f, sig.db, maxPoints), rp = resample(f, sig.ph, maxPoints);
            const a = PlotMath.ac(f, sig.db, sig.ph);
            out.signals[s] = { gain_db: arr(rs.y, 5), phase_deg: arr(rp.y, 5), peak_db: round(a.peak.db, 5), peak_at_hz: round(a.peak.x), bandwidth_3db_hz: a.bw.high === null ? null : round(a.bw.high), unity_gain_hz: a.unity ? round(a.unity.x) : null, phase_margin_deg: a.unity && a.unity.margin !== null ? round(a.unity.margin, 4) : null };
        }
        out.measures = measure(measures.concat((deck.measures || []).filter(m => m.kind === "ac")), get);
    } else if (type === "dc") {
        const sp = args.dc || card;
        const source = (sp.source || "").toUpperCase();
        const res = engine.dcSweep(source, num(sp.start, card.start), num(sp.stop, card.stop), num(sp.step, card.step));
        out.sweepSource = source; out.sweep = arr(res.sweep);
        out.signals = {};
        for (const s of (args.signals && args.signals.length ? args.signals : defaultSignals(circuit, "dc"))) {
            const m = /^([vi])\((.+)\)$/i.exec(s.trim());
            const table = m && (m[1].toLowerCase() === "v" ? res.nodeHistories : res.currentHistories);
            const key = m && Object.keys(table).find(k => k.toLowerCase() === m[2].toLowerCase());
            if (!key) throw new Error(`unknown signal ${s} (use v(node) or i(source))`);
            out.signals[s] = arr(table[key]);
        }
    } else if (type === "noise") {
        const n = args.noise || {};
        if (!n.output) throw new Error("noise needs noise.output (a node name) and noise.input (a source name)");
        const rows = engine.noise({ out: [String(n.output)], input: n.input ? String(n.input).toUpperCase() : null, fStart: num(n.fStart, 10), fStop: num(n.fStop, 1e6), pointsPerDecade: num(n.pointsPerDecade, 10) });
        let power = 0;
        for (let i = 1; i < rows.length; i++) power += 0.5 * (rows[i].onoise ** 2 + rows[i - 1].onoise ** 2) * (rows[i].frequency - rows[i - 1].frequency);
        const last = rows[Math.floor(rows.length / 2)];
        out.frequency = arr(rows.map(r => r.frequency)); out.output_noise_v_per_rthz = arr(rows.map(r => r.onoise));
        out.input_referred_v_per_rthz = rows[0].inoise === null ? null : arr(rows.map(r => r.inoise));
        out.integrated_output_noise_vrms = round(Math.sqrt(power));
        out.contributors_at_mid_band = Object.entries(last.parts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ source: k, share_percent: round(100 * v / Object.values(last.parts).reduce((s, x) => s + x, 0), 4) }));
    } else if (type === "tf") {
        const t = args.tf || {};
        if (!t.output || !t.input) throw new Error("tf needs tf.output (a node) and tf.input (a source name)");
        const r = engine.tf({ out: [String(t.output)], input: String(t.input).toUpperCase() });
        out.gain = round(r.gain); out.input_resistance_ohm = round(r.rin); out.output_resistance_ohm = round(r.rout);
    } else throw new Error(`unknown analysis "${type}"`);
    return out;
}

// ------------------------------------------------------------------------------------------------ sweep
// replace the value of ".param name=..." in the deck text
function setParam(netlist, name, value) {
    const re = new RegExp(`^(\\s*\\.param\\s+(?:[^\\n]*?\\s)?${name}\\s*=\\s*)\\S+`, "im");
    if (!re.test(netlist)) throw new Error(`the deck has no ".param ${name}=..." line to sweep (use {${name}} in the element values)`);
    return netlist.replace(re, (_, pre) => `${pre}${value}`);
}

function sweepValues(a) {
    if (Array.isArray(a.values)) return a.values.map(v => num(v));
    const n = Math.round(num(a.points, 5)), s = num(a.start), e = num(a.stop);
    if (!Number.isFinite(s) || !Number.isFinite(e) || n < 2) throw new Error("give values, or start, stop and points (at least 2)");
    return Array.from({ length: n }, (_, i) => (a.scale === "log" ? s * Math.pow(e / s, i / (n - 1)) : s + ((e - s) * i) / (n - 1)));
}

function sweep(args) {
    const values = sweepValues(args);
    if (values.length > 200) throw new Error("at most 200 sweep points");
    if (!args.measures || !args.measures.length) throw new Error("give at least one measurement, for example \".meas tran vpk max v(out)\"");
    const rows = values.map(v => {
        const text = setParam(args.netlist, args.param, v);
        const r = simulate({ ...args, netlist: text, signals: [], maxPoints: 2, analysis: args.analysis || (args.measures[0].match(/\.meas(?:ure)?\s+(\w+)/i) || [])[1] });
        return { [args.param]: v, measures: r.measures };
    });
    return { param: args.param, results: rows };
}

// ------------------------------------------------------------------------------------------------ Monte Carlo
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function monteCarlo(args) {
    const runs = Math.round(num(args.runs, 50));
    if (runs < 2 || runs > 1000) throw new Error("runs must be between 2 and 1000");
    if (!args.measure) throw new Error('give one measurement, for example ".meas tran vfinal find v(out) at=5m"');
    const opSpec = parseOpMeas(args.measure), spec = opSpec || Measure.parse(args.measure);
    if (!spec) throw new Error(`cannot read measurement: ${args.measure}`);
    const tol = Object.assign({ R: 5, C: 10, L: 10 }, args.tolerance_percent || {});
    const rand = rng(num(args.seed, 1));
    const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const base = parseDeck(args.netlist), values = [];
    const card = base.deck.analyses.find(a => a.type === spec.kind) || {};
    for (let i = 0; i < runs; i++) {
        const { deck } = parseDeck(args.netlist);
        for (const e of deck.elements) if (["R", "C", "L"].includes(e.kind) && tol[e.kind] > 0) {
            const t = tol[e.kind] / 100;
            e.value *= 1 + (args.distribution === "uniform" ? (rand() * 2 - 1) * t : Math.max(-t, Math.min(t, (gauss() * t) / 3)));
        }
        const { circuit } = SpiceParser.build(deck);
        const eng = new SimEngine(circuit, { temp: deck.temp === undefined ? 27 : deck.temp });
        try {
            if (opSpec) { values.push(opValue(opSpec, eng.operatingPoint({ nodeset: deck.nodeset }))); continue; }
            const get = spec.kind === "tran"
                ? Measure.tranSignals(eng.transient({ tStop: card.tStop, tStep: card.tStep, uic: card.uic !== false, nodeIC: deck.ic }))
                : Measure.acSignals(eng.ac({ fStart: card.fStart, fStop: card.fStop, pointsPerDecade: card.points || 20 }));
            values.push(Measure.compute(spec, get));
        } catch (e) { /* a run where the measurement cannot be made is skipped */ }
    }
    if (values.length < 2) throw new Error("the measurement could not be made in enough runs");
    const v = values.slice().sort((a, b) => a - b), n = v.length, mean = v.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
    const lo = args.limits && args.limits.min !== undefined ? num(args.limits.min) : -Infinity, hi = args.limits && args.limits.max !== undefined ? num(args.limits.max) : Infinity;
    const bins = Math.max(5, Math.min(20, Math.ceil(Math.log2(n)) + 1)), span = v[n - 1] - v[0] || 1, counts = new Array(bins).fill(0);
    for (const x of v) counts[Math.min(bins - 1, Math.floor(((x - v[0]) / span) * bins))]++;
    return { measurement: opSpec ? opToSpice(opSpec) : Measure.toSpice(spec), runs: n, mean: round(mean), std_dev: round(std), min: round(v[0]), max: round(v[n - 1]), median: round(v[n >> 1]), yield_percent: lo > -Infinity || hi < Infinity ? round((100 * v.filter(x => x >= lo && x <= hi).length) / n, 4) : undefined, histogram: { from: round(v[0]), to: round(v[n - 1]), counts } };
}

// ------------------------------------------------------------------------------------------------ check / compare / models
function checkDeck(args) {
    const { deck, circuit, warnings } = parseDeck(args.netlist);
    const kinds = {};
    for (const e of circuit.elements) if (!e.name.includes(".")) kinds[e.constructor.name] = (kinds[e.constructor.name] || 0) + 1;
    let op = null, opError = null;
    try { op = new SimEngine(circuit, { temp: deck.temp === undefined ? 27 : deck.temp }).operatingPoint(); } catch (e) { opError = e.message; }
    const nodes = circuit.names.filter(n => !n.includes("#") && !n.includes("."));
    return { title: deck.title, ok: !opError, operatingPointError: opError, warnings, elements: kinds, nodes, analyses: deck.analyses.map(a => a.type), measures: (deck.measures || []).map(m => Measure.toSpice(m)), subcircuits: Object.keys(deck.subckts || {}), operatingPointConverged: !!op };
}

function compareNgspice(args) {
    if (spawnSync("ngspice", ["-v"]).error) throw new Error("ngspice is not installed on this machine, so there is nothing to compare with");
    const { deck, engine, circuit } = engineFor(args.netlist);
    const nodes = circuit.names.filter(n => !n.includes("#") && !n.includes("."));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bs-cmp-"));
    let body = args.netlist.split("\n").filter(l => !/^\s*\.(op|tran|ac|dc|end|control|endc|print|plot)\b/i.test(l)).join("\n");
    // models taken from the built-in library (1N4148, 2N2222 ...) are not known to ngspice: hand them over as .model cards
    const given = new Set();
    for (const e of deck.elements) {
        if (!["D", "Q", "J", "M"].includes(e.kind) || !e.model || deck.models[e.model] || given.has(e.model)) continue;
        const kinds = e.kind === "D" ? ["D", "LED", "DZ"] : e.kind === "Q" ? ["BJT_NPN", "BJT_PNP"] : e.kind === "M" ? ["NMOS", "PMOS"] : ["JFET_N", "JFET_P"];
        for (const k of kinds) { const set = SIM_MODELS[k], key = set && Object.keys(set).find(x => x.toLowerCase() === e.model.toLowerCase()); if (key) { body += "\n" + simModelCardFromParams(k, e.model, set[key].params); given.add(e.model); if (e.kind === "M") {
                const lp = set[key].params, nm = e.name.replace(/[^A-Za-z0-9_]/g, "_"), [g, d, so] = e.nodes;
                if (lp.cgs > 0) body += `\nC${nm}_GS ${g} ${so} ${lp.cgs}`;
                if (lp.cgd > 0) body += `\nC${nm}_GD ${g} ${d} ${lp.cgd}`;
                if (lp.bodyDiode) body += `\n${k === "NMOS" ? `D${nm}_BD ${so} ${d}` : `D${nm}_BD ${d} ${so}`} BD_${nm}\n.model BD_${nm} D(IS=${lp.bodyDiode.is} N=${lp.bodyDiode.n === undefined ? 1 : lp.bodyDiode.n}${lp.bodyDiode.rs ? ` RS=${lp.bodyDiode.rs}` : ""})`;
            }
            if (e.kind === "M") body = body.split("\n").map(l => (/^\s*m/i.test(l) && new RegExp(`\\s${e.model}(\\s|$)`, "i").test(l) ? l.replace(/\s+[wl]\s*=\s*\S+/gi, "") : l)).join("\n"); break; } }
    }
    const tr = deck.analyses.find(a => a.type === "tran"), ac = deck.analyses.find(a => a.type === "ac");
    const ctl = [".control", "set noaskquit", "op", ...nodes.map(n => `print v(${n})`)];
    if (tr) ctl.push(`tran ${tr.tStep} ${tr.tStop}${tr.uic ? " uic" : ""}`, `wrdata ${tmp}/t.txt ${nodes.map(n => `v(${n})`).join(" ")}`);
    if (ac) ctl.push(`ac ${ac.mode} ${ac.points} ${ac.fStart} ${ac.fStop}`, `wrdata ${tmp}/a.txt ${nodes.map(n => `vm(${n})`).join(" ")}`);
    ctl.push("quit", ".endc", ".end");
    if (args.ngspice_method === "gear") body += "\n.options method=gear";
    fs.writeFileSync(`${tmp}/d.cir`, `${body}\n${ctl.join("\n")}\n`);
    const run = spawnSync("ngspice", ["-b", `${tmp}/d.cir`], { encoding: "utf8", timeout: 120000 });
    const text = run.stdout + run.stderr, ng = {};
    for (const m of text.matchAll(/^v\(([^)]+)\)\s*=\s*(\S+)/gm)) if (!(m[1] in ng)) ng[m[1]] = parseFloat(m[2]);
    const res = { nodes: nodes.length };
    const op = engine.operatingPoint().nodeVoltages;
    const span = Math.max(1, ...nodes.map(n => Math.abs(ng[n] || 0)));
    const dev = nodes.filter(n => n in ng).map(n => ({ node: n, builtin: round(op[n]), ngspice: round(ng[n]) }));
    res.operatingPoint = { worst_deviation_percent_of_full_scale: round(100 * Math.max(0, ...dev.map(d => Math.abs(d.builtin - d.ngspice) / span)), 4), nodes: dev.slice(0, 20) };
    const read = (file, k) => fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number)).filter(r => r.every(Number.isFinite)) : null;
    const t0 = Number(args.after) > 0 ? Number(args.after) : 0;          // ignore the start-up before this time (seconds) in the transient comparison
    const rows = tr && (read(`${tmp}/t.txt`) || []).filter(x => x[0] >= t0);
    if (rows && rows.length) {
        const r = new SimEngine(circuit, { temp: deck.temp === undefined ? 27 : deck.temp }).transient({ tStop: tr.tStop, tStep: tr.tStep, uic: tr.uic, nodeIC: deck.ic });
        let worst = 0, worstNode = "", worstMean = 0;
        const per = [];
        nodes.forEach((n, k) => {
            const ys = rows.map(x => x[2 * k + 1]), range = Math.max(Math.max(...ys) - Math.min(...ys), 0.05 * Math.max(...ys.map(Math.abs)), 1e-3);
            let acc = 0; rows.forEach((x, i) => { const d = PlotMath.valueAt(r.timePoints, r.nodeHistories[n], x[0]) - ys[i]; acc += d * d; });
            const rms = Math.sqrt(acc / rows.length) / range; if (rms > worst) { worst = rms; worstNode = n; }
            // the time average of each waveform: robust against small timing differences of fast edges
            const avg = (xs, vs) => { let a = 0; for (let i = 1; i < xs.length; i++) a += 0.5 * (vs[i] + vs[i - 1]) * (xs[i] - xs[i - 1]); return a / (xs[xs.length - 1] - xs[0]); };
            const k0 = r.timePoints.findIndex(t => t >= t0), bt = r.timePoints.slice(k0 < 0 ? 0 : k0), bv = r.nodeHistories[n].slice(k0 < 0 ? 0 : k0);
            const mean = Math.abs(avg(bt, bv) - avg(rows.map(x => x[0]), ys)) / range; worstMean = Math.max(worstMean, mean);
            per.push({ node: n, rms_deviation_percent_of_range: round(100 * rms, 4), mean_deviation_percent_of_range: round(100 * mean, 4) });
        });
        res.transient = { worst_rms_deviation_percent_of_range: round(100 * worst, 4), at_node: worstNode, worst_mean_deviation_percent_of_range: round(100 * worstMean, 4), nodes: per, note: "rms compares sample by sample and is dominated by the timing of fast switching edges; the mean compares the time averages" };
    }
    return res;
}

function listModels() {
    return Object.fromEntries(Object.entries(SIM_MODELS).map(([k, v]) => [k, Object.keys(v)]));
}

// ------------------------------------------------------------------------------------------------ registry
const NETLIST = { type: "string", description: "The SPICE deck as text (first line is the title). Supports R C L V I E G B D Q M J K X, .model, .subckt, .param, .ic, .tran/.ac/.dc/.op, .meas." };
const MEAS = { type: "array", items: { type: "string" }, description: 'SPICE measurements, e.g. ".meas tran vpk max v(out) from=1m to=5m", ".meas ac f3db when vdb(out)=-3 fall=1"' };

const TOOLS = [
    {
        name: "simulate", description: "Run one analysis of a SPICE deck on the Browser SPICE engine and return numbers an agent can reason about: operating point, transient waveforms (downsampled, with min/max/mean/rms/final), AC gain and phase (with peak, -3 dB bandwidth, unity-gain frequency, phase margin), DC sweep, noise or the small-signal transfer function. Optional .meas measurements are evaluated.",
        inputSchema: { type: "object", required: ["netlist"], properties: { netlist: NETLIST, analysis: { type: "string", enum: ["op", "tran", "ac", "dc", "noise", "tf"], description: "Default: the first analysis card in the deck, else op." }, tran: { type: "object", description: "tStop, tStep (seconds, SI suffixes allowed), uic (bool)" }, ac: { type: "object", description: "fStart, fStop, pointsPerDecade" }, dc: { type: "object", description: "source, start, stop, step" }, noise: { type: "object", description: "output (node), input (source name), fStart, fStop" }, tf: { type: "object", description: "output (node), input (source name)" }, signals: { type: "array", items: { type: "string" }, description: "e.g. [\"v(out)\", \"i(v1)\"]; AC also vdb/vp. Default: the first nodes." }, maxPoints: { type: "number", description: "Waveform points returned (default 100, max 2000)." }, measures: MEAS } },
        run: simulate
    },
    {
        name: "sweep", description: "Sweep a .param of the deck over a list or a linear/log range, run the analysis for each value and return the requested measurements. Use {name} in element values and a '.param name=value' line.",
        inputSchema: { type: "object", required: ["netlist", "param", "measures"], properties: { netlist: NETLIST, param: { type: "string", description: "Name of a .param line in the deck." }, values: { type: "array", items: { type: "number" } }, start: { type: "number" }, stop: { type: "number" }, points: { type: "number" }, scale: { type: "string", enum: ["lin", "log"] }, analysis: { type: "string", enum: ["tran", "ac"] }, tran: { type: "object" }, ac: { type: "object" }, measures: MEAS } },
        run: sweep
    },
    {
        name: "monte_carlo", description: "Tolerance analysis: vary every resistor, capacitor and inductor randomly (seeded, Gaussian with tolerance = 3 sigma, or uniform), measure one quantity each run, and return mean, sigma, min/max, yield against optional limits and a histogram.",
        inputSchema: { type: "object", required: ["netlist", "measure"], properties: { netlist: NETLIST, measure: { type: "string", description: 'One .meas line, e.g. ".meas tran vfinal find v(out) at=5m"' }, runs: { type: "number", description: "2-1000, default 50" }, seed: { type: "number" }, distribution: { type: "string", enum: ["gaussian", "uniform"] }, tolerance_percent: { type: "object", description: 'e.g. {"R": 1, "C": 5}; defaults R 5, C 10, L 10' }, limits: { type: "object", description: "min and/or max for the yield" } } },
        run: monteCarlo
    },
    {
        name: "check_deck", description: "Parse a SPICE deck and report warnings, element counts, nodes, analyses, .meas cards, subcircuits, and whether the DC operating point converges (and the error if not).",
        inputSchema: { type: "object", required: ["netlist"], properties: { netlist: NETLIST } },
        run: checkDeck
    },
    {
        name: "compare_with_ngspice", description: "Cross-check the deck against native ngspice (if installed): operating point, and transient when the deck has a .tran card. Returns the worst deviations.",
        inputSchema: { type: "object", required: ["netlist"], properties: { netlist: NETLIST, after: { type: "number", description: "Ignore the transient before this time (seconds) when comparing: a circuit can chatter chaotically at its first diode commutations, where two correct engines disagree about the phase." }, ngspice_method: { type: "string", enum: ["trap", "gear"], description: "Integration method ngspice uses (default trap). Its trapezoidal rule rings on nodes that only diode leakage holds (a floating transformer secondary between rectifier conductions) when the step is coarse; gear damps that, so use gear to compare such circuits." } } },
        run: compareNgspice
    },
    {
        name: "list_models", description: "List the built-in device models (diodes, BJTs, MOSFETs, op-amps ...) by kind, usable by name in .model-less decks of the schematic tool.",
        inputSchema: { type: "object", properties: {} },
        run: listModels
    }
];

TOOLS.push(...require("./pcb-tools.cjs").TOOLS);

module.exports = { TOOLS, simulate, sweep, monteCarlo, checkDeck, compareNgspice, listModels };

// SPICE netlist importer: parses standard .cir text (ngspice / LTspice / PSpice
// dialect basics) into a SimCircuit that the engine can run directly.
//
//   const deck = SpiceParser.parse(text);
//   const { circuit, warnings } = SpiceParser.build(deck);
//   new SimEngine(circuit).operatingPoint();
//
// Supported: R C L V I D Q M E G X(.subckt), .model (D NPN PNP NMOS PMOS level 1),
// DC / SIN / PULSE / PWL sources, .op .tran .ac .dc. Anything else is reported in
// `warnings` rather than silently ignored.

class SpiceParser {

    // SPICE number with engineering suffix: 1k 4.7u 10meg 1e-9 100pF
    static number(tok) {
        if (typeof tok === "number") return tok;
        const m = String(tok).trim().toLowerCase().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]*)/);
        if (!m) return NaN;
        const v = parseFloat(m[1]);
        const suf = m[2];
        if (!suf) return v;
        if (suf.startsWith("meg")) return v * 1e6;
        if (suf.startsWith("mil")) return v * 25.4e-6;
        const scale = { t: 1e12, g: 1e9, k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }[suf[0]];
        return scale === undefined ? v : v * scale;
    }

    // join continuation lines, drop comments, lowercase
    static logicalLines(text) {
        const raw = text.replace(/\r/g, "").split("\n");
        const lines = [];
        raw.forEach((line, i) => {
            if (i === 0) { lines.push({ text: line, title: true }); return; }
            const t = line.replace(/\$.*$/, "").replace(/;.*$/, "");
            if (/^\s*\*/.test(t) || !t.trim()) return;
            if (/^\s*\+/.test(t) && lines.length) {
                lines[lines.length - 1].text += " " + t.replace(/^\s*\+/, "");
            } else {
                lines.push({ text: t });
            }
        });
        return lines;
    }

    static tokens(line) {
        return line
            .replace(/\s*=\s*/g, "=")
            .replace(/[(),]/g, " ")
            .trim().toLowerCase().split(/\s+/).filter(Boolean);
    }

    static params(tokens) {
        const p = {};
        for (const t of tokens) {
            const i = t.indexOf("=");
            if (i > 0) p[t.slice(0, i)] = SpiceParser.number(t.slice(i + 1));
        }
        return p;
    }

    // evaluate  {a*2+1}  /  10k*3  style expressions with named parameters
    static evalExpr(src, params) {
        const t = src.toLowerCase().match(/[a-z_][a-z0-9_]*|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z]*|[-+*/^()]/g) || [];
        let i = 0;
        const peek = () => t[i], next = () => t[i++];
        const atom = () => {
            const k = next();
            if (k === undefined) throw new Error("incomplete expression: " + src);
            if (k === "(") { const v = sum(); next(); return v; }
            if (k === "-") return -atom();
            if (k === "+") return atom();
            if (/^[a-z_]/.test(k) && !(k in params) && isNaN(SpiceParser.number(k))) throw new Error(`unknown parameter ${k}`);
            return k in params ? params[k] : SpiceParser.number(k);
        };
        const pow = () => { let v = atom(); while (peek() === "^") { next(); v = Math.pow(v, atom()); } return v; };
        const prod = () => { let v = pow(); while (peek() === "*" || peek() === "/") { v = next() === "*" ? v * pow() : v / pow(); } return v; };
        const sum = () => { let v = prod(); while (peek() === "+" || peek() === "-") { v = next() === "+" ? v + prod() : v - prod(); } return v; };
        return sum();
    }

    // .param definitions, then {expr} substitution in every other line
    static applyParams(lines, warnings) {
        const params = {};
        const out = [];
        for (const l of lines) {
            if (!l.title && /^\s*\.param\b/i.test(l.text)) {
                for (const m of l.text.replace(/^\s*\.param\s*/i, "").matchAll(/([a-z_][a-z0-9_]*)\s*=\s*(\{[^}]*\}|\S+)/gi)) {
                    try { params[m[1].toLowerCase()] = SpiceParser.evalExpr(m[2].replace(/^\{|\}$/g, ""), params); }
                    catch (e) { warnings.push(`.param ${m[1]}: ${e.message}`); }
                }
                continue;
            }
            if (l.title) { out.push(l); continue; }
            out.push({ ...l, text: l.text.replace(/\{([^}]*)\}/g, (all, expr) => {
                try { return String(SpiceParser.evalExpr(expr, params)); }
                catch (e) { warnings.push(`{${expr}}: ${e.message}`); return "0"; }
            }) });
        }
        return out;
    }

    static parse(text) {
        const warnings = [];
        const deck = { title: "", elements: [], models: {}, subckts: {}, analyses: [], warnings };
        const lines = SpiceParser.applyParams(SpiceParser.logicalLines(text), warnings);
        let current = null; // open .subckt

        for (const { text: line, title } of lines) {
            if (title) { deck.title = line.replace(/^\*\s*/, "").trim(); continue; }
            const tok = SpiceParser.tokens(line);
            if (!tok.length) continue;
            const head = tok[0];

            if (head === ".end") break;
            if (head === ".subckt") {
                current = { name: tok[1], ports: tok.slice(2).filter(t => !t.includes("=")), elements: [] };
                deck.subckts[current.name] = current;
                continue;
            }
            if (head === ".ends") { current = null; continue; }

            if (head.startsWith(".")) {
                SpiceParser.directive(deck, tok, line, warnings);
                continue;
            }

            const el = SpiceParser.element(tok, line, warnings);
            if (el) (current ? current.elements : deck.elements).push(el);
        }
        return deck;
    }

    static directive(deck, tok, line, warnings) {
        const N = SpiceParser.number;
        switch (tok[0]) {
            case ".model": {
                const params = SpiceParser.params(tok.slice(3));
                deck.models[tok[1]] = { name: tok[1], type: tok[2], params };
                break;
            }
            case ".op": deck.analyses.push({ type: "op" }); break;
            case ".tran":
                deck.analyses.push({
                    type: "tran", tStep: N(tok[1]), tStop: N(tok[2]),
                    uic: tok.includes("uic")
                });
                break;
            case ".ac":
                deck.analyses.push({ type: "ac", mode: tok[1], points: N(tok[2]), fStart: N(tok[3]), fStop: N(tok[4]) });
                break;
            case ".dc":
                deck.analyses.push({ type: "dc", source: tok[1], start: N(tok[2]), stop: N(tok[3]), step: N(tok[4]) });
                break;
            case ".temp": deck.temp = N(tok[1]); break;
            case ".ic":
                deck.ic = deck.ic || {};
                for (const m of line.toLowerCase().matchAll(/v\(\s*([^)\s]+)\s*\)\s*=\s*(\S+)/g)) deck.ic[m[1]] = N(m[2]);
                break;
            case ".options": case ".option": case ".print": case ".plot":
            case ".probe": case ".save": case ".control": case ".endc": case ".include": case ".lib":
                warnings.push(`${tok[0]} is not supported and was ignored`);
                break;
            default:
                warnings.push(`unknown directive ${tok[0]} was ignored`);
        }
    }

    // a source's value spec: DC x | AC m p | SIN() | PULSE() | PWL()
    static sourceSpec(tok) {
        const N = SpiceParser.number;
        const spec = { dc: 0, acMag: 0, acPhase: 0, wave: null };
        for (let i = 0; i < tok.length; i++) {
            const t = tok[i];
            if (t === "dc") { spec.dc = N(tok[++i]); }
            else if (t === "ac") {
                spec.acMag = N(tok[++i]);
                if (i + 1 < tok.length && !isNaN(N(tok[i + 1])) && /^[-+.\d]/.test(tok[i + 1])) spec.acPhase = N(tok[++i]);
            } else if (t === "sin" || t === "pulse" || t === "pwl") {
                const args = [];
                while (i + 1 < tok.length && /^[-+.\d]/.test(tok[i + 1]) && !["dc", "ac"].includes(tok[i + 1])) args.push(N(tok[++i]));
                spec.wave = { kind: t, args };
            } else if (i === 0 && /^[-+.\d]/.test(t)) {
                spec.dc = N(t);
            }
        }
        return spec;
    }

    static element(tok, line, warnings) {
        const N = SpiceParser.number;
        const name = tok[0];
        const kind = name[0];

        switch (kind) {
            case "r": return { kind: "R", name, nodes: [tok[1], tok[2]], value: N(tok[3]) };
            case "c": return { kind: "C", name, nodes: [tok[1], tok[2]], value: N(tok[3]), ic: SpiceParser.params(tok).ic };
            case "l": return { kind: "L", name, nodes: [tok[1], tok[2]], value: N(tok[3]), ic: SpiceParser.params(tok).ic };
            case "v":
            case "i":
                return { kind: kind.toUpperCase(), name, nodes: [tok[1], tok[2]], spec: SpiceParser.sourceSpec(tok.slice(3)) };
            case "d": return { kind: "D", name, nodes: [tok[1], tok[2]], model: tok[3] };
            case "q": {
                // Q c b e [substrate] model
                const hasSub = tok.length >= 6 && !tok[5].includes("=");
                return { kind: "Q", name, nodes: [tok[1], tok[2], tok[3]], model: tok[hasSub ? 5 : 4] };
            }
            case "m": {
                const p = SpiceParser.params(tok.slice(6));
                return { kind: "M", name, nodes: [tok[2], tok[1], tok[3]], model: tok[5], w: p.w, l: p.l };
            }
            case "e": return { kind: "E", name, nodes: [tok[1], tok[2], tok[3], tok[4]], gain: N(tok[5]) };
            case "g": return { kind: "G", name, nodes: [tok[1], tok[2], tok[3], tok[4]], gm: N(tok[5]) };
            case "x": return { kind: "X", name, nodes: tok.slice(1, -1).filter(t => !t.includes("=")), sub: tok.filter(t => !t.includes("=")).pop() };
            default:
                warnings.push(`element ${name} (${kind.toUpperCase()}) is not supported and was ignored`);
                return null;
        }
    }

    // ---- build ---------------------------------------------------------------

    static waveFor(spec, kind) {
        const w = spec.wave;
        if (!w) return Waveform.dc(spec.dc);
        const a = w.args;
        if (w.kind === "sin") {
            return Waveform.sin({ offset: a[0] || 0, amp: a[1] || 0, freq: a[2] || 1e3, delay: a[3] || 0, damp: a[4] || 0, phase: a[5] || 0 });
        }
        if (w.kind === "pulse") {
            return Waveform.pulse({
                v1: a[0] || 0, v2: a[1] || 0, delay: a[2] || 0, rise: a[3] || 1e-9, fall: a[4] || 1e-9,
                width: a[5] === undefined ? 1e-3 : a[5], period: a[6] || 0
            });
        }
        const pts = [];
        for (let i = 0; i + 1 < a.length; i += 2) pts.push([a[i], a[i + 1]]);
        return Waveform.pwl(pts);
    }

    static diodeParams(m) {
        const p = m ? m.params : {};
        return {
            is: p.is || 1e-14, n: p.n || 1, rs: p.rs || 0,
            bv: p.bv || Infinity, ibv: p.ibv || 1e-3, nbv: p.nbv || 1,
            cjo: p.cjo || p.cj0 || 0, vj: p.vj || 1, m: p.m || 0.5, fc: p.fc || 0.5, tt: p.tt || 0,
            eg: p.eg || 1.11, xti: p.xti === undefined ? 3 : p.xti
        };
    }

    static bjtParams(m) {
        const p = m ? m.params : {};
        return {
            is: p.is || 1e-16, bf: p.bf || 100, br: p.br || 1, nf: p.nf || 1, nr: p.nr || 1,
            vaf: p.vaf || p.va || 0,
            cje: p.cje || 0, vje: p.vje || 0.75, mje: p.mje || 0.33,
            cjc: p.cjc || 0, vjc: p.vjc || 0.75, mjc: p.mjc || 0.33,
            tf: p.tf || 0, tr: p.tr || 0, fc: p.fc || 0.5,
            eg: p.eg || 1.11, xti: p.xti === undefined ? 3 : p.xti, xtb: p.xtb || 0
        };
    }

    static mosParams(m, w, l) {
        const p = m ? m.params : {};
        const ratio = (w || 1e-4) / (l || 1e-4);
        return { vto: Math.abs(p.vto === undefined ? 0 : p.vto), beta: (p.kp || 2e-5) * ratio, lambda: p.lambda || 0 };
    }

    // flatten subcircuits into a plain element list with prefixed names / nodes
    static flatten(deck, elements, prefix, portMap, warnings, depth = 0) {
        const out = [];
        const mapNode = (n) => {
            if (n === "0" || n === "gnd") return "0";
            if (portMap && portMap.has(n)) return portMap.get(n);
            return prefix ? `${prefix}.${n}` : n;
        };
        for (const el of elements) {
            if (el.kind !== "X") {
                out.push({ ...el, name: prefix ? `${prefix}.${el.name}` : el.name, nodes: el.nodes.map(mapNode) });
                continue;
            }
            const sub = deck.subckts[el.sub];
            if (!sub || depth > 8) { warnings.push(`subcircuit ${el.sub} for ${el.name} not found`); continue; }
            const map = new Map();
            sub.ports.forEach((port, i) => map.set(port, mapNode(el.nodes[i])));
            out.push(...SpiceParser.flatten(deck, sub.elements, prefix ? `${prefix}.${el.name}` : el.name, map, warnings, depth + 1));
        }
        return out;
    }

    static build(deck) {
        const warnings = [...deck.warnings];
        const circuit = new SimCircuit();
        const els = SpiceParser.flatten(deck, deck.elements, "", null, warnings);
        const model = (name, what) => {
            const m = deck.models[name];
            if (!m) warnings.push(`model ${name} for ${what} not found, using defaults`);
            return m;
        };

        for (const e of els) {
            const nm = e.name.toUpperCase();
            switch (e.kind) {
                case "R": circuit.add(new Resistor(nm, e.nodes, { r: e.value })); break;
                case "C": circuit.add(new Capacitor(nm, e.nodes, { c: e.value, ic: e.ic })); break;
                case "L": circuit.add(new Inductor(nm, e.nodes, { l: e.value, ic: e.ic })); break;
                case "V":
                    circuit.add(new VoltageSource(nm, e.nodes, {
                        wave: SpiceParser.waveFor(e.spec), acMag: e.spec.acMag, acPhase: e.spec.acPhase
                    }));
                    break;
                case "I": circuit.add(new CurrentSource(nm, e.nodes, { wave: SpiceParser.waveFor(e.spec) })); break;
                case "D": circuit.add(new Diode(nm, e.nodes, SpiceParser.diodeParams(model(e.model, e.name)))); break;
                case "Q": {
                    const m = model(e.model, e.name);
                    const pol = m && m.type === "pnp" ? -1 : 1;
                    // SPICE order is C B E; the engine takes B C E
                    circuit.add(new BJT(nm, [e.nodes[1], e.nodes[0], e.nodes[2]], pol, SpiceParser.bjtParams(m)));
                    break;
                }
                case "M": {
                    const m = model(e.model, e.name);
                    const pol = m && m.type === "pmos" ? -1 : 1;
                    // e.nodes is [g, d, s]
                    circuit.add(new MOSFET(nm, e.nodes, pol, SpiceParser.mosParams(m, e.w, e.l)));
                    break;
                }
                case "E": circuit.add(new VCVS(nm, e.nodes, { gain: e.gain })); break;
                case "G": circuit.add(new VCCS(nm, e.nodes, { gm: e.gm })); break;
            }
        }
        return { circuit, warnings };
    }
}

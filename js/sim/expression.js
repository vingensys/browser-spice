// Behavioural expressions for B sources (SPICE "B1 out 0 V = 2*v(in) + sin(2*pi*1k*time)").
//
//   const e = Expr.compile("v(a,b)*i(vsense) + limit(time*1k, 0, 1)");
//   e.vars   [{ type: "v", a: "a", b: "b" }, { type: "i", name: "vsense" }]   the circuit values it reads
//   e.eval(values, time)        values[k] belongs to vars[k]
//
// Grammar: numbers with SPICE suffixes, + - * / % ^ **, unary - + !, comparisons, && ||, a ? b : c, parentheses and
// the usual functions (abs sqrt exp ln log log10 sin cos tan asin acos atan atan2 sinh cosh tanh min max pow pwr
// sgn floor ceil int round limit u uramp if). Names are case-insensitive. `time` is the simulation time.

class Expr {
    static FUNCS = {
        abs: [1, Math.abs], sqrt: [1, (x) => Math.sqrt(Math.max(x, 0))], exp: [1, (x) => Math.exp(Math.min(x, 700))],
        ln: [1, (x) => Math.log(Math.max(x, 1e-300))], log: [1, (x) => Math.log(Math.max(x, 1e-300))],   // log is the natural log, as in ngspice log10: [1, (x) => Math.log10(Math.max(x, 1e-300))],
        sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan], asin: [1, (x) => Math.asin(Math.min(1, Math.max(-1, x)))], acos: [1, (x) => Math.acos(Math.min(1, Math.max(-1, x)))],
        atan: [1, Math.atan], atan2: [2, Math.atan2], sinh: [1, (x) => Math.sinh(Math.max(-700, Math.min(700, x)))], cosh: [1, (x) => Math.cosh(Math.max(-700, Math.min(700, x)))], tanh: [1, Math.tanh],
        min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow], pwr: [2, (x, y) => Math.sign(x) * Math.pow(Math.abs(x), y)],
        sgn: [1, Math.sign], floor: [1, Math.floor], ceil: [1, Math.ceil], int: [1, Math.trunc], round: [1, Math.round],
        limit: [3, (x, lo, hi) => Math.min(Math.max(x, Math.min(lo, hi)), Math.max(lo, hi))],
        u: [1, (x) => (x > 0 ? 1 : 0)], uramp: [1, (x) => Math.max(x, 0)], if: [3, (c, a, b) => (c ? a : b)]
    };

    static SI = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

    static number(text) {
        const m = /^((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/.exec(text);
        if (!m) throw new Error(`bad number "${text}"`);
        const suf = m[2];
        if (!suf) return Number(m[1]);
        const key = suf.startsWith("meg") ? "meg" : suf[0];
        if (!(key in Expr.SI)) return Number(m[1]);          // a unit such as "v" or "s" after the number
        return Number(m[1]) * Expr.SI[key];
    }

    static tokenize(src) {
        const out = [];
        const re = /\s*(?:((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z]*)|([a-z_][a-z0-9_.#$]*)|(\*\*|<=|>=|==|!=|&&|\|\||[-+*/%^()<>!?:,]))/giy;
        let pos = 0, m;
        src = src.trim().replace(/^\{|\}$/g, "");
        while (pos < src.length) {
            re.lastIndex = pos;
            m = re.exec(src);
            if (!m) throw new Error(`unexpected "${src.slice(pos).trim()[0]}" in expression "${src}"`);
            pos = re.lastIndex;
            if (m[1] !== undefined) out.push({ t: "num", v: Expr.number(m[1].toLowerCase()) });
            else if (m[2] !== undefined) out.push({ t: "id", v: m[2].toLowerCase() });
            else out.push({ t: "op", v: m[3] });
            if (/^\s*$/.test(src.slice(pos))) break;
        }
        return out;
    }

    // compile to { vars, eval }
    static compile(text) {
        const toks = Expr.tokenize(String(text)), vars = [], keys = new Map();
        let i = 0;
        const peek = () => toks[i], next = () => toks[i++];
        const isOp = (v) => toks[i] && toks[i].t === "op" && toks[i].v === v;
        const expect = (v) => { if (!isOp(v)) throw new Error(`expected "${v}" in expression "${text}"`); i++; };
        const addVar = (v) => { const k = `${v.type}:${v.a || v.name}:${v.b || ""}`; if (!keys.has(k)) { keys.set(k, vars.length); vars.push(v); } return keys.get(k); };

        const ternary = () => {
            const c = orExpr();
            if (isOp("?")) { next(); const a = ternary(); expect(":"); const b = ternary(); return (V, T) => (c(V, T) ? a(V, T) : b(V, T)); }
            return c;
        };
        const orExpr = () => { let l = andExpr(); while (isOp("||")) { next(); const a = l, b = andExpr(); l = (V, T) => (a(V, T) || b(V, T) ? 1 : 0); } return l; };
        const andExpr = () => { let l = cmp(); while (isOp("&&")) { next(); const a = l, b = cmp(); l = (V, T) => (a(V, T) && b(V, T) ? 1 : 0); } return l; };
        const cmp = () => {
            let l = add();
            while (peek() && peek().t === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(peek().v)) {
                const op = next().v, a = l, b = add();
                l = { "<": (V, T) => (a(V, T) < b(V, T) ? 1 : 0), ">": (V, T) => (a(V, T) > b(V, T) ? 1 : 0), "<=": (V, T) => (a(V, T) <= b(V, T) ? 1 : 0), ">=": (V, T) => (a(V, T) >= b(V, T) ? 1 : 0), "==": (V, T) => (a(V, T) === b(V, T) ? 1 : 0), "!=": (V, T) => (a(V, T) !== b(V, T) ? 1 : 0) }[op];
            }
            return l;
        };
        const add = () => {
            let l = mul();
            while (isOp("+") || isOp("-")) { const op = next().v, a = l, b = mul(); l = op === "+" ? (V, T) => a(V, T) + b(V, T) : (V, T) => a(V, T) - b(V, T); }
            return l;
        };
        const mul = () => {
            let l = unary();
            while (isOp("*") || isOp("/") || isOp("%")) {
                const op = next().v, a = l, b = unary();
                l = op === "*" ? (V, T) => a(V, T) * b(V, T) : op === "/" ? (V, T) => { const d = b(V, T); return a(V, T) / (d === 0 ? 1e-300 : d); } : (V, T) => a(V, T) % b(V, T);
            }
            return l;
        };
        const unary = () => {
            if (isOp("-")) { next(); const a = unary(); return (V, T) => -a(V, T); }
            if (isOp("+")) { next(); return unary(); }
            if (isOp("!")) { next(); const a = unary(); return (V, T) => (a(V, T) ? 0 : 1); }
            return power();
        };
        // the exponent of ^ is a primary with an optional sign; chains group to the left, as in ngspice (2^3^2 = 64)
        const exponent = () => {
            if (isOp("-")) { next(); const a = exponent(); return (V, T) => -a(V, T); }
            if (isOp("+")) { next(); return exponent(); }
            return primary();
        };
        const power = () => {
            let base = primary();
            while (isOp("^") || isOp("**")) {
                next();
                const b = base, e = exponent();
                base = (V, T) => { const x = b(V, T), y = e(V, T), r = Math.pow(x, y); return Number.isFinite(r) ? r : (x < 0 ? 0 : r); };
            }
            return base;
        };
        const primary = () => {
            const tk = next();
            if (!tk) throw new Error(`expression "${text}" ends too soon`);
            if (tk.t === "num") { const v = tk.v; return () => v; }
            if (tk.t === "op" && tk.v === "(") { const e = ternary(); expect(")"); return e; }
            if (tk.t !== "id") throw new Error(`unexpected "${tk.v}" in expression "${text}"`);
            const name = tk.v;
            if (!isOp("(")) {
                if (name === "time") return (V, T) => T;
                if (name === "pi") return () => Math.PI;
                if (name === "true") return () => 1;
                if (name === "false") return () => 0;
                throw new Error(`unknown name "${name}" in expression "${text}"`);
            }
            next();                                                   // (
            if (name === "v") {
                const a = next(); let b = null;
                if (isOp(",")) { next(); b = next(); }
                expect(")");
                if (!a || a.t === "op" || (b && b.t === "op")) throw new Error(`v() needs node names in "${text}"`);
                const k = addVar({ type: "v", a: String(a.v), b: b ? String(b.v) : null });
                return (V) => V[k];
            }
            if (name === "i") {
                const a = next(); expect(")");
                if (!a || a.t === "op") throw new Error(`i() needs a source name in "${text}"`);
                const k = addVar({ type: "i", name: String(a.v) });
                return (V) => V[k];
            }
            const f = Expr.FUNCS[name];
            if (!f) throw new Error(`unknown function ${name}() in expression "${text}"`);
            const args = [];
            if (!isOp(")")) { args.push(ternary()); while (isOp(",")) { next(); args.push(ternary()); } }
            expect(")");
            if (args.length !== f[0]) throw new Error(`${name}() takes ${f[0]} argument${f[0] > 1 ? "s" : ""} in "${text}"`);
            const fn = f[1];
            if (args.length === 1) { const a = args[0]; return (V, T) => fn(a(V, T)); }
            if (args.length === 2) { const [a, b] = args; return (V, T) => fn(a(V, T), b(V, T)); }
            const [a, b, c] = args; return (V, T) => fn(a(V, T), b(V, T), c(V, T));
        };

        const root = ternary();
        if (i < toks.length) throw new Error(`unexpected "${toks[i].v}" in expression "${text}"`);
        return { vars, text: String(text), eval: (values, time = 0) => { const r = root(values, time); return Number.isFinite(r) ? r : 0; } };
    }

    // the same expression for ngspice, which has no limit(), if(), atan2(), int() or round(): the first two are rewritten
    // in terms of functions it has; the others are returned unchanged and listed in `unsupported`
    static toSpice(text) {
        const unsupported = new Set();
        const rewrite = (src) => {
            const re = /\b(limit|if)\s*\(/i;
            for (let guard = 0; guard < 50; guard++) {
                const m = re.exec(src);
                if (!m) break;
                let depth = 1, i = m.index + m[0].length, start = i;
                const args = [];
                for (; i < src.length && depth > 0; i++) {
                    const ch = src[i];
                    if (ch === "(") depth++;
                    else if (ch === ")") { depth--; if (!depth) args.push(src.slice(start, i)); }
                    else if (ch === "," && depth === 1) { args.push(src.slice(start, i)); start = i + 1; }
                }
                const a = args.map(x => rewrite(x.trim()));
                const out = m[1].toLowerCase() === "limit" && a.length === 3 ? `max(min(${a[1]},${a[2]}),min(max(${a[1]},${a[2]}),${a[0]}))`
                    : m[1].toLowerCase() === "if" && a.length === 3 ? `((${a[0]})?(${a[1]}):(${a[2]}))` : null;
                if (out === null) break;
                src = src.slice(0, m.index) + out + src.slice(i);
            }
            return src;
        };
        const out = rewrite(String(text));
        for (const f of ["atan2", "int", "round"]) if (new RegExp(`\\b${f}\\s*\\(`, "i").test(out)) unsupported.add(f);
        return { text: out, unsupported: [...unsupported] };
    }
}

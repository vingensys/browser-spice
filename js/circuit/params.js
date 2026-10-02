// Design parameters: named values (with expressions) that part values can use as {name} or {expression}.
//
//   Design > Parameters…   rbias = 47k     gain = 10     rf = {gain*1k}
//   a resistor's value:    {rbias}         {rf/2}        an amplitude: {vin*0.5}
//
// Parameters are substituted just while the netlist is extracted, so every analysis, the SPICE export and the sweeps
// see plain numbers; the schematic keeps showing the {names}. Sweeps can vary a parameter, which moves every part
// that uses it at once.

class DesignParams {
    static RESERVED = new Set(["pi", "time", "true", "false", "v", "i"]);
    static NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

    // list: [{ name, value }] where value is text (a number with SI suffix, or an expression of other parameters).
    // Returns { values: { name: number }, errors: { name: message } }.
    static resolve(list) {
        const values = {}, errors = {}, pending = [];
        for (const p of list || []) {
            const name = String(p.name || "").trim();
            if (!name) continue;
            if (!DesignParams.NAME.test(name)) { errors[name] = "a parameter name is letters, digits and _, not starting with a digit"; continue; }
            if (DesignParams.RESERVED.has(name.toLowerCase())) { errors[name] = `${name} is reserved`; continue; }
            if (name.toLowerCase() in values || pending.some(q => q.name.toLowerCase() === name.toLowerCase())) { errors[name] = "defined twice"; continue; }
            pending.push({ name: name.toLowerCase(), shown: name, text: String(p.value === undefined ? "" : p.value).trim().replace(/^\{|\}$/g, "") });
        }
        // evaluate in dependency order: keep going until nothing more resolves
        let left = pending;
        for (let progress = true; progress && left.length;) {
            progress = false;
            const next = [];
            for (const p of left) {
                try {
                    if (!p.text) throw new Error("no value");
                    values[p.name] = Expr.compile(p.text, values).eval([], 0);
                    progress = true;
                } catch (e) { p.err = e.message; next.push(p); }
            }
            left = next;
        }
        for (const p of left) errors[p.shown] = /unknown name/.test(p.err) ? `${p.err.replace(/ in expression.*$/, "")} (or a circular definition)` : p.err;
        return { values, errors };
    }

    // text with {expr} pieces replaced by numbers; throws a plain-words error for an unknown name
    static substitute(text, values) {
        return String(text).replace(/\{([^{}]*)\}/g, (_, inner) => {
            let v;
            try { v = Expr.compile(inner, values).eval([], 0); }
            catch (e) { throw new Error(`${e.message.replace(/ in expression.*$/, "")} (in {${inner}})`); }
            return String(Number(v.toPrecision(9)));
        });
    }

    static SKIP = new Set(["name", "text", "id", "type", "model", "customParams"]);

    // run fn with every {…} in the parts' values replaced by its number, then put the originals back
    static with(editor, fn) {
        const list = editor.params || [];
        const touched = [];
        const any = editor.components.some(c => Object.entries(c).some(([k, v]) => typeof v === "string" && !DesignParams.SKIP.has(k) && v.includes("{")));
        if (!any && !list.length) return fn();
        const { values, errors } = DesignParams.resolve(list);
        try {
            for (const c of editor.components) {
                for (const k of Object.keys(c)) {
                    const v = c[k];
                    if (typeof v !== "string" || DesignParams.SKIP.has(k) || !v.includes("{")) continue;
                    let out;
                    try { out = DesignParams.substitute(v, values); }
                    catch (e) {
                        const bad = Object.keys(errors).find(n => e.message.includes(n.toLowerCase()) || e.message.includes(n));
                        throw new Error(`${c.name}: ${e.message}${bad ? `. Parameter ${bad}: ${errors[bad]}` : ""}`);
                    }
                    touched.push([c, k, v]);
                    c[k] = out;
                }
            }
            return fn();
        } finally {
            for (const [c, k, v] of touched) c[k] = v;
        }
    }
}

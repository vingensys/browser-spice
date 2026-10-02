// Imports a KiCad schematic (.kicad_sch, KiCad 6+) or a KiCad netlist (.net, "export" format) as an editable schematic.
//
// KiCad stores only symbols, wires and labels; the connectivity has to be recomputed. This reads the S-expressions,
// places every symbol pin on the sheet (position, rotation, mirror), joins pins, wire ends, junctions and labels
// that meet, and merges nets that share a name (labels, global labels, power symbols). The result is turned into a
// SPICE deck and handed to SchematicImporter, so the layout and the parts come out the same as for a SPICE import.
// Mapped: R C L (also polarised), D / LED / Zener, BJT, MOSFET, JFET, DC / AC / pulse sources from Sim.* fields or the
// value, power symbols as nets (GND is node 0). Symbols with no mapping are listed as warnings, never dropped silently.
// Hierarchical sheets are not followed (only the sheet that was opened).

class KicadImporter {

    // ---------------------------------------------------------------- S-expressions
    static parseSexp(text) {
        let i = 0;
        const n = text.length;
        const read = () => {
            while (i < n && /\s/.test(text[i])) i++;
            if (text[i] === "(") {
                i++;
                const list = [];
                for (;;) {
                    while (i < n && /\s/.test(text[i])) i++;
                    if (i >= n) throw new Error("Unbalanced parentheses: the file is truncated.");
                    if (text[i] === ")") { i++; return list; }
                    list.push(read());
                }
            }
            if (text[i] === '"') {
                let s = "";
                i++;
                while (i < n && text[i] !== '"') {
                    if (text[i] === "\\" && i + 1 < n) { i++; s += text[i] === "n" ? "\n" : text[i]; } else s += text[i];
                    i++;
                }
                i++;
                return { s };
            }
            let a = i;
            while (i < n && !/[\s()]/.test(text[i])) i++;
            if (a === i) throw new Error("Unexpected character in the file.");
            return text.slice(a, i);
        };
        const root = read();
        return root;
    }

    static str(x) { return x && typeof x === "object" && !Array.isArray(x) ? x.s : (typeof x === "string" ? x : undefined); }
    static head(l) { return Array.isArray(l) && typeof l[0] === "string" ? l[0] : null; }
    static kids(l, name) { return l.filter(x => KicadImporter.head(x) === name); }
    static kid(l, name) { return l.find(x => KicadImporter.head(x) === name); }
    static num(x) { return Number(typeof x === "string" ? x : KicadImporter.str(x)); }

    // ---------------------------------------------------------------- schematic -> components with pin nets
    static fromSchematic(root, warnings) {
        const K = KicadImporter, { kids, kid, str } = K;
        if (K.head(root) !== "kicad_sch") throw new Error("This is not a KiCad schematic.");
        const libs = new Map();
        for (const s of kids(kid(root, "lib_symbols") || [], "symbol")) {
            const id = str(s[1]);
            const pins = [];
            for (const sub of kids(s, "symbol")) for (const p of kids(sub, "pin")) pins.push(K.libPin(p));
            for (const p of kids(s, "pin")) pins.push(K.libPin(p));
            libs.set(id, { pins, power: !!kid(s, "power") });
        }

        // union-find over points and names
        const parent = new Map();
        const find = (a) => { if (!parent.has(a)) parent.set(a, a); while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
        const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
        const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
        const xy = (l) => { const at = kid(l, "at"); return at ? [K.num(at[1]), K.num(at[2]), K.num(at[3] || 0)] : [0, 0, 0]; };

        const segs = [];
        for (const w of kids(root, "wire")) {
            const pts = kids(kid(w, "pts") || [], "xy").map(p => [K.num(p[1]), K.num(p[2])]);
            for (let i = 0; i + 1 < pts.length; i++) { segs.push([pts[i], pts[i + 1]]); union(key(...pts[i]), key(...pts[i + 1])); }
        }
        const onSeg = (x, y) => segs.find(([a, b]) => {
            const cx = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
            if (Math.abs(cx) > 1e-3 * Math.hypot(b[0] - a[0], b[1] - a[1])) return false;
            return x >= Math.min(a[0], b[0]) - 1e-3 && x <= Math.max(a[0], b[0]) + 1e-3 && y >= Math.min(a[1], b[1]) - 1e-3 && y <= Math.max(a[1], b[1]) + 1e-3;
        });
        // a point that meets a wire anywhere along it joins that wire (pins, labels and junctions)
        const touch = (x, y) => { const k = key(x, y), s = onSeg(x, y); if (s) union(k, key(...s[0])); return k; };

        for (const j of kids(root, "junction")) { const [x, y] = xy(j); touch(x, y); }

        const names = new Map();   // point key -> net name
        const nameAt = (k, name) => { union(k, `name:${name}`); names.set(k, name); };
        for (const l of kids(root, "label")) { const [x, y] = xy(l); nameAt(touch(x, y), str(l[1])); }
        for (const l of kids(root, "global_label")) { const [x, y] = xy(l); nameAt(touch(x, y), str(l[1])); }
        for (const l of kids(root, "hierarchical_label")) { const [x, y] = xy(l); nameAt(touch(x, y), str(l[1])); }
        if (kids(root, "sheet").length) warnings.push("hierarchical sheets are not followed: only this sheet was imported");

        const comps = [];
        for (const sym of kids(root, "symbol")) {
            const libId = str(kid(sym, "lib_id")[1]), lib = libs.get(libId);
            const props = {};
            for (const p of kids(sym, "property")) props[str(p[1])] = str(p[2]);
            const ref = props.Reference || "?";
            const [sx, sy, rot] = xy(sym);
            const mir = kid(sym, "mirror") ? str(kid(sym, "mirror")[1]) || kid(sym, "mirror")[1] : "";
            const unit = Number(kid(sym, "unit") ? kid(sym, "unit")[1] : 1);
            if (!lib) { warnings.push(`${ref}: symbol ${libId} has no definition in the file, skipped`); continue; }
            const th = (rot * Math.PI) / 180, c = Math.round(Math.cos(th) * 1e6) / 1e6, s = Math.round(Math.sin(th) * 1e6) / 1e6;
            const pinNets = [];
            for (const p of lib.pins) {
                if (p.unit && p.unit !== 0 && p.unit !== unit) continue;
                let lx = p.x, ly = p.y;
                if (mir === "x") ly = -ly;
                if (mir === "y") lx = -lx;
                const a = lx, b = -ly;
                const px = sx + a * c + b * s, py = sy - a * s + b * c;
                pinNets.push({ number: p.number, name: p.name, type: p.type, key: touch(px, py) });
            }
            // a power symbol names the net its pin sits on
            if (lib.power || /^#PWR|^#FLG/.test(ref)) {
                if (/^#FLG/.test(ref)) continue;
                const net = props.Value || libId.replace(/^.*:/, "");
                for (const p of pinNets) nameAt(p.key, net);
                continue;
            }
            comps.push({ ref, value: props.Value || "", libId, props, pins: pinNets });
        }
        for (const nc of kids(root, "no_connect")) { /* open pins stay on their own net */ }

        // net numbers / names
        const nameOf = new Map();    // root -> name
        for (const [k, name] of names) nameOf.set(find(k), name);
        let auto = 0;
        const netOf = (k) => {
            const r = find(k);
            if (!nameOf.has(r)) nameOf.set(r, `N${++auto}`);
            return nameOf.get(r);
        };
        for (const c of comps) for (const p of c.pins) p.net = netOf(p.key);
        return comps;
    }

    static libPin(p) {
        const K = KicadImporter, at = K.kid(p, "at");
        return { x: K.num(at[1]), y: K.num(at[2]), type: p[1], name: K.str(K.kid(p, "name")[1]) || "", number: K.str(K.kid(p, "number")[1]) || "", unit: 0 };
    }

    // ---------------------------------------------------------------- netlist (.net) -> components
    static fromNetlist(root, warnings) {
        const K = KicadImporter, { kids, kid, str } = K;
        const comps = new Map();
        for (const c of kids(kid(root, "components") || [], "comp")) {
            const ref = str(kid(c, "ref")[1]), ls = kid(c, "libsource");
            const props = {};
            for (const f of kids(kid(c, "fields") || [], "field")) props[str(f[1][1])] = str(f[2]);
            comps.set(ref, { ref, value: kid(c, "value") ? str(kid(c, "value")[1]) : "", libId: ls ? `${str(kid(ls, "lib")[1])}:${str(kid(ls, "part")[1])}` : "", props, pins: [] });
        }
        for (const net of kids(kid(root, "nets") || [], "net")) {
            const name = str(kid(net, "name")[1]);
            for (const nd of kids(net, "node")) {
                const c = comps.get(str(kid(nd, "ref")[1]));
                if (!c) continue;
                const pf = kid(nd, "pinfunction"), pt = kid(nd, "pintype");
                c.pins.push({ number: str(kid(nd, "pin")[1]), name: pf ? str(pf[1]) : "", type: pt ? str(pt[1]) : "", net: name });
            }
        }
        return [...comps.values()].filter(c => !/^#/.test(c.ref) && c.pins.length);
    }

    // ---------------------------------------------------------------- components -> SPICE deck
    // ---------------------------------------------------------------- simulation models (KiCad 7 / 8 Sim.* fields)
    // key=value pairs, values optionally in double quotes ("sffm(-5 1 100meg 5 10meg)")
    static simParams(text) {
        const out = {};
        for (const m of String(text || "").matchAll(/([A-Za-z_][\w.]*)\s*=\s*(?:"([^"]*)"|(\S+))/g)) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
        return out;
    }

    // a part value as SPICE reads it: "2k7" -> 2.7k, "10R" -> 10, "1M" -> 1meg (KiCad's M is mega), "2200uF;63V" -> 2200uF
    static spiceValue(v) {
        let t = String(v === undefined || v === null ? "" : v).split(";")[0].trim().replace(/µ/g, "u").replace(/Ω|ohms?$/gi, "");
        t = t.replace(/^(\d+)([RrkKMGTmunpf])(\d+)$/, (_, a, u, c) => `${a}.${c}${u === "R" || u === "r" ? "" : u}`);
        t = t.replace(/^([\d.]+)[Rr]$/, "$1");
        t = t.replace(/^([\d.]+)M(?!eg|EG)(?=[A-Za-z]*$)/, "$1meg");
        return t;
    }

    // Sim.Pins "1=C 2=B 3=E" -> { "1": "C", ... }
    static simPins(text) {
        const out = {};
        for (const m of String(text || "").matchAll(/(\S+?)=(\S+)/g)) out[m[1]] = m[2];
        return out;
    }

    // ---------------------------------------------------------------- components -> SPICE deck
    static toSpice(text) {
        const K = KicadImporter;
        const warnings = [];
        const root = K.parseSexp(text);
        const comps = K.head(root) === "kicad_sch" ? K.fromSchematic(root, warnings)
            : (K.head(root) === "export" ? K.fromNetlist(root, warnings) : null);
        if (!comps) throw new Error("This is neither a KiCad schematic (.kicad_sch) nor a KiCad netlist (.net).");
        const node = (net) => (/^(gnd|0)$/i.test(String(net).replace(/^.*\//, "")) ? "0" : (String(net).replace(/^\//, "").replace(/\+/g, "p").replace(/-/g, "m").replace(/[^A-Za-z0-9_]/g, "_") || "N0"));
        const lines = [];
        const models = new Set();
        const used = new Set();
        const uniq = (prefix, ref) => {
            let nm = String(ref).replace(/[^A-Za-z0-9_]/g, "_");
            if (!nm.toUpperCase().startsWith(prefix)) nm = prefix + nm;
            while (used.has(nm.toUpperCase())) nm += "_";
            used.add(nm.toUpperCase());
            return nm;
        };
        const opampPins = (cc) => {
            const f = (re) => cc.pins.find(q => re.test(q.name.replace(/\s/g, "")));
            const o = { inp: f(/^(\+|IN\+|INP|NONINV.*|V?IN\+)$/i), inn: f(/^(-|IN-|INN|INV.*|V?IN-)$/i), vcc: f(/^(V\+|VCC|VS\+|\+V|VDD|\+VS)$/i), vee: f(/^(V-|VEE|VS-|-V|VSS|-VS)$/i), out: f(/^(OUT|OUTPUT|VOUT|O)$/i) || cc.pins.find(q => q.type === "output") };
            return o.inp && o.inn && o.vcc && o.vee && o.out ? o : null;
        };
        let usesOpamp = false;
        const extraLines = [];
        const lib = (kinds, name) => typeof SIM_MODELS !== "undefined" && kinds.some(k => SIM_MODELS[k] && Object.keys(SIM_MODELS[k]).some(x => x.toLowerCase() === String(name).toLowerCase().replace(/^[qd](?=\d)/, "")));
        const addModel = (name, type, kinds) => { if (models.has(name) || lib(kinds, name)) return; models.add(name); lines.push(`.model ${name} ${type}`); };

        for (const c of comps) {
            if (c.props["Sim.Enable"] === "0" || c.props.Sim_Enable === "0") continue;
            const sim = K.simParams(c.props["Sim.Params"]), pins = K.simPins(c.props["Sim.Pins"]);
            const ref = c.ref, letter = (ref.match(/^[A-Za-z]+/) || [""])[0].toUpperCase();
            const libpart = c.libId.replace(/^.*:/, ""), lc = c.libId.toLowerCase();
            // the pin that plays a role: by Sim.Pins, else by the pin's name, else by number
            const byRole = (cc, pm, ...roles) => {
                for (const r of roles) { const num = Object.keys(pm).find(k => pm[k].toUpperCase() === r); if (num !== undefined) { const p = cc.pins.find(q => q.number === num); if (p) return p; } }
                for (const r of roles) { const p = cc.pins.find(q => q.name.toUpperCase() === r || q.name.toUpperCase().replace(/[^A-Z+\-]/g, "") === r); if (p) return p; }
                return null;
            };
            let dev = String(c.props["Sim.Device"] || "").toUpperCase();
            if (!dev) {                                          // no model fields (older files, KiCad 6, plain netlists): infer from the reference
                if (letter === "R" && c.pins.length === 2) dev = "R"; else if (letter === "C" && c.pins.length === 2) dev = "C"; else if (letter === "L" && c.pins.length === 2) dev = "L";
                else if (letter === "D" && c.pins.length === 2 || /(^|:)(led|d_.*|1n\d+.*)$/i.test(lc) && c.pins.length === 2) dev = "D";
                else if (letter === "Q" && c.pins.length === 3) dev = /npn/i.test(lc) ? "NPN" : /pnp/i.test(lc) ? "PNP" : (byRole(c, pins, "G", "GATE") ? (/p[-_]?(ch|mos|channel)|pmos/i.test(lc) ? "PMOS" : "NMOS") : "NPN");
                else if (letter === "V" || letter === "I") dev = letter;
            }
            const byNum = (n) => c.pins.find(p => p.number === String(n));
            const two = () => { const a = byNum(1), b = byNum(2) || c.pins[1]; if (!a || !b) throw new Error("expected pins 1 and 2"); return [node(a.net), node(b.net)]; };
            const value = () => K.spiceValue(sim.r || sim.c || sim.l || c.value);
            try {
                if (dev === "R" || dev === "C" || dev === "L") {
                    const n = two(), pre = dev;
                    lines.push(`${uniq(pre, ref)} ${n[0]} ${n[1]} ${value()}`);
                } else if (dev === "V" || dev === "I") {
                    const pl = byRole(c, pins, "+", "P", "PLUS") || byNum(1), mi = byRole(c, pins, "-", "N", "MINUS") || byNum(2);
                    const type = String(c.props["Sim.Type"] || "DC").toUpperCase(), n = (k, d) => K.spiceValue(sim[k] !== undefined ? sim[k] : d);
                    const ac = sim.ac !== undefined ? ` AC ${n("ac")}` : "";
                    let spec;
                    if (type === "DC") { const dcv = sim.dc !== undefined ? n("dc") : K.spiceValue(c.value); spec = `DC ${/^[-+]?[\d.]/.test(dcv) ? dcv : 0}${ac}`; }
                    else if (type === "PWL" && sim.pwl) spec = `PWL(${sim.pwl})${ac}`;
                    else if (type === "SIN") spec = `SIN(${n("dc", 0)} ${n("ampl", 1)} ${n("f", 1000)} ${n("td", 0)} ${n("theta", 0)} ${n("phase", 0)})${ac}`;
                    else if (type === "PULSE") spec = `PULSE(${n("y1", 0)} ${n("y2", 5)} ${n("td", 0)} ${n("tr", "1n")} ${n("tf", "1n")} ${n("tw", "1m")} ${n("per", "2m")})${ac}`;
                    else if (type === "EXP") spec = `EXP(${n("y1", 0)} ${n("y2", 5)} ${n("td1", 0)} ${n("tau1", "1m")} ${n("td2", "1m")} ${n("tau2", "1m")})${ac}`;
                    else { warnings.push(`${ref}: the ${type} source type has no equivalent here (supported: DC, SIN, PULSE, EXP and raw sffm / pwl); skipped`); continue; }
                    lines.push(`${uniq(dev, ref)} ${node(pl.net)} ${node(mi.net)} ${spec}`);
                } else if (dev === "SPICE") {
                    // a raw model line: model="pwl(0 -7 50n -7 ...)" type="V"; the source / element letter comes from type
                    const sp = K.simParams(c.props["Sim.Params"]), mt = String(sp.type || letter || "X").toUpperCase(), model = sp.model || "";
                    const order = Object.keys(pins).sort((a, b) => Number(a) - Number(b)).map(k => c.pins.find(q => q.number === k)).filter(Boolean);
                    const nodes = (order.length ? order : c.pins).map(q => node(q.net)).join(" ");
                    if (/^(sffm|pwl|sin|pulse|exp)\(/i.test(model) && (mt === "V" || mt === "I")) lines.push(`${uniq(mt, ref)} ${nodes} ${model}`);
                    else if ((mt === "R" || mt === "C" || mt === "L") && /^[\d.]/.test(model)) lines.push(`${uniq(mt, ref)} ${nodes} ${K.spiceValue(model)}`);
                    else if (/^am\(/i.test(model)) { warnings.push(`${ref}: amplitude-modulated sources are not supported; skipped`); continue; }
                    else { warnings.push(`${ref}: a raw SPICE model (${model.slice(0, 30)}) is not understood; skipped`); continue; }
                } else if (dev === "D") {
                    const a = byRole(c, pins, "A", "ANODE", "A1") || byNum(2), k = byRole(c, pins, "K", "CATHODE", "K1") || byNum(1);
                    const m = String(c.props["Sim.Name"] || c.value || "D").replace(/[^A-Za-z0-9_.\-]/g, "_");
                    lines.push(`${uniq("D", ref)} ${node(a.net)} ${node(k.net)} ${m}`);
                    addModel(m, "D", ["D", "LED", "DZ"]);
                } else if (dev === "NPN" || dev === "PNP") {
                    const cc = byRole(c, pins, "C", "COLLECTOR") || byNum(1), b = byRole(c, pins, "B", "BASE") || byNum(2), e = byRole(c, pins, "E", "EMITTER") || byNum(3);
                    const m = String(c.props["Sim.Name"] || c.value || dev).replace(/[^A-Za-z0-9_.\-]/g, "_");
                    lines.push(`${uniq("Q", ref)} ${node(cc.net)} ${node(b.net)} ${node(e.net)} ${m}`);
                    addModel(m, dev, ["BJT_NPN", "BJT_PNP"]);
                } else if (dev === "NMOS" || dev === "PMOS") {
                    const d = byRole(c, pins, "D", "DRAIN") || byNum(1), g = byRole(c, pins, "G", "GATE") || byNum(2), so = byRole(c, pins, "S", "SOURCE") || byNum(3);
                    const m = String(c.props["Sim.Name"] || c.value || dev).replace(/[^A-Za-z0-9_.\-]/g, "_");
                    lines.push(`${uniq("M", ref)} ${node(d.net)} ${node(g.net)} ${node(so.net)} ${node(so.net)} ${m}`);
                    addModel(m, dev, ["NMOS", "PMOS"]);
                } else if ((dev === "SUBCKT" || c.props["Sim.Library"]) && opampPins(c)) {
                    // an op-amp whose model is a vendor library file we do not have: a generic single-pole op-amp stands in, and the warning says so
                    const o = opampPins(c);
                    if (!usesOpamp) { usesOpamp = true; extraLines.push(...K.GENERIC_OPAMP); }
                    lines.push(`${uniq("X", ref)} ${node(o.inp.net)} ${node(o.inn.net)} ${node(o.vcc.net)} ${node(o.vee.net)} ${node(o.out.net)} KICAD_GENERIC_OPAMP`);
                    warnings.push(`${ref}: the model ${c.props["Sim.Name"] || c.value} (${c.props["Sim.Library"] || "library file"}) is not available; a generic op-amp (gain 100 dB, GBW 1 MHz, output swing 1.5 V inside the rails) stands in for it`);
                } else if ((!dev || dev === "SUBCKT") && c.props["Sim.Library"] && (byRole(c, pins, "C") && byRole(c, pins, "B") && byRole(c, pins, "E"))) {
                    const cc = byRole(c, pins, "C"), b = byRole(c, pins, "B"), e = byRole(c, pins, "E"), m = String(c.props["Sim.Name"] || c.value).replace(/[^A-Za-z0-9_.\-]/g, "_");
                    lines.push(`${uniq("Q", ref)} ${node(cc.net)} ${node(b.net)} ${node(e.net)} ${m}`);
                    addModel(m, /pnp/i.test(c.libId + c.value) ? "PNP" : "NPN", ["BJT_NPN", "BJT_PNP"]);
                    warnings.push(`${ref}: the model ${m} (${c.props["Sim.Library"]}) is not available; a default transistor model stands in for it`);
                } else if ((!dev || dev === "SUBCKT") && c.props["Sim.Library"] && c.pins.length === 2 && /diode|^d/i.test(c.libId.replace(/^.*:/, "") + letter)) {
                    const a = byRole(c, pins, "A") || byNum(2), k = byRole(c, pins, "K") || byNum(1), m = String(c.props["Sim.Name"] || c.value).replace(/[^A-Za-z0-9_.\-]/g, "_");
                    lines.push(`${uniq("D", ref)} ${node(a.net)} ${node(k.net)} ${m}`);
                    addModel(m, "D", ["D", "LED", "DZ"]);
                    warnings.push(`${ref}: the model ${m} (${c.props["Sim.Library"]}) is not available; a default diode model stands in for it`);
                } else if ((!dev || dev === "SUBCKT") && c.props["Sim.Library"] && byRole(c, pins, "G", "GATE") && byRole(c, pins, "D", "DRAIN") && byRole(c, pins, "S", "SOURCE")) {
                    const d = byRole(c, pins, "D", "DRAIN"), g = byRole(c, pins, "G", "GATE"), so = byRole(c, pins, "S", "SOURCE");
                    const val = String(c.value).replace(/[^A-Za-z0-9_.\-]/g, "_"), pch = /pmos|p[-_]?ch|bs250|irf9|fqp\d*p/i.test(c.libId + c.value + (c.props["Sim.Name"] || ""));
                    const inLib = lib(["NMOS", "PMOS"], val), m = inLib ? val : String(c.props["Sim.Name"] || c.value).replace(/[^A-Za-z0-9_.\-]/g, "_");
                    lines.push(`${uniq("M", ref)} ${node(d.net)} ${node(g.net)} ${node(so.net)} ${node(so.net)} ${m}`);
                    if (inLib) warnings.push(`${ref}: the library file ${c.props["Sim.Library"]} is not available; the built-in model ${val} is used instead`);
                    else { addModel(m, pch ? "PMOS" : "NMOS", ["NMOS", "PMOS"]); warnings.push(`${ref}: the model ${m} (${c.props["Sim.Library"]}) is not available; a default ${pch ? "P" : "N"}-channel MOSFET stands in for it`); }
                } else if (dev === "SUBCKT" || c.props["Sim.Library"]) {
                    warnings.push(`${ref} (${c.libId}): a model from the library file ${c.props["Sim.Library"] || "(unnamed)"} (${c.props["Sim.Name"] || c.value}) that is not available here; skipped (import that file first, File > Import, to place it)`);
                } else if (letter === "R" || letter === "C" || letter === "L") {
                    const n = two(); lines.push(`${uniq(letter, ref)} ${n[0]} ${n[1]} ${K.spiceValue(c.value)}`);
                } else if (/^[RCL]\s*=/.test(String(c.value))) {
                    warnings.push(`${ref}: a behavioural ${letter} expression (${String(c.value).slice(0, 40)}) is not supported; skipped`);
                } else if (/^(J|H|U|SW|TP|MH|FID)/.test(ref) || !letter) {
                    // connectors, mounting holes, test points, ICs without a simulation model: nothing to simulate
                    if (!/^(J|H|TP|MH|FID)/.test(ref)) warnings.push(`${ref} (${c.libId || c.value}): no simulation model, skipped`);
                } else {
                    warnings.push(`${ref} (${c.libId || c.value}): no simulation mapping, skipped`);
                }
            } catch (e) {
                warnings.push(`${ref} (${c.libId}): ${e.message}, skipped`);
            }
        }
        if (!lines.some(l => !/^\.model/.test(l))) throw new Error("No simulatable parts (R, C, L, D, Q, M, V, I) were found in that KiCad file.");
        const nets = new Set();
        for (const c of comps) for (const p of c.pins) nets.add(node(p.net));
        if (!nets.has("0")) warnings.push("the schematic has no ground (GND or 0) net: add a ground symbol before simulating");
        return { deck: `* imported from KiCad\n${lines.join("\n")}\n${extraLines.join("\n")}\n.end\n`, warnings };
    }

    static import(editor, text) {
        const { deck, warnings } = KicadImporter.toSpice(text);
        const r = SchematicImporter.import(editor, deck);
        r.warnings = [...warnings, ...r.warnings];
        r.title = "KiCad";
        return r;
    }

    static GENERIC_OPAMP = [".subckt KICAD_GENERIC_OPAMP inp inn vcc vee out", "Rin inp inn 2meg", "Gm 0 a inp inn 1m", "Rp a 0 100meg", "Cp a 0 1.59155n", "Bout b 0 V=min(max(V(a),V(vee)+1.5),V(vcc)-1.5)", "Ro b out 75", ".ends KICAD_GENERIC_OPAMP"];

    static isKicad(text) { return /^\s*\((kicad_sch|export)\b/.test(text); }
}

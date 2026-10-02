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
    static toSpice(text) {
        const K = KicadImporter;
        const warnings = [];
        const root = K.parseSexp(text);
        const comps = K.head(root) === "kicad_sch" ? K.fromSchematic(root, warnings)
            : (K.head(root) === "export" ? K.fromNetlist(root, warnings) : null);
        if (!comps) throw new Error("This is neither a KiCad schematic (.kicad_sch) nor a KiCad netlist (.net).");
        const node = (net) => (/^(gnd|0|agnd|dgnd|pgnd|earth|vss)$/i.test(String(net).replace(/^.*\//, "")) ? "0" : String(net).replace(/^\//, "").replace(/[^A-Za-z0-9_+\-]/g, "_").replace(/^-/, "m_") || "N0");
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
        const byName = (c, ...cands) => { for (const w of cands) { const p = c.pins.find(q => q.name.toUpperCase() === w || q.name.toUpperCase().replace(/[^A-Z]/g, "") === w); if (p) return p; } return null; };
        const byNum = (c, n) => c.pins.find(p => p.number === String(n));
        const num = (s) => { const t = String(s).trim().replace(/Ω|ohm/gi, "").replace(/µ/g, "u"); return t; };
        const modelName = (c) => String(c.props["Sim.Name"] || c.value || c.libId.replace(/^.*:/, "")).replace(/[^A-Za-z0-9_.\-]/g, "_");

        for (const c of comps) {
            if (c.props["Sim.Enable"] === "0" || c.props.Sim_Enable === "0") continue;
            const part = c.libId.replace(/^.*:/, ""), lib = c.libId.replace(/:.*$/, "");
            const R = (c.ref.match(/^[A-Za-z]+/) || [""])[0].toUpperCase();
            const lc = `${lib}:${part}`.toLowerCase();
            const two = () => { const a = byNum(c, 1), b = byNum(c, 2) || c.pins[1]; return a && b ? [node(a.net), node(b.net)] : null; };
            try {
                if (/^(r|r_.*|r_small|r_us|r_pot.*|potentiometer.*)$/i.test(part) && R === "R" && c.pins.length === 2) {
                    const n = two(); lines.push(`${uniq("R", c.ref)} ${n[0]} ${n[1]} ${num(c.value)}`);
                } else if (/^c(p|p_.*|_.*|_small|_polarized.*)?$/i.test(part) && R === "C" && c.pins.length === 2) {
                    const n = two(); lines.push(`${uniq("C", c.ref)} ${n[0]} ${n[1]} ${num(c.value)}`);
                } else if (/^l(_.*|_small|_core.*)?$/i.test(part) && R === "L" && c.pins.length === 2) {
                    const n = two(); lines.push(`${uniq("L", c.ref)} ${n[0]} ${n[1]} ${num(c.value)}`);
                } else if (R === "D" && c.pins.length === 2 || /(^|:)(d|led|d_.*|led_.*|1n\d+.*)$/i.test(lc) && c.pins.length === 2) {
                    const a = byName(c, "A", "ANODE", "A1") || byNum(c, 2), k = byName(c, "K", "CATHODE", "K1") || byNum(c, 1);
                    const m = /led/i.test(lc) ? (modelName(c).toUpperCase() === "LED" || /^led/i.test(c.value) || !c.value ? "RED" : modelName(c)) : modelName(c);
                    lines.push(`${uniq("D", c.ref)} ${node(a.net)} ${node(k.net)} ${/led/i.test(lc) && /^(led|red|green|blue|yellow|white|led.*)$/i.test(m) ? (/green|blue|yellow|white/i.test(m) ? m : "RED") : m}`);
                } else if (R === "Q" && c.pins.length === 3) {
                    const b = byName(c, "B", "BASE"), cc = byName(c, "C", "COLLECTOR"), e = byName(c, "E", "EMITTER");
                    const g = byName(c, "G", "GATE"), d = byName(c, "D", "DRAIN"), s = byName(c, "S", "SOURCE");
                    if (b && cc && e) {
                        const m = modelName(c), pnp = /pnp/i.test(lc) || /^(2n(29|39)05|bc5(5|6)|bc3(27|37)|tip(3|4)2|2n3906|bc557|bc558)/i.test(m) && !/npn/i.test(lc);
                        lines.push(`${uniq("Q", c.ref)} ${node(cc.net)} ${node(b.net)} ${node(e.net)} ${m}`);
                        if (pnp && !(typeof SIM_MODELS !== "undefined" && SIM_MODELS.BJT_PNP && SIM_MODELS.BJT_PNP[m.toUpperCase()]) && !models.has(m)) { models.add(m); lines.push(`.model ${m} PNP`); }
                    } else if (g && d && s) {
                        const m = modelName(c), p = /p[-_]?(ch|mos|channel)|pmos/i.test(lc);
                        lines.push(`${uniq("M", c.ref)} ${node(d.net)} ${node(g.net)} ${node(s.net)} ${node(s.net)} ${m}`);
                        if (!models.has(m)) { models.add(m); lines.push(`.model ${m} ${p ? "PMOS" : "NMOS"}`); }
                    } else throw new Error("pins not recognised (expected B/C/E or G/D/S)");
                } else if (/^(v|i)(dc|ac|sin|pulse|source|_.*)?$/i.test(part) || /simulation_spice:(v|i)/i.test(lc) || R === "V" && c.pins.length === 2 || R === "I" && c.pins.length === 2) {
                    const isI = /^i/i.test(part) || R === "I";
                    const pl = byName(c, "+", "P", "PLUS") || byNum(c, 1), mi = byName(c, "-", "N", "MINUS") || byNum(c, 2);
                    const prm = {}; for (const kv of String(c.props["Sim.Params"] || "").split(/\s+/)) { const [a, b] = kv.split("="); if (a && b !== undefined) prm[a.toLowerCase()] = b; }
                    const type = String(c.props["Sim.Type"] || (/sin/i.test(part) ? "SIN" : /pulse/i.test(part) ? "PULSE" : "DC")).toUpperCase();
                    let spec;
                    if (type === "SIN") spec = `SIN(${num(prm.dc || 0)} ${num(prm.ampl || prm.amp || c.value || 1)} ${num(prm.f || prm.freq || 1000)} ${num(prm.td || 0)} ${num(prm.theta || 0)})`;
                    else if (type === "PULSE") spec = `PULSE(${num(prm.y1 || 0)} ${num(prm.y2 || prm.v2 || 5)} ${num(prm.td || 0)} ${num(prm.tr || "1n")} ${num(prm.tf || "1n")} ${num(prm.tw || prm.pw || "1m")} ${num(prm.per || "2m")})`;
                    else spec = `DC ${num(prm.dc || c.value || 0)}`;
                    lines.push(`${uniq(isI ? "I" : "V", c.ref)} ${node(pl.net)} ${node(mi.net)} ${spec}`);
                } else {
                    warnings.push(`${c.ref} (${c.libId || c.value}): no simulation mapping, skipped`);
                }
            } catch (e) {
                warnings.push(`${c.ref} (${c.libId}): ${e.message}, skipped`);
            }
        }
        if (!lines.length) throw new Error("No simulatable parts (R, C, L, D, Q, M, V, I) were found in that KiCad file.");
        const nets = new Set();
        for (const c of comps) for (const p of c.pins) nets.add(node(p.net));
        if (!nets.has("0")) warnings.push("the schematic has no ground (GND) net: add a ground symbol before simulating");
        return { deck: `* imported from KiCad\n${lines.join("\n")}\n.end\n`, warnings };
    }

    static import(editor, text) {
        const { deck, warnings } = KicadImporter.toSpice(text);
        const r = SchematicImporter.import(editor, deck);
        r.warnings = [...warnings, ...r.warnings];
        r.title = "KiCad";
        return r;
    }

    static isKicad(text) { return /^\s*\((kicad_sch|export)\b/.test(text); }
}

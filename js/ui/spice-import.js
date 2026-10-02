// Imports a SPICE netlist (.cir / .net / .sp) as an editable schematic.
//
// Parts are mapped onto library symbols (imported .model parameters travel with the
// part so the circuit simulates exactly as written), laid out in columns by distance
// from the sources, and wired net by net; ground connections get their own GND symbols.
// The wires are routed by the normal router, so everything is editable afterwards.

class SchematicImporter {

    static PIN_NAMES = {
        R: ["1", "2"], C: ["1", "2"], L: ["1", "2"],
        V: ["2", "1"],            // netlist order is (+, -); our + terminal is pin 2
        I: ["1", "2"],            // current flows pin 1 -> pin 2, like the netlist (n+ -> n-)
        E: ["O+", "O-", "C+", "C-"],
        G: ["O+", "O-", "C+", "C-"],
        D: ["1", "2"],
        Q: ["C", "B", "E"],       // parser order (collector, base, emitter)
        M: ["G", "D", "S"],       // parser order (gate, drain, source)
        J: ["G", "D", "S"],
        XFMR: ["P1", "P2", "S1", "S2"],
        B: ["O+", "O-", "A", "B", "C", "D"]
    };

    static import(editor, text) {
        const deck = SpiceParser.parse(text);
        const warnings = [...deck.warnings];
        const els = SchematicImporter.coupleInductors(SpiceParser.flatten(deck, deck.elements, "", null, warnings), warnings);

        const parts = [];
        for (const e of els) {
            const part = SchematicImporter.mapElement(e, deck, warnings);
            if (part) parts.push(part);
        }
        if (!parts.length) {
            // a model-only file (vendor .lib / .mod): add its models to the part pickers
            const lib = SimModelLibrary.register(deck);
            if (!lib.added.length) throw new Error("No supported components or models were found in that file.");
            return { count: 0, models: lib.added.length, skipped: lib.skipped, title: deck.title, warnings: lib.skipped.length ? [`skipped ${lib.skipped.join(", ")}`] : [], deck };
        }

        editor.saveState();
        editor.setTool("select");
        editor.components = [];
        editor.wires = [];
        editor.probes = [];
        editor.nextId = 1;
        editor.clearSelection();
        editor.resetView();

        // ---- layout: columns by BFS distance from the sources ---------------------
        const isGround = (n) => n === "0" || n === "gnd";
        const byNode = new Map();
        parts.forEach((p, i) => p.nodes.forEach(n => {
            if (isGround(n)) return;
            if (!byNode.has(n)) byNode.set(n, []);
            byNode.get(n).push(i);
        }));

        const layer = new Array(parts.length).fill(-1);
        let queue = parts.map((p, i) => (p.type === "V" ? i : -1)).filter(i => i >= 0);
        if (!queue.length) queue = [0];
        queue.forEach(i => { layer[i] = 0; });
        for (let head = 0; head < queue.length; head++) {
            const i = queue[head];
            for (const n of parts[i].nodes) {
                for (const j of byNode.get(n) || []) {
                    if (layer[j] < 0) { layer[j] = layer[i] + 1; queue.push(j); }
                }
            }
        }
        layer.forEach((l, i) => { if (l < 0) layer[i] = 1; });

        const rowCount = new Map();
        const COL = 260, ROW = 200, X0 = 140, Y0 = 140;
        parts.forEach((p, i) => {
            const row = rowCount.get(layer[i]) || 0;
            rowCount.set(layer[i], row + 1);
            p.comp = editor.addComponent(p.type, X0 + layer[i] * COL, Y0 + row * ROW, 0);
            Object.assign(p.comp, p.props);
            p.comp.name = p.name;
        });

        // ---- wiring ------------------------------------------------------------------
        const pinsOf = new Map(); // net -> [{comp, pin, x, y}]
        for (const p of parts) {
            p.nodes.forEach((n, k) => {
                const pin = SchematicImporter.PIN_NAMES[p.kind][k];
                const pos = editor.getTerminalInfo(p.comp.id, pin).position;
                if (!pinsOf.has(n)) pinsOf.set(n, []);
                pinsOf.get(n).push({ comp: p.comp, pin, x: pos.x, y: pos.y });
            });
        }

        const link = (a, b) => editor.wires.push({
            id: editor.nextId++,
            start: { type: "terminal", component: a.comp.id, terminal: a.pin },
            end: { type: "terminal", component: b.comp.id, terminal: b.pin },
            route: null
        });

        // .ic node voltages become initial-condition flags on their nets
        for (const [net, v] of Object.entries(deck.ic || {})) {
            const pins = pinsOf.get(net);
            if (!pins || !pins.length) { warnings.push(`.ic v(${net}) refers to an unknown net and was skipped`); continue; }
            const anchor = pins[0];
            const flag = editor.addComponent("NODEIC", anchor.x, anchor.y - 120, 0);
            flag.value = Units.formatSI(v, "V");
            pins.push({ comp: flag, pin: "1", x: flag.x, y: flag.y + 20 });
        }

        for (const [net, pins] of pinsOf) {
            if (isGround(net)) {
                // every ground connection gets its own symbol just below the pin
                for (const p of pins) {
                    const g = editor.addComponent("GND", p.x, p.y + 100, 0);
                    link(p, { comp: g, pin: "1" });
                }
                continue;
            }
            const sorted = pins.slice().sort((a, b) => a.x - b.x || a.y - b.y);
            for (let i = 0; i + 1 < sorted.length; i++) link(sorted[i], sorted[i + 1]);
        }

        // ---- simulation settings from the deck's analyses ------------------------------
        const tran = deck.analyses.find(a => a.type === "tran");
        const ac = deck.analyses.find(a => a.type === "ac");
        const setField = (id, v) => { const el = document.getElementById(id); if (el && isFinite(v)) el.value = Units.formatSI(v, "").replace(/\s/g, "").replace("µ", "u"); };
        if (tran) {
            setField("simTstop", tran.tStop);
            setField("simTstep", tran.tStep);
            const uic = document.getElementById("simUic");
            if (uic) uic.checked = !!tran.uic;
        }
        if (ac) { setField("simFstart", ac.fStart); setField("simFstop", ac.fStop); }

        editor.refreshWires();
        editor.fitView();
        editor.draw();
        editor.notify();

        const blocked = editor.wires.filter(w => w.blocked).length;
        if (blocked) warnings.push(`${blocked} wire(s) could not be routed; move parts apart or press T to tidy`);
        return { count: parts.length, title: deck.title, warnings, deck };
    }

    // a K card turns its two inductors into one transformer symbol
    static coupleInductors(els, warnings) {
        const used = new Set(), out = [];
        for (const k of els.filter(e => e.kind === "K")) {
            const [a, b] = k.inductors.map(n => els.find(e => e.kind === "L" && e.name.toLowerCase().endsWith(n.toLowerCase())));
            if (!a || !b || used.has(a) || used.has(b)) { warnings.push(`${k.name}: coupling needs two inductors that are not already coupled; ignored`); continue; }
            used.add(a); used.add(b);
            out.push({ kind: "XFMR", name: k.name, nodes: [...a.nodes, ...b.nodes], l1: a.value, l2: b.value, k: k.k });
        }
        return [...els.filter(e => !used.has(e) && e.kind !== "K"), ...out];
    }

    // one SPICE element -> one schematic part (or null if there is no symbol)
    static mapElement(e, deck, warnings) {
        const N = SpiceParser.number;
        const name = e.name.toUpperCase();
        const base = { kind: e.kind, name, nodes: e.nodes, props: {} };

        switch (e.kind) {
            case "R": return { ...base, type: "R", props: { value: Units.formatSI(e.value, "Ω") } };
            case "C": return { ...base, type: "C", props: { value: Units.formatSI(e.value, "F"), ic: e.ic !== undefined ? e.ic : "" } };
            case "L": return { ...base, type: "L", props: { value: Units.formatSI(e.value, "H"), ic: e.ic || "" } };
            case "V":
            case "I": {
                const s = e.spec;
                const props = { dcVoltage: s.dc, acStim: s.acMag || "" };
                const w = s.wave;
                if (w && w.kind === "sin") {
                    Object.assign(props, {
                        sourceType: "AC", dcOffset: w.args[0] || 0, acMagnitude: w.args[1] || 0,
                        frequency: w.args[2] || 1000, acPhase: w.args[5] || 0
                    });
                } else if (w && w.kind === "pulse") {
                    const a = w.args;
                    Object.assign(props, {
                        sourceType: "PULSE",
                        pulse: { v1: a[0] || 0, v2: a[1] || 0, delay: a[2] || 0, rise: a[3] || 1e-9, fall: a[4] || 1e-9, width: a[5] === undefined ? 1e-3 : a[5], period: a[6] || 0 }
                    });
                } else if (w && w.kind === "exp") {
                    const a = w.args;
                    Object.assign(props, { sourceType: "EXP", exp: { v1: a[0] || 0, v2: a[1] || 0, td1: a[2] || 0, tau1: a[3] || 1e-3, td2: a[4] === undefined ? 1e-3 : a[4], tau2: a[5] || 1e-3 } });
                } else if (w && w.kind === "sffm") {
                    const a = w.args;
                    Object.assign(props, { sourceType: "SFFM", sffm: { vo: a[0] || 0, va: a[1] || 0, fc: a[2] || 1e3, mdi: a[3] || 0, fs: a[4] || 1e3 } });
                } else if (w && w.kind === "pwl") {
                    Object.assign(props, { sourceType: "PWL", pwl: w.args.join(" ") });
                }
                const part = { ...base, type: e.kind, props };
                props.value = PropertiesPanel.sourceLabel(Object.assign({ sourceType: "DC", type: e.kind }, props));
                return part;
            }
            case "E": return { ...base, type: "E", props: { value: String(e.gain) } };
            case "G": return { ...base, type: "G", props: { value: Units.formatSI(e.gm, "S") } };
            case "D": {
                const m = deck.models[e.model];
                const params = SpiceParser.diodeParams(m);
                const type = /led/.test(e.model) ? "LED" : (isFinite(params.bv) && params.bv < 30 ? "DZ" : "D");
                return { ...base, type, props: { model: e.model.toUpperCase(), value: e.model.toUpperCase(), customParams: m ? params : undefined } };
            }
            case "Q": {
                const m = deck.models[e.model];
                const type = m && m.type === "pnp" ? "BJT_PNP" : "BJT_NPN";
                return { ...base, type, props: { model: e.model.toUpperCase(), value: e.model.toUpperCase(), customParams: m ? SpiceParser.bjtParams(m) : undefined } };
            }
            case "B": {
                // the schematic part has four sense pins (A-D): numbered nets in the expression become pin letters
                const ground = (n) => n === "0" || n === "gnd";
                const sense = [];
                const letter = (n) => { let k = sense.indexOf(n); if (k < 0) { sense.push(n); k = sense.length - 1; } return "ABCD"[k] || null; };
                let overflow = false;
                const expr = e.expr.replace(/\bv\(\s*([^),\s]+)\s*(?:,\s*([^)\s]+)\s*)?\)/g, (_, a, b) => {
                    const la = ground(a) ? null : letter(a), lb = b === undefined || ground(b) ? null : letter(b);
                    if ((!ground(a) && !la) || (b !== undefined && !ground(b) && !lb)) overflow = true;
                    if (!la && !lb) return "0";
                    if (!lb) return `v(${la})`;
                    if (!la) return `(-v(${lb}))`;
                    return `v(${la},${lb})`;
                });
                if (overflow) { warnings.push(`${e.name}: reads more than four nodes; a schematic B source has inputs A-D, so it was skipped`); return null; }
                return { ...base, type: "BSRC", nodes: [...e.nodes, ...sense], props: { mode: e.mode, expr, value: expr } };
            }
            case "XFMR":
                return { ...base, type: "XFMR", props: { l1: String(e.l1), ratio: String(Math.sqrt(e.l2 / e.l1)), k: String(e.k), value: "" } };
            case "J": {
                const m = deck.models[e.model];
                const type = m && m.type === "pjf" ? "JFET_P" : "JFET_N";
                return { ...base, type, props: { model: e.model.toUpperCase(), value: e.model.toUpperCase(), customParams: m ? SpiceParser.jfetParams(m) : undefined } };
            }
            case "M": {
                const m = deck.models[e.model];
                const type = m && m.type === "pmos" ? "PMOS" : "NMOS";
                return { ...base, type, props: { model: e.model.toUpperCase(), value: e.model.toUpperCase(), customParams: m ? SpiceParser.mosParams(m, e.w, e.l) : undefined } };
            }
            default:
                return null;
        }
    }
}

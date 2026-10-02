// Electrical rule check: looks at the schematic (nets, parts, wires, probes) and reports problems that would
// give a wrong or failed simulation, or that are almost certainly mistakes. Each issue says which rule found it,
// how serious it is and where it is, so the sheet can jump to it.
//
//   const { issues } = ErcChecker.run(editor);
//   issue = { level: "err" | "warn", rule, text, refs: [{ comp?, wire?, probe?, x?, y? }] }
//
// Rules: ground, vshort, vloop, lloop, dcpath, pin, dangling, single, duplicate, shorted, output, contention,
//        led, probe, power

class ErcChecker {

    // chips whose outputs can float, so two of them on one net is normal (a bus)
    static TRISTATE = new Set(["74244", "74373", "74374", "74595"]);

    static RULES = {
        ground: "A ground symbol is needed",
        vshort: "A voltage source must not be shorted",
        vloop: "Voltage sources must not form a loop",
        lloop: "An inductor or winding directly across a voltage source",
        dcpath: "Every net needs a DC path to ground",
        pin: "Parts should have all their pins connected",
        dangling: "A wire must end on a pin or another wire",
        single: "A net should connect at least two pins",
        duplicate: "Reference designators must be unique",
        shorted: "A part has all its pins on one net",
        output: "An output must not be tied to ground or a supply",
        contention: "Two outputs must not drive the same net",
        led: "An LED needs a current-limiting resistor",
        probe: "A probe on ground always reads zero",
        power: "Ports with the same name must agree"
    };

    static run(editor) {
        const nets = NetlistExtractor.nets(editor);
        const { els } = NetlistExtractor.elements(editor, nets);
        const issues = [];
        const add = (level, rule, text, refs = []) => issues.push({ level, rule, text, refs });
        const posOf = (comp, pin) => { const t = editor.getTerminals(comp).find(k => k.name === pin); return t ? editor.getTerminalPosition(comp, t) : { x: comp.x, y: comp.y }; };
        const compRef = (c) => ({ comp: c, x: c.x, y: c.y });
        const label = (id) => nets.displayName(id);
        const real = editor.components.filter(c => !editor.isOverlay(c));

        // ---- ground ------------------------------------------------------------------------------
        if (!nets.hasGround) add("err", "ground", "There is no ground symbol on the sheet. Add a GND (or a port named GND) and wire it to the circuit.");

        // ---- pins that are not connected ----------------------------------------------------------
        for (const c of real) {
            if (c.type === "GND" || c.type === "NODEIC" || c.type === "SCOPE" || c.type === "LOGAN") continue;
            const def = typeof PartLib !== "undefined" ? PartLib.defs[c.type] : null;
            if (def && def.quietPins) continue;
            const open = editor.getTerminals(c).filter(t => !nets.wired.has(`${c.id}:${t.name}`) && !((c.type === "NMOS" || c.type === "PMOS") && t.name === "B"));   // an open MOSFET body is tied to the source
            if (open.length) add("warn", "pin", `${c.name}: ${open.length > 1 ? "pins" : "pin"} ${open.map(t => t.name).join(", ")} ${open.length > 1 ? "are" : "is"} not connected.`, open.map(t => ({ comp: c, ...posOf(c, t.name) })));
        }

        // ---- wires that end in mid air ------------------------------------------------------------
        const pinSpots = new Set();
        for (const c of real) for (const t of editor.getTerminals(c)) { const p = editor.getTerminalPosition(c, t); pinSpots.add(`${p.x},${p.y}`); }
        const touchesOther = (wire, pt) => editor.wires.some(w => {
            if (w === wire || !w.route || w.route.length < 2) return false;
            for (let i = 0; i < w.route.length - 1; i++) if (editor.isPointOnSegment(pt.x, pt.y, w.route[i].x, w.route[i].y, w.route[i + 1].x, w.route[i + 1].y)) return true;
            return false;
        });
        for (const w of editor.wires) {
            if (!w.route || w.route.length < 2) continue;
            for (const [end, pt] of [[w.start, w.route[0]], [w.end, w.route[w.route.length - 1]]]) {
                if (end && end.type === "point" && !pinSpots.has(`${pt.x},${pt.y}`) && !touchesOther(w, pt)) {
                    add("warn", "dangling", `A wire in net ${label(nets.wireNode(w))} ends in free space at (${pt.x / 20 * 100 | 0}, ${pt.y / 20 * 100 | 0}).`, [{ wire: w, x: pt.x, y: pt.y }]);
                }
            }
        }

        // ---- nets with a single pin ---------------------------------------------------------------
        const groups = new Map();      // net id -> { pins: [{comp, pin}], wires: [] }
        const group = (id) => { if (!groups.has(id)) groups.set(id, { pins: [], wires: [] }); return groups.get(id); };
        for (const c of real) for (const t of editor.getTerminals(c)) { const id = nets.terminalNode(c, t.name); if (id !== null) group(id).pins.push({ comp: c, pin: t.name }); }
        for (const w of editor.wires) { const id = nets.wireNode(w); if (id !== null) group(id).wires.push(w); }
        for (const [id, g] of groups) {
            if (id === "0" || !g.wires.length || g.pins.length !== 1) continue;
            const only = g.pins[0];
            add("warn", "single", `Net ${label(id)} connects only ${only.comp.name}.${only.pin}: the wire goes nowhere.`, [{ comp: only.comp, ...posOf(only.comp, only.pin) }]);
        }

        // ---- duplicate designators ----------------------------------------------------------------
        const byName = new Map();
        for (const c of real) { if (c.type === "GND") continue; if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
        for (const [name, list] of byName) if (list.length > 1) add("warn", "duplicate", `Reference ${name} is used by ${list.length} parts.`, list.map(compRef));

        // ---- parts shorted onto one net / voltage source shorts -----------------------------------
        const ground = "0";
        const seenShort = new Set();
        for (const el of els) {
            const nodes = el.nodes.filter(n => n !== undefined);
            if (nodes.length < 2 || !el.comp) continue;
            const distinct = new Set(nodes);
            const isSource = el.kind === "V" && el.params && !(el.comp.type === "AM");
            if (isSource && el.nodes[0] === el.nodes[1]) {
                add("err", "vshort", `${el.comp.name}: both terminals are on net ${label(el.nodes[0])}, a short circuit across the source.`, [compRef(el.comp)]);
                seenShort.add(el.comp);
            } else if (distinct.size === 1 && !seenShort.has(el.comp) && !["POWER", "NETLABEL"].includes(el.comp.type)) {
                add("warn", "shorted", `${el.comp.name}: all its pins are on net ${label(nodes[0])}, so it does nothing.`, [compRef(el.comp)]);
                seenShort.add(el.comp);
            }
        }

        // ---- loops of ideal voltage sources, inductors across sources -----------------------------
        const loopKeys = new Set();          // loops already reported (a voltage-source loop is not reported again as an inductor loop)
        const cycle = (edgeEls, level, rule, what) => {
            const adj = new Map();
            const link = (a, b, el) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push({ to: b, el }); adj.get(b).push({ to: a, el }); };
            for (const el of edgeEls) {
                const [a, b] = el.edge;
                if (a === b) continue;                               // reported as a short
                // is b already reachable from a through the edges so far?
                const prev = new Map([[a, null]]);
                const queue = [a];
                while (queue.length && !prev.has(b)) {
                    const n = queue.shift();
                    for (const e of adj.get(n) || []) if (!prev.has(e.to)) { prev.set(e.to, { from: n, el: e.el }); queue.push(e.to); }
                }
                if (prev.has(b)) {
                    const loop = [el];
                    for (let n = b; prev.get(n); n = prev.get(n).from) loop.push(prev.get(n).el);
                    const names = [...new Set(loop.map(l => l.comp.name))];
                    const key = names.slice().sort().join("|");
                    if (!loopKeys.has(key)) {
                        loopKeys.add(key);
                        add(level, rule, `${names.join(", ")} ${what}`, [...new Set(loop.map(l => l.comp))].map(compRef));
                    }
                } else link(a, b, el);
            }
        };
        const vEdges = els.filter(e => e.kind === "V" && e.comp).map(e => ({ ...e, edge: [e.nodes[0], e.nodes[1]] }));
        cycle(vEdges, "err", "vloop", "form a loop of ideal voltage sources: the circuit equations have no solution. Put a resistance in the loop.");
        const lEdges = els.flatMap(e => {
            if (!e.comp) return [];
            if (e.kind === "V") return [{ ...e, edge: [e.nodes[0], e.nodes[1]] }];
            if (e.kind === "L") return [{ ...e, edge: [e.nodes[0], e.nodes[1]] }];
            if (e.kind === "T") {            // a winding with its own resistance is not a DC short
                const out = [];
                if (!(e.params.rp > 0)) out.push({ ...e, edge: [e.nodes[0], e.nodes[1]] });
                if (!(e.params.rs > 0)) out.push({ ...e, edge: [e.nodes[2], e.nodes[3]] });
                return out;
            }
            return [];
        });
        cycle(lEdges, "warn", "lloop", "form a loop of voltage sources and inductors or windings, which is a DC short. Add a series resistance (a transformer winding resistance, for instance).");

        // ---- nets with no DC path to ground ---------------------------------------------------------
        const uf = new Map();
        const find = (n) => { if (!uf.has(n)) uf.set(n, n); let r = n; while (uf.get(r) !== r) r = uf.get(r); uf.set(n, r); return r; };
        const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) uf.set(ra, rb); };
        find(ground);
        const all = (el) => { for (let i = 1; i < el.nodes.length; i++) join(el.nodes[0], el.nodes[i]); };
        for (const el of els) {
            switch (el.kind) {
                case "R": case "L": case "V": case "SW": case "FUSE": join(el.nodes[0], el.nodes[1]); break;
                case "E": join(el.nodes[0], el.nodes[1]); break;
                case "D": case "Q": case "J": case "REG": case "SCR": case "TRIAC": all(el); break;
                case "M": join(el.nodes[1], el.nodes[2]); break;                      // the gate is insulated
                case "T": join(el.nodes[0], el.nodes[1]); join(el.nodes[2], el.nodes[3]); break;
                case "RLY": join(el.nodes[0], el.nodes[1]); join(el.nodes[2], el.nodes[3]); break;
                case "OPAMP": join(el.nodes[2], ground); break;                      // the output stage is referenced to ground
                case "GATE": case "FF": case "DIGITAL": case "555": for (const n of el.nodes) join(n, ground); break;   // pulled / driven logic pins
                default: break;                                                      // C, I, G, CCCS: no DC path
            }
        }
        const floating = new Map();
        const lone = (n) => { const g = groups.get(n); return !!g && !g.wires.length && g.pins.length <= 1; };   // an open pin: reported as such
        for (const el of els) for (const n of el.nodes) {
            if (n === undefined || n === ground || lone(n)) continue;
            if (find(n) !== find(ground)) { const r = find(n); if (!floating.has(r)) floating.set(r, { nets: new Set(), comps: new Set() }); floating.get(r).nets.add(n); if (el.comp) floating.get(r).comps.add(el.comp); }
        }
        for (const f of floating.values()) {
            const names = [...f.comps].map(c => c.name);
            add("warn", "dcpath", `Net${f.nets.size > 1 ? "s" : ""} ${[...f.nets].map(label).join(", ")} (${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}) ${f.nets.size > 1 ? "have" : "has"} no DC path to ground (only capacitors, current sources or high-impedance inputs). The operating point may be undefined.`, [...f.comps].map(compRef));
        }

        // ---- outputs ----------------------------------------------------------------------------------
        const outputsOf = (c) => {
            const t = c.type;
            if (["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "BUF"].includes(t)) return ["Y"];
            if (t === "OPAMP" || t === "IC555") return ["OUT"];
            if (t === "REG") return ["OUT"];
            if (["DFF", "TFF", "JKFF"].includes(t)) return ["Q", "QN"];
            if (typeof LOGIC_ICS !== "undefined" && LOGIC_ICS[t]) return ErcChecker.TRISTATE.has(t) ? [] : LOGIC_ICS[t].right;
            return [];
        };
        const sourceNets = new Map();       // net id -> source part names
        for (const el of els) if (el.kind === "V" && el.comp && el.comp.type !== "AM") for (const n of el.nodes) { if (!sourceNets.has(n)) sourceNets.set(n, []); sourceNets.get(n).push(el.comp.name); }
        const drivers = new Map();          // net id -> [{ comp, pin }]
        for (const c of real) {
            for (const pin of outputsOf(c)) {
                const id = nets.terminalNode(c, pin);
                if (id === null || !nets.wired.has(`${c.id}:${pin}`)) continue;
                if (!drivers.has(id)) drivers.set(id, []);
                drivers.get(id).push({ comp: c, pin });
                if (id === ground) add("warn", "output", `Output ${c.name}.${pin} is connected straight to ground.`, [{ comp: c, ...posOf(c, pin) }]);
                else if (sourceNets.has(id) && !sourceNets.get(id).includes(c.name)) add("warn", "output", `Output ${c.name}.${pin} is wired straight to the supply ${sourceNets.get(id)[0]}.`, [{ comp: c, ...posOf(c, pin) }]);
            }
        }
        for (const [id, list] of drivers) {
            if (list.length < 2 || id === ground) continue;
            add("warn", "contention", `Outputs ${list.map(d => `${d.comp.name}.${d.pin}`).join(" and ")} drive the same net (${label(id)}).`, list.map(d => ({ comp: d.comp, ...posOf(d.comp, d.pin) })));
        }

        // ---- LEDs across a source with no resistor -----------------------------------------------------
        const hardNets = new Set([ground, ...sourceNets.keys()]);
        for (const el of els) {
            if (el.kind === "D" && el.comp && el.comp.type === "LED" && hardNets.has(el.nodes[0]) && hardNets.has(el.nodes[1]) && el.nodes[0] !== el.nodes[1]) {
                add("warn", "led", `${el.comp.name}: the LED is connected straight across the supply with no current-limiting resistor.`, [compRef(el.comp)]);
            }
        }

        // ---- probes on ground -----------------------------------------------------------------------------
        for (const p of editor.probes) {
            if (p.type !== "V") continue;
            if (nets.getPointNodeName(p.x, p.y) === ground) add("warn", "probe", `Probe ${p.label} is on ground (or on no net) and will always read 0 V.`, [{ probe: p, x: p.x, y: p.y }]);
        }

        // ---- power ports with the same name but different voltages -----------------------------------------
        const ports = new Map();
        for (const c of real) if (c.type === "POWER") {
            const name = String(c.net || "VCC").trim().toUpperCase();
            if (name === "GND" || name === "0") continue;
            if (!ports.has(name)) ports.set(name, []);
            ports.get(name).push(c);
        }
        for (const [name, list] of ports) {
            const volts = new Set(list.map(c => Units.parseSI(c.volts === undefined ? 5 : c.volts)));
            if (volts.size > 1) add("warn", "power", `Power ports named ${name} disagree on the voltage (${[...volts].join(" V, ")} V); only the first one counts.`, list.map(compRef));
        }

        // errors first, then by rule
        const order = Object.keys(ErcChecker.RULES);
        issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "err" ? -1 : 1) || order.indexOf(a.rule) - order.indexOf(b.rule));
        return { issues, nets, elements: els };
    }

    // the problems that make a simulation impossible, worded for the person at the keyboard
    static fatal(editor) {
        return ErcChecker.run(editor).issues.filter(i => i.level === "err" && (i.rule === "vloop" || i.rule === "vshort"));
    }
}

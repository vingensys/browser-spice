class DisjointSet {
    constructor() {
        this.parent = new Map();
    }

    makeSet(id) {
        if (!this.parent.has(id)) {
            this.parent.set(id, id);
        }
    }

    find(id) {
        if (!this.parent.has(id)) {
            this.parent.set(id, id);
            return id;
        }
        if (this.parent.get(id) === id) return id;

        const root = this.find(this.parent.get(id));
        this.parent.set(id, root); // Path compression
        return root;
    }

    union(id1, id2) {
        const root1 = this.find(id1);
        const root2 = this.find(id2);
        if (root1 !== root2) {
            this.parent.set(root1, root2);
        }
    }
}

// Turns the schematic into (1) nets, (2) a neutral element list, and from that
// (3) a SimCircuit for the engine or (4) a standard SPICE .cir file. The element
// list is the single source of truth, so what you simulate is what you export.
class NetlistExtractor {

    // ---- nets ----------------------------------------------------------------

    static nets(editor) {
        const ds = new DisjointSet();
        const getKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

        const terminalNodeKeys = new Map(); // componentId:terminalName -> key
        for (const comp of editor.components) {
            for (const term of editor.getTerminals(comp)) {
                const pos = editor.getTerminalPosition(comp, term);
                const key = getKey(pos.x, pos.y);
                ds.makeSet(key);
                terminalNodeKeys.set(`${comp.id}:${term.name}`, key);
            }
        }

        for (const wire of editor.wires) {
            if (!wire.route || wire.route.length < 2) continue;

            for (let i = 0; i < wire.route.length; i++) {
                const k1 = getKey(wire.route[i].x, wire.route[i].y);
                ds.makeSet(k1);
                if (i > 0) ds.union(getKey(wire.route[i - 1].x, wire.route[i - 1].y), k1);
            }

            for (const [end, pt] of [[wire.start, wire.route[0]], [wire.end, wire.route[wire.route.length - 1]]]) {
                if (end && end.type === "terminal") {
                    const k = terminalNodeKeys.get(`${end.component}:${end.terminal}`);
                    if (k) ds.union(k, getKey(pt.x, pt.y));
                }
            }
        }

        // T-junctions: a wire end touching another wire's run joins that run
        for (const wireA of editor.wires) {
            if (!wireA.route || wireA.route.length < 2) continue;
            for (const pt of [wireA.route[0], wireA.route[wireA.route.length - 1]]) {
                const keyA = getKey(pt.x, pt.y);
                for (const wireB of editor.wires) {
                    if (wireA === wireB || !wireB.route || wireB.route.length < 2) continue;
                    for (let j = 0; j < wireB.route.length - 1; j++) {
                        const a = wireB.route[j], b = wireB.route[j + 1];
                        if (editor.isPointOnSegment(pt.x, pt.y, a.x, a.y, b.x, b.y)) {
                            ds.union(keyA, getKey(a.x, a.y));
                            ds.union(keyA, getKey(b.x, b.y));
                        }
                    }
                }
            }
        }

        // ground: every GND symbol's net is node "0"
        const groundRoots = new Set();
        for (const comp of editor.components) {
            if (comp.type === "GND") {
                const key = terminalNodeKeys.get(`${comp.id}:1`);
                if (key) groundRoots.add(ds.find(key));
            }
        }
        const hasGround = groundRoots.size > 0;

        const rootToName = new Map();
        let counter = 1;
        const nameForKey = (key) => {
            const root = ds.find(key);
            if (groundRoots.has(root)) return "0";
            if (!rootToName.has(root)) rootToName.set(root, String(counter++));
            return rootToName.get(root);
        };

        const terminalNode = (comp, pin) => {
            const key = terminalNodeKeys.get(`${comp.id}:${pin}`);
            return key ? nameForKey(key) : null;
        };

        const getPointNodeName = (x, y) => {
            let closestKey = null;
            let minDist = 25;
            for (const k of ds.parent.keys()) {
                const [kx, ky] = k.split(",").map(Number);
                const d = Math.hypot(x - kx, y - ky);
                if (d < minDist) { minDist = d; closestKey = k; }
            }
            return closestKey ? nameForKey(closestKey) : "0";
        };

        // wires attached to a terminal (to detect unconnected pins)
        const wired = new Set();
        for (const wire of editor.wires) {
            for (const end of [wire.start, wire.end]) {
                if (end && end.type === "terminal") wired.add(`${end.component}:${end.terminal}`);
            }
        }

        return { terminalNode, getPointNodeName, hasGround, wired };
    }

    // ---- element list --------------------------------------------------------

    // Neutral description of every simulatable part. kind selects the model.
    static elements(editor, nets) {
        const els = [];
        const warnings = [];
        const P = (v, fallback) => {
            const x = Units.parseSI(v);
            return x === 0 && (v === undefined || v === "" || v === null) ? fallback : x;
        };

        for (const comp of editor.components) {
            if (comp.type === "GND") continue;

            const pin = (name) => nets.terminalNode(comp, name) || "0";
            const unwired = editor.getTerminals(comp)
                .filter(t => !nets.wired.has(`${comp.id}:${t.name}`)).map(t => t.name);
            if (unwired.length) warnings.push(`${comp.name}: unconnected pin${unwired.length > 1 ? "s" : ""} ${unwired.join(", ")}`);

            const base = { name: comp.name, comp };

            switch (comp.type) {
                case "R":
                    els.push({ ...base, kind: "R", nodes: [pin("1"), pin("2")], params: { r: P(comp.value, 1000) || 1000 } });
                    break;
                case "C":
                    els.push({ ...base, kind: "C", nodes: [pin("1"), pin("2")], params: { c: P(comp.value, 1e-6) || 1e-6, ic: Units.parseSI(comp.ic) || 0 } });
                    break;
                case "L":
                    els.push({ ...base, kind: "L", nodes: [pin("1"), pin("2")], params: { l: P(comp.value, 1e-3) || 1e-3, ic: Units.parseSI(comp.ic) || 0 } });
                    break;
                case "V":
                    // pin 2 is the + terminal
                    els.push({ ...base, kind: "V", nodes: [pin("2"), pin("1")], params: NetlistExtractor.sourceParams(comp) });
                    break;
                case "D":
                case "LED":
                case "DZ": {
                    const model = comp.model || SIM_DEFAULT_MODEL[comp.type];
                    els.push({ ...base, kind: "D", model, modelKind: comp.type, nodes: [pin("1"), pin("2")], params: simModel(comp.type, model).params });
                    break;
                }
                case "BJT_NPN":
                case "BJT_PNP": {
                    const model = comp.model || SIM_DEFAULT_MODEL[comp.type];
                    els.push({
                        ...base, kind: "Q", model, modelKind: comp.type, pol: comp.type === "BJT_NPN" ? 1 : -1,
                        nodes: [pin("B"), pin("C"), pin("E")], params: simModel(comp.type, model).params
                    });
                    break;
                }
                case "NMOS":
                case "PMOS": {
                    const model = comp.model || SIM_DEFAULT_MODEL[comp.type];
                    els.push({
                        ...base, kind: "M", model, modelKind: comp.type, pol: comp.type === "NMOS" ? 1 : -1,
                        nodes: [pin("G"), pin("D"), pin("S")], params: simModel(comp.type, model).params
                    });
                    break;
                }
                case "OPAMP": {
                    const model = comp.model || SIM_DEFAULT_MODEL.OPAMP;
                    const vp = comp.vcc !== undefined && comp.vcc !== "" ? Units.parseSI(comp.vcc) : 15;
                    const vn = comp.vee !== undefined && comp.vee !== "" ? Units.parseSI(comp.vee) : -15;
                    els.push({
                        ...base, kind: "OPAMP", model, modelKind: "OPAMP",
                        nodes: [pin("IN-"), pin("IN+"), pin("OUT")],
                        params: Object.assign({}, simModel("OPAMP", model).params, { vp, vn })
                    });
                    break;
                }
                case "AND": case "OR": case "NOT": case "NAND": case "NOR": case "XOR": {
                    const vcc = comp.vcc !== undefined && comp.vcc !== "" ? Units.parseSI(comp.vcc) : 5;
                    const inputs = comp.type === "NOT" ? [pin("A")] : [pin("A"), pin("B")];
                    els.push({ ...base, kind: "GATE", gate: comp.type, nodes: [...inputs, pin("Y")], params: { vcc } });
                    break;
                }
                case "IC555":
                    els.push({
                        ...base, kind: "555",
                        nodes: ["GND", "TRIG", "OUT", "RESET", "VCC", "DISCH", "THRES", "CTRL"].map(pin), params: {}
                    });
                    break;
            }
        }
        return { els, warnings };
    }

    static sourceParams(comp) {
        const sourceType = comp.sourceType || "DC";
        const dc = Units.parseSI(comp.dcVoltage !== undefined ? comp.dcVoltage : comp.value);
        const params = { sourceType, dc: isFinite(dc) ? dc : 0 };

        if (sourceType === "AC") {
            params.sin = {
                offset: Units.parseSI(comp.dcOffset) || 0,
                amp: Units.parseSI(comp.acMagnitude) || 0,
                freq: Units.parseSI(comp.frequency) || 1000,
                phase: Units.parseSI(comp.acPhase) || 0
            };
            params.acMag = params.sin.amp;
            params.acPhase = params.sin.phase;
        } else if (sourceType === "PULSE") {
            const p = comp.pulse || {};
            params.pulse = {
                v1: Units.parseSI(p.v1) || 0,
                v2: p.v2 === undefined ? 5 : Units.parseSI(p.v2),
                delay: Units.parseSI(p.delay) || 0,
                rise: p.rise === undefined ? 1e-6 : Units.parseSI(p.rise),
                fall: p.fall === undefined ? 1e-6 : Units.parseSI(p.fall),
                width: p.width === undefined ? 5e-4 : Units.parseSI(p.width),
                period: p.period === undefined ? 1e-3 : Units.parseSI(p.period)
            };
            params.acMag = 0;
        }
        return params;
    }

    // ---- simulation ---------------------------------------------------------

    static instantiate(els) {
        const c = new SimCircuit();
        for (const e of els) {
            const p = e.params;
            switch (e.kind) {
                case "R": c.add(new Resistor(e.name, e.nodes, p)); break;
                case "C": c.add(new Capacitor(e.name, e.nodes, p)); break;
                case "L": c.add(new Inductor(e.name, e.nodes, p)); break;
                case "V": {
                    let wave;
                    if (p.sourceType === "AC") wave = Waveform.sin(p.sin);
                    else if (p.sourceType === "PULSE") wave = Waveform.pulse(p.pulse);
                    else wave = Waveform.dc(p.dc);
                    c.add(new VoltageSource(e.name, e.nodes, { wave, acMag: p.acMag || 0, acPhase: p.acPhase || 0 }));
                    break;
                }
                case "D": c.add(new Diode(e.name, e.nodes, p)); break;
                case "Q": c.add(new BJT(e.name, e.nodes, e.pol, p)); break;
                case "M": c.add(new MOSFET(e.name, e.nodes, e.pol, p)); break;
                case "OPAMP": c.add(new OpAmp(e.name, e.nodes, p)); break;
                case "GATE": c.add(new LogicGate(e.name, e.nodes, e.gate, p)); break;
                case "555": c.add(new Timer555(e.name, e.nodes, p)); break;
            }
        }
        return c;
    }

    // One call for the UI: nets + elements + a ready SimCircuit
    static extract(editor) {
        const nets = NetlistExtractor.nets(editor);
        const { els, warnings } = NetlistExtractor.elements(editor, nets);

        if (!nets.hasGround) {
            throw new Error("There is no ground in this schematic. Add a GND symbol and wire it to the circuit.");
        }
        if (!els.length) throw new Error("The schematic has no components to simulate.");

        const circuit = NetlistExtractor.instantiate(els);
        return {
            circuit, elements: els, warnings,
            getPointNodeName: nets.getPointNodeName,
            getTerminalNodeName: nets.terminalNode
        };
    }

    static extractCircuit(editor) {
        return NetlistExtractor.extract(editor).circuit;
    }

    // ---- SPICE export ---------------------------------------------------------

    // Behavioural NE555 built only from smooth controlled sources (no switch models,
    // which chatter at thresholds): resistor divider, two tanh comparators driving a
    // capacitor-held SR latch (reset dominant), a driven output and a discharge sink.
    static NE555_SUBCKT = [
        "* behavioural NE555 timer (pins: gnd trig out reset vcc disch thres ctrl)",
        ".subckt NE555 gnd trig out reset vcc disch thres ctrl",
        "R1 vcc ctrl 5k",
        "R2 ctrl nb 5k",
        "R3 nb gnd 5k",
        "Rrs reset vcc 100k",
        "Cq ql gnd 1n IC=0",
        // dq/dt: set drive, reset drive (dominant) and a cubic term that makes 0 and 1 the
        // only stable latch states
        "Bq gnd ql I=2e-1*(0.5*(1+tanh((V(nb)-V(trig))/0.02))*(1-(V(ql)-V(gnd)))-1.5*0.5*(1+tanh(max(V(thres)-V(ctrl),0.7-V(reset)+V(gnd))/0.02))*(V(ql)-V(gnd))+0.5*(V(ql)-V(gnd))*(1-(V(ql)-V(gnd)))*(2*(V(ql)-V(gnd))-1))",
        "Bout oi gnd V=0.1+(V(vcc)-V(gnd)-1.8)*0.5*(1+tanh((V(ql)-V(gnd)-0.5)/0.02))",
        "Ro oi out 10",
        "Bdis disch gnd I=(V(disch)-V(gnd))/10*(1-0.5*(1+tanh((V(ql)-V(gnd)-0.5)/0.02)))",
        ".ends NE555"
    ];

    static spiceName(e) {
        const clean = (s) => String(s).replace(/[^A-Za-z0-9_]/g, "_");
        const prefix = { R: "R", C: "C", L: "L", V: "V", D: "D", Q: "Q", M: "M", OPAMP: "X", GATE: "B", "555": "X" }[e.kind];
        const n = clean(e.name);
        return n.toUpperCase().startsWith(prefix) ? n : `${prefix}${n}`;
    }

    static toSpice(els, opts = {}) {
        const { title = "Browser SPICE export", analysis = ".op" } = opts;
        const f = (v) => (typeof v === "number" ? Number(v.toPrecision(6)).toString() : v);
        const lines = [`* ${title}`, `* generated ${new Date().toISOString()}`, ""];
        const models = new Map();
        const subckts = new Set();
        const extra = [];
        let uses555 = false;

        for (const e of els) {
            const name = NetlistExtractor.spiceName(e);
            const n = e.nodes;
            const p = e.params;

            switch (e.kind) {
                case "R": lines.push(`${name} ${n[0]} ${n[1]} ${f(p.r)}`); break;
                case "C": lines.push(`${name} ${n[0]} ${n[1]} ${f(p.c)}${p.ic ? ` IC=${f(p.ic)}` : ""}`); break;
                case "L": lines.push(`${name} ${n[0]} ${n[1]} ${f(p.l)}${p.ic ? ` IC=${f(p.ic)}` : ""}`); break;
                case "V": {
                    let spec;
                    if (p.sourceType === "AC") {
                        const s = p.sin;
                        spec = `SIN(${f(s.offset)} ${f(s.amp)} ${f(s.freq)} 0 0 ${f(s.phase)}) AC ${f(s.amp)}`;
                    } else if (p.sourceType === "PULSE") {
                        const q = p.pulse;
                        spec = `PULSE(${f(q.v1)} ${f(q.v2)} ${f(q.delay)} ${f(q.rise)} ${f(q.fall)} ${f(q.width)} ${f(q.period)})`;
                    } else {
                        spec = `DC ${f(p.dc)}`;
                    }
                    lines.push(`${name} ${n[0]} ${n[1]} ${spec}`);
                    break;
                }
                case "D":
                    models.set(e.model, e.modelKind);
                    lines.push(`${name} ${n[0]} ${n[1]} ${e.model}`);
                    break;
                case "Q":
                    models.set(e.model, e.modelKind);
                    // SPICE order: collector base emitter
                    lines.push(`${name} ${n[1]} ${n[0]} ${n[2]} ${e.model}`);
                    break;
                case "M":
                    models.set(e.model, e.modelKind);
                    // drain gate source bulk(=source)
                    lines.push(`${name} ${n[1]} ${n[0]} ${n[2]} ${n[2]} ${e.model} W=1u L=1u`);
                    break;
                case "OPAMP": {
                    const sub = `OPAMP_${e.model}`;
                    subckts.add(e.model);
                    const vp = `${name}_VP`, vn = `${name}_VN`;
                    extra.push(`V${name}P ${vp} 0 DC ${f(p.vp)}`, `V${name}N ${vn} 0 DC ${f(p.vn)}`);
                    // X<name> in+ in- out vcc vee subckt
                    lines.push(`X${name.replace(/^X/i, "")} ${n[1]} ${n[0]} ${n[2]} ${vp} ${vn} ${sub}`);
                    break;
                }
                case "GATE": {
                    const th = f(p.vcc / 2), vcc = f(p.vcc);
                    const u = (node) => `u(V(${node})-${th})`;
                    let expr;
                    switch (e.gate) {
                        case "AND": expr = `${vcc}*${u(n[0])}*${u(n[1])}`; break;
                        case "NAND": expr = `${vcc}*(1-${u(n[0])}*${u(n[1])})`; break;
                        case "OR": expr = `${vcc}*(1-(1-${u(n[0])})*(1-${u(n[1])}))`; break;
                        case "NOR": expr = `${vcc}*(1-${u(n[0])})*(1-${u(n[1])})`; break;
                        case "XOR": expr = `${vcc}*(${u(n[0])}+${u(n[1])}-2*${u(n[0])}*${u(n[1])})`; break;
                        default: expr = `${vcc}*(1-${u(n[0])})`; break;
                    }
                    lines.push(`${name} ${n[n.length - 1]} 0 V=${expr}`);
                    break;
                }
                case "555":
                    uses555 = true;
                    // pins: GND TRIG OUT RESET VCC DISCH THRES CTRL
                    lines.push(`X${name.replace(/^X/i, "")} ${n.join(" ")} NE555`);
                    break;
            }
        }

        if (extra.length) lines.push("", "* op-amp supply rails", ...extra);

        if (models.size) {
            lines.push("", "* device models");
            for (const [name, kind] of models) lines.push(simModelCard(kind, name));
        }
        if (subckts.size) {
            lines.push("", "* behavioural op-amp macromodels (single pole, clamped output)");
            for (const model of subckts) {
                const m = simModel("OPAMP", model).params;
                const rp = m.gain / 1e-3;
                const cp = 1 / (2 * Math.PI * (m.gbw / m.gain) * rp);
                lines.push(
                    `.subckt OPAMP_${model} inp inn out vcc vee`,
                    `Rin inp inn ${f(m.rin)}`,
                    `Gm 0 a inp inn 1m`,
                    `Rp a 0 ${f(rp)}`,
                    `Cp a 0 ${f(cp)}`,
                    `Bout b 0 V=min(max(V(a),V(vee)+${f(m.drop)}),V(vcc)-${f(m.drop)})`,
                    `Ro b out ${f(m.ro)}`,
                    `.ends OPAMP_${model}`
                );
            }
        }

        if (uses555) {
            // the behavioural latch needs tighter tolerances than the default 0.1 %
            lines.push("", ".options reltol=1e-4 vntol=1e-7", ...NetlistExtractor.NE555_SUBCKT);
        }

        lines.push("", analysis, ".end");
        return lines.join("\n");
    }
}

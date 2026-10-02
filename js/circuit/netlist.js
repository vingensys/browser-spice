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

        // Connectivity rules: a wire's own points are one conductor; two wires connect only
        // where they share a pin or an END point (an end landing on another wire's run is a
        // T-junction). Interior corners of different wires that merely coincide do NOT connect.
        const vertexKey = (wire, i) => {
            const last = wire.route.length - 1;
            const p = wire.route[i];
            return (i === 0 || i === last) ? getKey(p.x, p.y) : `w${wire.id}#${i}`;
        };
        const points = []; // for probe lookup: { x, y, key }

        for (const wire of editor.wires) {
            if (!wire.route || wire.route.length < 2) continue;

            for (let i = 0; i < wire.route.length; i++) {
                const k = vertexKey(wire, i);
                ds.makeSet(k);
                points.push({ x: wire.route[i].x, y: wire.route[i].y, key: k });
                if (i > 0) ds.union(vertexKey(wire, i - 1), k);
            }

            for (const [end, pt] of [[wire.start, wire.route[0]], [wire.end, wire.route[wire.route.length - 1]]]) {
                if (end && end.type === "terminal") {
                    const k = terminalNodeKeys.get(`${end.component}:${end.terminal}`);
                    if (k) ds.union(k, getKey(pt.x, pt.y));
                }
            }
        }
        for (const [key] of terminalNodeKeys) {
            const [x, y] = terminalNodeKeys.get(key).split(",").map(Number);
            points.push({ x, y, key: terminalNodeKeys.get(key) });
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
                            ds.union(keyA, vertexKey(wireB, j));
                            ds.union(keyA, vertexKey(wireB, j + 1));
                        }
                    }
                }
            }
        }

        // net labels / power ports with the same name are one net (no wire needed)
        const labelled = new Map();
        for (const comp of editor.components) {
            if (comp.type !== "NETLABEL" && comp.type !== "POWER" && comp.type !== "PORT") continue;
            const key = terminalNodeKeys.get(`${comp.id}:1`);
            if (!key) continue;
            const name = String(comp.net || (comp.type === "POWER" ? "VCC" : comp.type === "PORT" ? "PORT" : "NET")).trim().toUpperCase();
            if (labelled.has(name)) ds.union(labelled.get(name), key); else labelled.set(name, key);
        }

        // ground: every GND symbol's net is node "0"
        const groundRoots = new Set();
        for (const [name, key] of labelled) if (name === "GND" || name === "0") groundRoots.add(ds.find(key));
        for (const comp of editor.components) {
            if (comp.type === "GND") {
                const key = terminalNodeKeys.get(`${comp.id}:1`);
                if (key) groundRoots.add(ds.find(key));
            }
        }
        const hasGround = groundRoots.size > 0;

        const rootToName = new Map();
        const idToRoot = new Map();
        let counter = 1;
        const nameForKey = (key) => {
            const root = ds.find(key);
            if (groundRoots.has(root)) return "0";
            if (!rootToName.has(root)) { const id = String(counter++); rootToName.set(root, id); idToRoot.set(id, root); }
            return rootToName.get(root);
        };

        // a name for people: the label / port name when the net has one, otherwise N<id>
        const rootToLabel = new Map();
        for (const [name, key] of labelled) rootToLabel.set(ds.find(key), name);
        const displayName = (id) => {
            if (id === "0") return "GND";
            const root = idToRoot.get(id);
            return root !== undefined && rootToLabel.has(root) ? rootToLabel.get(root) : `N${id}`;
        };
        const wireNode = (wire) => (wire.route && wire.route.length ? nameForKey(vertexKey(wire, 0)) : null);

        const terminalNode = (comp, pin) => {
            const key = terminalNodeKeys.get(`${comp.id}:${pin}`);
            return key ? nameForKey(key) : null;
        };

        const getPointNodeName = (x, y) => {
            let closest = null;
            let minDist = 25;
            for (const p of points) {
                const d = Math.hypot(x - p.x, y - p.y);
                if (d < minDist) { minDist = d; closest = p; }
            }
            return closest ? nameForKey(closest.key) : "0";
        };

        // wires attached to a terminal (to detect unconnected pins)
        const wired = new Set();
        for (const wire of editor.wires) {
            for (const end of [wire.start, wire.end]) {
                if (end && end.type === "terminal") wired.add(`${end.component}:${end.terminal}`);
            }
        }

        return { terminalNode, getPointNodeName, hasGround, wired, wireNode, displayName, labelled };
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

        // a value the user typed that cannot be used is reported instead of silently replaced
        const positive = (comp, raw, fallback, what) => {
            const x = Units.parseSI(raw);
            if (raw !== undefined && raw !== null && String(raw).trim() !== "" && !(x > 0 && isFinite(x))) {
                warnings.push(`${comp.name}: "${raw}" is not a valid ${what}; using ${fallback}`);
                return fallback;
            }
            return x > 0 ? x : fallback;
        };
        const knownModel = (comp, kind) => {
            const m = comp.model || SIM_DEFAULT_MODEL[kind];
            if (!comp.customParams && SIM_MODELS[kind] && !SIM_MODELS[kind][m]) {
                warnings.push(`${comp.name}: model "${m}" is not in the library; using ${SIM_DEFAULT_MODEL[kind]}`);
            }
        };

        const nodeIC = {};
        const instruments = [];
        for (const comp of editor.components) {
            if (comp.type === "GND") continue;

            const pin = (name) => nets.terminalNode(comp, name) || "0";
            const base = { name: comp.name, comp };
            if (comp.type === "VM" || comp.type === "SCOPE" || comp.type === "LOGAN") {
                instruments.push({
                    type: comp.type, comp,
                    nets: editor.getTerminals(comp).map(t => pin(t.name)),
                    wired: editor.getTerminals(comp).map(t => nets.wired.has(`${comp.id}:${t.name}`))
                });
                continue;
            }
            if (comp.type === "AM") {
                // an ideal ammeter is a 0 V source in series; its branch current is the reading
                instruments.push({ type: "AM", comp, nets: [pin("+"), pin("-")] });
                els.push({ ...base, kind: "V", nodes: [pin("+"), pin("-")], params: { sourceType: "DC", dc: 0, acMag: 0 } });
                continue;
            }
            if (comp.type === "NODEIC") {
                const net = pin("1");
                if (net !== "0") nodeIC[net] = Units.parseSI(comp.value);
                if (!nets.wired.has(`${comp.id}:1`)) warnings.push(`${comp.name}: initial-condition flag is not connected to a net`);
                continue;
            }
            const unwired = editor.getTerminals(comp)
                .filter(t => !nets.wired.has(`${comp.id}:${t.name}`)).map(t => t.name);
            const quiet = typeof PartLib !== "undefined" && PartLib.defs[comp.type] && PartLib.defs[comp.type].quietPins;
            if (comp.type === "NMOS" || comp.type === "PMOS") unwired.splice(0, unwired.length, ...unwired.filter(n => n !== "B"));
            if (unwired.length && comp.type !== "SCOPE" && comp.type !== "LOGAN" && !quiet) warnings.push(`${comp.name}: unconnected pin${unwired.length > 1 ? "s" : ""} ${unwired.join(", ")}`);

            switch (comp.type) {
                case "R":
                    els.push({ ...base, kind: "R", nodes: [pin("1"), pin("2")], params: { r: positive(comp, comp.value, 1000, "resistance") } });
                    break;
                case "C":
                    els.push({ ...base, kind: "C", nodes: [pin("1"), pin("2")], params: { c: positive(comp, comp.value, 1e-6, "capacitance"), ic: (comp.ic === undefined || comp.ic === "" || comp.ic === null) ? undefined : Units.parseSI(comp.ic) } });
                    break;
                case "L":
                    els.push({ ...base, kind: "L", nodes: [pin("1"), pin("2")], params: { l: positive(comp, comp.value, 1e-3, "inductance"), ic: Units.parseSI(comp.ic) || 0 } });
                    break;
                case "V":
                    // pin 2 is the + terminal
                    els.push({ ...base, kind: "V", nodes: [pin("2"), pin("1")], params: NetlistExtractor.sourceParams(comp) });
                    break;
                case "I":
                    // current flows from pin 1 through the source to pin 2
                    els.push({ ...base, kind: "I", nodes: [pin("1"), pin("2")], params: NetlistExtractor.sourceParams(comp) });
                    break;
                case "E":
                    els.push({ ...base, kind: "E", nodes: [pin("O+"), pin("O-"), pin("C+"), pin("C-")], params: { gain: Units.parseSI(comp.value) || 0 } });
                    break;
                case "G":
                    els.push({ ...base, kind: "G", nodes: [pin("O+"), pin("O-"), pin("C+"), pin("C-")], params: { gm: Units.parseSI(comp.value) || 0 } });
                    break;
                case "SW":
                    els.push({ ...base, kind: "SW", nodes: [pin("1"), pin("2")], params: { closed: !!comp.closed, ron: 1e-3, roff: 1e9 } });
                    break;
                case "POT": {
                    // two resistors on either side of the wiper
                    const total = positive(comp, comp.value, 10000, "resistance");
                    const pos = Math.min(1, Math.max(0, comp.position === undefined ? 0.5 : comp.position));
                    const rTop = Math.max(total * pos, 1e-3), rBot = Math.max(total * (1 - pos), 1e-3);
                    els.push({ kind: "R", name: `${comp.name}_A`, comp, nodes: [pin("A"), pin("W")], params: { r: rTop } });
                    els.push({ kind: "R", name: `${comp.name}_B`, comp, nodes: [pin("W"), pin("B")], params: { r: rBot } });
                    break;
                }
                case "D":
                case "LED":
                case "DZ": {
                    knownModel(comp, comp.type);
                    const model = comp.model || SIM_DEFAULT_MODEL[comp.type];
                    els.push({ ...base, kind: "D", model, modelKind: comp.type, nodes: [pin("1"), pin("2")], params: comp.customParams || simModel(comp.type, model).params });
                    break;
                }
                case "BJT_NPN":
                case "BJT_PNP": {
                    knownModel(comp, comp.type);
                    const model = comp.model || SIM_DEFAULT_MODEL[comp.type];
                    els.push({
                        ...base, kind: "Q", model, modelKind: comp.type, pol: comp.type === "BJT_NPN" ? 1 : -1,
                        nodes: [pin("B"), pin("C"), pin("E")], params: comp.customParams || simModel(comp.type, model).params
                    });
                    break;
                }
                case "NMOS":
                case "PMOS": {
                    knownModel(comp, comp.type);
                    const model = comp.model || SIM_DEFAULT_MODEL[comp.type];
                    els.push({
                        ...base, kind: "M", model, modelKind: comp.type, pol: comp.type === "NMOS" ? 1 : -1,
                        // an unwired body is tied to the source
                        nodes: [pin("G"), pin("D"), pin("S"), nets.wired.has(`${comp.id}:B`) ? pin("B") : pin("S")], params: comp.customParams || simModel(comp.type, model).params
                    });
                    break;
                }
                case "OPAMP": {
                    knownModel(comp, "OPAMP");
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
                case "AND": case "OR": case "NOT": case "NAND": case "NOR": case "XOR": case "XNOR": case "BUF": {
                    const vcc = comp.vcc !== undefined && comp.vcc !== "" ? Units.parseSI(comp.vcc) : 5;
                    const inputs = comp.type === "NOT" || comp.type === "BUF" ? [pin("A")] : [pin("A"), pin("B")];
                    els.push({ ...base, kind: "GATE", gate: comp.type, nodes: [...inputs, pin("Y")], params: { vcc } });
                    break;
                }
                default: {
                    const part = typeof PartLib !== "undefined" && PartLib.defs[comp.type];
                    if (part && part.netlist) els.push(...part.netlist(comp, PartLib.kit(comp, nets, P, editor)));
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
        els.nodeIC = nodeIC;
        els.instruments = instruments;
        return { els, warnings };
    }

    static sourceParams(comp) {
        const sourceType = comp.sourceType || "DC";
        const dc = Units.parseSI(comp.dcVoltage !== undefined ? comp.dcVoltage : comp.value);
        const params = { sourceType, dc: isFinite(dc) ? dc : 0 };
        // small-signal magnitude for AC sweeps on DC / pulse sources (SPICE "DC x AC y")
        const stim = Units.parseSI(comp.acStim) || 0;

        if (sourceType === "AC") {
            params.sin = {
                offset: Units.parseSI(comp.dcOffset) || 0,
                amp: Units.parseSI(comp.acMagnitude) || 0,
                freq: Units.parseSI(comp.frequency) || 1000,
                phase: Units.parseSI(comp.acPhase) || 0
            };
            params.acMag = params.sin.amp;
            params.acPhase = params.sin.phase;
        } else if (sourceType === "PWL") {
            const nums = String(comp.pwl || "0 0").split(/[\s,]+/).filter(Boolean).map(t => Units.parseSI(t));
            const pts = [];
            for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
            params.pwl = pts;
            params.acMag = stim;
        } else if (sourceType === "EXP") {
            const x = comp.exp || {};
            params.exp = {
                v1: Units.parseSI(x.v1) || 0, v2: x.v2 === undefined ? 5 : Units.parseSI(x.v2),
                td1: Units.parseSI(x.td1) || 0, tau1: x.tau1 === undefined ? 1e-3 : Units.parseSI(x.tau1),
                td2: x.td2 === undefined ? 5e-3 : Units.parseSI(x.td2), tau2: x.tau2 === undefined ? 1e-3 : Units.parseSI(x.tau2)
            };
            params.acMag = stim;
        } else if (sourceType === "SFFM") {
            const x = comp.sffm || {};
            params.sffm = {
                vo: Units.parseSI(x.vo) || 0, va: x.va === undefined ? 1 : Units.parseSI(x.va),
                fc: x.fc === undefined ? 10e3 : Units.parseSI(x.fc), mdi: x.mdi === undefined ? 5 : Units.parseSI(x.mdi),
                fs: x.fs === undefined ? 1e3 : Units.parseSI(x.fs)
            };
            params.acMag = stim;
        } else if (sourceType === "SQUARE" || sourceType === "TRIANGLE" || sourceType === "SAWTOOTH") {
            // function-generator shapes are pulse trains: square (duty cycle), triangle, ramp
            const g = comp.gen || {};
            const lo = Units.parseSI(g.low) || 0, hi = g.high === undefined ? 5 : Units.parseSI(g.high);
            const f = Math.max(g.freq === undefined ? 1000 : Units.parseSI(g.freq), 1e-6), per = 1 / f;
            const duty = Math.min(0.99, Math.max(0.01, (g.duty === undefined ? 50 : Units.parseSI(g.duty)) / 100));
            const edge = Math.min(per * 1e-4, 1e-6);
            params.sourceType = "PULSE";
            if (sourceType === "SQUARE") params.pulse = { v1: lo, v2: hi, delay: 0, rise: edge, fall: edge, width: per * duty - edge, period: per };
            else if (sourceType === "TRIANGLE") params.pulse = { v1: lo, v2: hi, delay: 0, rise: per / 2, fall: per / 2, width: 0, period: per };
            else params.pulse = { v1: lo, v2: hi, delay: 0, rise: per - edge, fall: edge, width: 0, period: per };
            params.acMag = stim;
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
            params.acMag = stim;
        } else {
            params.acMag = stim;
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
                    else if (p.sourceType === "PWL") wave = Waveform.pwl(p.pwl);
                    else if (p.sourceType === "EXP") wave = Waveform.exp(p.exp);
                    else if (p.sourceType === "SFFM") wave = Waveform.sffm(p.sffm);
                    else wave = Waveform.dc(p.dc);
                    c.add(new VoltageSource(e.name, e.nodes, { wave, acMag: p.acMag || 0, acPhase: p.acPhase || 0 }));
                    break;
                }
                case "I": {
                    let wave;
                    if (p.sourceType === "AC") wave = Waveform.sin(p.sin);
                    else if (p.sourceType === "PULSE") wave = Waveform.pulse(p.pulse);
                    else if (p.sourceType === "PWL") wave = Waveform.pwl(p.pwl);
                    else if (p.sourceType === "EXP") wave = Waveform.exp(p.exp);
                    else if (p.sourceType === "SFFM") wave = Waveform.sffm(p.sffm);
                    else wave = Waveform.dc(p.dc);
                    c.add(new CurrentSource(e.name, e.nodes, { wave, acMag: p.acMag || 0, acPhase: p.acPhase || 0 }));
                    break;
                }
                case "E": c.add(new VCVS(e.name, e.nodes, p)); break;
                case "G": c.add(new VCCS(e.name, e.nodes, p)); break;
                case "SW": c.add(new Switch(e.name, e.nodes, p)); break;
                case "D": c.add(new Diode(e.name, e.nodes, p)); break;
                case "Q": c.add(new BJT(e.name, e.nodes, e.pol, p)); break;
                case "M": c.add(new MOSFET(e.name, e.nodes, e.pol, p)); break;
                case "OPAMP": c.add(new OpAmp(e.name, e.nodes, p)); break;
                case "GATE": c.add(new LogicGate(e.name, e.nodes, e.gate, p)); break;
                case "555": c.add(new Timer555(e.name, e.nodes, p)); break;
                case "J": c.add(new JFET(e.name, [e.nodes[0], e.nodes[1], e.nodes[2]], e.pol, p)); break;
                case "T": c.add(new Transformer(e.name, e.nodes, p)); break;
                case "RLY": c.add(new Relay(e.name, e.nodes, p)); break;
                case "FUSE": c.add(new Fuse(e.name, e.nodes, p)); break;
                case "SCR": case "TRIAC": c.add(new Thyristor(e.name, e.nodes, p)); break;
                case "REG": c.add(new Regulator(e.name, e.nodes, p)); break;
                case "FF": c.add(new FlipFlop(e.name, e.nodes, e.ff, p)); break;
                case "DIGITAL": c.add(new DigitalIC(e.name, e.nodes, LOGIC_ICS[e.ic], p)); break;
                case "SUBCKT": SpiceParser.addSubckt(c, e.def, e.nodes, e.name); break;
                case "BSRC": c.add(new BSource(e.name, e.nodes, { mode: e.params.mode, expr: e.params.expr })); break;
                case "CCCS": c.add(new CCCS(e.name, e.nodes, { ctrl: e.ctrl, gain: p.gain, vsat: p.vsat })); break;
            }
        }
        return c;
    }

    // One call for the UI: nets + elements + a ready SimCircuit
    static extract(editor) {
        return typeof DesignParams !== "undefined" ? DesignParams.with(editor, () => NetlistExtractor.extractNow(editor)) : NetlistExtractor.extractNow(editor);
    }

    static extractNow(editor) {
        const nets = NetlistExtractor.nets(editor);
        const { els, warnings } = NetlistExtractor.elements(editor, nets);
        if (typeof Hierarchy !== "undefined") Hierarchy.expand(editor, nets, els, warnings);

        if (!nets.hasGround && !els.childGround) {
            throw new Error("There is no ground in this schematic. Add a GND symbol and wire it to the circuit.");
        }
        if (!els.length) throw new Error("The schematic has no components to simulate.");

        const circuit = NetlistExtractor.instantiate(els);
        return {
            circuit, elements: els, warnings, probes: [...editor.probes, ...(els.subProbes || [])], located: els.located, nodeIC: els.nodeIC || {}, instruments: els.instruments || [],
            getPointNodeName: nets.getPointNodeName,
            getTerminalNodeName: nets.terminalNode,
            nets
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
        // only stable latch states. The cubic barrier (4) means a comparator must reach about
        // half of its range to flip the latch, i.e. it switches at the nominal threshold.
        "Bq gnd ql I=2e-1*(0.5*(1+tanh((V(nb)-V(trig))/0.005))*(1-(V(ql)-V(gnd)))-1.5*0.5*(1+tanh(max(V(thres)-V(ctrl),0.7-V(reset)+V(gnd))/0.005))*(V(ql)-V(gnd))+4*(V(ql)-V(gnd))*(1-(V(ql)-V(gnd)))*(2*(V(ql)-V(gnd))-1))",
        "Bout oi gnd V=0.1+(V(vcc)-V(gnd)-1.8)*0.5*(1+tanh((V(ql)-V(gnd)-0.5)/0.005))",
        "Ro oi out 10",
        "Bdis disch gnd I=(V(disch)-V(gnd))/10*(1-0.5*(1+tanh((V(ql)-V(gnd)-0.5)/0.005)))",
        ".ends NE555"
    ];

    // ports: anode cathode gate (SCR) or MT2 MT1 gate (TRIAC). The state x relaxes to 1 when the device is forward biased
    // and triggered, to 0 when the current falls below the holding current; it holds in between.
    static thyristorSubckt(id, triac, params, f) {
        const p = Object.assign({ igt: 5e-3, ih: 10e-3, vf: 1, ron: 0.05, rg: 100 }, params);
        const vf = f(p.vf), igt = f(p.igt), ih = f(p.ih), ron = f(p.ron), rg = f(p.rg);
        const xx = "min(max(v(x),0),1)";
        const step = (expr, w) => `0.5*(1+tanh((${expr})/(${w})))`;
        const ak = triac ? "abs(v(a1,k))" : "v(a1,k)", cur = triac ? "abs(i(Vs))" : "i(Vs)", gate = triac ? "abs(v(g,k))" : "v(g,k)";
        return [
            `.subckt ${id} a k g`,
            `Rg g k ${rg}`, `Vs a a1 0`, `Cx x 0 1n`,
            `Bx 0 x I = 1m*(${step(`${ak}-${vf}`, "0.05")}*${step(`${gate}/${rg}-${igt}`, f(0.1 * p.igt))}*(1-${xx})-${step(`${ih}-${cur}`, f(0.1 * p.ih))}*${xx})`,
            triac ? `Bak a1 k I = ${xx}*sgn(v(a1,k))*max(abs(v(a1,k))-${vf},0)/${ron}+(1-${xx})*1e-9*v(a1,k)` : `Bak a1 k I = ${xx}*max(v(a1,k)-${vf},0)/${ron}+(1-${xx})*1e-9*v(a1,k)`,
            `.ends ${id}`
        ];
    }

    // Master-slave flip-flop from two sample-and-hold nodes (no clock-edge detection, so it does not depend on the time
    // step): the master follows the next-state function while the clock is low, the slave follows the master while it is
    // high; asynchronous set / reset (active high, reset wins) act on the slave. Ports: d k clk q qn set rst.
    static flipFlopSubckt(id, kind, params, f) {
        const vcc = params.vcc === undefined ? 5 : params.vcc, ro = params.ro || 50;
        const h = (x, at = 0.5, w = 0.05) => `0.5*(1+tanh((${x}-${f(vcc * at)})/${f(w * vcc)}))`;
        const hq = "0.5*(1+tanh((v(s)-0.5)/0.05))", hm = "0.5*(1+tanh((v(m)-0.5)/0.05))";
        const hd = h("v(d)"), hk = h("v(k)");
        const next = kind === "T" ? `(${hd}*(1-${hq})+(1-${hd})*${hq})`
            : kind === "JK" ? `(${hd}*(1-${hk})+${hd}*${hk}*(1-${hq})+(1-${hd})*(1-${hk})*${hq})` : hd;
        // separate thresholds for the two halves leave a dead zone while the clock crosses, so they are never both open
        const low = `(1-${h("v(clk)", 0.45, 0.01)})`, high = h("v(clk)", 0.55, 0.01);
        return [
            `.subckt ${id} d k clk q qn set rst`,
            `Cm m 0 1p`, `Cs s 0 1p`,
            `Bm 0 m I = 1m*${low}*(${next}-v(m))+50u*(${hm}-v(m))`,
            `Bs 0 s I = 1m*${high}*(v(m)-v(s))+50u*(${hq}-v(s))+10m*${h("v(set)")}*(1-v(s))*(1-${h("v(rst)")})-10m*${h("v(rst)")}*v(s)`,
            `Bq qi 0 V = ${f(vcc)}*${hq}`, `Rq qi q ${f(ro)}`,
            `Bqn qni 0 V = ${f(vcc)}*(1-${hq})`, `Rqn qni qn ${f(ro)}`,
            `.ends ${id}`
        ];
    }

    static spiceName(e) {
        const clean = (s) => String(s).replace(/[^A-Za-z0-9_]/g, "_");
        const prefix = { R: "R", C: "C", L: "L", V: "V", I: "I", E: "E", G: "G", SW: "R", D: "D", Q: "Q", M: "M", OPAMP: "X", GATE: "B", "555": "X", J: "J" }[e.kind] || "X";
        const n = clean(e.name);
        return n.toUpperCase().startsWith(prefix) ? n : `${prefix}${n}`;
    }

    static toSpice(els, opts = {}) {
        const { title = "Browser SPICE export", analysis = ".op", nodeIC = els.nodeIC } = opts;
        const f = (v) => (typeof v === "number" ? Number(v.toPrecision(6)).toString() : v);
        const lines = [`* ${title}`, `* generated ${new Date().toISOString()}`, ""];
        const models = new Map();
        const subckts = new Set();
        const extra = [];
        let uses555 = false;
        const userSubckts = new Map();
        const thyristors = new Map();

        for (const e of els) {
            const name = NetlistExtractor.spiceName(e);
            const n = e.nodes;
            const p = e.params;

            switch (e.kind) {
                case "R": lines.push(`${name} ${n[0]} ${n[1]} ${f(p.r)}`); break;
                case "C": lines.push(`${name} ${n[0]} ${n[1]} ${f(p.c)}${p.ic ? ` IC=${f(p.ic)}` : ""}`); break;
                case "L": lines.push(`${name} ${n[0]} ${n[1]} ${f(p.l)}${p.ic ? ` IC=${f(p.ic)}` : ""}`); break;
                case "E": lines.push(`${name} ${n[0]} ${n[1]} ${n[2]} ${n[3]} ${f(p.gain)}`); break;
                case "G": lines.push(`${name} ${n[0]} ${n[1]} ${n[2]} ${n[3]} ${f(p.gm)}`); break;
                case "SW": {
                    // an ideal switch exported as the resistance it presents in this state
                    lines.push(`* ${e.name} is ${p.closed ? "closed" : "open"}`);
                    lines.push(`${name} ${n[0]} ${n[1]} ${f(p.closed ? p.ron : p.roff)}`);
                    break;
                }
                case "I":
                case "V": {
                    let spec;
                    if (p.sourceType === "AC") {
                        const s = p.sin;
                        spec = `SIN(${f(s.offset)} ${f(s.amp)} ${f(s.freq)} 0 0 ${f(s.phase)}) AC ${f(s.amp)}`;
                    } else if (p.sourceType === "PWL") {
                        spec = `PWL(${p.pwl.map(pt => `${f(pt[0])} ${f(pt[1])}`).join(" ")})${p.acMag ? ` AC ${f(p.acMag)}` : ""}`;
                    } else if (p.sourceType === "EXP") {
                        const q = p.exp;
                        spec = `EXP(${f(q.v1)} ${f(q.v2)} ${f(q.td1)} ${f(q.tau1)} ${f(q.td2)} ${f(q.tau2)})${p.acMag ? ` AC ${f(p.acMag)}` : ""}`;
                    } else if (p.sourceType === "SFFM") {
                        const q = p.sffm;
                        spec = `SFFM(${f(q.vo)} ${f(q.va)} ${f(q.fc)} ${f(q.mdi)} ${f(q.fs)})${p.acMag ? ` AC ${f(p.acMag)}` : ""}`;
                    } else if (p.sourceType === "PULSE") {
                        const q = p.pulse;
                        spec = `PULSE(${f(q.v1)} ${f(q.v2)} ${f(q.delay)} ${f(q.rise)} ${f(q.fall)} ${f(q.width)} ${f(q.period)})${p.acMag ? ` AC ${f(p.acMag)}` : ""}`;
                    } else {
                        spec = `DC ${f(p.dc)}${p.acMag ? ` AC ${f(p.acMag)}` : ""}`;
                    }
                    lines.push(`${name} ${n[0]} ${n[1]} ${spec}`);
                    break;
                }
                case "D":
                    models.set(e.model, { kind: e.modelKind, params: p });
                    lines.push(`${name} ${n[0]} ${n[1]} ${e.model}`);
                    break;
                case "Q":
                    models.set(e.model, { kind: e.modelKind, params: p });
                    // SPICE order: collector base emitter
                    lines.push(`${name} ${n[1]} ${n[0]} ${n[2]} ${e.model}`);
                    break;
                case "M":
                    models.set(e.model, { kind: e.modelKind, params: p });
                    // drain gate source bulk
                    lines.push(`${name} ${n[1]} ${n[0]} ${n[2]} ${n[3] === undefined ? n[2] : n[3]} ${e.model} W=${f(p.w || 1e-6)} L=${f(p.l || 1e-6)}${p.ad ? ` AD=${f(p.ad)}` : ""}${p.as ? ` AS=${f(p.as)}` : ""}${p.pd ? ` PD=${f(p.pd)}` : ""}${p.ps ? ` PS=${f(p.ps)}` : ""}`);
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
                        case "XNOR": expr = `${vcc}*(1-(${u(n[0])}+${u(n[1])}-2*${u(n[0])}*${u(n[1])}))`; break;
                        case "BUF": expr = `${vcc}*${u(n[0])}`; break;
                        default: expr = `${vcc}*(1-${u(n[0])})`; break;
                    }
                    // same 10 ns lag and 50 ohm output as the built-in model: ideal gate -> RC -> buffer -> Ro
                    const out = n[n.length - 1];
                    const tpd = 10e-9, rd = 1000;
                    lines.push(`B${name}_G ${name}_a 0 V=${expr}`);
                    lines.push(`R${name}_D ${name}_a ${name}_f ${rd}`);
                    lines.push(`C${name}_D ${name}_f 0 ${f(tpd / rd)}`);
                    lines.push(`B${name}_B ${name}_o 0 V=V(${name}_f)`);
                    lines.push(`R${name}_O ${name}_o ${out} 50`);
                    break;
                }
                case "J":
                    models.set(e.model, { kind: e.modelKind, params: p });
                    lines.push(`${name} ${n[1]} ${n[0]} ${n[2]} ${e.model}`); // drain gate source
                    break;
                case "T": {
                    // two coupled inductors; winding resistances go in series with the pins
                    const nm = String(e.name).replace(/[^A-Za-z0-9_]/g, "_");
                    const l2 = p.l1 * p.ratio * p.ratio;
                    const pa = p.rp > 0 ? `${nm}_p` : n[0], sa = p.rs > 0 ? `${nm}_s` : n[2];
                    if (p.rp > 0) lines.push(`R${nm}_P ${n[0]} ${pa} ${f(p.rp)}`);
                    if (p.rs > 0) lines.push(`R${nm}_S ${n[2]} ${sa} ${f(p.rs)}`);
                    lines.push(`L${nm}_P ${pa} ${n[1]} ${f(p.l1)}`, `L${nm}_S ${sa} ${n[3]} ${f(l2)}`, `K${nm} L${nm}_P L${nm}_S ${f(p.k)}`);
                    break;
                }
                case "RLY": {
                    // coil: R + L; the contact is a voltage-controlled switch across the coil resistor
                    const nm = String(e.name).replace(/[^A-Za-z0-9_]/g, "_");
                    const vt = (p.pull + p.drop) / 2 * p.rcoil, vh = (p.pull - p.drop) / 2 * p.rcoil;
                    lines.push(`R${nm}_C ${n[0]} ${nm}_m ${f(p.rcoil)}`, `L${nm}_C ${nm}_m ${n[1]} ${f(p.lcoil)}`,
                        `S${nm} ${n[2]} ${n[3]} ${n[0]} ${nm}_m SW_${nm}`);
                    extra.push(`.model SW_${nm} SW(VT=${f(vt)} VH=${f(vh)} RON=${f(p.ron || 0.05)} ROFF=${f(p.roff || 1e9)})`);
                    break;
                }
                case "FUSE":
                    lines.push(`* ${e.name}: fuse (blows at I2t > ${f(p.rating * p.rating * p.tm)} A2s in the built-in simulator), exported as its cold resistance`);
                    lines.push(`R${String(e.name).replace(/[^A-Za-z0-9_]/g, "_")} ${n[0]} ${n[1]} ${f(p.r)}`);
                    break;
                case "REG": {
                    // behavioural pass element: smooth-min of the set voltage and (input - dropout)
                    const nm = String(e.name).replace(/[^A-Za-z0-9_]/g, "_");
                    const neg = p.vout < 0, a = Math.abs(p.vout);
                    const b = neg ? `(V(${n[2]})-V(${n[0]})-${f(p.dropout)})` : `(V(${n[0]})-V(${n[2]})-${f(p.dropout)})`;
                    const sm = `0.5*(${f(a)}+${b}-sqrt((${f(a)}-${b})*(${f(a)}-${b})+0.0025))`;
                    lines.push(`B${nm}_T ${nm}_o 0 V=V(${n[2]})${neg ? "-" : "+"}${sm}`,
                        `R${nm}_O ${nm}_o ${n[1]} ${f(p.ro)}`,
                        `B${nm}_I ${n[0]} ${n[2]} I=(V(${nm}_o)-V(${n[1]}))/${f(p.ro)}+${f(p.iq)}`);
                    break;
                }
                case "SUBCKT": {
                    const nm = `X${String(e.name).replace(/[^A-Za-z0-9_]/g, "_").replace(/^X/i, "")}`;
                    lines.push(`${nm} ${n.join(" ")} ${e.def.name}`);
                    userSubckts.set(e.def.name.toLowerCase(), e.def);
                    break;
                }
                case "BSRC": {
                    const ex = Expr.toSpice(p.expr);
                    if (ex.unsupported.length) lines.push(`* ${e.name}: ngspice has no ${ex.unsupported.join(", ")}() function`);
                    lines.push(`B${String(e.name).replace(/[^A-Za-z0-9_]/g, "_").replace(/^B/i, "")} ${n[0]} ${n[1]} ${p.mode}=${ex.text}`);
                    break;
                }
                case "CCCS": {
                    // output current = gain * I(sense source) with a smooth saturation near 0 V
                    const sense = NetlistExtractor.spiceName({ kind: "V", name: e.ctrl });
                    lines.push(`B${String(e.name).replace(/[^A-Za-z0-9_]/g, "_")} ${n[0]} ${n[1]} I=${f(p.gain)}*I(${sense})*tanh(V(${n[0]},${n[1]})/${f(p.vsat)})`);
                    break;
                }
                case "SCR": case "TRIAC": {
                    // a latch node x (0 off, 1 on) with a behavioural conduction path; see thyristorSubckt
                    const id = `${e.kind}_${String(e.model || "X").replace(/[^A-Za-z0-9_]/g, "_")}`;
                    thyristors.set(id, NetlistExtractor.thyristorSubckt(id, e.kind === "TRIAC", p, f));
                    const ports = e.kind === "TRIAC" ? [n[1], n[0], n[2]] : [n[0], n[1], n[2]];
                    lines.push(`X${String(e.name).replace(/[^A-Za-z0-9_]/g, "_").replace(/^X/i, "")} ${ports.join(" ")} ${id}`);
                    break;
                }
                case "FF": {
                    const id = `FF_${e.ff}_${String(p.vcc).replace(/[^0-9]/g, "_")}`;
                    thyristors.set(id, NetlistExtractor.flipFlopSubckt(id, e.ff, p, f));
                    lines.push(`X${String(e.name).replace(/[^A-Za-z0-9_]/g, "_").replace(/^X/i, "")} ${n.join(" ")} ${id}`);
                    break;
                }
                case "DIGITAL":
                    lines.push(`* ${e.name}: ${e.kind === "FF" ? "flip-flop" : (e.kind === "DIGITAL" ? e.ic + " logic IC" : e.kind)} has no SPICE model in this export (built-in simulator only)`);
                    break;
                case "555":
                    uses555 = true;
                    // pins: GND TRIG OUT RESET VCC DISCH THRES CTRL
                    lines.push(`X${name.replace(/^X/i, "")} ${n.join(" ")} NE555`);
                    break;
            }
        }

        const rails = extra.filter(l => !l.startsWith(".model")), swModels = extra.filter(l => l.startsWith(".model"));
        if (rails.length) lines.push("", "* op-amp supply rails", ...rails);
        if (swModels.length) lines.push("", "* relay contact models", ...swModels);

        if (models.size) {
            lines.push("", "* device models");
            for (const [name, m] of models) lines.push(simModelCardFromParams(m.kind, name, m.params));
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

        if (thyristors.size) lines.push("", "* thyristor macromodels (latch + conduction path)", ...[...thyristors.values()].flat());

        if (userSubckts.size) {
            lines.push("", "* subcircuits");
            const seen = new Set(), mseen = new Set();
            for (const d of userSubckts.values()) {
                for (const m of d.models || []) { const k = m.toLowerCase(); if (!mseen.has(k)) { mseen.add(k); lines.push(m); } }
                if (!seen.has(d.name.toLowerCase())) { seen.add(d.name.toLowerCase()); lines.push(d.text); }
            }
        }

        if (uses555) {
            // the behavioural latch needs tighter tolerances than the default 0.1 %
            lines.push("", ".options reltol=1e-4 vntol=1e-7", ...NetlistExtractor.NE555_SUBCKT);
        }

        // initial conditions only mean something for a "start from 0" (UIC) run
        if (nodeIC && Object.keys(nodeIC).length && /uic/i.test(analysis)) {
            lines.push("", `.ic ${Object.entries(nodeIC).map(([n, v]) => `v(${n})=${f(v)}`).join(" ")}`);
        }

        lines.push("", analysis, ".end");
        return lines.join("\n");
    }
}

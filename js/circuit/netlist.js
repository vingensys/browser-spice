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

class NetlistExtractor {
    /**
     * Converts schematic editor data (components and wires) into a solvable Circuit object and node mapping functions.
     * @param {SchematicEditor} editor 
     * @returns {{ circuit: Circuit, getPointNodeName: (x: number, y: number) => string }}
     */
    static extract(editor) {
        const circuit = new Circuit();
        const ds = new DisjointSet();

        const getKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

        // 1. Register all component terminals into DisjointSet
        const terminalNodeKeys = new Map(); // componentId:terminalName -> key

        for (const comp of editor.components) {
            const terminals = editor.getTerminals(comp);
            for (const term of terminals) {
                const pos = editor.getTerminalPosition(comp, term);
                const key = getKey(pos.x, pos.y);
                ds.makeSet(key);
                terminalNodeKeys.set(`${comp.id}:${term.name}`, key);
            }
        }

        // 2. Process all wires and merge connected point keys
        for (const wire of editor.wires) {
            if (!wire.route || wire.route.length < 2) continue;

            for (let i = 0; i < wire.route.length; i++) {
                const k1 = getKey(wire.route[i].x, wire.route[i].y);
                ds.makeSet(k1);

                if (i > 0) {
                    const k0 = getKey(wire.route[i - 1].x, wire.route[i - 1].y);
                    ds.union(k0, k1);
                }
            }

            // Union wire start / end if bound to component terminals
            if (wire.start && wire.start.type === "terminal") {
                const kStart = terminalNodeKeys.get(`${wire.start.component}:${wire.start.terminal}`);
                if (kStart && wire.route.length) {
                    ds.union(kStart, getKey(wire.route[0].x, wire.route[0].y));
                }
            }

            if (wire.end && wire.end.type === "terminal") {
                const kEnd = terminalNodeKeys.get(`${wire.end.component}:${wire.end.terminal}`);
                if (kEnd && wire.route.length) {
                    ds.union(kEnd, getKey(wire.route[wire.route.length - 1].x, wire.route[wire.route.length - 1].y));
                }
            }
        }

        // 2b. Merge T-junction wire taps (where an endpoint of wireA touches a segment of wireB)
        for (const wireA of editor.wires) {
            if (!wireA.route || wireA.route.length < 2) continue;

            const endPoints = [wireA.route[0], wireA.route[wireA.route.length - 1]];
            for (const pt of endPoints) {
                const keyA = getKey(pt.x, pt.y);

                for (const wireB of editor.wires) {
                    if (wireA === wireB || !wireB.route || wireB.route.length < 2) continue;

                    for (let j = 0; j < wireB.route.length - 1; j++) {
                        const a = wireB.route[j];
                        const b = wireB.route[j + 1];

                        if (editor.isPointOnSegment(pt.x, pt.y, a.x, a.y, b.x, b.y)) {
                            const keyB1 = getKey(a.x, a.y);
                            const keyB2 = getKey(b.x, b.y);
                            ds.union(keyA, keyB1);
                            ds.union(keyA, keyB2);
                        }
                    }
                }
            }
        }

        // 3. Find Ground root node
        let groundRoot = null;
        for (const comp of editor.components) {
            if (comp.type === "GND") {
                const key = terminalNodeKeys.get(`${comp.id}:1`);
                if (key) {
                    groundRoot = ds.find(key);
                    break;
                }
            }
        }

        // 4. Map DisjointSet roots to SPICE node names ("0" for Ground, "1", "2", ... for others)
        const rootToNodeName = new Map();
        let nodeCounter = 1;

        if (groundRoot !== null) {
            rootToNodeName.set(groundRoot, "0");
        }

        const getNodeNameForKey = (key) => {
            const root = ds.find(key);
            if (!rootToNodeName.has(root)) {
                if (root === groundRoot) {
                    rootToNodeName.set(root, "0");
                } else {
                    rootToNodeName.set(root, String(nodeCounter++));
                }
            }
            return rootToNodeName.get(root);
        };

        const getTerminalNodeName = (comp, termName) => {
            const key = terminalNodeKeys.get(`${comp.id}:${termName}`);
            if (!key) return "0";
            return getNodeNameForKey(key);
        };

        const getPointNodeName = (x, y) => {
            const snapX = editor.snap(x);
            const snapY = editor.snap(y);
            const key = getKey(snapX, snapY);

            // Find closest key in DisjointSet
            let closestKey = null;
            let minDist = 25; // 25px tolerance

            for (const k of ds.parent.keys()) {
                const [kx, ky] = k.split(',').map(Number);
                const d = Math.hypot(x - kx, y - ky);
                if (d < minDist) {
                    minDist = d;
                    closestKey = k;
                }
            }

            if (closestKey) {
                return getNodeNameForKey(closestKey);
            }

            return "0";
        };

        // 5. Instantiate solver components and add to Circuit
        for (const comp of editor.components) {
            if (comp.type === "GND") continue;

            const n1 = getTerminalNodeName(comp, "1");
            const n2 = getTerminalNodeName(comp, "2");

            let solverComp = null;
            switch (comp.type) {
                case "R":
                    const rVal = Units.parseSI(comp.value) || 1000;
                    solverComp = new Resistor(comp.name, n1, n2, rVal);
                    break;
                case "C":
                    const cVal = Units.parseSI(comp.value) || 1e-6;
                    solverComp = new Capacitor(comp.name, n1, n2, cVal);
                    break;
                case "L":
                    const lVal = Units.parseSI(comp.value) || 1e-3;
                    solverComp = new Inductor(comp.name, n1, n2, lVal);
                    break;
                case "V":
                    const dcVal = Units.parseSI(comp.dcVoltage || comp.value) || 5;
                    solverComp = new VoltageSource(comp.name, n1, n2, dcVal);
                    solverComp.sourceType = comp.sourceType || "DC";
                    solverComp.dcVoltage = dcVal;
                    solverComp.dcOffset = Units.parseSI(comp.dcOffset) || 0;
                    solverComp.acMagnitude = Units.parseSI(comp.acMagnitude || comp.value) || 5;
                    solverComp.acPhase = Units.parseSI(comp.acPhase) || 0;
                    solverComp.frequency = Units.parseSI(comp.frequency) || 1000;
                    break;
            }

            if (solverComp) {
                circuit.addComponent(solverComp);
            }
        }

        return { circuit, getPointNodeName };
    }

    static extractCircuit(editor) {
        return NetlistExtractor.extract(editor).circuit;
    }
}

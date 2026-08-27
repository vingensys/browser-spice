class DCOperatingPoint {
    constructor(circuit) {
        this.circuit = circuit;
        this.result = this.solveDC(circuit);
    }

    solveDC(circuit) {
        const nodeNames = circuit.getNonGroundNodes();
        const voltageSources = circuit.getVoltageSources();

        const nodeCount = nodeNames.length;
        const sourceCount = voltageSources.length;
        const matrixSize = nodeCount + sourceCount;

        if (matrixSize === 0) {
            return { nodeVoltages: {}, sourceCurrents: {} };
        }

        const A = createComplexMatrix(matrixSize, matrixSize);
        const b = createComplexVector(matrixSize);

        const nodeIndex = new Map();
        nodeNames.forEach((name, index) => {
            nodeIndex.set(name, index);
        });

        function getIndex(node) {
            if (node === "0") return -1;
            return nodeIndex.get(node);
        }

        function addConductance(node1, node2, g) {
            const i = getIndex(node1);
            const j = getIndex(node2);
            const G = new Complex(g, 0);

            if (i >= 0) A[i][i] = A[i][i].add(G);
            if (j >= 0) A[j][j] = A[j][j].add(G);

            if (i >= 0 && j >= 0) {
                A[i][j] = A[i][j].sub(G);
                A[j][i] = A[j][i].sub(G);
            }
        }

        // Add Gmin shunt to ground for every non-ground node to prevent singular matrices
        const Gmin = new Complex(1e-12, 0);
        for (let i = 0; i < nodeCount; i++) {
            A[i][i] = A[i][i].add(Gmin);
        }

        // Stamp components for DC
        for (const comp of circuit.components) {
            const type = comp.getType();
            if (type === "RESISTOR") {
                addConductance(comp.node1, comp.node2, 1 / comp.resistance);
            } else if (type === "INDUCTOR") {
                // Inductor is short circuit at DC (large conductance 1e6)
                addConductance(comp.node1, comp.node2, 1e6);
            } else if (type === "CAPACITOR") {
                // Capacitor is open circuit at DC (small conductance 1e-12)
                addConductance(comp.node1, comp.node2, 1e-12);
            }
        }

        // Stamp DC Voltage Sources
        voltageSources.forEach((source, sourceIndex) => {
            const row = nodeCount + sourceIndex;
            const i = getIndex(source.node1);
            const j = getIndex(source.node2);

            if (i >= 0) {
                A[i][row] = A[i][row].add(Complex.one());
                A[row][i] = A[row][i].add(Complex.one());
            }

            if (j >= 0) {
                A[j][row] = A[j][row].sub(Complex.one());
                A[row][j] = A[row][j].sub(Complex.one());
            }

            const dcVal = source.sourceType === "AC" ? source.dcVoltage : source.dcVoltage;
            b[row] = new Complex(dcVal, 0);
        });

        const solution = solveComplexMatrix(A, b);

        const nodeVoltages = { "0": 0 };
        nodeNames.forEach((name, index) => {
            nodeVoltages[name] = solution[index].re;
        });

        const sourceCurrents = {};
        voltageSources.forEach((source, index) => {
            sourceCurrents[source.name] = solution[nodeCount + index].re;
        });

        return { nodeVoltages, sourceCurrents };
    }

    voltage(node) {
        if (node === "0") return 0;
        return this.result.nodeVoltages[node] || 0;
    }

    sourceCurrent(name) {
        return this.result.sourceCurrents[name] || 0;
    }
}

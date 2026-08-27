function solveAC(circuit, frequency) {

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

    function addMatrix(row, col, value) {
        A[row][col] = A[row][col].add(value);
    }

    function stampAdmittance(node1, node2, Y) {
        const i = getIndex(node1);
        const j = getIndex(node2);

        if (i >= 0) addMatrix(i, i, Y);
        if (j >= 0) addMatrix(j, j, Y);

        if (i >= 0 && j >= 0) {
            addMatrix(i, j, Y.scale(-1));
            addMatrix(j, i, Y.scale(-1));
        }
    }

    // Add Gmin shunt to ground for every non-ground node
    const Gmin = new Complex(1e-12, 0);
    for (let i = 0; i < nodeCount; i++) {
        A[i][i] = A[i][i].add(Gmin);
    }

    // Stamp R, C, and L
    for (const component of circuit.components) {
        const type = component.getType();

        if (type === "RESISTOR") {
            stampAdmittance(component.node1, component.node2, component.admittance());
        } else if (type === "CAPACITOR") {
            stampAdmittance(component.node1, component.node2, component.admittance(frequency));
        } else if (type === "INDUCTOR") {
            stampAdmittance(component.node1, component.node2, component.admittance(frequency));
        }
    }

    // Stamp voltage sources
    voltageSources.forEach((source, sourceIndex) => {
        const row = nodeCount + sourceIndex;
        const i = getIndex(source.node1);
        const j = getIndex(source.node2);

        if (i >= 0) {
            addMatrix(i, row, Complex.one());
            addMatrix(row, i, Complex.one());
        }

        if (j >= 0) {
            addMatrix(j, row, new Complex(-1, 0));
            addMatrix(row, j, new Complex(-1, 0));
        }

        b[row] = source.phasor();
    });

    const solution = solveComplexMatrix(A, b);

    const nodeVoltages = { "0": Complex.zero() };
    nodeNames.forEach((name, index) => {
        nodeVoltages[name] = solution[index];
    });

    const sourceCurrents = {};
    voltageSources.forEach((source, index) => {
        sourceCurrents[source.name] = solution[nodeCount + index];
    });

    return {
        nodeVoltages,
        sourceCurrents
    };
}
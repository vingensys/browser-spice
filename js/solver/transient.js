class TransientAnalysis {
    /**
     * Solves time-domain transient response using Backward Euler companion model integration.
     * @param {Circuit} circuit 
     * @param {number} tStop Total simulation duration in seconds (default 10 ms)
     * @param {number} tStep Time step resolution in seconds (default 10 µs)
     */
    constructor(circuit, tStop = 0.01, tStep = 1e-5) {
        this.circuit = circuit;
        this.tStop = tStop;
        this.tStep = tStep;

        this.timePoints = [];
        this.nodeHistories = {};
        this.currentHistories = {};

        this.runSimulation();
    }

    runSimulation() {
        const nodeNames = this.circuit.getNonGroundNodes();
        const voltageSources = this.circuit.getVoltageSources();

        // Initialize histories
        nodeNames.forEach(name => {
            this.nodeHistories[name] = [];
        });
        voltageSources.forEach(source => {
            this.currentHistories[source.name] = [];
        });

        // Initial condition state (t=0)
        let prevNodeVoltages = {};
        nodeNames.forEach(name => { prevNodeVoltages[name] = 0; });
        prevNodeVoltages["0"] = 0;

        let prevCapVoltages = new Map();
        let prevIndCurrents = new Map();

        this.circuit.components.forEach(comp => {
            if (comp.getType() === "CAPACITOR") prevCapVoltages.set(comp, 0);
            if (comp.getType() === "INDUCTOR") prevIndCurrents.set(comp, 0);
        });

        const dt = this.tStep;
        const totalSteps = Math.ceil(this.tStop / dt);

        const nodeCount = nodeNames.length;
        const sourceCount = voltageSources.length;
        const matrixSize = nodeCount + sourceCount;

        if (matrixSize === 0) return;

        const nodeIndex = new Map();
        nodeNames.forEach((name, index) => {
            nodeIndex.set(name, index);
        });

        const getIndex = (node) => (node === "0" ? -1 : nodeIndex.get(node));

        for (let step = 0; step <= totalSteps; step++) {
            const time = step * dt;
            this.timePoints.push(time);

            const A = createComplexMatrix(matrixSize, matrixSize);
            const b = createComplexVector(matrixSize);

            // Add Gmin shunt to ground to prevent matrix singularity
            const Gmin = new Complex(1e-12, 0);
            for (let i = 0; i < nodeCount; i++) {
                A[i][i] = A[i][i].add(Gmin);
            }

            const addConductance = (node1, node2, g) => {
                const i = getIndex(node1);
                const j = getIndex(node2);
                const G = new Complex(g, 0);

                if (i >= 0) A[i][i] = A[i][i].add(G);
                if (j >= 0) A[j][j] = A[j][j].add(G);

                if (i >= 0 && j >= 0) {
                    A[i][j] = A[i][j].sub(G);
                    A[j][i] = A[j][i].sub(G);
                }
            };

            const addCurrentSource = (node1, node2, current) => {
                const i = getIndex(node1);
                const j = getIndex(node2);

                if (i >= 0) b[i] = b[i].add(new Complex(current, 0));
                if (j >= 0) b[j] = b[j].sub(new Complex(current, 0));
            };

            // Stamp components with Backward Euler companion models
            for (const comp of this.circuit.components) {
                const type = comp.getType();

                if (type === "RESISTOR") {
                    addConductance(comp.node1, comp.node2, 1 / comp.resistance);
                } else if (type === "CAPACITOR") {
                    const gEq = comp.capacitance / dt;
                    const vPrev = prevCapVoltages.get(comp) || 0;
                    const iEq = gEq * vPrev;

                    addConductance(comp.node1, comp.node2, gEq);
                    addCurrentSource(comp.node1, comp.node2, iEq);
                } else if (type === "INDUCTOR") {
                    const gEq = dt / comp.inductance;
                    const iPrev = prevIndCurrents.get(comp) || 0;

                    addConductance(comp.node1, comp.node2, gEq);
                    addCurrentSource(comp.node1, comp.node2, iPrev);
                }
            }

            // Stamp Voltage Sources (supports AC time-varying signals and DC)
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

                const vInstant = source.getVoltageAtTime(time);
                b[row] = new Complex(vInstant, 0);
            });

            const solution = solveComplexMatrix(A, b);

            // Record voltages
            const currentStepVoltages = { "0": 0 };
            nodeNames.forEach((name, index) => {
                const v = solution[index].re;
                currentStepVoltages[name] = v;
                this.nodeHistories[name].push(v);
            });

            voltageSources.forEach((source, index) => {
                this.currentHistories[source.name].push(solution[nodeCount + index].re);
            });

            // Update states for next step
            this.circuit.components.forEach(comp => {
                if (comp.getType() === "CAPACITOR") {
                    const vComp = (currentStepVoltages[comp.node1] || 0) - (currentStepVoltages[comp.node2] || 0);
                    prevCapVoltages.set(comp, vComp);
                } else if (comp.getType() === "INDUCTOR") {
                    const vComp = (currentStepVoltages[comp.node1] || 0) - (currentStepVoltages[comp.node2] || 0);
                    const iPrev = prevIndCurrents.get(comp) || 0;
                    const iNew = iPrev + (dt / comp.inductance) * vComp;
                    prevIndCurrents.set(comp, iNew);
                }
            });

            prevNodeVoltages = currentStepVoltages;
        }
    }
}

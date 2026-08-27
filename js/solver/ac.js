class ACAnalysis {

    constructor(circuit, frequency = 1000) {
        this.circuit = circuit;
        this.frequency = frequency;
        this.result = solveAC(circuit, frequency);
    }

    voltage(node) {
        if (node === "0") return Complex.zero();
        return this.result.nodeVoltages[node] || Complex.zero();
    }

    sourceCurrent(name) {
        return this.result.sourceCurrents[name] || Complex.zero();
    }

    /**
     * Performs logarithmic frequency sweep for AC Bode Plot analysis.
     */
    static sweep(circuit, startFreq = 1, stopFreq = 1e6, pointsPerDecade = 20) {
        const results = [];
        const decades = Math.log10(stopFreq / startFreq);
        const totalPoints = Math.max(10, Math.round(decades * pointsPerDecade));

        const logStart = Math.log10(startFreq);
        const logStop = Math.log10(stopFreq);

        for (let i = 0; i <= totalPoints; i++) {
            const freq = Math.pow(10, logStart + (i / totalPoints) * (logStop - logStart));
            const ac = new ACAnalysis(circuit, freq);
            results.push({
                frequency: freq,
                nodeVoltages: ac.result.nodeVoltages,
                sourceCurrents: ac.result.sourceCurrents
            });
        }

        return results;
    }
}
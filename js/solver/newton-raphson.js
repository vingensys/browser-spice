/**
 * Newton-Raphson Non-Linear Solver Core for SPICE Semiconductor Devices
 */
class NewtonRaphsonSolver {
    /**
     * Diode equation & linearization:
     * Id = Is * (exp(Vd / (n * Vt)) - 1)
     * gd = dId/dVd = (Is / (n * Vt)) * exp(Vd / (n * Vt))
     * Ieq = Id - gd * Vd
     */
    static evaluateDiode(vd, Is = 1e-14, n = 1, Vt = 0.02585, vCritical = 0.7) {
        // Voltage limiting to prevent floating point overflow in exp()
        let vdLimited = vd;
        if (vd > vCritical) {
            vdLimited = vCritical + (n * Vt) * Math.log(1 + (vd - vCritical) / (n * Vt));
        }

        const expVal = Math.exp(vdLimited / (n * Vt));
        const id = Is * (expVal - 1);
        const gd = Math.max(1e-12, (Is / (n * Vt)) * expVal);
        const ieq = id - gd * vdLimited;

        return { id, gd, ieq, vdLimited };
    }

    /**
     * Checks convergence between previous iteration voltages and current iteration voltages
     */
    static checkConvergence(vOld, vNew, relTol = 1e-3, absTol = 1e-6) {
        for (const node in vNew) {
            const v1 = vOld[node] || 0;
            const v2 = vNew[node] || 0;
            const diff = Math.abs(v2 - v1);
            const limit = absTol + relTol * Math.max(Math.abs(v1), Math.abs(v2));
            if (diff > limit) return false;
        }
        return true;
    }
}

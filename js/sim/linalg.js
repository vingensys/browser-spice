// Dense linear algebra for the SPICE engine.
//
// DenseSystem solves A x = b with LU and partial pivoting. Circuits here are
// at most a few hundred unknowns, where dense is simpler and fast enough.
// ComplexStamper maps a complex system onto a real 2N x 2N one for AC analysis.

class SingularMatrixError extends Error {
    constructor(index) {
        super("Singular matrix");
        this.name = "SingularMatrixError";
        this.index = index;
    }
}

class DenseSystem {
    constructor(n) {
        this.n = n;
        this.A = new Float64Array(n * n);
        this.b = new Float64Array(n);
    }

    clear() {
        this.A.fill(0);
        this.b.fill(0);
    }

    // i / j of -1 is ground and is skipped
    add(i, j, v) {
        if (i < 0 || j < 0) return;
        this.A[i * this.n + j] += v;
    }

    rhs(i, v) {
        if (i < 0) return;
        this.b[i] += v;
    }

    // Conductance g between nodes i and j
    addG(i, j, g) {
        this.add(i, i, g);
        this.add(j, j, g);
        this.add(i, j, -g);
        this.add(j, i, -g);
    }

    solve() {
        const n = this.n;
        const M = Float64Array.from(this.A);
        const x = Float64Array.from(this.b);

        for (let k = 0; k < n; k++) {
            let p = k;
            let max = Math.abs(M[k * n + k]);
            for (let i = k + 1; i < n; i++) {
                const v = Math.abs(M[i * n + k]);
                if (v > max) { max = v; p = i; }
            }
            if (max < 1e-30) throw new SingularMatrixError(k);

            if (p !== k) {
                for (let j = 0; j < n; j++) {
                    const t = M[k * n + j]; M[k * n + j] = M[p * n + j]; M[p * n + j] = t;
                }
                const t = x[k]; x[k] = x[p]; x[p] = t;
            }

            const piv = M[k * n + k];
            for (let i = k + 1; i < n; i++) {
                const f = M[i * n + k] / piv;
                if (f === 0) continue;
                M[i * n + k] = 0;
                for (let j = k + 1; j < n; j++) M[i * n + j] -= f * M[k * n + j];
                x[i] -= f * x[k];
            }
        }

        for (let i = n - 1; i >= 0; i--) {
            let s = x[i];
            for (let j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
            x[i] = s / M[i * n + i];
        }
        return x;
    }
}

// Complex admittance stamping on a real block system [Re -Im; Im Re].
class ComplexStamper {
    constructor(n) {
        this.n = n;
        this.sys = new DenseSystem(2 * n);
    }

    clear() { this.sys.clear(); }

    add(i, j, re, im = 0) {
        if (i < 0 || j < 0) return;
        const n = this.n;
        this.sys.add(i, j, re);
        this.sys.add(n + i, n + j, re);
        this.sys.add(i, n + j, -im);
        this.sys.add(n + i, j, im);
    }

    addY(i, j, re, im = 0) {
        this.add(i, i, re, im);
        this.add(j, j, re, im);
        this.add(i, j, -re, -im);
        this.add(j, i, -re, -im);
    }

    rhs(i, re, im = 0) {
        if (i < 0) return;
        this.sys.rhs(i, re);
        this.sys.rhs(this.n + i, im);
    }

    // returns { re: Float64Array, im: Float64Array }
    solve() {
        const x = this.sys.solve();
        return { re: x.slice(0, this.n), im: x.slice(this.n) };
    }
}

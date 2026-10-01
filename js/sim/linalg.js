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

// Sparse LU with Markowitz pivoting for larger circuits. Same interface as DenseSystem.
//
// Rows are hash maps (column -> value). Each step picks the sparsest active column, then
// the pivot row in it with the fewest entries among those within a threshold of the largest
// (so a zero diagonal on a voltage-source row is no problem), and eliminates it. Fill-in is
// kept low by that ordering, so cost grows roughly with the number of nonzeros rather than n^3.
class SparseSystem {
    constructor(n) {
        this.n = n;
        this.rows = Array.from({ length: n }, () => new Map());
        this.b = new Float64Array(n);
    }

    clear() {
        for (const r of this.rows) r.clear();
        this.b.fill(0);
    }

    add(i, j, v) {
        if (i < 0 || j < 0) return;
        const r = this.rows[i];
        r.set(j, (r.get(j) || 0) + v);
    }

    rhs(i, v) {
        if (i < 0) return;
        this.b[i] += v;
    }

    addG(i, j, g) {
        this.add(i, i, g);
        this.add(j, j, g);
        this.add(i, j, -g);
        this.add(j, i, -g);
    }

    // Newton iterations re-solve the same circuit structure over and over, so the pivot order
    // found by the first (searching) factorisation is replayed afterwards. If a replayed pivot
    // has become too small, fall back to a fresh search.
    solve() {
        if (this.plan) {
            try { return this.factor(this.plan); } catch (e) { if (!(e instanceof PivotReplayError)) throw e; }
        }
        return this.factor(null);
    }

    factor(plan) {
        const n = this.n;
        const rows = this.rows.map(m => new Map(m));
        const b = Float64Array.from(this.b);
        const cols = Array.from({ length: n }, () => new Set());
        for (let i = 0; i < n; i++) for (const j of rows[i].keys()) cols[j].add(i);

        const colActive = new Uint8Array(n).fill(1);
        const pivots = []; // { p, q, pv, prow }
        const order = [];
        const THRESH = 0.1, REPLAY_THRESH = 0.01;

        for (let k = 0; k < n; k++) {
            let p = -1, q = -1;

            if (plan) {
                ({ p, q } = plan[k]);
                const entry = rows[p].get(q);
                if (entry === undefined || !colActive[q]) throw new PivotReplayError();
                let maxAbs = 0;
                for (const i of cols[q]) maxAbs = Math.max(maxAbs, Math.abs(rows[i].get(q)));
                if (maxAbs < 1e-30 || Math.abs(entry) < REPLAY_THRESH * maxAbs) throw new PivotReplayError();
            } else {
                // sparsest active column
                let best = Infinity;
                for (let j = 0; j < n; j++) {
                    if (!colActive[j]) continue;
                    const c = cols[j].size;
                    if (c < best) { best = c; q = j; if (c <= 1) break; }
                }
                if (q < 0 || best === 0) throw new SingularMatrixError(q < 0 ? k : q);

                let maxAbs = 0;
                for (const i of cols[q]) maxAbs = Math.max(maxAbs, Math.abs(rows[i].get(q)));
                if (maxAbs < 1e-30) throw new SingularMatrixError(q);

                // among acceptable rows prefer the one with the fewest entries (least fill)
                let bestLen = Infinity;
                for (const i of cols[q]) {
                    if (Math.abs(rows[i].get(q)) >= THRESH * maxAbs && rows[i].size < bestLen) {
                        bestLen = rows[i].size;
                        p = i;
                    }
                }
            }

            const prow = rows[p];
            const pv = prow.get(q);

            for (const i of Array.from(cols[q])) {
                if (i === p) continue;
                const ri = rows[i];
                const f = ri.get(q) / pv;
                ri.delete(q);
                if (f !== 0) {
                    for (const [j, v] of prow) {
                        if (j === q) continue;
                        const old = ri.get(j);
                        if (old === undefined) { ri.set(j, -f * v); cols[j].add(i); }
                        else ri.set(j, old - f * v);
                    }
                    b[i] -= f * b[p];
                }
            }

            // retire the pivot row and column
            for (const j of prow.keys()) cols[j].delete(p);
            cols[q].clear();
            colActive[q] = 0;
            pivots.push({ p, q, pv, prow });
            order.push({ p, q });
        }

        if (!plan) this.plan = order;

        const x = new Float64Array(n);
        for (let k = n - 1; k >= 0; k--) {
            const { p, q, pv, prow } = pivots[k];
            let sum = b[p];
            for (const [j, v] of prow) if (j !== q) sum -= v * x[j];
            x[q] = sum / pv;
        }
        return x;
    }
}

class PivotReplayError extends Error { }

// Pick the solver by problem size (dense wins for small systems, sparse for large ones).
const SPARSE_THRESHOLD = { n: 70 };
function createSystem(n) {
    return n >= SPARSE_THRESHOLD.n ? new SparseSystem(n) : new DenseSystem(n);
}

// Complex admittance stamping on a real block system [Re -Im; Im Re].
class ComplexStamper {
    constructor(n) {
        this.n = n;
        this.sys = createSystem(2 * n);
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

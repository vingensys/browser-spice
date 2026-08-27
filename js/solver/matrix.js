function createComplexMatrix(rows, columns) {
    return Array.from(
        { length: rows },
        () =>
            Array.from(
                { length: columns },
                () => Complex.zero()
            )
    );
}

function createComplexVector(size) {
    return Array.from(
        { length: size },
        () => Complex.zero()
    );
}

function solveComplexMatrix(A, b) {
    const n = b.length;

    // Gaussian elimination with partial pivoting
    for (let k = 0; k < n; k++) {
        let pivotRow = k;
        let pivotMagnitude = A[k][k].magnitude();

        for (let row = k + 1; row < n; row++) {
            const magnitude = A[row][k].magnitude();
            if (magnitude > pivotMagnitude) {
                pivotMagnitude = magnitude;
                pivotRow = row;
            }
        }

        if (pivotMagnitude < 1e-15) {
            throw new Error(
                "Circuit matrix is singular. Please verify that your circuit has a Ground (GND) component connected and no floating nodes or short-circuited voltage sources."
            );
        }

        // Swap rows
        if (pivotRow !== k) {
            [A[k], A[pivotRow]] = [A[pivotRow], A[k]];
            [b[k], b[pivotRow]] = [b[pivotRow], b[k]];
        }

        // Eliminate
        for (let row = k + 1; row < n; row++) {
            const factor = A[row][k].div(A[k][k]);

            for (let col = k; col < n; col++) {
                A[row][col] = A[row][col].sub(factor.mul(A[k][col]));
            }

            b[row] = b[row].sub(factor.mul(b[k]));
        }
    }

    // Back substitution
    const x = createComplexVector(n);

    for (let row = n - 1; row >= 0; row--) {
        let sum = b[row];

        for (let col = row + 1; col < n; col++) {
            sum = sum.sub(A[row][col].mul(x[col]));
        }

        x[row] = sum.div(A[row][row]);
    }

    return x;
}
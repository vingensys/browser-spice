// Numbers behind the graph window: interpolation, statistics, frequency and edge measurements,
// AC figures (peak, -3 dB bandwidth, unity-gain frequency, phase margin) and CSV export.
// Pure functions of arrays, so they are testable without a canvas.

class PlotMath {

    // first index whose x is >= value (xs ascending)
    static lowerBound(xs, x) {
        let lo = 0, hi = xs.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] < x) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    // value of a piecewise-linear signal at x (clamped to the data); log interpolates against log10(x)
    static valueAt(xs, ys, x, log = false) {
        const n = xs.length;
        if (!n) return NaN;
        if (x <= xs[0]) return ys[0];
        if (x >= xs[n - 1]) return ys[n - 1];
        const i = PlotMath.lowerBound(xs, x);
        const x0 = xs[i - 1], x1 = xs[i];
        const t = log && x0 > 0 && x1 > 0 ? (Math.log10(x) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0)) : (x - x0) / (x1 - x0 || 1);
        return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }

    // the signal restricted to [x0, x1] with interpolated end points
    static clip(xs, ys, x0, x1, log = false) {
        const n = xs.length;
        if (!n) return { xs: [], ys: [] };
        const a = Math.max(Math.min(x0, x1), xs[0]), b = Math.min(Math.max(x0, x1), xs[n - 1]);
        if (!(b > a)) return { xs: [a], ys: [PlotMath.valueAt(xs, ys, a, log)] };
        const outX = [a], outY = [PlotMath.valueAt(xs, ys, a, log)];
        for (let i = PlotMath.lowerBound(xs, a); i < n && xs[i] < b; i++) {
            if (xs[i] > a) { outX.push(xs[i]); outY.push(ys[i]); }
        }
        outX.push(b); outY.push(PlotMath.valueAt(xs, ys, b, log));
        return { xs: outX, ys: outY };
    }

    // min, max, peak-to-peak and the time-weighted mean and RMS of a piecewise-linear signal over [x0, x1]
    static stats(xs, ys, x0, x1) {
        const c = PlotMath.clip(xs, ys, x0, x1);
        const n = c.xs.length;
        if (!n) return null;
        let min = Infinity, max = -Infinity;
        for (const v of c.ys) { if (v < min) min = v; if (v > max) max = v; }
        let area = 0, sq = 0;
        for (let i = 1; i < n; i++) {
            const dt = c.xs[i] - c.xs[i - 1], a = c.ys[i - 1], b = c.ys[i];
            area += (a + b) / 2 * dt;
            sq += (a * a + a * b + b * b) / 3 * dt;     // exact integral of a straight segment squared
        }
        const span = c.xs[n - 1] - c.xs[0];
        return span > 0
            ? { min, max, pkpk: max - min, mean: area / span, rms: Math.sqrt(Math.max(sq / span, 0)), span }
            : { min, max, pkpk: max - min, mean: c.ys[0], rms: Math.abs(c.ys[0]), span: 0 };
    }

    // x positions where the signal crosses `level` (interpolated); dir +1 rising, -1 falling, 0 both
    static crossings(xs, ys, level, x0 = -Infinity, x1 = Infinity, dir = 0) {
        const out = [];
        for (let i = 1; i < xs.length; i++) {
            if (xs[i] < x0 || xs[i - 1] > x1) continue;
            const a = ys[i - 1] - level, b = ys[i] - level;
            if ((a < 0 && b >= 0 && dir >= 0) || (a > 0 && b <= 0 && dir <= 0)) {
                const t = (a === b) ? 0 : a / (a - b);
                const x = xs[i - 1] + t * (xs[i] - xs[i - 1]);
                if (x >= x0 && x <= x1) out.push(x);
            }
        }
        return out;
    }

    // repetition rate from the rising crossings of the mid level; null when there is no clear periodic signal
    static frequency(xs, ys, x0, x1) {
        const s = PlotMath.stats(xs, ys, x0, x1);
        if (!s || !(s.pkpk > 1e-9)) return null;
        const mid = (s.min + s.max) / 2;
        const rise = PlotMath.crossings(xs, ys, mid, x0, x1, 1);
        if (rise.length < 2) return null;
        const period = (rise[rise.length - 1] - rise[0]) / (rise.length - 1);
        const fall = PlotMath.crossings(xs, ys, mid, rise[0], rise[rise.length - 1], -1);
        const duty = fall.length ? Math.min(Math.max((fall[0] - rise[0]) / period, 0), 1) : null;
        return { freq: 1 / period, period, cycles: rise.length - 1, duty };
    }

    // 10 % to 90 % time of the first rising and first falling edge in the range (levels from the range's min / max)
    static edges(xs, ys, x0, x1) {
        const s = PlotMath.stats(xs, ys, x0, x1);
        if (!s || !(s.pkpk > 1e-9)) return null;
        const lo = s.min + 0.1 * s.pkpk, hi = s.min + 0.9 * s.pkpk;
        const rl = PlotMath.crossings(xs, ys, lo, x0, x1, 1), rh = PlotMath.crossings(xs, ys, hi, x0, x1, 1);
        const fh = PlotMath.crossings(xs, ys, hi, x0, x1, -1), fl = PlotMath.crossings(xs, ys, lo, x0, x1, -1);
        let rise = null, fall = null;
        for (const a of rl) { const b = rh.find(v => v > a); if (b !== undefined) { rise = b - a; break; } }
        for (const a of fh) { const b = fl.find(v => v > a); if (b !== undefined) { fall = b - a; break; } }
        return { rise, fall };
    }

    // AC figures from gain in dB and phase in degrees (xs = frequency, ascending)
    static ac(xs, gainDb, phaseDeg) {
        const n = xs.length;
        if (!n) return null;
        let pi = 0;
        for (let i = 1; i < n; i++) if (gainDb[i] > gainDb[pi]) pi = i;
        const peak = { x: xs[pi], db: gainDb[pi] };
        // -3 dB points relative to the peak: the lowest / highest frequency where the response has fallen by 3 dB
        const level = peak.db - 3;
        let lo = null, hi = null;
        for (let i = 0; i < n; i++) if (gainDb[i] >= level) { lo = i; break; }
        for (let i = n - 1; i >= 0; i--) if (gainDb[i] >= level) { hi = i; break; }
        const cross = (i, j) => {                       // where the segment i..j crosses the -3 dB level, in log frequency
            const a = gainDb[i] - level, b = gainDb[j] - level;
            const t = a === b ? 0 : a / (a - b);
            return Math.pow(10, Math.log10(xs[i]) + t * (Math.log10(xs[j]) - Math.log10(xs[i])));
        };
        const f1 = lo > 0 ? cross(lo - 1, lo) : null;   // null: the response is already within 3 dB at the first point
        const f2 = hi < n - 1 ? cross(hi, hi + 1) : null;
        const bw = { low: f1, high: f2, width: f1 && f2 ? f2 - f1 : (f2 !== null && f1 === null ? f2 : null) };
        // 0 dB crossing (first downward) and the phase margin there
        let unity = null;
        for (let i = 1; i < n; i++) {
            if (gainDb[i - 1] > 0 && gainDb[i] <= 0) {
                const t = gainDb[i - 1] / (gainDb[i - 1] - gainDb[i]);
                const f = Math.pow(10, Math.log10(xs[i - 1]) + t * (Math.log10(xs[i]) - Math.log10(xs[i - 1])));
                const ph = phaseDeg ? PlotMath.valueAt(xs, phaseDeg, f, true) : null;
                unity = { x: f, phase: ph, margin: ph === null ? null : 180 + ph };
                break;
            }
        }
        return { peak, bw, unity };
    }

    // ---- CSV -------------------------------------------------------------------------------------

    static csvCell(v) {
        if (typeof v === "number") return Number.isFinite(v) ? String(Number(v.toPrecision(9))) : "";
        const s = String(v === undefined || v === null ? "" : v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }

    // columns: [{ header, values }]; rows i0..i1 inclusive
    static csv(xHeader, xs, columns, i0 = 0, i1 = xs.length - 1) {
        const lines = [[xHeader, ...columns.map(c => c.header)].map(PlotMath.csvCell).join(",")];
        for (let i = Math.max(0, i0); i <= Math.min(xs.length - 1, i1); i++) {
            lines.push([xs[i], ...columns.map(c => c.values[i])].map(PlotMath.csvCell).join(","));
        }
        return lines.join("\r\n") + "\r\n";
    }
}

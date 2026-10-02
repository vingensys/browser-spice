// Spectrum analysis of simulation waveforms: resample the (unevenly spaced) transient data onto a uniform grid,
// window it, FFT it, and report amplitude per frequency plus the fundamental and THD.
//
//   const sp = Spectrum.analyse(times, values, { t0, t1, n: 4096, window: "hann" });
//   sp.freq[], sp.mag[] (peak volts), sp.db[] (dBV, 0 dB = 1 V peak), sp.fundamental { f, mag }, sp.thd (fraction)

class Spectrum {
    static WINDOWS = {
        rect: { label: "Rectangular", f: () => 1 },
        hann: { label: "Hann", f: (i, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n) },
        hamming: { label: "Hamming", f: (i, n) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / n) },
        blackman: { label: "Blackman", f: (i, n) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n) },
        flattop: { label: "Flat top", f: (i, n) => 0.2156 - 0.4160 * Math.cos((2 * Math.PI * i) / n) + 0.2781 * Math.cos((4 * Math.PI * i) / n) - 0.0836 * Math.cos((6 * Math.PI * i) / n) + 0.0069 * Math.cos((8 * Math.PI * i) / n) }
    };

    // in-place iterative radix-2 FFT (re, im: Float64Array of power-of-two length)
    static fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
            for (let i = 0; i < n; i += len) {
                let cr = 1, ci = 0;
                for (let k = 0; k < len / 2; k++) {
                    const a = i + k, b = a + len / 2;
                    const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                    const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
                }
            }
        }
    }

    static pow2(n, max = 1 << 17) { let p = 1; while (p * 2 <= n && p * 2 <= max) p *= 2; return p; }

    // linear interpolation of an uneven signal onto n uniform points over [t0, t1)
    static resample(xs, ys, t0, t1, n) {
        const out = new Float64Array(n);
        let j = 0;
        for (let i = 0; i < n; i++) {
            const t = t0 + ((t1 - t0) * i) / n;
            while (j < xs.length - 2 && xs[j + 1] < t) j++;
            const a = xs[j], b = xs[j + 1] === undefined ? xs[j] : xs[j + 1];
            const f = b === a ? 0 : Math.min(1, Math.max(0, (t - a) / (b - a)));
            out[i] = ys[j] + f * ((ys[j + 1] === undefined ? ys[j] : ys[j + 1]) - ys[j]);
        }
        return out;
    }

    // options: t0, t1 (the span analysed; default all), n (points, power of two; default from the data), window, maxHarmonics
    static analyse(xs, ys, opts = {}) {
        const t0 = opts.t0 !== undefined ? Math.max(opts.t0, xs[0]) : xs[0];
        const t1 = opts.t1 !== undefined ? Math.min(opts.t1, xs[xs.length - 1]) : xs[xs.length - 1];
        if (!(t1 > t0) || xs.length < 8) return null;
        const inSpan = PlotMath.lowerBound(xs, t1) - PlotMath.lowerBound(xs, t0);
        const n = opts.n || Spectrum.pow2(Math.max(256, inSpan * 2));
        const x = Spectrum.resample(xs, ys, t0, t1, n);
        // remove the mean first: a large DC level would leak into the bins around the tone (the DC bin is then
        // reported from the mean itself)
        const w = (Spectrum.WINDOWS[opts.window || "hann"] || Spectrum.WINDOWS.hann).f;
        let mean = 0;
        for (let i = 0; i < n; i++) mean += x[i];
        mean /= n;
        let wsum = 0;
        const re = new Float64Array(n), im = new Float64Array(n);
        for (let i = 0; i < n; i++) { const wi = w(i, n); wsum += wi; re[i] = (x[i] - mean) * wi; }
        Spectrum.fft(re, im);
        const fs = n / (t1 - t0), half = n >> 1;
        const freq = new Float64Array(half), mag = new Float64Array(half);
        // amplitude of a sine = 2 |X| / sum(window)
        for (let k = 0; k < half; k++) {
            freq[k] = (k * fs) / n;
            mag[k] = k === 0 ? Math.abs(mean) : (2 * Math.hypot(re[k], im[k])) / wsum;
        }
        const db = Array.from(mag, m => 20 * Math.log10(Math.max(m, 1e-15)));
        // fundamental: the strongest bin above DC, refined by parabolic interpolation
        let pk = 1;
        for (let k = 2; k < half - 1; k++) if (mag[k] > mag[pk]) pk = k;
        let fund = null, thd = null, harmonics = [];
        if (pk >= 1 && mag[pk] > 1e-9) {
            const a = Math.log(Math.max(mag[pk - 1], 1e-18)), b = Math.log(mag[pk]), c = Math.log(Math.max(mag[pk + 1], 1e-18));
            const d = (a - 2 * b + c) === 0 ? 0 : 0.5 * (a - c) / (a - 2 * b + c);
            const f1 = ((pk + d) * fs) / n;
            // the window spreads a tone over a few bins: take the largest bin near each harmonic
            const near = (f) => { const c0 = Math.round((f * n) / fs); let best = 0; for (let k = Math.max(1, c0 - 2); k <= Math.min(half - 1, c0 + 2); k++) best = Math.max(best, mag[k]); return best; };
            fund = { f: f1, mag: near(f1), bin: pk };
            const hmax = opts.maxHarmonics || 10;
            let sq = 0;
            for (let h = 2; h <= hmax && h * f1 < fs / 2 - fs / n * 3; h++) { const m = near(h * f1); harmonics.push({ h, f: h * f1, mag: m }); sq += m * m; }
            thd = fund.mag > 0 ? Math.sqrt(sq) / fund.mag : null;
        }
        return { freq, mag, db, fs, n, t0, t1, mean, fundamental: fund, thd, harmonics, window: opts.window || "hann" };
    }
}

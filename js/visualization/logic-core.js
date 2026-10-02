// The logic analyser's brain: a history of eight input voltages, a threshold that turns them into 0 / 1, an
// optional edge trigger, and the window of time on show. No DOM, so it can be tested with plain numbers.
//
//   const la = new LogicCore(settings);   la.push(t, { 0: v, 3: v });   const cap = la.capture();
//   la.segments(2, cap)     [{ x0, x1, level }]  level 0 / 1 across the screen (divisions 0..10), merged runs
//   la.bus(cap, div)        the 8-bit value at a screen position (null when any input has no data)

class LogicCore {
    static CHANNELS = 8;
    static HISTORY = 60;          // screens of history kept (at the current time/div)
    static CAPACITY = 200000;
    static TDIV = [];

    static defaults() {
        return { tdiv: 1e-3, thresh: 1.5, run: true, trig: { ch: 0, edge: "none" }, back: 0, cur: { on: false, x: [3, 7] }, names: ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"] };
    }

    static merge(saved) {
        const base = LogicCore.defaults(), s = saved && typeof saved === "object" ? saved : {};
        const out = Object.assign(LogicCore.defaults(), s);
        out.trig = Object.assign(base.trig, s.trig || {});
        out.cur = Object.assign(base.cur, s.cur || {});
        out.cur.x = [Number((s.cur && s.cur.x && s.cur.x[0]) ?? 3), Number((s.cur && s.cur.x && s.cur.x[1]) ?? 7)];
        out.names = base.names.map((n, i) => (s.names && s.names[i]) || n);
        return out;
    }

    constructor(settings) { this.s = settings || LogicCore.merge(); this.reset(); }

    reset() {
        this.t = [];
        this.v = Array.from({ length: LogicCore.CHANNELS }, () => []);
        this.wired = new Array(LogicCore.CHANNELS).fill(true);
        this.last = null;
        this.status = "STOP";
    }

    get tNow() { return this.t.length ? this.t[this.t.length - 1] : 0; }

    push(t, values) {
        if (this.t.length && t <= this.t[this.t.length - 1]) return;
        this.t.push(t);
        for (let c = 0; c < LogicCore.CHANNELS; c++) this.v[c].push(values[c] === undefined ? NaN : values[c]);
        const horizon = t - LogicCore.HISTORY * this.s.tdiv - 1e-12;
        if (this.t[0] < horizon) {
            const k = PlotMath.lowerBound(this.t, horizon);
            if (k > 0) { this.t.splice(0, k); for (const a of this.v) a.splice(0, k); }
        }
        if (this.t.length > LogicCore.CAPACITY) {
            const half = this.t.length >> 1, keep = (_, i) => i >= half || i % 2 === 0;
            this.t = this.t.filter(keep);
            this.v = this.v.map(a => a.filter(keep));
        }
    }

    // what the screen shows now: the newest 10 divisions (or, with a trigger, the latest edge placed at 2 divisions);
    // "back" scrolls into the past by that many divisions
    capture() {
        const s = this.s, tdiv = s.tdiv;
        if (!this.t.length) { this.status = "STOP"; return this.last; }
        if (!s.run) { this.status = "STOP"; return this.last; }
        let t0 = this.tNow - 10 * tdiv - s.back * tdiv, trigged = false;
        const tr = s.trig;
        if (tr.edge !== "none") {
            const lvl = s.thresh, ys = this.v[tr.ch].map(v => (Number.isFinite(v) ? v : 0));
            const dir = tr.edge === "fall" ? -1 : tr.edge === "rise" ? 1 : 0;
            const hits = PlotMath.crossings(this.t, ys, lvl, Math.max(this.t[0], this.tNow - LogicCore.HISTORY * tdiv), this.tNow - 8 * tdiv, dir);
            if (hits.length) { t0 = hits[hits.length - 1] - 2 * tdiv - s.back * tdiv; trigged = true; }
            this.status = trigged ? "TRIG'D" : "WAIT";
        } else this.status = "RUN";
        this.last = { t0, tdiv, trigged };
        return this.last;
    }

    level(c, t) {
        const v = PlotMath.valueAt(this.t, this.v[c], t);
        return Number.isFinite(v) ? (v > this.s.thresh ? 1 : 0) : null;
    }

    // runs of constant level across the screen, in divisions; the switching instant is where the analogue
    // signal crosses the threshold
    segments(c, cap = this.last) {
        const out = [];
        if (!cap || !this.t.length) return out;
        const ts = this.t, vs = this.v[c], th = this.s.thresh, t1 = cap.t0 + 10 * cap.tdiv;
        const xOf = (t) => ((t - cap.t0) / cap.tdiv);
        let lvl = this.level(c, Math.max(cap.t0, ts[0])), start = Math.max(0, xOf(ts[0]));
        if (lvl === null) return out;
        let i = Math.max(1, PlotMath.lowerBound(ts, cap.t0));
        for (; i < ts.length && ts[i - 1] <= t1; i++) {
            const a = vs[i - 1], b = vs[i];
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
            if ((a > th) !== (b > th)) {
                const f = (th - a) / (b - a), t = ts[i - 1] + f * (ts[i] - ts[i - 1]);
                const x = xOf(t);
                if (x <= 0) continue;                      // switched before the screen starts: the starting level already includes it
                if (x >= 10) break;
                if (x > start) out.push({ x0: start, x1: x, level: lvl });
                start = x; lvl = lvl ? 0 : 1;
            }
        }
        const end = Math.min(10, xOf(Math.min(this.tNow, t1)));
        if (end > start) out.push({ x0: start, x1: end, level: lvl });
        return out;
    }

    // the 8-bit value across the inputs at a screen position (null if unavailable)
    bus(cap, div, chans = [0, 1, 2, 3, 4, 5, 6, 7].filter(c => this.wired[c])) {
        if (!cap) return null;
        const t = cap.t0 + (div / 10) * 10 * cap.tdiv;
        let n = 0;
        for (let k = 0; k < chans.length; k++) { const l = this.level(chans[k], t); if (l === null) return null; n |= l << k; }
        return n;
    }

    // time relative to the left edge -> each channel's level, as CSV
    csv(cap = this.last, n = 1000) {
        if (!cap) return "";
        const lines = [["Time (s)", ...this.s.names].join(",")];
        for (let i = 0; i < n; i++) {
            const t = cap.t0 + (i / (n - 1)) * 10 * cap.tdiv;
            lines.push([t, ...this.s.names.map((_, c) => { const l = this.level(c, t); return l === null ? "" : l; })].join(","));
        }
        return lines.join("\r\n");
    }

    // the fastest-switching input sets the timebase so about 4 of its cycles fill the screen
    autoset() {
        if (this.t.length < 4) return false;
        let best = 0;
        for (let c = 0; c < LogicCore.CHANNELS; c++) {
            const ys = this.v[c].map(v => (Number.isFinite(v) ? v : 0));
            const f = PlotMath.frequency(this.t, ys, this.t[0], this.tNow);
            if (f && f.freq > best) best = f.freq;
        }
        if (!best) return false;
        const want = 4 / best / 10;
        this.s.tdiv = LogicCore.TDIV.find(v => v >= want) || LogicCore.TDIV[LogicCore.TDIV.length - 1];
        this.s.back = 0; this.s.run = true;
        return true;
    }
}

LogicCore.TDIV = (() => { const a = []; for (let e = -6; e <= 1; e++) for (const m of [1, 2, 5]) a.push(m * Math.pow(10, e)); return a.map(x => Number(x.toPrecision(3))); })();

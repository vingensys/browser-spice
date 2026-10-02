// The oscilloscope's brain: a sample buffer, the trigger, the timebase and the vertical scaling.
// No DOM and no canvas, so it can be tested with plain numbers.
//
//   const scope = new ScopeCore(settings);        settings is edited in place by the UI
//   scope.push(t, { A: v, B: v });                one call per accepted simulation step
//   const cap = scope.capture();                  { status, t0, tdiv, trigT, ... }  (what the screen shows now)
//   scope.samples("A", 480)                       the displayed voltage of a channel at N points across the screen
//
// Screen: 10 horizontal divisions (time) by 8 vertical divisions (volts). The trigger point sits at
// 5 + hpos divisions from the left edge. Trigger modes follow a real scope: AUTO keeps drawing even without
// a trigger, NORMAL only redraws on a trigger, SINGLE catches one trigger then holds.

class ScopeCore {
    static TDIV = [];
    static VDIV = [];
    static CAPACITY = 150000;
    static CHANNELS = ["A", "B", "C", "D"];
    static COLORS = { A: "#ffd54a", B: "#4fc3f7", C: "#ff6e9a", D: "#7cf08a" };

    static defaults() {
        return {
            tdiv: 1e-3, hpos: 0,
            chan: {
                A: { on: true, vdiv: 1, pos: 0, coup: "DC" },
                B: { on: true, vdiv: 1, pos: 0, coup: "DC" },
                C: { on: false, vdiv: 1, pos: 0, coup: "DC" },
                D: { on: false, vdiv: 1, pos: 0, coup: "DC" }
            },
            trig: { src: "A", level: 0, slope: "rise", mode: "auto", autoLevel: true },
            xy: false, run: true
        };
    }

    // fill any missing fields of saved settings (older designs, partial edits)
    static merge(saved) {
        const base = ScopeCore.defaults(), s = saved && typeof saved === "object" ? saved : {};
        const out = Object.assign(ScopeCore.defaults(), s);
        out.chan = {};
        for (const c of ScopeCore.CHANNELS) out.chan[c] = Object.assign(base.chan[c], (s.chan || {})[c] || {});
        out.trig = Object.assign(base.trig, s.trig || {});
        if (s.trig && s.trig.level !== undefined && s.trig.autoLevel === undefined) out.trig.autoLevel = false;   // an explicit level wins
        return out;
    }

    constructor(settings) {
        this.s = settings || ScopeCore.merge();
        this.reset();
    }

    reset() {
        this.t = [];
        this.v = { A: [], B: [], C: [], D: [] };
        this.lastStored = -Infinity;
        this.last = null;            // the capture currently shown
        this.armedAt = null;         // time a SINGLE sweep was armed
        this.status = "STOP";
        this.live = false;           // a simulation is feeding it
    }

    get tNow() { return this.t.length ? this.t[this.t.length - 1] : 0; }

    // ---- acquisition -----------------------------------------------------------------------------------

    // Every accepted step is kept (the signal is only as detailed as the simulation's time step), but only the
    // last 30 screens' worth of time, and when the buffer gets big the oldest half is thinned.
    push(t, values) {
        this.live = true;
        if (this.t.length && t <= this.t[this.t.length - 1]) {            // same instant: just refresh the values
            const n = this.t.length - 1;
            for (const c of ScopeCore.CHANNELS) if (values[c] !== undefined) this.v[c][n] = values[c];
            return;
        }
        this.t.push(t);
        for (const c of ScopeCore.CHANNELS) this.v[c].push(values[c] === undefined ? NaN : values[c]);
        const horizon = t - 30 * this.s.tdiv - 1e-12;
        if (this.t[0] < horizon) {
            const k = PlotMath.lowerBound(this.t, horizon);
            if (k > 0) { this.t.splice(0, k); for (const c of ScopeCore.CHANNELS) this.v[c].splice(0, k); }
        }
        if (this.t.length > ScopeCore.CAPACITY) {
            const half = this.t.length >> 1, keep = (_, i) => i >= half || i % 2 === 0;
            this.t = this.t.filter(keep);
            for (const c of ScopeCore.CHANNELS) this.v[c] = this.v[c].filter(keep);
        }
    }

    // ---- trigger --------------------------------------------------------------------------------------------

    // the latest trigger event that has a full post-trigger sweep in the buffer (and, for SINGLE, is newer than arming)
    findTrigger() {
        const s = this.s, tr = s.trig;
        const ys = this.v[tr.src];
        if (!ys || !this.t.length) return null;
        const tdiv = s.tdiv, post = (10 - (5 + s.hpos)) * tdiv;
        const from = Math.max(this.t[0], this.tNow - 30 * tdiv), to = this.tNow - Math.max(post, 0);
        if (to <= from) return null;
        const hits = PlotMath.crossings(this.t, ys, tr.level, from, to, tr.slope === "fall" ? -1 : 1);
        for (let i = hits.length - 1; i >= 0; i--) {
            if (this.armedAt !== null && hits[i] <= this.armedAt) break;
            return hits[i];
        }
        return null;
    }

    // update what the screen shows; call once per frame
    capture() {
        const s = this.s, tdiv = s.tdiv;
        if (!this.t.length) { this.status = this.live ? "WAIT" : "STOP"; return this.last; }
        if (!s.run) { this.status = "STOP"; return this.last; }

        // auto level: keep the trigger level at the middle of the source signal, so a 0-5 V square wave triggers
        // without anyone setting a level
        if (s.trig.autoLevel && this.t.length > 3) {
            const st = PlotMath.stats(this.t, this.v[s.trig.src].map(v => (Number.isFinite(v) ? v : 0)), Math.max(this.t[0], this.tNow - 6 * tdiv), this.tNow);
            if (st && st.pkpk > 1e-9) s.trig.level = (st.max + st.min) / 2;
        }

        const trigT = this.findTrigger();
        const make = (trigged, tt) => ({ trigged, trigT: tt, tdiv, hpos: s.hpos, t0: trigged ? tt - (5 + s.hpos) * tdiv : this.tNow - 10 * tdiv });

        if (s.trig.mode === "single") {
            if (this.armedAt === null) this.armedAt = this.tNow;           // arm on the first look
            if (trigT !== null) {
                this.last = make(true, trigT);
                this.armedAt = null;
                s.run = false;                                             // caught it: hold
                this.status = "STOP";
            } else this.status = "WAIT";
            return this.last;
        }

        if (trigT !== null) { this.last = make(true, trigT); this.status = "TRIG'D"; }
        else if (s.trig.mode === "auto") { this.last = make(false, null); this.status = "AUTO"; }
        else this.status = this.last ? "WAIT" : "WAIT";                    // normal: keep the last sweep
        return this.last;
    }

    // arm a single sweep (also resumes from STOP)
    arm() {
        this.s.run = true;
        this.s.trig.mode = "single";
        this.armedAt = this.tNow;
        this.last = null;
        this.status = "WAIT";
    }

    // ---- what the screen draws ---------------------------------------------------------------------------------

    // voltage of one channel at n points across the captured window, with the channel's coupling applied; NaN where there is no data
    samples(chan, n, cap = this.last) {
        const out = new Array(n).fill(NaN);
        if (!cap) return out;
        const c = this.s.chan[chan], ys = this.v[chan];
        if (!c || !c.on || !ys.length) return out;
        const t1 = cap.t0 + 10 * cap.tdiv;
        let offset = 0;
        if (c.coup === "GND") return out.map((_, i) => 0);
        if (c.coup === "AC") {
            const st = PlotMath.stats(this.t, ys, Math.max(cap.t0, this.t[0]), Math.min(t1, this.tNow));
            offset = st ? st.mean : 0;
        }
        for (let i = 0; i < n; i++) {
            const t = cap.t0 + (i / (n - 1)) * 10 * cap.tdiv;
            if (t < this.t[0] || t > this.tNow) continue;
            out[i] = PlotMath.valueAt(this.t, ys, t) - offset;
        }
        return out;
    }

    // Vpp, Vrms, Vavg, frequency of a channel over the displayed window
    measure(chan, cap = this.last) {
        if (!cap) return null;
        const c = this.s.chan[chan];
        if (!c || !c.on || c.coup === "GND") return null;
        const n = 1000;
        const xs = Array.from({ length: n }, (_, i) => cap.t0 + (i / (n - 1)) * 10 * cap.tdiv);
        const ys = this.samples(chan, n, cap);
        const ok = ys.map((v, i) => (Number.isFinite(v) ? i : -1)).filter(i => i >= 0);
        if (ok.length < 4) return null;
        const X = ok.map(i => xs[i]), Y = ok.map(i => ys[i]);
        const st = PlotMath.stats(X, Y, X[0], X[X.length - 1]);
        const f = PlotMath.frequency(X, Y, X[0], X[X.length - 1]);
        return { vpp: st.pkpk, vrms: st.rms, vavg: st.mean, vmax: st.max, vmin: st.min, freq: f ? f.freq : null, period: f ? f.period : null };
    }

    // ---- automatic setup -----------------------------------------------------------------------------------------

    // pick a timebase, volts/div, positions and a trigger level so the signals fill the screen sensibly
    autoset() {
        const s = this.s;
        if (this.t.length < 4) return false;
        const lo = this.t[0], hi = this.tNow;
        let best = null;
        for (const c of ScopeCore.CHANNELS) {
            if (!s.chan[c].on) continue;
            const st = PlotMath.stats(this.t, this.v[c].map(v => (Number.isFinite(v) ? v : 0)), lo, hi);
            if (st && (!best || st.pkpk > best.st.pkpk)) best = { c, st };
        }
        if (!best) return false;
        const nice = (value, list) => list.find(v => v >= value) || list[list.length - 1];
        for (const c of ScopeCore.CHANNELS) {
            if (!s.chan[c].on) continue;
            const st = PlotMath.stats(this.t, this.v[c].map(v => (Number.isFinite(v) ? v : 0)), lo, hi);
            if (!st) continue;
            const swing = Math.max(st.pkpk, 1e-3);
            s.chan[c].coup = "DC";
            s.chan[c].vdiv = nice(swing / 6, ScopeCore.VDIV);
            s.chan[c].pos = Math.max(-3.5, Math.min(3.5, -Math.round(((st.max + st.min) / 2) / s.chan[c].vdiv)));
        }
        s.trig.src = best.c;
        s.trig.level = (best.st.max + best.st.min) / 2;
        s.trig.autoLevel = true;
        s.trig.slope = "rise";
        s.trig.mode = "auto";
        s.hpos = 0;
        const f = PlotMath.frequency(this.t, this.v[best.c], lo, hi);
        if (f) s.tdiv = nice((3 / f.freq) / 10, ScopeCore.TDIV);
        s.run = true;
        this.armedAt = null;
        this.last = null;
        return true;
    }
}

// 1-2-5 steps
ScopeCore.TDIV = (() => { const a = []; for (let e = -6; e <= 0; e++) for (const m of [1, 2, 5]) a.push(m * Math.pow(10, e)); a.push(10); return a.map(x => Number(x.toPrecision(3))); })();
ScopeCore.VDIV = (() => { const a = []; for (let e = -3; e <= 1; e++) for (const m of [1, 2, 5]) a.push(m * Math.pow(10, e)); a.push(100); return a.map(x => Number(x.toPrecision(3))); })();

// The rolling record behind the LIVE graph tab.
//
//   const b = new LiveBuffer(channels, window, points = 1500);
//   b.push(t, [v0, v1, ...]);       every accepted time step
//   b.times, b.values[k]            what to plot (kept in place: the same arrays every time)
//   b.setWindow(seconds)            how much history is kept
//
// The window is divided into `points` buckets. A bucket that saw several steps keeps two points per channel, its
// lowest and highest value in the order they happened (peak detect), so a signal much faster than a bucket still
// shows its true height instead of aliasing to whatever the steps happened to land on. The newest, still
// open bucket is shown too, as tentative rows that the next push replaces.

class LiveBuffer {
    constructor(channels, window, points = 1500) {
        this.n = channels;
        this.points = points;
        this.times = [];
        this.values = Array.from({ length: channels }, () => []);
        this.tent = 0;               // tentative rows at the end of the arrays (the open bucket)
        this.setWindow(window);
        this.cur = null;
        this.latest = 0;
    }

    setWindow(w) {
        this.window = w > 0 ? w : 1;
        this.width = this.window / this.points;
        this.closeBucket();
        this.trim();
    }

    dropTentative() {
        if (!this.tent) return;
        this.times.length -= this.tent;
        for (const v of this.values) v.length -= this.tent;
        this.tent = 0;
    }

    // the rows a bucket stands for: one when it saw one step, two (first and last time) otherwise
    rows(b) {
        if (b.count === 1) return [{ t: b.tFirst, v: b.first }];
        const r0 = { t: b.tFirst, v: new Array(this.n) }, r1 = { t: b.tLast, v: new Array(this.n) };
        for (let k = 0; k < this.n; k++) {
            const lowFirst = b.tMin[k] <= b.tMax[k];
            r0.v[k] = lowFirst ? b.min[k] : b.max[k];
            r1.v[k] = lowFirst ? b.max[k] : b.min[k];
        }
        return [r0, r1];
    }

    emit(b, tentative) {
        for (const r of this.rows(b)) {
            this.times.push(r.t);
            for (let k = 0; k < this.n; k++) this.values[k].push(r.v[k]);
            if (tentative) this.tent++;
        }
    }

    closeBucket() {
        if (!this.cur) return;
        this.dropTentative();
        this.emit(this.cur, false);
        this.cur = null;
    }

    push(t, vals) {
        this.latest = t;
        const idx = Math.floor(t / this.width);
        let b = this.cur;
        if (b && b.idx !== idx) { this.closeBucket(); b = null; }
        if (!b) {
            b = this.cur = { idx, count: 0, tFirst: t, tLast: t, first: vals.slice(), min: vals.slice(), max: vals.slice(), tMin: new Array(this.n).fill(t), tMax: new Array(this.n).fill(t) };
        }
        b.count++; b.tLast = t;
        for (let k = 0; k < this.n; k++) {
            const v = vals[k];
            if (v < b.min[k]) { b.min[k] = v; b.tMin[k] = t; }
            if (v > b.max[k]) { b.max[k] = v; b.tMax[k] = t; }
        }
    }

    // call after a batch of pushes: shows the open bucket and drops what fell out of the window
    settle() {
        this.dropTentative();
        this.trim();
        if (this.cur) this.emit(this.cur, true);
    }

    trim() {
        this.dropTentative();
        const cut = this.latest - this.window;
        let k = 0;
        while (k < this.times.length - 2 && this.times[k] < cut) k++;
        if (k > 0) { this.times.splice(0, k); for (const v of this.values) v.splice(0, k); }
    }
}

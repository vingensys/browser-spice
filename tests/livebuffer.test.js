// The LIVE graph's rolling buffer:  node tests/livebuffer.test.js
const fs = require("fs"), path = require("path");
const { LiveBuffer, FastRing } = new Function(fs.readFileSync(path.join(__dirname, "..", "js/visualization/live-buffer.js"), "utf8") + "\nreturn { LiveBuffer, FastRing };")();
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, info === undefined ? "" : JSON.stringify(info)); } };
const span = (a) => Math.max(...a) - Math.min(...a);

// a 10 kHz sine seen through a 1 s window: old behaviour (every 1/3000 s) saw a flat line
{
    const b = new LiveBuffer(2, 1);
    for (let t = 0; t < 1; t += 7e-6) { b.push(t, [Math.sin(2 * Math.PI * 1e4 * t), t]); if (Math.round(t / 7e-6) % 300 === 0) b.settle(); }
    b.settle();
    ok("a 10 kHz sine in a 1 s window keeps its height (2 V peak to peak)", Math.abs(span(b.values[0]) - 2) < 0.01, span(b.values[0]));
    ok("the buffer stays bounded (about 2 rows per bucket)", b.times.length <= 3100, b.times.length);
    ok("times are in order", b.times.every((t, i) => i === 0 || t >= b.times[i - 1]));
    ok("a slow ramp is reproduced exactly", b.times.every((t, i) => Math.abs(b.values[1][i] - t) < 1e-9));
}

// a slow sine (many buckets per cycle) is drawn as itself
{
    const b = new LiveBuffer(1, 1);
    for (let t = 0; t < 1; t += 1e-4) b.push(t, [Math.sin(2 * Math.PI * 2 * t)]);
    b.settle();
    let worst = 0;
    for (let i = 0; i < b.times.length; i++) worst = Math.max(worst, Math.abs(b.values[0][i] - Math.sin(2 * Math.PI * 2 * b.times[i])));
    ok("a slow sine's points lie within a bucket's slope of the true curve", worst < 0.02, worst);
}

// the order of low and high within a bucket follows time, per channel
{
    const b = new LiveBuffer(2, 1, 10);                         // 0.1 s buckets
    for (const [t, a, c] of [[0.01, 5, 1], [0.02, 1, 3], [0.03, 3, 9]]) b.push(t, [a, c]);   // channel 0 falls then rises; channel 1 rises
    b.settle();
    ok("a bucket becomes two rows, at its first and last time", b.times.join() === "0.01,0.03", b.times);
    ok("a channel whose high came first gets high, then low", b.values[0].join() === "5,1", b.values[0]);
    ok("a channel whose low came first gets low, then high", b.values[1].join() === "1,9", b.values[1]);
}

// tentative rows are replaced, not accumulated
{
    const b = new LiveBuffer(1, 1, 10);
    b.push(0.01, [1]); b.push(0.02, [2]); b.settle();
    ok("the open bucket shows as tentative rows", b.values[0].join() === "1,2" && b.tent === 2, b.values[0]);
    b.push(0.03, [3]); b.settle(); b.settle();
    ok("they are replaced on each settle", b.values[0].join() === "1,3" && b.times.join() === "0.01,0.03", [b.times, b.values[0]]);
    b.push(0.5, [9]); b.settle();
    ok("a closed bucket becomes permanent and the new one is tentative", b.times.join() === "0.01,0.03,0.5" && b.tent === 1, b.times);
}

// the window slides
{
    const b = new LiveBuffer(1, 0.1);
    for (let t = 0; t < 1; t += 1e-3) b.push(t, [t]);
    b.settle();
    ok("only the last window is kept", b.times[0] >= 0.9 - 0.01 && b.times[b.times.length - 1] > 0.99, [b.times[0], b.times[b.times.length - 1]]);
    b.setWindow(0.5);
    for (let t = 1; t < 1.2; t += 1e-3) b.push(t, [t]);
    b.settle();
    ok("widening the window keeps what was recorded and goes on from there", b.times[0] > 0.89 && b.times[b.times.length - 1] > 1.19, [b.times[0], b.times[b.times.length - 1]]);
}

// the full-rate ring
{
    const r = new FastRing(2, 1000);
    for (let i = 0; i < 2500; i++) r.push(i * 1e-3, [i, -i]);
    ok("the ring holds the newest cap samples", r.count === 1000);
    const all = r.snapshot();
    ok("a snapshot is chronological and unwrapped", all.xs.length === 1000 && all.xs.every((t, i) => i === 0 || t > all.xs[i - 1]) && all.ys[0][0] === 1500 && all.ys[1][999] === -2499, [all.ys[0][0], all.ys[1][999]]);
    const part = r.snapshot(2.0);
    ok("a snapshot can start at a time", part.xs[0] >= 2.0 && part.xs.length === 500 && part.ys[0][0] === 2000, [part.xs[0], part.xs.length]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

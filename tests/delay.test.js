// Propagation delay of the event-driven logic (flip-flops and logic ICs):  node tests/delay.test.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js"];
const { SimCircuit, SimEngine, VoltageSource, Waveform, FlipFlop, DigitalIC, LOGIC_ICS } =
    new Function(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + "\nreturn { SimCircuit, SimEngine, VoltageSource, Waveform, FlipFlop, DigitalIC, LOGIC_ICS };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

// first time after `from` that the node crosses `level` going the given way (linear interpolation)
const cross = (r, node, level, rising, from = 0) => {
    const v = r.nodeHistories[node], t = r.timePoints;
    for (let i = 1; i < t.length; i++) {
        if (t[i] <= from) continue;
        const a = v[i - 1] - level, b = v[i] - level;
        if (rising ? (a < 0 && b >= 0) : (a > 0 && b <= 0)) return t[i - 1] + (t[i] - t[i - 1]) * (-a / (b - a));
    }
    return NaN;
};
const ck = (delay, width) => ({ wave: Waveform.pulse({ v1: 0, v2: 5, delay, rise: 1e-9, fall: 1e-9, width, period: 1 }) });

// D flip-flop as a toggle: Q follows the rising clock edge after tpd
for (const tpd of [0, 100e-6, 300e-6]) {
    const c = new SimCircuit();
    c.add(new VoltageSource("VCK", ["ck", "0"], ck(0.5e-3, 0.4e-3)));
    c.add(new FlipFlop("U1", ["qn", "0", "ck", "q", "qn", "0", "0"], "D", { vcc: 5, tpd }));
    const r = new SimEngine(c).transient({ tStop: 1.5e-3, tStep: 20e-6 });
    const d = cross(r, "q", 2.5, true) - cross(r, "ck", 2.5, true);
    check(`flip-flop tpd ${tpd * 1e6} us: Q rises ${tpd * 1e6} us after the clock edge`, Math.abs(d - tpd) < 2e-6, `${(d * 1e6).toFixed(2)} us`);
    const dn = cross(r, "qn", 2.5, false) - cross(r, "ck", 2.5, true);
    check(`flip-flop tpd ${tpd * 1e6} us: QN falls with Q`, Math.abs(dn - tpd) < 2e-6, `${(dn * 1e6).toFixed(2)} us`);
}

// a counter chip (74161): QA follows the clock by tpd, and counting is unchanged
{
    const tpd = 50e-6, c = new SimCircuit();
    c.add(new VoltageSource("VCK", ["ck", "0"], { wave: Waveform.pulse({ v1: 0, v2: 5, delay: 0.5e-3, rise: 1e-9, fall: 1e-9, width: 0.4e-3, period: 1e-3 }) }));
    c.add(new VoltageSource("VH", ["hi", "0"], { wave: Waveform.dc(5) }));
    c.add(new DigitalIC("U1", ["0", "0", "0", "0", "ck", "hi", "hi", "hi", "hi", "qa", "qb", "qc", "qd", "rco"], LOGIC_ICS["74161"], { vcc: 5, tpd }));
    const r = new SimEngine(c).transient({ tStop: 4.2e-3, tStep: 20e-6 });
    const d = cross(r, "qa", 2.5, true) - cross(r, "ck", 2.5, true);
    check("74161 with tpd 50 us: QA rises 50 us after the clock", Math.abs(d - tpd) < 2e-6, `${(d * 1e6).toFixed(2)} us`);
    const qb = cross(r, "qb", 2.5, true) - cross(r, "ck", 2.5, true, 1.4e-3);
    check("74161 with tpd 50 us: QB rises 50 us after the second clock", Math.abs(qb - tpd) < 2e-6, `${(qb * 1e6).toFixed(2)} us`);
}

// a gate package: a long input pulse comes through delayed, a pulse shorter than tpd is swallowed
{
    const run = (width) => {
        const c = new SimCircuit();
        c.add(new VoltageSource("VIN", ["a", "0"], ck(1e-6, width)));
        c.add(new DigitalIC("U1", ["a", "0", "0", "0", "0", "0", "y", "o2", "o3", "o4", "o5", "o6"], LOGIC_ICS["7404"], { vcc: 5, tpd: 100e-9 }));
        return new SimEngine(c).transient({ tStop: 3e-6, tStep: 5e-9 });
    };
    const long = run(1e-6);
    const d = cross(long, "y", 2.5, false) - cross(long, "a", 2.5, true);
    check("7404 with tpd 100 ns: output falls 100 ns after a wide input pulse", Math.abs(d - 100e-9) < 5e-9, `${(d * 1e9).toFixed(1)} ns`);
    const short = run(40e-9);
    check("7404 with tpd 100 ns: a 40 ns pulse is swallowed", Math.min(...short.nodeHistories.y) > 4.9, `min y ${Math.min(...short.nodeHistories.y).toFixed(2)}`);
}

// a flip-flop glitch: reset released before the delay expires cancels the pending change
{
    const c = new SimCircuit();
    c.add(new VoltageSource("VCK", ["ck", "0"], ck(0.5e-3, 0.4e-3)));
    c.add(new VoltageSource("VH", ["hi", "0"], { wave: Waveform.dc(5) }));
    c.add(new FlipFlop("T1", ["hi", "0", "ck", "q", "qn", "0", "rst"], "T", { vcc: 5, tpd: 200e-6 }));
    c.add(new VoltageSource("VR", ["rst", "0"], { wave: Waveform.pwl([[0, 0], [0.55e-3, 0], [0.5501e-3, 5], [4e-3, 5]]) }));
    const r = new SimEngine(c).transient({ tStop: 1.5e-3, tStep: 20e-6 });
    check("a reset arriving before the delay ends cancels the pending Q rise", Math.max(...r.nodeHistories.q) < 0.5, `max q ${Math.max(...r.nodeHistories.q).toFixed(2)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

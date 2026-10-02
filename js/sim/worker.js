// Runs one analysis off the main thread so the page stays responsive and the run can be cancelled (by terminating
// this worker). The page sends the neutral element list; the worker builds the circuit, solves, and posts back plain
// data (complex numbers as [re, im]). See SimWorker in sim-worker.js for the page side.

const stamp = self.location.search || "";
for (const f of ["utils/complex.js", "utils/units.js", "sim/linalg.js", "sim/devices.js", "sim/logic-ics.js", "sim/expression.js", "sim/devices-extra.js",
    "sim/models.js", "sim/models-extra.js", "sim/models-parts.js", "sim/engine.js", "analysis/measure.js", "sim/spice-parser.js", "circuit/netlist.js"]) importScripts(`../${f}${stamp}`);

const pack = (z) => [z.re, z.im];

function run(job, progress) {
    const circuit = NetlistExtractor.instantiate(job.elements);
    const engine = new SimEngine(circuit, job.options);
    const a = job.args || {};
    if (job.kind === "op") {
        const op = engine.operatingPoint({ uic: !!a.uic, nodeIC: a.nodeIC || null });
        return { nodeVoltages: op.nodeVoltages, currents: op.currents, iterations: op.iterations, method: op.method };
    }
    if (job.kind === "tran") {
        const r = new TransientRun(engine, { tStop: a.tStop, tStep: a.tStep, uic: a.uic, method: "trap", nodeIC: a.nodeIC });
        let last = 0;
        while (!r.done) {
            r.step();
            const now = performance.now();
            if (now - last > 80) { last = now; progress(r.t / r.tStop); }
        }
        return r.result;
    }
    if (job.kind === "ac") {
        const res = engine.ac({ fStart: a.fStart, fStop: a.fStop, pointsPerDecade: a.pointsPerDecade || 20, progress });
        return res.map(r => ({
            frequency: r.frequency,
            nodeVoltages: Object.fromEntries(Object.entries(r.nodeVoltages).map(([k, z]) => [k, pack(z)])),
            sourceCurrents: Object.fromEntries(Object.entries(r.sourceCurrents).map(([k, z]) => [k, pack(z)]))
        }));
    }
    if (job.kind === "tf") return engine.tf({ out: a.out, input: a.input });
    if (job.kind === "noise") return engine.noise({ out: a.out, input: a.input, fStart: a.fStart, fStop: a.fStop, pointsPerDecade: a.pointsPerDecade || 10, progress });
    if (job.kind === "sweep") return engine.dcSweep(a.source, a.start, a.stop, a.step, progress);
    throw new Error(`unknown analysis ${job.kind}`);
}

self.onmessage = (e) => {
    const { id, job } = e.data;
    try {
        const result = run(job, (p) => self.postMessage({ id, progress: p }));
        self.postMessage({ id, result });
    } catch (err) {
        self.postMessage({ id, error: err && err.message ? err.message : String(err) });
    }
};

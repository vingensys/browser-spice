// Page side of the simulation worker: run an analysis off the main thread, with progress and cancel.
//
//   const res = await SimWorker.run(info.elements, "tran", { tStop, tStep, uic, nodeIC }, options, (p) => ...)
//   SimWorker.cancel();           the promise rejects with Error("Cancelled")
//
// Falls back to null (the caller then solves on the main thread) when workers are unavailable.

class SimWorker {
    static worker = null;
    static job = null;
    static nextId = 1;
    static failed = false;
    static stamp = Date.now();

    static available() { return typeof Worker !== "undefined" && !SimWorker.failed && typeof location !== "undefined" && /^https?:/.test(location.protocol); }

    static get busy() { return !!SimWorker.job; }

    static start() {
        if (SimWorker.worker) return SimWorker.worker;
        const w = new Worker(`js/sim/worker.js?b=${SimWorker.stamp}`);
        w.onmessage = (e) => {
            const job = SimWorker.job;
            if (!job || e.data.id !== job.id) return;
            if (e.data.progress !== undefined) { if (job.progress) job.progress(e.data.progress); return; }
            SimWorker.job = null;
            if (e.data.error !== undefined) job.reject(new Error(e.data.error)); else job.resolve(e.data.result);
        };
        w.onerror = (e) => {
            const job = SimWorker.job;
            SimWorker.job = null; SimWorker.worker = null;
            SimWorker.failed = true;                       // could not load: use the main thread from now on
            if (job) job.reject(Object.assign(new Error(e.message || "the simulation worker failed"), { workerFailed: true }));
        };
        SimWorker.worker = w;
        return w;
    }

    // plain-data copy of the neutral element list (no editor objects)
    static plain(elements) { return elements.map(e => ({ ...e, comp: undefined, def: e.def ? { ...e.def, _deck: undefined } : undefined })); }

    static run(elements, kind, args, options, progress) {
        if (SimWorker.job) return Promise.reject(new Error("A simulation is already running."));
        const worker = SimWorker.start();
        return new Promise((resolve, reject) => {
            const id = SimWorker.nextId++;
            SimWorker.job = { id, resolve, reject, progress };
            try { worker.postMessage({ id, job: { kind, elements: SimWorker.plain(elements), args, options } }); }
            catch (err) { SimWorker.job = null; reject(err); }
        });
    }

    static cancel() {
        const job = SimWorker.job;
        if (!job) return false;
        SimWorker.job = null;
        if (SimWorker.worker) { SimWorker.worker.terminate(); SimWorker.worker = null; }
        job.reject(new Error("Cancelled"));
        return true;
    }

    // results come back as plain data: rebuild complex numbers
    static unpackAc(rows) {
        const z = ([re, im]) => new Complex(re, im);
        return rows.map(r => ({
            frequency: r.frequency,
            nodeVoltages: Object.fromEntries(Object.entries(r.nodeVoltages).map(([k, v]) => [k, z(v)])),
            sourceCurrents: Object.fromEntries(Object.entries(r.sourceCurrents).map(([k, v]) => [k, z(v)]))
        }));
    }
}

// ngspice (WebAssembly) in a module worker, so a runaway or malformed deck can be cancelled by terminating the
// worker instead of freezing the page. See NgspiceBackend.run.
import { Simulation } from "../../vendor/ngspice/eecircuit-engine.mjs";

let sim = null;

self.onmessage = async (e) => {
    const { deck } = e.data;
    const log = [];
    const saved = { error: console.error, warn: console.warn, log: console.log };
    console.error = console.warn = console.log = (...a) => log.push(a.join(" "));
    try {
        if (!sim) { sim = new Simulation(); await sim.start(); }
        sim.setNetList(deck);
        const res = await sim.runSim();
        const errors = sim.getError ? sim.getError() : [];
        console.error = saved.error; console.warn = saved.warn; console.log = saved.log;
        self.postMessage({ res, log, errors });
    } catch (err) {
        console.error = saved.error; console.warn = saved.warn; console.log = saved.log;
        self.postMessage({ error: err && err.message ? err.message : String(err), log });
    }
};

// ngspice (WebAssembly) in a module worker, so a runaway or malformed deck can be cancelled by terminating the
// worker instead of freezing the page. See NgspiceBackend.run.
// the bundle is copied to vendor/ngspice by `npm install`; a copy of the app without it (the Pages site) loads it from a CDN
const SOURCES = ["../../vendor/ngspice/eecircuit-engine.mjs", "https://cdn.jsdelivr.net/npm/eecircuit-engine@1.8.0/dist/eecircuit-engine.mjs"];
let Simulation = null;
async function loadModule() {
    if (Simulation) return;
    let last;
    for (const src of SOURCES) { try { ({ Simulation } = await import(src)); return; } catch (e) { last = e; } }
    throw new Error(`The ngspice engine could not be loaded (${last && last.message})`);
}

let sim = null;

self.onmessage = async (e) => {
    const { deck } = e.data;
    const log = [];
    const saved = { error: console.error, warn: console.warn, log: console.log };
    console.error = console.warn = console.log = (...a) => log.push(a.join(" "));
    try {
        if (!sim) { await loadModule(); sim = new Simulation(); await sim.start(); }
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

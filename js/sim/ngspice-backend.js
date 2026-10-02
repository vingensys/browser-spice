// Optional "accurate" backend: runs the exported SPICE netlist through ngspice
// compiled to WebAssembly (the MIT-licensed `eecircuit-engine` package).
//
// The built-in engine stays the default because it is instant and interactive.
// ngspice adds the real thing: the same solver the industry uses, so vendor models
// and unusual devices behave exactly as they do in desktop SPICE.
//
// Install once with `npm install` (copies the bundle to vendor/ngspice/).

const NGSPICE_LOCAL = (typeof document !== "undefined" && document.currentScript)
    ? new URL("../../vendor/ngspice/eecircuit-engine.mjs", document.currentScript.src).href
    : null;

const NGSPICE_WORKER = (typeof document !== "undefined" && document.currentScript)
    ? new URL("ngspice-worker.js", document.currentScript.src).href
    : null;

class NgspiceBackend {
    static simulation = null;
    static loading = null;
    static worker = null;
    static job = null;
    static workerFailed = false;

    // in a browser page served over http(s): run ngspice in a module worker (cancellable)
    static workerAvailable() {
        return typeof Worker !== "undefined" && !!NGSPICE_WORKER && !NgspiceBackend.workerFailed && typeof location !== "undefined" && /^https?:/.test(location.protocol);
    }

    static workerRun(deck) {
        return new Promise((resolve, reject) => {
            if (NgspiceBackend.job) { reject(new Error("ngspice is already running.")); return; }
            let w = NgspiceBackend.worker;
            if (!w) {
                try { w = NgspiceBackend.worker = new Worker(`${NGSPICE_WORKER}?b=${Date.now()}`, { type: "module" }); }
                catch (e) { NgspiceBackend.workerFailed = true; reject(Object.assign(e, { workerFailed: true })); return; }
            }
            const job = NgspiceBackend.job = { resolve, reject };
            w.onmessage = (e) => {
                if (NgspiceBackend.job !== job) return;
                NgspiceBackend.job = null;
                if (e.data.error !== undefined) reject(new Error(e.data.error)); else resolve({ ...e.data.res, log: e.data.log, errors: e.data.errors });
            };
            w.onerror = (e) => {
                if (NgspiceBackend.job !== job) return;
                NgspiceBackend.job = null; NgspiceBackend.worker = null; NgspiceBackend.workerFailed = true;
                reject(Object.assign(new Error(e.message || "The ngspice worker could not start."), { workerFailed: true }));
            };
            w.postMessage({ deck });
        });
    }

    // stop a running ngspice job (terminates its worker; the next run starts a fresh one)
    static cancel() {
        const job = NgspiceBackend.job;
        if (!job) return false;
        NgspiceBackend.job = null;
        if (NgspiceBackend.worker) { NgspiceBackend.worker.terminate(); NgspiceBackend.worker = null; }
        job.reject(new Error("Cancelled"));
        return true;
    }

    static async load() {
        if (NgspiceBackend.simulation) return NgspiceBackend.simulation;
        if (!NgspiceBackend.loading) {
            NgspiceBackend.loading = (async () => {
                let mod;
                try {
                    try { mod = await import(NGSPICE_LOCAL); }
                    catch (e) { mod = await import("https://cdn.jsdelivr.net/npm/eecircuit-engine@1.8.0/dist/eecircuit-engine.mjs"); }
                } catch (e) {
                    throw new Error("The ngspice engine is not installed. Run `npm install` in the project folder " +
                        "(it copies the engine into vendor/ngspice/), then reload.");
                }
                const sim = new mod.Simulation();
                await sim.start();
                NgspiceBackend.simulation = sim;
                return sim;
            })();
            NgspiceBackend.loading.catch(() => { NgspiceBackend.loading = null; });
        }
        return NgspiceBackend.loading;
    }

    // Parts the exported deck cannot express (they would silently vanish from the run)
    static unsupported(info) {
        return (info.elements || []).filter(e => ["SCR", "TRIAC", "FF", "DIGITAL"].includes(e.kind)).map(e => e.name);
    }

    // ngspice writes its progress and convergence chatter to the console; capture it so it
    // can be shown (or ignored) deliberately instead of flooding the developer console.
    static async run(deck) {
        // ngspice (WebAssembly) cannot be interrupted: a malformed value such as "undefined" in a model
        // card makes it spin forever and freezes the page, so refuse such decks up front
        const bad = deck.match(/^.*\b(undefined|NaN|Infinity)\b.*$/m);
        if (bad) throw new Error(`The exported netlist has an invalid value, not sent to ngspice: ${bad[0].trim()}`);
        if (NgspiceBackend.workerAvailable()) {
            try {
                const res = await NgspiceBackend.workerRun(deck);
                if (!res || !res.data || !res.data.length) {
                    const fatal = (res.log || []).filter(l => /error|fatal|abort/i.test(l)).slice(0, 2).join("; ");
                    throw new Error("ngspice produced no data" + (((res.errors || []).length || fatal) ? `: ${((res.errors || []).slice(0, 2).join("; ") || fatal)}` : "."));
                }
                res.log = (res.log || []).filter(l => l.trim());
                return res;
            } catch (e) {
                if (!e.workerFailed) throw e;               // otherwise fall back to the main thread below
            }
        }
        const sim = await NgspiceBackend.load();
        const log = [];
        const saved = { error: console.error, warn: console.warn, log: console.log };
        const grab = (...a) => log.push(a.join(" "));
        console.error = console.warn = console.log = grab;
        let res, errors = [];
        try {
            sim.setNetList(deck);
            res = await sim.runSim();
            errors = sim.getError ? sim.getError() : [];
        } finally {
            console.error = saved.error; console.warn = saved.warn; console.log = saved.log;
        }
        if (!res || !res.data || !res.data.length) {
            const fatal = log.filter(l => /error|fatal|abort/i.test(l)).slice(0, 2).join("; ");
            throw new Error("ngspice produced no data" + ((errors.length || fatal) ? `: ${(errors.slice(0, 2).join("; ") || fatal)}` : "."));
        }
        res.log = log.filter(l => l.trim());
        return res;
    }

    // Lines worth telling the user about (real problems, not gmin-stepping progress notes)
    static problems(res) {
        return (res.log || []).filter(l => /error|fatal|abort|too many|no convergence|timestep too small/i.test(l));
    }

    // ---- result conversion (pure; unit-testable without a browser) ------------

    // v(n) -> node, i(name) / name#branch -> element, using the exported SPICE names
    static classify(name, info) {
        const spiceToName = new Map(info.elements.map(e => [NetlistExtractor.spiceName(e).toLowerCase(), e.name]));
        let m = name.match(/^v\((.+)\)$/i);
        if (m) return { type: "node", key: m[1].toLowerCase() };
        m = name.match(/^i\((.+)\)$/i) || name.match(/^(.+)#branch$/i);
        if (m) {
            const el = spiceToName.get(m[1].toLowerCase());
            return el ? { type: "current", key: el } : null;
        }
        return null;
    }

    // Resistor currents are not SPICE outputs, but follow from the node voltages
    static derivedCurrents(info, voltageAt) {
        const out = {};
        for (const e of info.elements) {
            if (e.kind === "R") out[e.name] = (i) => (voltageAt(e.nodes[0], i) - voltageAt(e.nodes[1], i)) / e.params.r;
        }
        return out;
    }

    static toOperatingPoint(res, info) {
        const nodeVoltages = { "0": 0 }, currents = {}, sourceCurrents = {};
        for (const d of res.data) {
            const c = NgspiceBackend.classify(d.name, info);
            if (!c) continue;
            const v = d.values[0];
            if (c.type === "node") nodeVoltages[c.key] = v;
            else { currents[c.key] = v; sourceCurrents[c.key] = v; }
        }
        const vAt = (n) => (n === "0" ? 0 : nodeVoltages[n] || 0);
        const derived = NgspiceBackend.derivedCurrents(info, (n) => vAt(n));
        for (const [name, fn] of Object.entries(derived)) currents[name] = fn(0);
        return { nodeVoltages, currents, sourceCurrents, method: "ngspice", iterations: null };
    }

    static toSweep(res, info) {
        const axis = res.data[0];
        const out = { sweep: axis.values.slice(), nodeHistories: {}, currentHistories: {} };
        for (const d of res.data.slice(1)) {
            const c = NgspiceBackend.classify(d.name, info);
            if (!c) continue;
            if (c.type === "node") out.nodeHistories[c.key] = d.values.slice();
            else out.currentHistories[c.key] = d.values.slice();
        }
        const derived = NgspiceBackend.derivedCurrents(info, (n, i) => (n === "0" ? 0 : (out.nodeHistories[n] || [])[i] || 0));
        for (const [name, fn] of Object.entries(derived)) out.currentHistories[name] = out.sweep.map((_, i) => fn(i));
        return out;
    }

    static toTransient(res, info) {
        const time = res.data.find(d => d.type === "time");
        const out = { timePoints: time.values.slice(), nodeHistories: {}, currentHistories: {}, steps: time.values.length - 1, rejected: 0 };
        for (const d of res.data) {
            const c = NgspiceBackend.classify(d.name, info);
            if (!c) continue;
            if (c.type === "node") out.nodeHistories[c.key] = d.values.slice();
            else out.currentHistories[c.key] = d.values.slice();
        }
        const derived = NgspiceBackend.derivedCurrents(info, (n, i) => (n === "0" ? 0 : (out.nodeHistories[n] || [])[i] || 0));
        for (const [name, fn] of Object.entries(derived)) out.currentHistories[name] = out.timePoints.map((_, i) => fn(i));
        return out;
    }

    static toAc(res, info) {
        const freq = res.data.find(d => d.type === "frequency");
        const rows = [];
        for (let i = 0; i < freq.values.length; i++) {
            const f = freq.values[i];
            const row = { frequency: typeof f === "object" ? f.real : f, nodeVoltages: { "0": new Complex(0, 0) }, sourceCurrents: {} };
            for (const d of res.data) {
                const c = NgspiceBackend.classify(d.name, info);
                if (!c) continue;
                const z = d.values[i];
                const cx = new Complex(z.real, z.img);
                if (c.type === "node") row.nodeVoltages[c.key] = cx;
                else row.sourceCurrents[c.key] = cx;
            }
            // resistor currents from the complex node voltages
            for (const e of info.elements) {
                if (e.kind !== "R") continue;
                const V = (n) => row.nodeVoltages[n] || new Complex(0, 0);
                row.sourceCurrents[e.name] = V(e.nodes[0]).sub(V(e.nodes[1])).mul(new Complex(1 / e.params.r, 0));
            }
            rows.push(row);
        }
        return rows;
    }
}

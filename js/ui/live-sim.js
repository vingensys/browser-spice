// Live ("animated") simulation, like pressing Play in ISIS: the engine runs a slice of
// simulation time every animation frame while probes, meters and the oscilloscope update.
//
//   Play    start / resume          Pause   freeze the clock
//   Step    one frame of progress   Stop    end the run and clear the displays
//
// Edits to the circuit restart the run; switch toggles and potentiometer settings are
// applied to the running engine without a restart.

// An instrument is identified by its component id on the first sheet, and by "sheetId:componentId" on any other sheet
// (component ids are only unique within a sheet).
const Instruments = {
    key(editor, comp) { return editor.sheetIndex === 0 ? comp.id : `${editor.activeSheet.id}:${comp.id}`; }
};

class LiveSim {
    constructor(editor, runner, graph) {
        this.editor = editor;
        this.runner = runner;
        this.graph = graph;
        this.state = "stopped";
        this.run = null;
        this.raf = 0;
        this.listeners = [];
        this.signature = "";
        this.lastSig = 0;
        this.lastDraw = 0;
        this.scopes = new Map();      // SCOPE component id -> { comp, nets, wired, core }
        this.logans = new Map();      // LOGAN component id -> { comp, nets, wired, core }
    }

    onState(fn) { this.listeners.push(fn); }
    emit() { this.listeners.forEach(fn => fn(this.state, this.run ? this.run.t : 0)); }

    // everything that changes the circuit's equations (switch / wiper settings excluded)
    circuitSignature() {
        const comps = this.editor.components.map(c => {
            const { closed, position, live, scopeTrace, scopeScale, logTrace, logan, glow, seg, energized, blown, on, scope, ...rest } = c;
            const part = PartLib.defs[c.type];
            for (const k of (part && part.tweak) || []) delete rest[k];   // knobs you can turn during a run
            if (part && part.tweak) delete rest.value;                     // its label shows the knob
            return rest;
        });
        return JSON.stringify([comps, this.editor.wires.map(w => [w.start, w.end]), this.editor.params]);
    }

    start() {
        if (this.state === "paused") { this.state = "running"; this.loop(); this.emit(); return; }
        if (this.state === "running") return;
        try {
            this.build();
        } catch (e) {
            console.error(e);
            this.runner.toast(e.message, "error");
            return;
        }
        this.state = "running";
        if (this.channels.length && this.graph && !this.graph.visible) this.graph.show("live");
        else if (this.channels.length && this.graph && this.graph.kind !== "live") this.graph.show("live");
        this.emit();
        this.loop();
    }

    build() {
        const ed = this.editor;
        // a sub-sheet that is open is simulated in place (as one use of it inside the whole design); a sheet no symbol uses
        // sends you to the first sheet
        let loc = null;
        if (ed.sheetIndex !== 0) { loc = Hierarchy.locate(ed, ed.activeSheet.id); if (!loc) this.runner.rootSheet(); }
        this.runner.rejectImpossible();
        const info = loc ? loc.info : NetlistExtractor.extract(ed);
        if (info.warnings.length) this.runner.toast(`Warning: ${info.warnings.slice(0, 3).join("; ")}`, "warn");

        const s = this.runner.settings();
        this.info = info;
        this.engine = new SimEngine(info.circuit, this.runner.engineOptions());
        this.run = this.engine.beginTransient({ tStep: s.tStep, uic: s.uic, nodeIC: info.nodeIC, nodeset: info.nodeset });
        this.span = s.tStop;
        this.speed = s.liveSpeed;          // simulated seconds per real second (0 = as fast as possible)
        this.target = 0;
        this.lastFrame = performance.now();
        this.signature = this.circuitSignature();

        // channels: probes first, then scope inputs
        this.channels = [];
        for (const prb of info.probes) {
            const orig = prb._orig || prb;
            if (prb.type === "V") this.channels.push({ name: prb.label, probe: orig, node: prb._node !== undefined ? prb._node : info.getPointNodeName(prb.x, prb.y) });
            else this.channels.push({ name: prb.label, probe: orig, element: prb._target || prb.targetName });
        }
        this.meters = info.instruments.filter(i => i.type === "VM" || i.type === "AM");
        this.clamps = info.instruments.filter(i => i.type === "CLAMP");
        for (const sc of info.instruments.filter(i => i.type === "SCOPE")) {
            sc.nets.forEach((net, k) => { if (sc.wired[k]) this.channels.push({ name: `${sc.comp.name}:${"ABCD"[k]}${sc.path ? "@" + sc.path.replace(/__/g, "/") : ""}`, node: net, scope: sc.comp, index: k }); });
        }
        this.times = [];
        this.values = this.channels.map(() => []);
        this.nextSample = 0;

        // oscilloscopes keep their own full-resolution buffers (and their settings live on the part)
        this.scopes = new Map();
        for (const sc of info.instruments.filter(i => i.type === "SCOPE")) {
            sc.comp.scope = ScopeCore.complete(sc.comp.scope);
            const core = new ScopeCore(sc.comp.scope);
            const { sources, meta } = this.scopeSources(sc.comp, sc.nets, sc.wired);
            core.meta = meta;
            this.scopes.set(sc.key !== undefined ? sc.key : sc.comp.id, { comp: sc.comp, nets: sc.nets, wired: sc.wired, core, sources });
        }
        if (this.editor.probeScope) this.attachProbeScope();
        this.buildConditions();
        this.logans = new Map();
        for (const la of info.instruments.filter(i => i.type === "LOGAN")) {
            la.comp.logan = LogicCore.merge(la.comp.logan);
            const core = new LogicCore(la.comp.logan);
            core.wired = la.wired;
            this.logans.set(la.key !== undefined ? la.key : la.comp.id, { comp: la.comp, nets: la.nets, wired: la.wired, core });
        }
        this.baseStep = s.tStep;
        this.feedScopes();
        this.applyScopeResolution();
        this.readout();
    }

    // Where each scope channel (A-H) gets its numbers: { node } = a net's voltage, { element } = a part's current.
    // A-D are the scope's pins (a pin on a clamp's output reads that clamp's part, in amps); a channel can also be
    // assigned a probe (comp.scope.chan[X].src = { probe: id }), which is how E-H are fed.
    scopeSources(comp, nets, wired) {
        const sources = new Array(8).fill(null), meta = {};
        const probeSource = (prb) => {
            const orig = prb._orig || prb;
            return prb.type === "V"
                ? { src: { node: prb._node !== undefined ? prb._node : this.info.getPointNodeName(prb.x, prb.y) }, meta: { unit: "V", label: orig.label } }
                : { src: { element: prb._target || prb.targetName }, meta: { unit: "A", label: orig.label } };
        };
        (nets || []).forEach((net, k) => {
            if (!wired[k] || k > 3) return;
            const clamp = (this.clamps || []).find(c => c.wired[0] && c.nets[0] === net && c.targetName);
            if (clamp) { sources[k] = { element: clamp.elementName || clamp.targetName }; meta["ABCD"[k]] = { unit: "A", label: `${clamp.comp.name} on ${clamp.targetName}` }; }
            else { sources[k] = { node: net }; meta["ABCD"[k]] = { unit: "V", label: "ABCD"[k] }; }
        });
        ScopeCore.CHANNELS.forEach((c, k) => {
            const a = comp.scope.chan[c].src;
            if (!a || a.probe === undefined) return;
            const prb = this.info.probes.find(p => (p._orig || p).id === a.probe && !p._sub);
            if (!prb) return;
            const r = probeSource(prb);
            sources[k] = r.src; meta[c] = r.meta;
        });
        return { sources, meta };
    }

    // The probe oscilloscope: a scope that is not a part on the sheet. Its channels are the probes, in order
    // (or whichever probe a channel was assigned). Created when the graph is popped out.
    attachProbeScope() {
        if (!this.run || !this.info) return null;
        const comp = this.editor.probeScopeComp();
        const probes = this.info.probes.filter(p => p.graph !== false && !p._sub);
        // keep the assignments that still point at a probe; give every other probe the first free channel
        const alive = new Set(probes.map(p => p.id));
        const used = new Set();
        for (const c of ScopeCore.CHANNELS) {
            const a = comp.scope.chan[c].src;
            if (a && alive.has(a.probe) && !used.has(a.probe)) used.add(a.probe); else delete comp.scope.chan[c].src;
        }
        for (const prb of probes) {
            if (used.has(prb.id)) continue;
            const c = ScopeCore.CHANNELS.find(k => !comp.scope.chan[k].src);
            if (!c) break;
            comp.scope.chan[c].src = { probe: prb.id };
            comp.scope.chan[c].on = true;
            used.add(prb.id);
        }
        const { sources, meta } = this.scopeSources(comp, [], []);
        const old = this.scopes.get("probes");
        const core = old ? old.core : new ScopeCore(comp.scope);
        core.s = comp.scope; core.meta = meta;
        const entry = { comp, nets: [], wired: [], core, sources, probeScope: true };
        this.scopes.set("probes", entry);
        return entry;
    }

    // Pause conditions (Debug > Pause Conditions): "pause when this probe goes above / below a value". A condition fires once,
    // when its test turns from false to true, so one that is already true at the start does not stop the run at once.
    buildConditions() {
        this.condSrc = [];
        for (const c of this.editor.pauseConditions || []) {
            if (c.on === false) continue;
            const prb = this.info.probes.find(p => !p._sub && p.id === c.probe);
            if (!prb) continue;
            const src = prb.type === "V" ? { node: prb._node !== undefined ? prb._node : this.info.getPointNodeName(prb.x, prb.y) } : { element: prb._target || prb.targetName };
            this.condSrc.push({ c, src, label: prb.label, unit: prb.type === "V" ? "V" : "A", was: false });
        }
    }

    // after a step: the text for the first condition that has just become true, else null
    checkConditions() {
        const run = this.run;
        for (const k of this.condSrc) {
            const v = k.src.node !== undefined ? run.voltage(k.src.node) : run.current(k.src.element);
            const now = k.c.op === "below" ? v < k.c.value : v > k.c.value;
            const fired = now && !k.was;
            k.was = now;
            if (fired) return `${k.label} went ${k.c.op === "below" ? "below" : "above"} ${Units.formatSI(k.c.value, k.unit)} (${Units.formatSI(v, k.unit)}) at t = ${Units.formatSI(run.t, "s")}`;
        }
        return null;
    }

    // The live value under the pointer: a pin or wire shows its net's voltage, a part shows its current (and the voltage
    // across it). Only on the first sheet, only while a run exists (running, paused or finished).
    tipAt(x, y) {
        if (!this.run || !this.info || this.state === "stopped" || this.editor.sheetIndex !== 0) return null;
        const ed = this.editor, run = this.run, nets = this.info.nets;
        const nm = (n) => (nets.displayName ? nets.displayName(n) : n);
        const V = (n) => Units.formatSI(run.voltage(n), "V");
        const pin = ed.findTerminal(x, y, 12);
        if (pin) {
            const n = nets.terminalNode(pin.component, pin.terminal.name);
            return n === null ? null : `${pin.component.name}.${pin.terminal.name}   net ${nm(n)}\n${V(n)}`;
        }
        const comp = ed.findComponent(x, y);
        if (comp && !["GND", "TEXT", "SCOPE", "LOGAN", "VM", "CLAMP", "NODEIC", "POWER", "NETLABEL", "PORT", "SHEET", "BUSTAP"].includes(comp.type)) {
            const term = ed.getTerminals(comp), cur = run.current(comp.name);
            const lines = [comp.name];
            if (Number.isFinite(cur) && cur !== 0) lines.push(`I = ${Units.formatSI(cur, "A")}`);
            if (term.length === 2) { const a = nets.terminalNode(comp, term[0].name), b = nets.terminalNode(comp, term[1].name); if (a !== null && b !== null) lines.push(`V = ${Units.formatSI(run.voltage(a) - run.voltage(b), "V")} across`); }
            return lines.length > 1 ? lines.join("\n") : null;
        }
        const hit = ed.findWireNearest(x, y, 8);
        if (hit) { const n = nets.wireNode(hit.wire); return n === null ? null : `net ${nm(n)}\n${V(n)}`; }
        return null;
    }

    // a channel's source was changed in the scope window
    refreshSources(key) {
        const e = this.scopes.get(key);
        if (!e || !this.info) return;
        if (e.probeScope) { this.attachProbeScope(); return; }
        const { sources, meta } = this.scopeSources(e.comp, e.nets, e.wired);
        e.sources = sources; e.core.meta = meta;
    }

    restart() {
        const was = this.state;
        this.cancel();
        this.state = "stopped";
        if (was !== "stopped") this.start();
    }

    pause() {
        if (this.state !== "running") return;
        this.state = "paused";
        this.cancel();
        this.emit();
    }

    stop() {
        this.cancel();
        this.state = "stopped";
        this.clearDisplays();
        this.run = null;
        this.emit();
    }

    step() {
        if (this.state === "stopped") {
            try { this.build(); } catch (e) { this.runner.toast(e.message, "error"); return; }
            this.state = "paused";
        }
        this.advance(30, true);
        this.readout();
        this.paint(true);
        this.emit();
        if (this.pauseReason) this.stopForCondition();
    }

    // a pause condition fired: hold the simulation there and say why
    stopForCondition() {
        const why = this.pauseReason;
        this.pauseReason = null;
        this.pause();
        this.paint(true);
        this.runner.toast(`Paused: ${why}. Open the scope or graph to look around, then press Play to continue.`, "info");
    }

    cancel() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

    loop() {
        this.cancel();
        const frame = (now) => {
            if (this.state !== "running") return;
            this.watchEdits(now);
            if (this.state !== "running") return;
            try {
                this.advance(11);
            } catch (e) {
                console.error(e);
                this.runner.toast(e.message, "error");
                this.pause();
                return;
            }
            this.readout();
            this.paint(false, now);
            this.emit();
            if (this.pauseReason) { this.stopForCondition(); return; }
            if (this.run.done) { this.pause(); return; }
            this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
    }

    // Advance by one frame's worth of simulated time (paced by the live-speed setting), never
    // spending more than `ms` of real time on it.
    advance(ms, force = false) {
        const run = this.run;
        const now = performance.now();
        const dtWall = Math.min(0.25, (now - this.lastFrame) / 1000);
        this.lastFrame = now;
        if (this.speed > 0) {
            this.target += force ? Math.max(this.speed * 0.02, 1e-6) : this.speed * dtWall;
            if (this.target - run.t > this.speed * 0.25) this.target = run.t + this.speed * 0.05; // cannot keep up: drop the backlog
        }

        const t0 = performance.now();
        const minGap = this.span / 3000; // keep the plot buffers bounded
        while (!run.done && performance.now() - t0 < ms && (this.speed <= 0 || run.t < this.target)) {
            run.step();
            if (this.scopes.size || this.logans.size) this.feedScopes();
            if (this.condSrc && this.condSrc.length) { const why = this.checkConditions(); if (why) this.pauseReason = why; }
            if (run.t >= this.nextSample) {
                this.times.push(run.t);
                this.channels.forEach((ch, i) => this.values[i].push(ch.node !== undefined ? run.voltage(ch.node) : run.current(ch.element)));
                this.nextSample = run.t + minGap;
            }
            if (this.pauseReason) break;
        }
        // keep only the visible time window
        const cut = run.t - this.span;
        let k = 0;
        while (k < this.times.length - 2 && this.times[k] < cut) k++;
        if (k > 0) { this.times.splice(0, k); this.values.forEach(v => v.splice(0, k)); }
    }

    // push live numbers into the schematic objects
    readout() {
        const run = this.run;
        if (!run) return;
        const fmt = (v, u) => `${v >= 0 ? "+" : ""}${Units.formatSI(v, u)}`;
        for (const ch of this.channels) {
            if (!ch.probe) continue;
            ch.probe.live = ch.node !== undefined ? Units.formatSI(run.voltage(ch.node), "V") : Units.formatSI(run.current(ch.element), "A");
        }
        if (this.editor.sheetIndex === 0) {
            for (const comp of this.editor.components) {
                const part = PartLib.defs[comp.type];
                if (part && part.live) part.live(comp, run);
            }
        }
        // parts on sub-sheets (their first use): the part sees the run as if its sheet were the whole circuit
        if (this.info && this.info.sheetPaths) for (const [sheetId, path] of this.info.sheetPaths) {
            const st = this.editor.sheetState(sheetId);
            if (!st || !st.components.some(c => PartLib.defs[c.type] && PartLib.defs[c.type].live)) continue;
            const prefix = `${path}__`;
            const view = { t: run.t, voltage: (n) => run.voltage(n), current: (name) => run.current(prefix + name), c: { elements: run.c.elements.filter(e => e.name.startsWith(prefix)).map(e => new Proxy(e, { get: (t, k) => (k === "name" ? t.name.slice(prefix.length) : t[k]) })) } };
            for (const comp of st.components) { const part = PartLib.defs[comp.type]; if (part && part.live) part.live(comp, view); }
        }
        if (window.opOverlay && window.opOverlay.on) window.opOverlay.fromRun(run);
        for (const cl of this.clamps || []) cl.comp.live = cl.targetName ? fmt(run.current(cl.elementName || cl.targetName), "A") : "—";
        for (const m of this.meters) {
            m.comp.live = m.type === "VM" ? fmt(run.voltage(m.nets[0]) - run.voltage(m.nets[1]), "V") : fmt(run.current(m.elementName || m.comp.name), "A");
        }
    }

    // Feed each oscilloscope symbol the recent samples of its channels (auto-scaled).
    // The scope symbol on the sheet shows the same triggered picture as the scope window (so it does not scroll)
    updateScopes() {
        for (const { comp, core } of this.scopes.values()) {
            const cap = core.capture();
            const trace = [[], [], [], []];
            ["A", "B", "C", "D"].forEach((c, i) => {
                const ch = comp.scope.chan[c];
                if (!cap || !ch.on) return;
                trace[i] = core.samples(c, 96, cap).map(v => (Number.isFinite(v) ? (v / ch.vdiv + ch.pos) / 4 : 0));
            });
            comp.scopeTrace = trace;
            comp.scopeScale = 1;          // the trace is already in screen units (+-1 = the screen edge)
        }
        for (const { comp, core } of this.logans.values()) {
            const cap = core.capture();
            comp.logTrace = cap ? [0, 1, 2, 3, 4, 5, 6, 7].map(c => { const out = []; for (let i = 0; i < 40; i++) { const l = core.level(c, cap.t0 + (i / 39) * 10 * cap.tdiv); out.push(l === null ? 0 : l); } return out; }) : null;
        }
    }

    // every accepted time point goes to each scope's sample buffer
    feedScopes() {
        const run = this.run;
        for (const e of this.scopes.values()) {
            const values = {};
            ScopeCore.CHANNELS.forEach((c, k) => {
                const s = e.sources[k];
                if (s) values[c] = s.node !== undefined ? run.voltage(s.node) : run.current(s.element);
            });
            e.core.push(run.t, values);
        }
        for (const e of this.logans.values()) {
            const values = {};
            e.nets.forEach((net, k) => { if (e.wired[k]) values[k] = run.voltage(net); });
            e.core.push(run.t, values);
        }
    }

    // an open scope with a fast timebase needs time steps small enough to draw the waveform
    applyScopeResolution() {
        if (!this.run) return;
        let want = this.baseStep || this.run.tStep;
        for (const [id, w] of ScopeWindow.windows) if (this.scopes.has(id)) want = Math.min(want, w.s.tdiv / 40);
        for (const [id, w] of LogicWindow.windows) if (this.logans.has(id)) want = Math.min(want, w.s.tdiv / 40);
        want = Math.max(want, (this.baseStep || want) * 1e-3);
        this.run.tStep = want;
        this.run.hNext = Math.min(this.run.hNext, want);
    }

    paint(force, now = performance.now()) {
        if (!force && now - this.lastDraw < 33) return;
        this.lastDraw = now;
        this.updateScopes();
        this.editor.draw();
        if (this.graph) this.graph.paintLive(this);
    }

    clearDisplays() {
        for (const prb of this.editor.probes) delete prb.live;
        for (const sh of this.editor.sheets) if (sh.data) for (const prb of sh.data.probes) delete prb.live;
        const stale = ["live", "scopeTrace", "scopeScale", "logTrace", "glow", "seg", "energized", "blown", "on"];
        for (const c of this.editor.components) for (const k of stale) delete c[k];
        for (const sh of this.editor.sheets) if (sh.data) for (const c of sh.data.components) for (const k of stale) delete c[k];
        this.editor.draw();
    }

    // restart on circuit edits (debounced); apply switch / pot changes in place
    watchEdits(now) {
        if (now - this.lastSig < 150) return;
        this.lastSig = now;
        const sig = this.circuitSignature();
        if (sig !== this.signature) { this.restart(); return; }
        this.syncControls();
    }

    syncControls() {
        for (const el of this.engine.c.elements) {
            if (el instanceof Switch) {
                const comp = this.editor.components.find(c => c.name === el.name);
                if (comp) el.closed = !!comp.closed;
            }
        }
        for (const comp of this.editor.components) {
            const part = PartLib.defs[comp.type];
            if (part && part.sync) part.sync(comp, this.engine.c.elements);
            if (part && part.resistance) {
                const el = this.engine.c.elements.find(e => e.name === comp.name);
                if (el) el.r = part.resistance(comp);
            }
            if (comp.type !== "POT") continue;
            const total = Units.parseSI(comp.value) || 10000;
            const pos = Math.min(1, Math.max(0, comp.position === undefined ? 0.5 : comp.position));
            for (const el of this.engine.c.elements) {
                if (el.name === `${comp.name}_A`) el.r = Math.max(total * pos, 1e-3);
                if (el.name === `${comp.name}_B`) el.r = Math.max(total * (1 - pos), 1e-3);
            }
        }
    }
}

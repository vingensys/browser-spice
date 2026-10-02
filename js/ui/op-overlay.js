// "Show operating point": node voltages on the wires and branch currents beside the parts, like the annotations
// ISIS and LTspice can put on the schematic. It solves the DC operating point after every edit (debounced) and,
// while a live simulation runs, follows the running values instead. The numbers are drawn by SchematicEditor
// (see NetView.drawOperatingPoint); this class only computes them.

class OpOverlay {
    constructor(editor, runner, live, doc) {
        this.editor = editor;
        this.runner = runner;
        this.live = live;
        this.on = false;
        editor.opData = null;
        doc.onChange(() => { if (this.on && this.live.state === "stopped") this.schedule(); });
        live.onState((state) => { if (this.on && state === "stopped") this.schedule(); });
    }

    toggle() { this.on ? this.disable() : this.enable(); return this.on; }

    enable() { this.on = true; this.refresh(); }

    disable() {
        this.on = false;
        this.editor.opData = null;
        this.editor.draw();
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), 150);
    }

    // solve the operating point now; a circuit that does not solve just shows nothing
    refresh() {
        if (!this.on) return;
        if (this.live.state !== "stopped" && this.live.run) { this.fromRun(this.live.run); return; }
        try {
            const info = NetlistExtractor.extract(this.editor);
            const op = new SimEngine(info.circuit, this.runner.engineOptions()).operatingPoint();
            this.editor.opData = this.build(info, op.nodeVoltages, op.currents);
        } catch (e) {
            this.editor.opData = { error: e.message };
        }
        this.editor.draw();
    }

    // while Play is running: the live engine's present values
    fromRun(run) {
        const info = this.live.info;
        if (!info) return;
        const volts = { "0": 0 };
        for (const name of run.c.names) if (!run.c.isInternal(name)) volts[name] = run.voltage(name);
        const cur = {};
        for (const el of info.elements) if (!el.name.includes(".")) cur[el.name] = run.current(el.name);
        this.editor.opData = this.build(info, volts, cur);
    }

    build(info, volts, currents) {
        const ed = this.editor;
        const nets = info.nets;              // the same net numbering the solver used (numbers are assigned on first use)
        // one label per net: on its longest wire segment
        const labels = new Map();
        for (const w of ed.wires) {
            if (!w.route || w.route.length < 2) continue;
            const id = nets.wireNode(w);
            if (id === null || id === "0" || volts[id] === undefined) continue;
            for (let i = 0; i < w.route.length - 1; i++) {
                const a = w.route[i], b = w.route[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
                const cur = labels.get(id);
                if (!cur || len > cur.len) labels.set(id, { id, len, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horizontal: Math.abs(b.y - a.y) < 1e-6, v: volts[id] });
            }
        }
        // currents: beside each part that has a branch current
        const parts = [];
        for (const el of info.elements) {
            if (!el.comp || el.name.includes("_") && el.comp.name !== el.name) continue;
            const i = currents[el.name];
            if (i === undefined || !Number.isFinite(i) || ["VM", "SCOPE", "LOGAN", "GND"].includes(el.comp.type)) continue;
            if (!parts.some(p => p.comp === el.comp)) parts.push({ comp: el.comp, i });
        }
        return { nodes: [...labels.values()], parts };
    }
}

// The design as a document: serialise / load it (shared by Save, Open and autosave), keep a copy in
// localStorage while you work, restore it after a reload or crash, and know whether there are changes
// that are not in a saved file (title bullet, "save before discarding?" prompts).

class DocumentStore {
    static KEY = "browser-spice/autosave/1";
    // fields that only exist while a simulation runs; they must never be saved or count as an edit
    static RUNTIME = ["live", "scopeTrace", "scopeScale", "glow", "seg", "energized", "blown", "on"];

    constructor(editor, runner) {
        this.editor = editor;
        this.runner = runner;
        this.name = null;            // file name of the last Open / Save
        this.savedSig = null;        // signature at the last Open / Save / New
        this.lastAutoSig = null;
        this.lastAutoAt = null;
        this.autosaveFailed = false;
        this.listeners = [];
    }

    onChange(fn) { this.listeners.push(fn); }
    emit() { this.listeners.forEach(fn => fn(this)); }

    // ---- serialise -----------------------------------------------------------------

    strip(obj) {
        const out = {};
        for (const [k, v] of Object.entries(obj)) if (!DocumentStore.RUNTIME.includes(k)) out[k] = v;
        return out;
    }

    serialize() {
        const ed = this.editor;
        return {
            format: "browser-spice/1",
            components: ed.components.map(c => this.strip(c)),
            wires: ed.wires.map(({ blocked, ...w }) => w),
            probes: ed.probes.map(p => this.strip(p)),
            titleBlock: ed.titleBlock,
            nextId: ed.nextId,
            view: { zoom: ed.zoom, panX: ed.panX, panY: ed.panY },
            settings: this.runner.settings()
        };
    }

    // what counts as an edit: the design and the run settings, not the view
    signature() {
        const s = this.serialize();
        return JSON.stringify([s.components, s.wires, s.probes, s.titleBlock, s.settings]);
    }

    isEmpty() { return !this.editor.components.length && !this.editor.wires.length && !this.editor.probes.length; }
    get dirty() { return this.savedSig !== this.signature(); }

    markSaved(name = this.name) {
        this.name = name;
        this.savedSig = this.signature();
        this.updateTitle();
        this.emit();
    }

    // ---- load ----------------------------------------------------------------------

    // Validate and load a design. Throws on something that is not a design; skips damaged parts and says so.
    apply(state, { undoable = true } = {}) {
        if (!state || typeof state !== "object" || !Array.isArray(state.components)) throw new Error("this is not a Browser SPICE design file");
        const notes = [];

        const comps = [];
        for (const c of state.components) {
            if (c && typeof c === "object" && SYMBOL_DEFS[c.type] && isFinite(c.x) && isFinite(c.y)) {
                comps.push(Object.assign({}, c, { rotation: Number(c.rotation) || 0 }));
            } else notes.push(`dropped an unknown part (${c && c.type})`);
        }
        const ids = new Set(comps.map(c => c.id));
        const wires = (Array.isArray(state.wires) ? state.wires : []).filter(w => {
            const ok = w && w.start && w.end &&
                (w.start.type !== "terminal" || ids.has(w.start.component)) && (w.end.type !== "terminal" || ids.has(w.end.component));
            if (!ok) notes.push("dropped a wire that referred to a missing part");
            return ok;
        });
        const probes = (Array.isArray(state.probes) ? state.probes : []).filter(p => p && isFinite(p.x) && isFinite(p.y));
        const maxId = Math.max(0, ...comps.map(c => c.id || 0), ...wires.map(w => w.id || 0), ...probes.map(p => p.id || 0));

        const ed = this.editor;
        if (undoable) ed.saveState();
        ed.components = comps;
        ed.wires = wires;
        ed.probes = probes;
        ed.nextId = Math.max(Number(state.nextId) || 1, maxId + 1);
        ed.titleBlock = Object.assign(SchematicEditor.defaultTitleBlock(), state.titleBlock && typeof state.titleBlock === "object" ? state.titleBlock : {});
        const v = state.view || { zoom: 1, panX: state.panX || 0, panY: state.panY || 0 };
        ed.zoom = v.zoom || 1; ed.panX = v.panX || 0; ed.panY = v.panY || 0;
        ed.clearSelection();
        ed.refreshWires();
        ed.draw();
        if (state.settings) this.applySettings(state.settings);
        return { parts: comps.length, notes };
    }

    applySettings(s) {
        const el = (id) => document.getElementById(id);
        const text = (id, v) => { if (el(id) && isFinite(v) && v !== undefined) el(id).value = Units.formatSI(v, "").replace(/\s/g, "").replace("µ", "u"); };
        text("simTstop", s.tStop); text("simTstep", s.tStep); text("simFstart", s.fStart); text("simFstop", s.fStop);
        text("sweepStart", s.sweepStart); text("sweepStop", s.sweepStop); text("sweepStep", s.sweepStep);
        if (el("simTemp") && isFinite(s.temp)) el("simTemp").value = s.temp;
        if (el("simUic") && typeof s.uic === "boolean") el("simUic").checked = s.uic;
        if (el("simEngine") && s.engine) el("simEngine").value = s.engine;
        if (el("liveSpeed") && s.liveSpeed !== undefined && [...el("liveSpeed").options].some(o => Number(o.value) === Number(s.liveSpeed))) el("liveSpeed").value = String(s.liveSpeed);
    }

    // ---- new / confirm -------------------------------------------------------------

    // Run `then` now, or after the user decides what to do with changes that are not in a saved file.
    confirmDiscard(then, save) {
        if (this.isEmpty() || !this.dirty) { then(); return; }
        Dialog.open({
            title: "Unsaved changes",
            content: `<div style="max-width:420px;line-height:1.5">The design${this.name ? ` “${PropertiesPanel.esc(this.name)}”` : ""} has changes that are not saved to a file.
                A copy is kept in this browser until you start something new.</div>`,
            buttons: [
                { label: "Save", primary: true, onClick: () => { save(); then(); } },
                { label: "Don't Save", onClick: () => { then(); } },
                { label: "Cancel" }
            ]
        });
    }

    // ---- autosave ------------------------------------------------------------------

    storage() { try { return window.localStorage; } catch (e) { return null; } }

    autosaveNow() {
        const ls = this.storage();
        const sig = this.signature();
        if (sig === this.lastAutoSig) return;
        try {
            if (!ls) throw new Error("no storage");
            if (this.isEmpty()) ls.removeItem(DocumentStore.KEY);
            else {
                ls.setItem(DocumentStore.KEY, JSON.stringify({ savedAt: Date.now(), name: this.name, savedSig: this.savedSig, state: this.serialize() }));
                this.lastAutoAt = Date.now();
            }
            this.lastAutoSig = sig;
            this.autosaveFailed = false;
        } catch (e) {
            if (!this.autosaveFailed) this.runner.toast("Autosave is not available (browser storage is blocked or full). Use Save Design to keep your work.", "warn");
            this.autosaveFailed = true;
        }
        this.updateTitle();
        this.emit();
    }

    discardAutosave() {
        const ls = this.storage();
        if (ls) { try { ls.removeItem(DocumentStore.KEY); } catch (e) { /* ignore */ } }
        this.lastAutoSig = null;
    }

    // Bring back the design from the last session. Never throws: a damaged copy is dropped.
    restore() {
        const ls = this.storage();
        if (!ls) return null;
        let rec = null;
        const raw = ls.getItem(DocumentStore.KEY);
        if (raw === null) return null;
        try { rec = JSON.parse(raw); } catch (e) { rec = null; }
        if (!rec || !rec.state) { this.discardAutosave(); return null; }
        try {
            const r = this.apply(rec.state, { undoable: false });
            if (!r.parts) { this.discardAutosave(); return null; }
            this.name = rec.name || null;
            this.savedSig = rec.savedSig === undefined ? null : rec.savedSig;
            this.lastAutoSig = this.signature();
            this.lastAutoAt = rec.savedAt;
            this.updateTitle();
            this.emit();
            return { parts: r.parts, savedAt: rec.savedAt, notes: r.notes };
        } catch (e) {
            console.error("autosave could not be restored", e);
            this.discardAutosave();
            return null;
        }
    }

    updateTitle() {
        const mark = this.dirty && !this.isEmpty() ? "• " : "";
        document.title = `${mark}${this.name || "Untitled"} - Browser SPICE`;
    }

    start() {
        this.timer = setInterval(() => this.autosaveNow(), 1500);
        const flush = () => this.autosaveNow();
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
        // the copy in this browser protects the work; only warn when that copy could not be made
        window.addEventListener("beforeunload", (e) => {
            this.autosaveNow();
            if (this.autosaveFailed && this.dirty && !this.isEmpty()) { e.preventDefault(); e.returnValue = ""; }
        });
        this.updateTitle();
    }
}

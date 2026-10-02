// Schematic editor core: view, selection, placement, wiring interaction, drawing.
// Pin/body tables live in js/cad/symbols.js, routing in js/cad/router.js and
// symbol artwork in js/cad/symbol-draw.js (mixed in at the bottom of this file).

const HOTKEYS = {
    c: "C", l: "L", v: "V", i: "I", g: "GND", d: "D", q: "BJT_NPN", m: "NMOS", u: "OPAMP",
    e: "E", s: "SW", w: "wire", b: "bus", a: "TEXT"
};

class SchematicEditor {

    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");

        this.gridSize = 20;

        this.components = [];
        this.wires = [];
        this.probes = [];
        this.titleBlock = SchematicEditor.defaultTitleBlock();
        this.measures = [];
        this.params = [];
        this.sheets = [{ id: 1, name: "Main", data: null, history: [], future: [] }];
        this.sheetIndex = 0;
        this.sheetStack = [];

        this.selection = [];
        this.selectedWire = null;
        this.selectedProbe = null;
        this.probeDrag = null;
        this.pasteMode = false;
        this.dragObject = false;

        this.tool = "select";
        this.placeRotation = 0;
        this.placeMirror = false;
        this.placeProps = null;   // properties copied onto each part placed from the device list

        // View
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.isSpacePressed = false;
        this.panStart = { x: 0, y: 0 };

        // Interaction state
        this.move = null;        // group move of components
        this.segDrag = null;     // wire segment drag
        this.box = null;         // rubber-band selection rectangle (world coords)
        this.pointerDownAt = null;

        this.clipboard = null;
        this.historyStack = [];
        this.futureStack = [];

        // Wiring state
        this.wiring = false;
        this.wireStart = null;
        this.wireAnchors = [];
        this.previewRoute = null;
        this.autoWire = false;
        this.hoverSnap = null;
        this.hoverTarget = null;

        this.mouse = { x: 0, y: 0 };
        this.mouseInside = false;
        this.nextId = 1;
        this.connectedPins = new Set();

        this.onChange = null;    // fired when selection / tool changes
        this.onDraw = null;      // fired after every redraw (overview map)
        this.onPointer = null;   // fired with world coordinates as the mouse moves
        this.onEdit = null;      // fired when a component is double-clicked
        this._notifyKey = "";

        this.resize();

        window.addEventListener("resize", () => this.resize());

        canvas.addEventListener("pointerdown", e => this.pointerDown(e));
        canvas.addEventListener("pointermove", e => this.pointerMove(e));
        canvas.addEventListener("pointerup", e => this.pointerUp(e));
        canvas.addEventListener("pointercancel", e => this.pointerUp(e));
        canvas.addEventListener("dblclick", e => this.doubleClick(e));

        canvas.addEventListener("pointerleave", () => {
            this.mouseInside = false;
            if (!this.wiring && !this.isDragging()) this.hoverSnap = null;
            this.draw();
        });
        canvas.addEventListener("pointerenter", () => { this.mouseInside = true; });

        canvas.addEventListener("wheel", e => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            if (e.shiftKey) {                       // Shift + wheel pans sideways, like most CAD tools
                this.panX -= (e.deltaY || e.deltaX);
                this.draw();
                return;
            }
            this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
        }, { passive: false });

        canvas.addEventListener("contextmenu", e => {
            e.preventDefault();
            if (this.pasteMode) { this.cancelPaste(); return; }
            if (this.dragObject) { this.cancelDragObject(); return; }
            if (this.wiring) {
                this.cancelWire();
                return;
            }
            if (this.isPlacing() || this.tool === "wire" || this.tool === "vProbe" || this.tool === "iProbe") {
                this.setTool("select");
                return;
            }

            const pos = this.getMousePosition(e);
            const probe = this.findProbe(pos.x, pos.y);
            const pinHit = probe ? null : this.findTerminal(pos.x, pos.y, 7);
            const comp = probe ? null : this.findComponent(pos.x, pos.y);
            let kind = "empty";
            if (pinHit) {
                this.clearSelection();
                this.contextPin = { comp: pinHit.component, pin: pinHit.terminal.name };
                kind = "pin";
            } else if (probe) {
                this.selectProbe(probe);
                kind = "probe";
            } else if (comp) {
                if (!this.isSelected(comp)) { this.selection = [comp]; }
                this.selectedWire = null; this.selectedProbe = null;
                kind = this.selection.length > 1 ? "multi" : "part";
            } else {
                const wireHit = this.findWire(pos.x, pos.y);
                if (wireHit) {
                    this.selectedWire = wireHit;
                    this.selection = []; this.selectedProbe = null;
                    kind = "wire";
                } else if (this.selection.length > 1) {
                    kind = "multi";
                }
            }
            this.contextPos = { x: pos.x, y: pos.y };
            this.draw();
            this.notify();

            if (typeof window.showContextMenu === "function") {
                window.showContextMenu(e, kind, this.contextPos);
            }
        });

        document.addEventListener("keydown", e => {
            if (e.code === "Space" && !this.isSpacePressed && !this.isTyping()) {
                this.isSpacePressed = true;
                this.canvas.style.cursor = "grab";
            }
            this.keyDown(e);
        });

        document.addEventListener("keyup", e => {
            if (e.code === "Space") {
                this.isSpacePressed = false;
                this.updateCursor();
            }
        });

        window.addEventListener("blur", () => { this.isSpacePressed = false; });

        this.draw();
    }

    isTyping() {
        const active = document.activeElement;
        return !!active && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA");
    }

    isDragging() {
        return !!(this.move || this.segDrag || this.box || this.isPanning);
    }


    // ============================================================
    // SELECTION
    // ============================================================

    get selected() {
        return this.selection.length === 1 ? this.selection[0] : null;
    }

    set selected(component) {
        this.selection = component ? [component] : [];
    }

    isSelected(component) {
        return this.selection.includes(component);
    }

    selectAll() {
        this.selection = [...this.components];
        this.selectedWire = null;
        this.selectedProbe = null;
        this.draw();
        this.notify();
    }

    clearSelection() {
        this.selection = [];
        this.selectedWire = null;
        this.selectedProbe = null;
    }

    notify() {
        const key = `${this.tool}|${this.selection.map(c => c.id).join(",")}|${this.selectedWire ? this.selectedWire.id : ""}|${this.selectedProbe ? this.selectedProbe.id : ""}|${this.wiring}|${this.pasteMode}|${this.dragObject}|${this.netHighlight ? this.netHighlight.id : ""}`;
        if (key === this._notifyKey) return;
        this._notifyKey = key;
        if (typeof this.onChange === "function") this.onChange();
    }


    // ============================================================
    // UNDO / REDO
    // ============================================================

    snapshot() {
        return JSON.stringify({
            components: this.components,
            wires: this.wires,
            probes: this.probes,
            titleBlock: this.titleBlock,
            measures: this.measures,
            params: this.params,
            nextId: this.nextId
        });
    }

    // Call BEFORE a change: records the state to return to on undo.
    saveState() {
        if (this.ercMarks) this.ercMarks = null;
        const snap = this.snapshot();
        if (this.historyStack.length > 0 && this.historyStack[this.historyStack.length - 1] === snap) return;

        this.historyStack.push(snap);
        if (this.historyStack.length > 100) this.historyStack.shift();
        this.futureStack = [];
    }

    restore(snapshot) {
        const state = JSON.parse(snapshot);
        this.components = state.components;
        this.wires = state.wires;
        this.probes = state.probes;
        this.titleBlock = Object.assign(SchematicEditor.defaultTitleBlock(), state.titleBlock || {});
        this.measures = Array.isArray(state.measures) ? state.measures : [];
        this.params = Array.isArray(state.params) ? state.params : [];
        this.nextId = state.nextId;

        this.clearSelection();
        this.cancelWire();
        this.refreshWires();
        this.draw();
        this.notify();
    }

    undo() {
        if (this.historyStack.length === 0) return;
        this.futureStack.push(this.snapshot());
        this.restore(this.historyStack.pop());
    }

    redo() {
        if (this.futureStack.length === 0) return;
        this.historyStack.push(this.snapshot());
        this.restore(this.futureStack.pop());
    }


    // ISIS "Drag Object": the selection follows the pointer until you click (Esc puts it back)
    beginDragObject() {
        if (!this.selection.length || !this.mouseInside) return;
        const first = this.selection[0];
        this.dragObject = true;
        this.move = {
            clicked: first,
            orig: new Map(this.selection.map(c => [c, { x: c.x, y: c.y }])),
            offX: this.mouse.x - first.x,
            offY: this.mouse.y - first.y,
            last: { dx: 0, dy: 0 },
            moved: false
        };
        this.updateCursor();
        this.draw();
        this.notify();
    }

    endDragObject() {
        if (this.move && this.move.moved) this.refreshWires();
        this.move = null;
        this.dragObject = false;
        this.updateCursor();
        this.draw();
        this.notify();
    }

    cancelDragObject() {
        const moved = this.move && this.move.moved;
        this.move = null;
        this.dragObject = false;
        if (moved) this.undo();
        this.updateCursor();
        this.draw();
        this.notify();
    }

    // ============================================================
    // COPY & PASTE (multi-selection, keeps wires between copied parts)
    // ============================================================

    copySelected() {
        if (!this.selection.length) return null;
        this.clipboard = this.clipboardFrom(this.selection);
        return this.selection;
    }

    // Snapshot of some parts, the wires between them (junction wires included) and the probes on them
    clipboardFrom(parts) {
        const ids = new Set(parts.map(c => c.id));
        const comps = parts.map(c => JSON.parse(JSON.stringify(c)));

        // a wire is copied when each end is a copied pin or a copied wire (found by repeated passes)
        const wireIds = new Set();
        const inside = (e) => (e.type === "terminal" && ids.has(e.component)) || (e.type === "wire" && wireIds.has(e.wireId));
        for (let pass = 0; pass < 6; pass++) {
            for (const w of this.wires) {
                if (!wireIds.has(w.id) && w.route && inside(w.start) && inside(w.end)) wireIds.add(w.id);
            }
        }
        const wires = this.wires.filter(w => wireIds.has(w.id))
            .map(w => JSON.parse(JSON.stringify({ id: w.id, start: w.start, end: w.end, route: w.route })));

        const probes = this.probes.filter(p => {
            if (p.type === "I") return ids.has(p.target);
            const a = p.anchor;
            return a && ((a.type === "terminal" && ids.has(a.component)) || (a.type === "wire" && wireIds.has(a.wire)));
        }).map(p => JSON.parse(JSON.stringify(p)));

        const xs = comps.map(c => c.x), ys = comps.map(c => c.y);
        return {
            comps, wires, probes,
            cx: (Math.min(...xs) + Math.max(...xs)) / 2,
            cy: (Math.min(...ys) + Math.max(...ys)) / 2
        };
    }

    cutSelected() {
        if (this.copySelected()) this.removeSelected();
    }

    // ISIS style: the copied block rides on the cursor until you click (Esc / right-click cancels)
    beginPaste(force = false) {
        if (!this.clipboard) return;
        if (!this.mouseInside && !force) { this.paste(); return; }
        this.setTool("select");
        this.pasteMode = true;
        this.draw();
        this.notify();
    }

    cancelPaste() {
        if (!this.pasteMode) return;
        this.pasteMode = false;
        this.draw();
        this.notify();
    }

    // where the block lands for a pointer position: snapped, and nudged to the nearest free spot
    pasteOffset(px, py) {
        const g = this.gridSize;
        const cb = this.clipboard;
        let dx = this.snap(px) - this.snap(cb.cx);
        let dy = this.snap(py) - this.snap(cb.cy);
        const fits = (ox, oy) => cb.comps.every(c => this.isPlacementFree(c, c.x + ox, c.y + oy, c.rotation));
        search:
        for (let r = 0; r <= 10; r++) {
            for (let i = -r; i <= r; i++) {
                for (let j = -r; j <= r; j++) {
                    if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
                    if (fits(dx + i * g, dy + j * g)) {
                        dx += i * g;
                        dy += j * g;
                        break search;
                    }
                }
            }
        }
        return { dx, dy, free: fits(dx, dy) };
    }

    paste(at = null) {
        if (!this.clipboard) return null;

        const g = this.gridSize;
        const cb = this.clipboard;
        const p = at || (this.mouseInside ? this.mouse : { x: cb.cx + 2 * g, y: cb.cy + 2 * g });
        const { dx, dy, free } = this.pasteOffset(p.x, p.y);
        if (at && !free) return null;      // a click where the block cannot go does nothing (the ghost shows red)
        this.pasteMode = false;


        this.saveState();

        const idMap = new Map();
        const created = [];
        for (const src of cb.comps) {
            const comp = Object.assign({}, src, {
                id: this.nextId++,
                name: src.type === "GND" ? "GND" : this.nextReference(src.type),
                x: src.x + dx,
                y: src.y + dy
            });
            idMap.set(src.id, comp.id);
            this.components.push(comp);
            created.push(comp);
        }

        // wires: allocate every new id first so junction wires can point at their copied neighbours
        const wireMap = new Map(cb.wires.map(w => [w.id, this.nextId++]));
        const end = (e) => {
            if (e.type === "terminal") return Object.assign({}, e, { component: idMap.get(e.component) });
            if (e.type === "wire") return Object.assign({}, e, { wireId: wireMap.get(e.wireId), x: e.x + dx, y: e.y + dy });
            return Object.assign({}, e);
        };
        for (const w of cb.wires) {
            this.wires.push({
                id: wireMap.get(w.id),
                start: end(w.start),
                end: end(w.end),
                route: w.route.map(p => ({ x: p.x + dx, y: p.y + dy }))
            });
        }

        for (const src of cb.probes || []) {
            const p = Object.assign({}, JSON.parse(JSON.stringify(src)), { id: this.nextId++, x: src.x + dx, y: src.y + dy });
            if (p.type === "I") {
                p.target = idMap.get(src.target);
                const owner = this.components.find(c => c.id === p.target);
                p.targetName = owner.name;
                p.label = `I(${owner.name})`;
            } else if (p.anchor && p.anchor.type === "terminal") p.anchor.component = idMap.get(p.anchor.component);
            else if (p.anchor && p.anchor.type === "wire") p.anchor.wire = wireMap.get(p.anchor.wire);
            this.probes.push(p);
        }

        this.selection = created;
        this.selectedWire = null;
        this.refreshWires();
        this.draw();
        this.notify();
        return created;
    }


    // ============================================================
    // VIEW: ZOOM & PAN
    // ============================================================

    snap(value) {
        return Math.round(value / this.gridSize) * this.gridSize;
    }

    getMousePosition(event) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        return {
            x: (sx - this.panX) / this.zoom,
            y: (sy - this.panY) / this.zoom,
            screenX: sx,
            screenY: sy
        };
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.width = rect.width;
        this.height = rect.height;

        this.draw();
    }

    zoomAt(screenX, screenY, factor) {
        const next = Math.min(3, Math.max(0.25, this.zoom * factor));
        const k = next / this.zoom;
        this.panX = screenX - (screenX - this.panX) * k;
        this.panY = screenY - (screenY - this.panY) * k;
        this.zoom = next;
        this.draw();
    }

    resetView() {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.draw();
    }

    fitView() {
        if (!this.components.length) {
            this.resetView();
            return;
        }
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const c of this.components) {
            const b = this.getComponentBox(c);
            x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1);
            x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2);
        }
        const pad = 60;
        const zoom = Math.min(2, Math.max(0.25, Math.min(
            this.width / (x2 - x1 + pad * 2),
            this.height / (y2 - y1 + pad * 2)
        )));
        this.zoom = zoom;
        this.panX = this.width / 2 - ((x1 + x2) / 2) * zoom;
        this.panY = this.height / 2 - ((y1 + y2) / 2) * zoom;
        this.draw();
    }

    updateCursor() {
        let cursor = "default";
        if (this.isPanning) cursor = "grabbing";
        else if (this.isSpacePressed) cursor = "grab";
        else if (this.pasteMode || this.dragObject) cursor = "move";
        else if (this.tool !== "select" || this.wiring) cursor = "crosshair";
        else if (this.hoverSnap && this.hoverSnap.type === "terminal") cursor = "crosshair";
        else if (this.hoverTarget === "component") cursor = "move";
        else if (this.hoverTarget === "wire") cursor = "pointer";
        this.canvas.style.cursor = cursor;
    }


    // ============================================================
    // TOOLS & PROBES
    // ============================================================

    isPlacing() {
        return !!SYMBOL_DEFS[this.tool];
    }

    setTool(tool, props = null) {
        this.pasteMode = false;
        this.cancelWire();
        this.busMode = tool === "bus";               // the Bus tool is the wire tool drawing a bus
        if (tool === "bus") tool = "wire";
        this.tool = tool;
        this.placeProps = props;
        this.placeRotation = 0;
        this.placeMirror = false;
        this.hoverSnap = null;
        this.hoverTarget = null;
        if (tool !== "select") this.selectedWire = null;
        this.updateCursor();
        this.draw();
        this.notify();
    }

    cancelWire() {
        this.endWiring();
        this.draw();
    }

    notice(message) { if (typeof this.onNotice === "function") this.onNotice(message); }

    // the wire closest to a point (within tolerancePx), not just the first one that is near enough
    findWireNearest(x, y, tolerancePx = 12) {
        const tol = tolerancePx / this.zoom;
        let best = null, bd = tol;
        for (const wire of this.wires) {
            if (!wire.route || wire.route.length < 2) continue;
            for (let j = 0; j < wire.route.length - 1; j++) {
                const a = wire.route[j], b = wire.route[j + 1];
                const d = this.distanceToSegment(x, y, a.x, a.y, b.x, b.y);
                if (d <= bd) { bd = d; best = { wire, type: "segment", index: j }; }
            }
        }
        return best;
    }

    // a wire or pin within easy reach (probes are small targets): pins first, then wires with a wider margin
    findProbeTarget(x, y) {
        const term = this.findTerminal(x, y, 18);
        if (term) return { x: term.x, y: term.y };
        const hit = this.findWireNearest(x, y, 12);
        if (hit) { const p = this.projectPointToWire(x, y, hit.wire); return { x: this.snap(p.x), y: this.snap(p.y) }; }
        return null;
    }

    // the part to measure the current of: the part clicked, or the nearer end of the wire clicked
    findCurrentProbeTarget(x, y) {
        const ok = (c) => c && c.type !== "GND" && !this.isOverlay(c) && !["VM", "AM", "SCOPE", "NODEIC", "POWER", "NETLABEL", "PORT"].includes(c.type);
        const direct = this.findComponent(x, y);
        if (ok(direct)) return direct;
        const hit = this.findWireNearest(x, y, 12);
        if (!hit) return null;
        const w = hit.wire, r = w.route;
        const ends = [[w.start, r[0]], [w.end, r[r.length - 1]]].filter(([e]) => e && e.type === "terminal");
        ends.sort((a, b) => Math.hypot(a[1].x - x, a[1].y - y) - Math.hypot(b[1].x - x, b[1].y - y));
        for (const [e] of ends) { const c = this.components.find(k => k.id === e.component); if (ok(c)) return c; }
        return null;
    }

    addVoltageProbe(x, y) {
        this.saveState();
        const snap = this.findSnapTarget(x, y);
        const count = this.probes.filter(p => p.type === 'V').length + 1;
        const probe = {
            id: this.nextId++,
            type: 'V',
            label: `V_PRB${count}`,
            x: snap.x,
            y: snap.y,
            anchor: this.anchorFor(snap)
        };
        this.probes.push(probe);
        this.draw();
        return probe;
    }

    addCurrentProbe(component) {
        this.saveState();
        const probe = {
            id: this.nextId++,
            type: 'I',
            target: component.id,
            targetName: component.name,
            label: `I(${component.name})`,
            x: component.x,
            y: component.y - 35
        };
        this.probes.push(probe);
        this.draw();
        return probe;
    }


    // ============================================================
    // COMPONENTS
    // ============================================================

    // Standard reference-designator prefixes (R1, C2, D1, Q1, U1, RV1 ...)
    static REF_PREFIX = {
        R: "R", C: "C", L: "L", V: "V", I: "I", E: "E", G: "G", D: "D", DZ: "D", LED: "D",
        BJT_NPN: "Q", BJT_PNP: "Q", NMOS: "Q", PMOS: "Q", OPAMP: "U", IC555: "U",
        AND: "U", OR: "U", NOT: "U", NAND: "U", NOR: "U", XOR: "U", XNOR: "U", BUF: "U",
        SW: "SW", POT: "RV", VM: "VM", AM: "AM", SCOPE: "OSC", LOGAN: "LA", NODEIC: "IC"
    };

    nextReference(type) {
        const prefix = SchematicEditor.REF_PREFIX[type] || type;
        const used = new Set(this.components.map(c => c.name));
        let n = 1;
        while (used.has(`${prefix}${n}`)) n++;
        return `${prefix}${n}`;
    }

    addComponent(type, x, y, rotation = 0) {
        const count = this.components.filter(c => c.type === type).length + 1;

        let defaultValue = "";
        if (type === "R") defaultValue = "4.7 kΩ";
        else if (type === "C") defaultValue = "10 µF";
        else if (type === "L") defaultValue = "10 mH";
        else if (type === "V") defaultValue = "5 V";
        else if (type === "I") defaultValue = "1 mA";
        else if (type === "E") defaultValue = "10";
        else if (type === "G") defaultValue = "10 mS";
        else if (type === "SW") defaultValue = "open";
        else if (type === "POT") defaultValue = "10 kΩ";
        else if (type === "NODEIC") defaultValue = "0 V";
        else if (type === "IC555") defaultValue = "NE555";

        // semiconductors start with their library default model
        let model;
        if (typeof SIM_DEFAULT_MODEL !== "undefined" && SIM_DEFAULT_MODEL[type]) {
            model = SIM_DEFAULT_MODEL[type];
            defaultValue = model;
        }

        const component = {
            id: this.nextId++,
            type,
            name: type === "GND" ? "GND" : this.nextReference(type),
            x: 0,
            y: 0,
            rotation,
            value: defaultValue,
            model,
            sourceType: (type === "V" || type === "I") ? "DC" : undefined,
            dcVoltage: type === "V" ? 5 : (type === "I" ? 0.001 : undefined),
            dcOffset: (type === "V" || type === "I") ? 0 : undefined,
            acMagnitude: type === "V" ? 5 : (type === "I" ? 0.001 : undefined),
            acPhase: (type === "V" || type === "I") ? 0 : undefined,
            frequency: (type === "V" || type === "I") ? 1000 : undefined,
            closed: type === "SW" ? false : undefined,
            position: type === "POT" ? 0.5 : undefined
        };

        const spot = this.findFreeSpot(component, x, y);
        component.x = spot.x;
        component.y = spot.y;
        const part = typeof PartLib !== "undefined" && PartLib.defs[type];
        if (part) {
            Object.assign(component, PartLib.defaults(type));
            if (!component.model && part.value) component.value = part.value;
        }

        this.components.push(component);
        this.refreshWires();
        this.draw();
        return component;
    }

    placeAt(x, y) {
        const gx = this.snap(x), gy = this.snap(y);
        const probe = { type: this.tool, x: gx, y: gy, rotation: this.placeRotation, mirror: this.placeMirror };
        if (!this.isPlacementFree(probe, gx, gy, this.placeRotation)) return null;

        this.saveState();
        const comp = this.addComponent(this.tool, gx, gy, this.placeRotation);
        if (this.placeMirror) comp.mirror = true;
        if (this.placeProps) Object.assign(comp, JSON.parse(JSON.stringify(this.placeProps)));
        if (comp.type === "BUSTAP" && this.placeProps) this.placeProps.index = (Number(this.placeProps.index) || 0) + 1;     // the next entry counts up
        if (comp.type === "TEXT") {            // one note at a time: place it, then type it
            this.setTool("select");
            this.selection = [comp];
            this.draw();
            this.notify();
            if (typeof this.onEdit === "function") this.onEdit(comp);
            return comp;
        }
        this.draw();
        return comp;
    }

    rotateSelected(steps = 1) {
        if (!this.selection.length) return;

        const deg = 90 * steps;
        const single = this.selection.length === 1;
        let px = 0, py = 0;
        if (!single) {
            const xs = this.selection.map(c => c.x), ys = this.selection.map(c => c.y);
            px = this.snap((Math.min(...xs) + Math.max(...xs)) / 2);
            py = this.snap((Math.min(...ys) + Math.max(...ys)) / 2);
        }

        const poses = this.selection.map(c => {
            const rot = (c.rotation + deg) % 360;
            if (single) return { c, x: c.x, y: c.y, rotation: rot };
            const o = this.rotateOffset(c.x - px, c.y - py, deg);
            return { c, x: px + o.x, y: py + o.y, rotation: rot };
        });

        const sel = new Set(this.selection);
        for (const p of poses) {
            if (!this.isPlacementFree(p.c, p.x, p.y, p.rotation, sel)) return;
        }

        this.saveState();
        for (const p of poses) {
            p.c.x = p.x;
            p.c.y = p.y;
            p.c.rotation = p.rotation;
        }
        this.refreshWires();
        this.draw();
    }

    // axis "x" mirrors left-right, "y" top-bottom. Each part flips about its own centre
    // (a group flips about the group's centre); top-bottom is mirror + 180 degrees.
    mirrorSelected(axis = "x") {
        if (!this.selection.length) {
            if (this.isPlacing()) {
                if (axis === "x") this.placeMirror = !this.placeMirror;
                else { this.placeMirror = !this.placeMirror; this.placeRotation = (this.placeRotation + 180) % 360; }
                this.draw();
            }
            return;
        }
        const movable = this.selection.filter(c => !this.isOverlay(c));    // text is not mirrored
        if (!movable.length) return;
        const xs = movable.map(c => c.x), ys = movable.map(c => c.y);
        const px = this.snap((Math.min(...xs) + Math.max(...xs)) / 2);
        const py = this.snap((Math.min(...ys) + Math.max(...ys)) / 2);
        const single = movable.length === 1;

        const poses = movable.map(c => {
            let x = c.x, y = c.y;
            if (!single) { if (axis === "x") x = 2 * px - c.x; else y = 2 * py - c.y; }
            const rotation = axis === "x" ? c.rotation : (c.rotation + 180) % 360;
            return { c, x, y, rotation, mirror: !c.mirror };
        });
        const sel = new Set(this.selection);
        for (const p of poses) {
            const probe = { type: p.c.type, mirror: p.mirror };
            if (!this.isPlacementFree(probe, p.x, p.y, p.rotation, sel)) return;
        }
        this.saveState();
        for (const p of poses) {
            p.c.x = p.x; p.c.y = p.y; p.c.rotation = p.rotation; p.c.mirror = p.mirror;
        }
        this.refreshWires();
        this.draw();
    }

    removeSelected() {
        if (this.selection.length) {
            this.saveState();
            const ids = new Set(this.selection.map(c => c.id));
            this.components = this.components.filter(c => !ids.has(c.id));

            this.wires = this.wires.filter(
                w =>
                    !(w.start.type === "terminal" && ids.has(w.start.component)) &&
                    !(w.end.type === "terminal" && ids.has(w.end.component))
            );
            this.probes = this.probes.filter(p => !(p.type === 'I' && ids.has(p.target)));

            this.selection = [];
            this.refreshWires();
            this.draw();
            this.notify();
            return;
        }

        if (this.selectedProbe) {
            this.removeProbe(this.selectedProbe);
            return;
        }

        if (this.selectedWire) {
            this.saveState();
            const gone = this.selectedWire;
            this.wires = this.wires.filter(w => w !== gone);
            this.selectedWire = null;
            this.refreshWires();
            this.draw();
            this.notify();
        }
    }


    // ============================================================
    // SYMBOL GEOMETRY: PINS, BODIES & COLLISION
    // ============================================================

    getSymbolDef(component) {
        const def = SYMBOL_DEFS[component.type] || SYMBOL_DEFS.R;
        return def.dynamic ? def.dynamic(component) : def;      // annotations size their box to their text
    }

    // annotations (text) sit on top of everything: they never block parts or wires
    isOverlay(component) {
        const def = SYMBOL_DEFS[component.type];
        return !!(def && def.overlay);
    }

    static defaultTitleBlock() {
        return { show: false, title: "", company: "", doc: "", rev: "", author: "", date: "", sheet: "1/1" };
    }

    // mirror flips the symbol left-right before it is rotated (Proteus "mirror X")
    rotateOffset(x, y, rotation, mirror = false) {
        if (mirror) x = -x;
        switch (((rotation % 360) + 360) % 360) {
            case 90: return { x: -y, y: x };
            case 180: return { x: -x, y: -y };
            case 270: return { x: y, y: -x };
            default: return { x, y };
        }
    }

    getTerminals(component) {
        return this.getSymbolDef(component).pins.map(([name, x, y, dx, dy]) => ({
            name, x, y, dir: { x: dx, y: dy }
        }));
    }

    getTerminalPosition(component, terminal) {
        const o = this.rotateOffset(terminal.x, terminal.y, component.rotation, component.mirror);
        return { x: component.x + o.x, y: component.y + o.y };
    }

    getTerminalDirection(component, terminal) {
        return this.rotateOffset(terminal.dir.x, terminal.dir.y, component.rotation, component.mirror);
    }

    // World-space body rectangle. Its interior is solid: wires may run along the
    // edge and leave through pins, but never pass through it.
    getComponentBox(component, pose = component) {
        const [bx1, by1, bx2, by2] = this.getSymbolDef(component).box;
        const corners = [[bx1, by1], [bx2, by1], [bx2, by2], [bx1, by2]]
            .map(([x, y]) => this.rotateOffset(x, y, pose.rotation, pose.mirror));
        return {
            x1: pose.x + Math.min(...corners.map(c => c.x)),
            x2: pose.x + Math.max(...corners.map(c => c.x)),
            y1: pose.y + Math.min(...corners.map(c => c.y)),
            y2: pose.y + Math.max(...corners.map(c => c.y))
        };
    }

    getComponentBoundingBox(component, clearance = 0) {
        const b = this.getComponentBox(component);
        return { x1: b.x1 - clearance, x2: b.x2 + clearance, y1: b.y1 - clearance, y2: b.y2 + clearance };
    }

    boxesOverlap(a, b) {
        return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    }

    // A part may not overlap another body, and no pin (or the one-grid exit stub in
    // front of it) may land on a foreign body. That keeps every pin escapable, so
    // wires can always leave and the router never gets boxed in.
    isPlacementFree(component, x, y, rotation, ignore = null) {
        if (this.isOverlay(component)) return true;
        const pose = { type: component.type, x, y, rotation, mirror: !!component.mirror };
        const box = this.getComponentBox(pose, pose);
        const g = this.gridSize;
        const inClosed = (px, py, b) => px >= b.x1 && px <= b.x2 && py >= b.y1 && py <= b.y2;

        const pinNodes = (c, p) => this.getTerminals(c).flatMap(t => {
            const o = this.rotateOffset(t.x, t.y, p.rotation, p.mirror);
            const d = this.rotateOffset(t.dir.x, t.dir.y, p.rotation, p.mirror);
            const px = p.x + o.x, py = p.y + o.y;
            return [{ x: px, y: py }, { x: px + d.x * g, y: py + d.y * g }];
        });
        const mine = pinNodes(pose, pose);

        for (const other of this.components) {
            if (other === component || (ignore && ignore.has(other)) || this.isOverlay(other)) continue;
            const ob = this.getComponentBox(other);
            if (this.boxesOverlap(box, ob)) return false;
            if (mine.some(n => inClosed(n.x, n.y, ob))) return false;
            if (pinNodes(other, other).some(n => inClosed(n.x, n.y, box))) return false;
        }
        return true;
    }

    // Nearest free grid position to (x, y) so parts never land on top of each other.
    findFreeSpot(component, x, y) {
        const g = this.gridSize;
        const px = this.snap(x);
        const py = this.snap(y);
        for (let r = 0; r <= 12; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    if (this.isPlacementFree(component, px + dx * g, py + dy * g, component.rotation)) {
                        return { x: px + dx * g, y: py + dy * g };
                    }
                }
            }
        }
        return { x: px, y: py };
    }

    findComponent(x, y) {
        for (const overlay of [false, true]) {
            for (let i = this.components.length - 1; i >= 0; i--) {
                if (this.isOverlay(this.components[i]) !== overlay) continue;
                const box = this.getComponentBoundingBox(this.components[i], 4);
                if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) {
                    return this.components[i];
                }
            }
        }
        return null;
    }

    findTerminal(x, y, tolerance = 16) {
        let best = null;
        let bestDist = tolerance / this.zoom;

        for (const component of this.components) {
            for (const terminal of this.getTerminals(component)) {
                const p = this.getTerminalPosition(component, terminal);
                const d = Math.hypot(x - p.x, y - p.y);
                if (d <= bestDist) {
                    bestDist = d;
                    best = { component, terminal, x: p.x, y: p.y };
                }
            }
        }
        return best;
    }

    getTerminalInfo(componentId, terminalName) {
        const component = this.components.find(c => c.id === componentId);
        if (!component) return null;

        const terminal = this.getTerminals(component).find(t => t.name === terminalName);
        if (!terminal) return null;

        return {
            component,
            terminal,
            position: this.getTerminalPosition(component, terminal),
            dir: this.getTerminalDirection(component, terminal)
        };
    }


    // ============================================================
    // SNAPPING & HIT TESTING
    // ============================================================

    findSnapTarget(x, y) {
        const term = this.findTerminal(x, y, 16);
        if (term) {
            return { type: "terminal", component: term.component, terminal: term.terminal, x: term.x, y: term.y };
        }

        const wireHit = this.findWireTarget(x, y);
        if (wireHit) {
            const p = this.projectPointToWire(x, y, wireHit.wire);
            return { type: "wire", wire: wireHit.wire, x: this.snap(p.x), y: this.snap(p.y) };
        }

        const gx = this.snap(x), gy = this.snap(y);
        return { type: "grid", x: gx, y: gy, blocked: this.pointInsideAnyBody(gx, gy) };
    }

    findWire(x, y) {
        const hit = this.findWireTarget(x, y);
        return hit ? hit.wire : null;
    }

    findWireTarget(x, y, tolerancePx = 7) {
        const tolerance = tolerancePx / this.zoom;

        for (let i = this.wires.length - 1; i >= 0; i--) {
            const wire = this.wires[i];
            if (!wire.route || wire.route.length < 2) continue;

            for (let j = 0; j < wire.route.length - 1; j++) {
                const a = wire.route[j];
                const b = wire.route[j + 1];
                if (this.distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= tolerance) {
                    return { wire, type: "segment", index: j };
                }
            }
        }
        return null;
    }


    // ============================================================
    // CLICK-TO-ANCHOR WIRING
    // Click a pin (or drag from it), move to preview the auto-route, click
    // empty grid to pin a corner, click a pin or wire to finish.
    // Double-click ends a wire in free space.
    // ============================================================

    startWire(snapTarget) {
        this.wiring = true;
        this.wireStart = snapTarget;
        this.wireAnchors = [];
        this.hoverSnap = snapTarget;
        this.clearSelection();
        this.updateWirePreview();
        this.updateCursor();
        this.draw();
    }

    addWireWaypoint(snapTarget) {
        if (snapTarget.blocked) return;
        const last = this.wireAnchors.length
            ? this.wireAnchors[this.wireAnchors.length - 1]
            : this.wireStart;
        if (last.x === snapTarget.x && last.y === snapTarget.y) return;

        this.wireAnchors.push({ x: snapTarget.x, y: snapTarget.y });
        this.updateWirePreview();
        this.draw();
    }

    removeLastAnchor() {
        if (!this.wiring) return false;
        if (this.wireAnchors.length) {
            this.wireAnchors.pop();
            this.updateWirePreview();
            this.draw();
        } else {
            this.cancelWire();
        }
        return true;
    }

    updateWirePreview() {
        if (!this.wiring || !this.wireStart || !this.hoverSnap) {
            this.previewRoute = null;
            return;
        }
        const temp = {
            start: this.formatWireEndpoint(this.wireStart),
            end: this.formatWireEndpoint(this.hoverSnap),
            anchors: this.wireAnchors.map(p => ({ x: p.x, y: p.y })),
            bus: !!this.busMode
        };
        this.previewRoute = this.calculateWireRoute(temp, this.buildRouteContext(null));
    }

    endWiring() {
        this.wiring = false;
        this.wireStart = null;
        this.wireAnchors = [];
        this.previewRoute = null;
        this.wireDragFrom = null;

        if (this.autoWire) {
            this.autoWire = false;
            if (this.tool === "wire") this.tool = "select";
        }
        this.updateCursor();
    }

    finishWire(snapTarget) {
        if (!this.wiring || !this.wireStart) return;

        const start = this.wireStart;
        const end = snapTarget;

        if (start.type === "terminal" && end.type === "terminal" &&
            start.component.id === end.component.id && start.terminal.name === end.terminal.name) {
            this.cancelWire();
            return;
        }

        if (!this.wireAnchors.length && start.x === end.x && start.y === end.y) {
            this.cancelWire();
            return;
        }

        this.saveState();

        const wire = {
            id: this.nextId++,
            start: this.formatWireEndpoint(start),
            end: this.formatWireEndpoint(end),
            anchors: this.wireAnchors.map(p => ({ x: p.x, y: p.y })),
            route: null
        };
        if (this.busMode) wire.bus = true;
        this.wires.push(wire);
        this.endWiring();

        wire.route = this.calculateWireRoute(wire, this.buildRouteContext(wire));
        delete wire.anchors;
        this.refreshWires();
        this.draw();
        this.notify();
    }

    doubleClick(event) {
        const pos = this.getMousePosition(event);

        if (this.wiring) {
            const last = this.wireAnchors.pop();
            if (!last) {
                this.cancelWire();
                return;
            }
            this.finishWire({ type: "grid", x: last.x, y: last.y });
            return;
        }

        if (this.tool === "select") {
            const probe = this.findProbe(pos.x, pos.y);
            if (probe) { if (typeof this.onEditProbe === "function") this.onEditProbe(probe); return; }
            const bw = this.findWire(pos.x, pos.y);
            if (bw && bw.bus && !this.findComponent(pos.x, pos.y) && typeof this.onEditBus === "function") { this.onEditBus(bw); return; }
        }

        if (this.tool === "select" && !this.findTerminal(pos.x, pos.y, 10)) {
            const comp = this.findComponent(pos.x, pos.y);
            if (comp && typeof this.onEdit === "function") this.onEdit(comp);
        }
    }

    formatWireEndpoint(snap) {
        if (snap.type === "terminal") {
            return { type: "terminal", component: snap.component.id, terminal: snap.terminal.name, x: snap.x, y: snap.y };
        }
        if (snap.type === "wire") {
            return { type: "wire", wireId: snap.wire.id, x: snap.x, y: snap.y };
        }
        return { type: "point", x: snap.x, y: snap.y };
    }


    // ============================================================
    // POINTER EVENTS
    // ============================================================

    pointerDown(event) {
        const pos = this.getMousePosition(event);
        this.mouse = pos;
        this.mouseInside = true;

        try { this.canvas.setPointerCapture(event.pointerId); } catch (e) { /* synthetic events */ }
        if (this.canvas !== document.activeElement) this.canvas.focus({ preventScroll: true });

        if (event.button === 1 || (event.button === 0 && this.isSpacePressed)) {
            this.isPanning = true;
            this.panStart = { x: event.clientX, y: event.clientY };
            this.updateCursor();
            return;
        }

        if (event.button !== 0) return;
        this.pointerDownAt = { x: pos.screenX, y: pos.screenY };

        if (this.pasteMode) {
            this.paste(pos);
            return;
        }

        if (this.dragObject) {          // the click drops the dragged object
            this.endDragObject();
            return;
        }

        // probes stay armed so several can be dropped in a row; right-click or Esc stops
        if (this.tool === "vProbe") {
            const snap = this.findProbeTarget(pos.x, pos.y);
            if (!snap) { this.notice("Click on a wire or a pin to attach a voltage probe."); return; }
            this.addVoltageProbe(snap.x, snap.y);
            return;
        }

        if (this.tool === "iProbe") {
            const component = this.findCurrentProbeTarget(pos.x, pos.y);
            if (!component) { this.notice("Click on a part (or the wire right next to it) to measure the current through it."); return; }
            if (this.probes.some(p => p.type === "I" && p.target === component.id)) { this.notice(`${component.name} already has a current probe.`); return; }
            this.addCurrentProbe(component);
            return;
        }

        if (this.tool === "wire" || this.wiring) {
            const snap = this.findSnapTarget(pos.x, pos.y);

            if (!this.wiring) {
                if (snap.type !== "grid" || !snap.blocked) this.startWire(snap);
            } else if (snap.type === "terminal" || snap.type === "wire") {
                this.finishWire(snap);
            } else {
                this.addWireWaypoint(snap);
            }
            this.notify();
            return;
        }

        if (this.isPlacing()) {
            this.placeAt(pos.x, pos.y);
            return;
        }

        // ----- select mode -----

        // probes are objects too: select / drag them (before pins, since they sit on pins)
        const probe = this.findProbe(pos.x, pos.y);
        if (probe) {
            this.selectProbe(probe);
            if (probe.type === "V") this.startProbeDrag(probe);
            this.draw();
            this.notify();
            return;
        }

        // Proteus-style: grabbing a pin starts a wire
        const pin = this.findTerminal(pos.x, pos.y, 10);
        if (pin) {
            this.tool = "wire";
            this.autoWire = true;
            this.wireDragFrom = { x: pos.screenX, y: pos.screenY };
            this.startWire({ type: "terminal", component: pin.component, terminal: pin.terminal, x: pin.x, y: pin.y });
            this.notify();
            return;
        }

        const component = this.findComponent(pos.x, pos.y);
        if (component) {
            if (event.shiftKey) {
                this.selection = this.isSelected(component)
                    ? this.selection.filter(c => c !== component)
                    : [...this.selection, component];
                this.selectedWire = null;
                this.draw();
                this.notify();
                return;
            }

            if (!this.isSelected(component)) this.selection = [component];
            this.selectedWire = null;
            this.selectedProbe = null;

            this.move = {
                clicked: component,
                orig: new Map(this.selection.map(c => [c, { x: c.x, y: c.y }])),
                offX: pos.x - component.x,
                offY: pos.y - component.y,
                last: { dx: 0, dy: 0 },
                moved: false
            };
            this.draw();
            this.notify();
            return;
        }

        const wireTarget = this.findWireTarget(pos.x, pos.y);
        if (wireTarget) {
            this.selectedWire = wireTarget.wire;
            this.selection = [];
            this.selectedProbe = null;
            this.segDrag = { wire: wireTarget.wire, idx: wireTarget.index, moved: false, begun: false };
            this.draw();
            this.notify();
            return;
        }

        // empty space: rubber-band selection
        if (!event.shiftKey) this.clearSelection();
        this.box = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, additive: event.shiftKey, base: [...this.selection] };
        this.draw();
        this.notify();
    }

    pointerMove(event) {
        if (this.isPanning) {
            this.panX += event.clientX - this.panStart.x;
            this.panY += event.clientY - this.panStart.y;
            this.panStart = { x: event.clientX, y: event.clientY };
            this.draw();
            return;
        }

        const pos = this.getMousePosition(event);
        this.mouse = pos;
        this.mouseInside = true;
        if (typeof this.onPointer === "function") this.onPointer(pos);

        if (this.box) {
            this.box.x2 = pos.x;
            this.box.y2 = pos.y;
            this.updateBoxSelection();
            this.draw();
            return;
        }

        if (this.probeDrag) {
            this.doProbeDrag(pos);
            return;
        }

        if (this.move) {
            this.doMove(pos);
            return;
        }

        if (this.segDrag) {
            this.doSegmentDrag(pos);
            return;
        }

        if (this.tool === "wire" || this.wiring) {
            const snap = this.findSnapTarget(pos.x, pos.y);
            const h = this.hoverSnap;
            const changed = !h || snap.x !== h.x || snap.y !== h.y || snap.type !== h.type;
            this.hoverSnap = snap;
            if (changed) this.updateWirePreview();
            this.draw();
            return;
        }

        if (this.isPlacing() || this.pasteMode) {
            this.draw();
            return;
        }

        // hover feedback in select mode
        const pin = this.findTerminal(pos.x, pos.y, 10);
        let target = null;
        if (!pin) {
            if (this.findComponent(pos.x, pos.y)) target = "component";
            else if (this.findWireTarget(pos.x, pos.y)) target = "wire";
        }
        const hover = pin ? { type: "terminal", x: pin.x, y: pin.y } : null;
        const hoverChanged = hover
            ? !this.hoverSnap || this.hoverSnap.x !== hover.x || this.hoverSnap.y !== hover.y
            : !!this.hoverSnap;
        if (hoverChanged || target !== this.hoverTarget) {
            this.hoverSnap = hover;
            this.hoverTarget = target;
            this.updateCursor();
            this.draw();
        }
    }

    pointerUp(event) {
        if (this.isPanning) {
            this.isPanning = false;
            this.updateCursor();
            return;
        }

        // drag from a pin and release on a target finishes the wire
        if (this.wiring && this.autoWire && this.wireDragFrom && event && event.type === "pointerup") {
            const pos = this.getMousePosition(event);
            const moved = Math.hypot(pos.screenX - this.wireDragFrom.x, pos.screenY - this.wireDragFrom.y);
            this.wireDragFrom = null;
            if (moved > 8) {
                const snap = this.findSnapTarget(pos.x, pos.y);
                if (snap.type === "terminal" || snap.type === "wire") this.finishWire(snap);
            }
        }

        this.box = null;
        if (this.probeDrag) this.endProbeDrag();

        if (this.move && !this.dragObject) {
            if (this.move.moved) this.refreshWires();
            this.move = null;
        }

        if (this.segDrag) {
            const { wire, moved } = this.segDrag;
            this.segDrag = null;
            if (moved) {
                wire.route = this.simplifyRoute(wire.route);
                this.refreshWires();
            }
        }

        this.draw();
        this.notify();
    }

    updateBoxSelection() {
        const b = this.box;
        const rect = {
            x1: Math.min(b.x1, b.x2), x2: Math.max(b.x1, b.x2),
            y1: Math.min(b.y1, b.y2), y2: Math.max(b.y1, b.y2)
        };
        const hit = this.components.filter(c => this.boxesOverlap(rect, this.getComponentBox(c)));
        this.selection = b.additive ? [...new Set([...b.base, ...hit])] : hit;
    }

    doMove(pos) {
        const m = this.move;
        const base = m.orig.get(m.clicked);
        const dx = this.snap(pos.x - m.offX) - base.x;
        const dy = this.snap(pos.y - m.offY) - base.y;

        if (dx === m.last.dx && dy === m.last.dy) return;

        const moving = new Set(m.orig.keys());
        for (const [c, o] of m.orig) {
            if (!this.isPlacementFree(c, o.x + dx, o.y + dy, c.rotation, moving)) return;
        }

        if (!m.moved) {
            m.moved = true;
            // record the pre-move state (positions are still the originals)
            this.saveState();
        }

        const stepX = dx - m.last.dx;
        const stepY = dy - m.last.dy;
        m.last = { dx, dy };

        for (const [c, o] of m.orig) {
            c.x = o.x + dx;
            c.y = o.y + dy;
        }

        // wires with both ends on moving parts translate rigidly; the rest rubber-band
        const ids = new Set([...moving].map(c => c.id));
        const rigid = new Set();
        for (let pass = 0; pass < 3; pass++) {
            for (const w of this.wires) {
                const endIn = (e) => (e.type === "terminal" && ids.has(e.component)) ||
                    (e.type === "wire" && [...rigid].some(r => r.id === e.wireId));
                if (endIn(w.start) && endIn(w.end)) rigid.add(w);
            }
        }
        for (const w of rigid) this.translateWire(w, stepX, stepY);

        this.refreshWires(new Set(this.wires.filter(w => !rigid.has(w))));

        for (const prb of this.probes) {
            if (prb.type === 'I' && ids.has(prb.target)) {
                const c = this.components.find(k => k.id === prb.target);
                prb.x = c.x;
                prb.y = c.y - 35;
            }
        }
        this.draw();
    }

    doSegmentDrag(pos) {
        const d = this.segDrag;
        const wire = d.wire;
        if (!wire.route || wire.route.length < 2) return;

        if (!d.begun) {
            // only start once the pointer has actually travelled
            if (Math.hypot(pos.screenX - this.pointerDownAt.x, pos.screenY - this.pointerDownAt.y) < 4) return;
            const idx = this.beginSegmentDragSafe(wire, d.idx);
            if (idx < 0) { this.segDrag = null; return; }
            d.idx = idx;
            d.begun = true;
        }

        const route = wire.route;
        const p1 = route[d.idx];
        const p2 = route[d.idx + 1];
        const horizontal = p1.y === p2.y;

        const value = this.clampSegmentDrag(wire, d.idx, horizontal, this.snap(horizontal ? pos.y : pos.x));
        if ((horizontal ? p1.y : p1.x) === value) return;

        const prev = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
        if (horizontal) { p1.y = value; p2.y = value; } else { p1.x = value; p2.x = value; }

        // reject moves that would push the wire through a component
        const ctx = this.buildRouteContext(wire);
        const allow = new Set([`${route[0].x},${route[0].y}`, `${route[route.length - 1].x},${route[route.length - 1].y}`]);
        let ok = true;
        for (let i = Math.max(0, d.idx - 1); i <= Math.min(route.length - 2, d.idx + 1); i++) {
            if (!this.segmentFree(route[i], route[i + 1], ctx, allow)) { ok = false; break; }
        }
        if (!ok) {
            p1.x = prev.x1; p1.y = prev.y1; p2.x = prev.x2; p2.y = prev.y2;
            return;
        }
        d.moved = true;
        this.draw();
    }

    // Snapshot first so the drag is undoable, then normalise the route.
    beginSegmentDragSafe(wire, idx) {
        const before = this.snapshot();
        const newIdx = this.beginSegmentDrag(wire, idx);
        if (newIdx >= 0 && this.historyStack[this.historyStack.length - 1] !== before) {
            this.historyStack.push(before);
            this.futureStack = [];
        }
        return newIdx;
    }


    // ============================================================
    // KEYBOARD
    // ============================================================

    keyDown(event) {
        if (this.isTyping()) return;

        const key = (event.key || "").toLowerCase();
        const isCtrl = event.ctrlKey || event.metaKey;

        if (isCtrl) {
            if (key === "c") { event.preventDefault(); this.copySelected(); }
            else if (key === "x") { event.preventDefault(); this.cutSelected(); }
            else if (key === "v") { event.preventDefault(); this.beginPaste(); }
            else if (key === "a") { event.preventDefault(); this.selectAll(); }
            else if (key === "z") { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
            else if (key === "y") { event.preventDefault(); this.redo(); }
            else if (key === "0") { event.preventDefault(); this.resetView(); }
            return;
        }

        if (key === "escape") {
            if (this.pasteMode) this.cancelPaste();
            else if (this.dragObject) this.cancelDragObject();
            else if (this.wiring) this.cancelWire();
            else if (this.netHighlight || this.ercMarks) { this.netHighlight = null; this.ercMarks = null; this.draw(); }
            else if (this.tool !== "select") this.setTool("select");
            else { this.clearSelection(); this.draw(); }
            this.notify();
            return;
        }

        if (key === "backspace" && this.wiring) {
            event.preventDefault();
            this.removeLastAnchor();
            return;
        }

        if (key === "delete" || key === "backspace") {
            this.removeSelected();
            return;
        }

        if (key === "r") {
            event.preventDefault();
            if (this.isPlacing()) {
                this.placeRotation = (this.placeRotation + 90) % 360;
                this.draw();
            } else if (this.selection.length) {
                this.rotateSelected();
            } else {
                this.setTool("R");
            }
            return;
        }

        if ((key === "x" || key === "y") && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            this.mirrorSelected(key);
            return;
        }

        if (key === "h" && !isCtrl) {
            event.preventDefault();
            this.toggleHighlightAt(this.mouseInside ? this.mouse.x : undefined, this.mouseInside ? this.mouse.y : undefined);
            return;
        }

        if (key === "f" || key === "home") {
            this.fitView();
            return;
        }

        if (key === "t") {
            if (!this.wires.length) return;
            this.saveState();
            if (this.selectedWire) this.tidyWire(this.selectedWire);
            else this.tidyAllWires();
            this.draw();
            return;
        }

        // ISIS zoom keys
        if (key === "f6") { event.preventDefault(); this.zoomAt(this.width / 2, this.height / 2, 1.2); return; }
        if (key === "f7") { event.preventDefault(); this.zoomAt(this.width / 2, this.height / 2, 1 / 1.2); return; }
        if (key === "f8") { event.preventDefault(); this.fitView(); return; }

        if (key === "+" || key === "=") { this.zoomAt(this.width / 2, this.height / 2, 1.2); return; }
        if (key === "-") { this.zoomAt(this.width / 2, this.height / 2, 1 / 1.2); return; }

        if (HOTKEYS[key]) {
            this.setTool(HOTKEYS[key]);
        }
    }


    // ============================================================
    // RENDERING
    // ============================================================

    // theme helpers (the symbol renderer provides col / tok / lw as well)
    sheetRect() {
        // an A4-landscape sheet (0.1 in = one grid cell) that grows to hold everything drawn
        let w = 2340, h = 1660;
        for (const c of this.components) {
            const b = this.getComponentBox(c);
            w = Math.max(w, Math.ceil((b.x2 + 200) / 100) * 100);
            h = Math.max(h, Math.ceil((b.y2 + 200) / 100) * 100);
        }
        return { x: 0, y: 0, w, h };
    }

    draw() {
        const ctx = this.ctx;

        ctx.fillStyle = this.tok("workspace");
        ctx.fillRect(0, 0, this.width, this.height);

        this.connectedPins = new Set();
        for (const w of this.wires) {
            if (!w.route || w.route.length < 2) continue;
            for (const pt of [w.route[0], w.route[w.route.length - 1]]) this.connectedPins.add(`${pt.x},${pt.y}`);
        }

        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);

        this.drawSheet();
        this.drawGrid();
        this.drawWires();
        this.drawWirePreview();
        this.drawComponents();
        this.drawGhost();
        this.drawProbes();
        if (typeof this.drawOverlays === "function") this.drawOverlays();
        this.drawSnapHighlight();
        this.drawSelectionBox();

        ctx.restore();

        if (!this.exporting) {
            ctx.fillStyle = this.tok("hud");
            ctx.font = "11px system-ui";
            ctx.textAlign = "right";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(`${Math.round(this.zoom * 100)}%`, this.width - 10, this.height - 8);
        }
        if (typeof this.onDraw === "function") this.onDraw();
    }

    drawSheet() {
        const ctx = this.ctx;
        const r = this.sheetRect();
        // shadow, paper, then the blue frame ISIS draws around the sheet
        ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
        ctx.fillRect(r.x + 6, r.y + 6, r.w, r.h);
        ctx.fillStyle = this.tok("sheet");
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = this.tok("border");
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 14, r.y + 14, r.w - 28, r.h - 28);
        this.drawTitleBlock(r);
    }

    // ISIS-style title block in the bottom-right corner of the frame
    drawTitleBlock(r) {
        const t = this.titleBlock;
        if (!t || !t.show) return;
        const ctx = this.ctx;
        const w = 520, h = 120;
        const x = r.x + r.w - 14 - w, y = r.y + r.h - 14 - h;
        const line = this.tok("border"), text = this.tok("label"), dim = this.tok("value");
        ctx.save();
        ctx.fillStyle = this.tok("sheet");
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = line;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
        // rows: company | title | doc / author / date; right column: revision and sheet
        const col = x + 380;
        ctx.beginPath();
        ctx.moveTo(x, y + 30); ctx.lineTo(x + w, y + 30);
        ctx.moveTo(x, y + 84); ctx.lineTo(x + w, y + 84);
        ctx.moveTo(col, y + 30); ctx.lineTo(col, y + h);
        ctx.moveTo(col, y + 57); ctx.lineTo(x + w, y + 57);
        ctx.moveTo(x + 190, y + 84); ctx.lineTo(x + 190, y + h);
        ctx.moveTo(x + 300, y + 84); ctx.lineTo(x + 300, y + h);
        ctx.stroke();
        const fit = (s, max, font) => {                     // shorten to fit the cell
            ctx.font = font;
            let out = String(s || "");
            while (out.length > 1 && ctx.measureText(out).width > max) out = out.slice(0, -2) + "…";
            return out;
        };
        const cell = (label, value, cx, cy, cw, big = false) => {
            ctx.textAlign = "left"; ctx.textBaseline = "top";
            ctx.font = "8px system-ui"; ctx.fillStyle = dim;
            ctx.fillText(label, cx + 5, cy + 3);
            ctx.fillStyle = text;
            const font = `${big ? "bold 20px" : "12px"} system-ui`;
            ctx.font = font;
            ctx.fillText(fit(value, cw - 10, font), cx + 5, cy + (big ? 13 : 14));
        };
        cell("COMPANY", t.company, x, y, w);
        cell("TITLE", t.title, x, y + 30, col - x, true);
        cell("REV", t.rev, col, y + 30, x + w - col);
        cell("SHEET", t.sheet, col, y + 57, x + w - col);
        cell("DOC NO.", t.doc, x, y + 84, 190);
        cell("AUTHOR", t.author, x + 190, y + 84, 110);
        cell("DATE", t.date, x + 300, y + 84, w - 300);
        ctx.restore();
    }

    drawGrid() {
        if (this.showGrid === false) return;
        const ctx = this.ctx;
        const g = this.gridSize;
        let step = g;
        while (step * this.zoom < 9) step *= 2;

        ctx.fillStyle = this.tok("grid");
        const sheet = this.sheetRect();
        const x0 = Math.max(sheet.x, Math.floor((-this.panX / this.zoom) / step) * step);
        const y0 = Math.max(sheet.y, Math.floor((-this.panY / this.zoom) / step) * step);
        const x1 = Math.min(sheet.x + sheet.w, (this.width - this.panX) / this.zoom);
        const y1 = Math.min(sheet.y + sheet.h, (this.height - this.panY) / this.zoom);
        const r = Math.max(0.8, 1 / this.zoom);

        for (let x = x0; x <= x1; x += step) {
            for (let y = y0; y <= y1; y += step) {
                ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
            }
        }
    }

    drawWires() {
        const ctx = this.ctx;
        const lw = (n) => n * (Theme.current.lineScale ? Math.max(Theme.current.lineScale, 0.8) : 1);

        for (const wire of this.wires) {
            if (!wire.route || wire.route.length < 2) continue;

            const isSelected = wire === this.selectedWire;
            ctx.strokeStyle = wire.blocked ? this.tok("wireBlocked") : (isSelected ? this.tok("wireSelected") : (wire.bus ? "#2f55d4" : this.tok("wire")));
            ctx.lineWidth = wire.bus ? lw(isSelected ? 7 : 5) : (isSelected ? lw(3) : lw(2));
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.setLineDash(wire.blocked ? [6, 4] : []);

            ctx.beginPath();
            ctx.moveTo(wire.route[0].x, wire.route[0].y);
            for (let i = 1; i < wire.route.length; i++) ctx.lineTo(wire.route[i].x, wire.route[i].y);
            ctx.stroke();
            ctx.setLineDash([]);
            if (wire.bus && wire.busName) {                // the bus name beside its longest run
                let best = null;
                for (let i = 0; i < wire.route.length - 1; i++) { const a = wire.route[i], b = wire.route[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y); if (!best || len > best.len) best = { len, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, h: Math.abs(b.y - a.y) < 1e-6 }; }
                ctx.save(); ctx.fillStyle = "#2f55d4"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
                ctx.fillText(wire.busName, best.x + (best.h ? 0 : 14), best.y - (best.h ? 8 : 0)); ctx.restore();
            }

            if (isSelected) {
                for (let i = 0; i < wire.route.length - 1; i++) {
                    const p1 = wire.route[i];
                    const p2 = wire.route[i + 1];
                    if (Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y) < this.gridSize) continue;
                    ctx.fillStyle = this.tok("sheet");
                    ctx.strokeStyle = this.tok("wireSelected");
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.rect((p1.x + p2.x) / 2 - 4, (p1.y + p2.y) / 2 - 4, 8, 8);
                    ctx.fill();
                    ctx.stroke();
                }
            }
        }

        // junction dots only where 3+ conductors really meet
        ctx.fillStyle = this.tok("junction");
        for (const key of this.computeJunctions()) {
            const [x, y] = key.split(",").map(Number);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // dangling wire ends
        ctx.strokeStyle = this.tok("dangling");
        ctx.lineWidth = 1.5;
        for (const wire of this.wires) {
            if (!wire.route || wire.route.length < 2) continue;
            for (const [end, pt] of [[wire.start, wire.route[0]], [wire.end, wire.route[wire.route.length - 1]]]) {
                if (end.type !== "point") continue;
                const touched = this.wires.some(o => o !== wire && o.route && o.route.some((q, j) =>
                    (q.x === pt.x && q.y === pt.y) ||
                    (j < o.route.length - 1 && this.isPointOnSegment(pt.x, pt.y, q.x, q.y, o.route[j + 1].x, o.route[j + 1].y))));
                if (touched) continue;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    drawWirePreview() {
        if (!this.wiring || !this.previewRoute || this.previewRoute.length < 2) return;

        const ctx = this.ctx;
        ctx.strokeStyle = this.tok("preview");
        ctx.lineWidth = this.busMode ? 5 : 2;
        ctx.lineJoin = "round";
        ctx.setLineDash([6, 4]);

        ctx.beginPath();
        ctx.moveTo(this.previewRoute[0].x, this.previewRoute[0].y);
        for (let i = 1; i < this.previewRoute.length; i++) {
            ctx.lineTo(this.previewRoute[i].x, this.previewRoute[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = this.tok("preview");
        for (const a of this.wireAnchors) {
            ctx.beginPath();
            ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawProbes() {
        const ctx = this.ctx;
        for (const prb of this.probes) {
            const color = prb.color || (prb.type === "V" ? this.tok("probeV") : this.tok("probeI"));
            ctx.fillStyle = color;
            ctx.strokeStyle = this.tok("sheet");
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.arc(prb.x, prb.y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            if (prb === this.selectedProbe || (this.selectedProbe && prb.id === this.selectedProbe.id)) {
                ctx.save();
                ctx.strokeStyle = this.tok("preview");
                ctx.lineWidth = 2 / this.zoom;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.arc(prb.x, prb.y, 11, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                ctx.lineWidth = 2;
            }

            ctx.font = "11px system-ui";
            ctx.fillStyle = color;
            ctx.textAlign = "center";
            ctx.fillText(prb.live !== undefined ? `${prb.label} = ${prb.live}` : prb.label, prb.x, prb.y - 12);
        }
    }

    drawSnapHighlight() {
        if (!this.hoverSnap) return;

        const ctx = this.ctx;
        const { x, y, type, blocked } = this.hoverSnap;

        ctx.lineWidth = 2;
        if (type === "terminal") {
            ctx.strokeStyle = this.tok("preview");
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.stroke();
        } else if (type === "wire") {
            ctx.strokeStyle = this.tok("preview");
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.stroke();
        } else if (this.tool === "wire" || this.wiring) {
            ctx.fillStyle = blocked ? this.tok("wireBlocked") : this.tok("preview");
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawSelectionBox() {
        if (!this.box) return;
        const b = this.box;
        const ctx = this.ctx;
        ctx.fillStyle = this.tok("selectionFill");
        ctx.strokeStyle = this.tok("selection");
        ctx.lineWidth = 1 / this.zoom;
        ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
        ctx.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
        ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
        ctx.setLineDash([]);
    }

    drawComponents() {
        for (const component of this.components) {
            this.drawComponent(component);
        }
    }

    // Translucent preview of the part being placed, red where it can't go
    drawPasteGhost() {
        if (!this.pasteMode || !this.mouseInside || !this.clipboard) return;
        const cb = this.clipboard;
        const { dx, dy, free } = this.pasteOffset(this.mouse.x, this.mouse.y);
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = this.tok("preview");
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 2;
        for (const w of cb.wires) {
            ctx.beginPath();
            w.route.forEach((p, i) => (i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)));
            ctx.stroke();
        }
        ctx.restore();
        for (const c of cb.comps) {
            this.drawComponent(Object.assign({}, c, { id: -1, x: c.x + dx, y: c.y + dy, name: c.name }), { free });
        }
    }

    drawGhost() {
        this.drawPasteGhost();
        if (!this.isPlacing() || !this.mouseInside) return;
        const x = this.snap(this.mouse.x);
        const y = this.snap(this.mouse.y);
        const ghost = Object.assign({ id: -1, type: this.tool, x, y, rotation: this.placeRotation, mirror: this.placeMirror, name: "", value: "" }, this.placeProps ? JSON.parse(JSON.stringify(this.placeProps)) : {});
        this.drawComponent(ghost, { free: this.isPlacementFree(ghost, x, y, this.placeRotation) });
    }

    loadExample() {
        this.saveState();
        this.components = [];
        this.wires = [];
        this.probes = [];
        this.clearSelection();
        this.nextId = 1;
        this.resetView();

        const y = 200;

        const v = this.addComponent("V", 100, y);
        const r1 = this.addComponent("R", 240, y);
        const r2 = this.addComponent("R", 380, y);
        const c1 = this.addComponent("C", 520, y);
        const c2 = this.addComponent("C", 660, y);
        const gnd = this.addComponent("GND", 800, y + 80);

        v.value = "10 V";
        v.dcVoltage = 10;
        r1.value = "1 kΩ";
        r2.value = "2.2 kΩ";
        c1.value = "10 µF";
        c2.value = "4.7 µF";

        const link = (a, ta, b, tb) => this.wires.push({
            id: this.nextId++,
            start: { type: "terminal", component: a.id, terminal: ta },
            end: { type: "terminal", component: b.id, terminal: tb },
            route: null
        });
        link(v, "2", r1, "1");
        link(r1, "2", r2, "1");
        link(r2, "2", c1, "1");
        link(c1, "2", c2, "1");
        link(c2, "2", gnd, "1");
        link(v, "1", gnd, "1");

        this.refreshWires();
        this.draw();
        this.notify();
    }
}

applyMixin(SchematicEditor, SchematicRouter);
applyMixin(SchematicEditor, SymbolRenderer);

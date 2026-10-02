// Seeing the circuit's connectivity on the sheet: highlight every wire and pin of one net (everything else fades),
// mark rule-check problems with !, and jump to a location. Mixed into SchematicEditor.

class NetView {

    // ---- net highlighting -------------------------------------------------------------------------

    // seed: { wire } or { comp, pin }. Returns false when the thing is not on a net.
    highlightNet(seed) {
        const nets = NetlistExtractor.nets(this);
        const id = seed.wire ? nets.wireNode(seed.wire) : nets.terminalNode(seed.comp, seed.pin);
        if (id === null || id === undefined) return false;
        this.netHighlight = { seed: seed.wire ? { wireId: seed.wire.id } : { compId: seed.comp.id, pin: seed.pin }, id };
        this.fillHighlight(nets);
        this.draw();
        this.notify();
        return true;
    }

    fillHighlight(nets) {
        const h = this.netHighlight;
        h.name = nets.displayName(h.id);
        h.wires = new Set(this.wires.filter(w => nets.wireNode(w) === h.id).map(w => w.id));
        h.pins = [];
        for (const c of this.components) {
            if (this.isOverlay(c)) continue;
            for (const t of this.getTerminals(c)) if (nets.terminalNode(c, t.name) === h.id) h.pins.push({ comp: c, pin: t.name, pos: this.getTerminalPosition(c, t) });
        }
        const names = h.pins.map(p => `${p.comp.name}.${p.pin}`);
        h.summary = `Net ${h.name}: ${h.pins.length} pin${h.pins.length === 1 ? "" : "s"} (${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}), ${h.wires.size} wire${h.wires.size === 1 ? "" : "s"}`;
        this._hlDirty = false;
    }

    clearHighlight() {
        if (!this.netHighlight) return;
        this.netHighlight = null;
        this.draw();
        this.notify();
    }

    // the net under a point: a pin first, then a wire. Used by the H key and the right-click menu.
    netSeedAt(x, y) {
        const pin = this.findTerminal(x, y, 12);
        if (pin) return { comp: pin.component, pin: pin.terminal.name };
        const hit = this.findWireTarget(x, y);
        return hit ? { wire: hit.wire } : null;
    }

    // H: highlight the net of the selected wire, else of whatever is under the pointer; again to clear
    toggleHighlightAt(x, y) {
        const seed = this.selectedWire ? { wire: this.selectedWire } : (x === undefined ? null : this.netSeedAt(x, y));
        if (!seed) { this.clearHighlight(); return false; }
        const nets = NetlistExtractor.nets(this);
        const id = seed.wire ? nets.wireNode(seed.wire) : nets.terminalNode(seed.comp, seed.pin);
        if (this.netHighlight && this.netHighlight.id === id) { this.clearHighlight(); return false; }
        return this.highlightNet(seed);
    }

    refreshHighlight() {
        const h = this.netHighlight;
        if (!h || !this._hlDirty) return;
        const nets = NetlistExtractor.nets(this);
        let id = null;
        if (h.seed.wireId !== undefined) { const w = this.wires.find(k => k.id === h.seed.wireId); if (w) id = nets.wireNode(w); }
        else { const c = this.components.find(k => k.id === h.seed.compId); if (c) id = nets.terminalNode(c, h.seed.pin); }
        if (id === null || id === undefined) { this.netHighlight = null; this._hlDirty = false; this.notify(); return; }
        h.id = id;
        this.fillHighlight(nets);
        this.notify();
    }

    // ---- rule-check marks ---------------------------------------------------------------------------

    setErcMarks(issues) {
        this.ercMarks = [];
        for (const i of issues) for (const r of i.refs) if (r.x !== undefined && r.y !== undefined) this.ercMarks.push({ x: r.x, y: r.y, level: i.level });
        this.draw();
    }

    clearErcMarks() {
        if (!this.ercMarks) return;
        this.ercMarks = null;
        this.draw();
    }

    // bring a rule-check issue's place into view and select what it names
    revealRefs(refs) {
        const r = refs && refs[0];
        if (!r) return;
        this.clearSelection();
        if (r.comp && this.components.some(c => c.id === r.comp.id)) this.selection = [this.components.find(c => c.id === r.comp.id)];
        else if (r.wire) this.selectedWire = this.wires.find(w => w.id === r.wire.id) || null;
        else if (r.probe) this.selectedProbe = this.probes.find(p => p.id === r.probe.id) || null;
        const x = r.x !== undefined ? r.x : (r.comp ? r.comp.x : 0), y = r.y !== undefined ? r.y : (r.comp ? r.comp.y : 0);
        const z = Math.max(this.zoom, 0.8);
        this.zoom = z;
        this.panX = this.width / 2 - x * z;
        this.panY = this.height / 2 - y * z;
        this.draw();
        this.notify();
    }

    // ---- drawing ----------------------------------------------------------------------------------------

    drawOverlays() {
        const ctx = this.ctx;
        if (this.netHighlight) {
            this.refreshHighlight();
            const h = this.netHighlight;
            if (h) {
                // fade everything, then redraw the net on top
                const sheet = this.sheetRect();
                ctx.save();
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = this.tok("sheet");
                ctx.fillRect(sheet.x, sheet.y, sheet.w, sheet.h);
                ctx.restore();
                ctx.save();
                ctx.strokeStyle = "#ff8c00";
                ctx.lineWidth = 4;
                ctx.lineJoin = "round"; ctx.lineCap = "round";
                for (const w of this.wires) {
                    if (!h.wires.has(w.id) || !w.route || w.route.length < 2) continue;
                    ctx.beginPath();
                    ctx.moveTo(w.route[0].x, w.route[0].y);
                    for (let i = 1; i < w.route.length; i++) ctx.lineTo(w.route[i].x, w.route[i].y);
                    ctx.stroke();
                }
                ctx.fillStyle = "#ff8c00";
                ctx.strokeStyle = this.tok("sheet");
                ctx.lineWidth = 2;
                for (const p of h.pins) {
                    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                }
                ctx.restore();
            }
        }
        if (this.ercMarks && this.ercMarks.length) {
            ctx.save();
            for (const m of this.ercMarks) {
                const col = m.level === "err" ? "#d32f2f" : "#e69500";
                ctx.fillStyle = col;
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(m.x, m.y - 16, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 13px system-ui";
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText("!", m.x, m.y - 15);
            }
            ctx.restore();
        }
    }
}
applyMixin(SchematicEditor, NetView);

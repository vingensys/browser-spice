// Probes are objects on the sheet: select, drag, rename and delete them like parts.
// A voltage probe is anchored to a pin or to a point along a wire (not to fixed
// coordinates), so it follows the circuit when parts move and goes away with what it
// measures. Older designs without anchors get one inferred from their position.

class ProbeTools {

    // anchor description for a snap target (terminal, wire point or nothing)
    anchorFor(snap) {
        if (snap.type === "terminal") return { type: "terminal", component: snap.component.id, terminal: snap.terminal.name };
        if (snap.type === "wire") return { type: "wire", wire: snap.wire.id, frac: this.fractionAlong(snap.wire, snap.x, snap.y) };
        return null;
    }

    inferAnchor(x, y) {
        const pin = this.findTerminal(x, y, 6);
        if (pin) return { type: "terminal", component: pin.component.id, terminal: pin.terminal.name };
        const hit = this.findWireTarget(x, y);
        if (hit) {
            const p = this.projectPointToWire(x, y, hit.wire);
            return { type: "wire", wire: hit.wire.id, frac: this.fractionAlong(hit.wire, p.x, p.y) };
        }
        return null;
    }

    // position of a point along a wire as a 0..1 fraction of its length
    fractionAlong(wire, x, y) {
        const r = wire.route;
        let total = 0, at = 0, best = Infinity;
        for (let i = 0; i < r.length - 1; i++) {
            const len = Math.hypot(r[i + 1].x - r[i].x, r[i + 1].y - r[i].y);
            const d = this.distanceToSegment(x, y, r[i].x, r[i].y, r[i + 1].x, r[i + 1].y);
            if (d < best) {
                best = d;
                const q = this.projectPointToSegment(x, y, r[i].x, r[i].y, r[i + 1].x, r[i + 1].y);
                at = total + Math.hypot(q.x - r[i].x, q.y - r[i].y);
            }
            total += len;
        }
        return total > 0 ? at / total : 0;
    }

    pointAlong(wire, frac) {
        const r = wire.route;
        const lens = [];
        let total = 0;
        for (let i = 0; i < r.length - 1; i++) { const l = Math.hypot(r[i + 1].x - r[i].x, r[i + 1].y - r[i].y); lens.push(l); total += l; }
        let want = Math.min(Math.max(frac, 0), 1) * total;
        for (let i = 0; i < lens.length; i++) {
            if (want <= lens[i] || i === lens.length - 1) {
                const t = lens[i] ? want / lens[i] : 0;
                return { x: this.snap(r[i].x + (r[i + 1].x - r[i].x) * t), y: this.snap(r[i].y + (r[i + 1].y - r[i].y) * t) };
            }
            want -= lens[i];
        }
        return { x: r[0].x, y: r[0].y };
    }

    // keep every probe on what it measures; drop the ones whose target is gone
    syncProbes() {
        if (!this.probes || !this.probes.length) return;
        const keep = [];
        for (const p of this.probes) {
            if (p.type === "I") {
                const c = this.components.find(k => k.id === p.target);
                if (!c) continue;
                p.x = c.x; p.y = c.y - 35;
                keep.push(p);
                continue;
            }
            if (p.anchor === undefined) p.anchor = this.inferAnchor(p.x, p.y);
            const a = p.anchor;
            if (a && a.type === "terminal") {
                const c = this.components.find(k => k.id === a.component);
                const t = c && this.getTerminals(c).find(k => k.name === a.terminal);
                if (!t) continue;
                const pos = this.getTerminalPosition(c, t);
                p.x = pos.x; p.y = pos.y;
            } else if (a && a.type === "wire") {
                const w = this.wires.find(k => k.id === a.wire);
                if (!w) continue;
                if (w.route && w.route.length > 1) { const pt = this.pointAlong(w, a.frac); p.x = pt.x; p.y = pt.y; }
            }
            keep.push(p);
        }
        if (keep.length !== this.probes.length) {
            this.probes = keep;
            if (this.selectedProbe && !keep.some(p => p.id === this.selectedProbe.id)) this.selectedProbe = null;
        }
    }

    findProbe(x, y) {
        const tol = 9 / this.zoom;
        let best = null, bd = tol;
        for (const p of this.probes) {
            const d = Math.hypot(p.x - x, p.y - y);
            if (d <= bd) { bd = d; best = p; }
        }
        return best;
    }

    selectProbe(probe) {
        this.selectedProbe = probe;
        this.selection = [];
        this.selectedWire = null;
    }

    removeProbe(probe) {
        this.saveState();
        this.probes = this.probes.filter(p => p !== probe && p.id !== probe.id);
        if (this.selectedProbe && this.selectedProbe.id === probe.id) this.selectedProbe = null;
        this.draw();
        this.notify();
    }

    // dragging a voltage probe: it follows the pointer, then re-anchors on whatever it is dropped on
    startProbeDrag(probe) {
        this.probeDrag = { probe, moved: false, before: this.snapshot(), x: probe.x, y: probe.y };
    }

    doProbeDrag(pos) {
        const d = this.probeDrag;
        if (!d.moved) {
            if (Math.hypot(pos.screenX - this.pointerDownAt.x, pos.screenY - this.pointerDownAt.y) < 4) return;
            d.moved = true;
        }
        const snap = this.findSnapTarget(pos.x, pos.y);
        d.snap = snap;
        d.probe.x = snap.x; d.probe.y = snap.y;
        this.hoverSnap = snap.type === "grid" ? null : snap;
        this.draw();
    }

    endProbeDrag() {
        const d = this.probeDrag;
        this.probeDrag = null;
        this.hoverSnap = null;
        if (!d || !d.moved) return;
        const anchor = d.snap ? this.anchorFor(d.snap) : null;
        if (anchor) {
            if (this.historyStack[this.historyStack.length - 1] !== d.before) { this.historyStack.push(d.before); this.futureStack = []; }
            d.probe.anchor = anchor;
        } else {
            d.probe.x = d.x; d.probe.y = d.y;   // dropped on empty sheet: put it back
        }
        this.syncProbes();
        this.draw();
    }
}
applyMixin(SchematicEditor, ProbeTools);

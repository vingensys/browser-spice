// Touch input for the schematic: two fingers pinch-zoom and pan, one finger drags parts / wires or, on empty sheet, pans;
// a long press opens the right-click menu; a double tap does what a double click does; larger touch targets.
// Mixed into SchematicEditor; the pointer handlers call touchDown / touchMove / touchUp first.

class TouchInput {

    touchDown(e) {
        if (e.pointerType !== "touch") { this.hitBoost = 1; return false; }
        this.hitBoost = 1.8;
        this.touches = this.touches || new Map();
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        clearTimeout(this.lpTimer);
        if (this.touches.size >= 2) {
            this.cancelTouchAction();
            const [a, b] = [...this.touches.values()];
            const r = this.canvas.getBoundingClientRect();
            this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, zoom: this.zoom, panX: this.panX, panY: this.panY };
            return true;
        }
        this.lpStart = { x: e.clientX, y: e.clientY };
        this.longPressed = false;
        this.lpTimer = setTimeout(() => this.longPress(), 550);
        return false;
    }

    // abandon what one finger had started (a wire, a part move, a box) when a second finger lands
    cancelTouchAction() {
        if (this.wiring) this.cancelWire();
        if (this.move) {
            for (const [c, o] of this.move.orig) { c.x = o.x; c.y = o.y; }
            this.move = null; this.refreshWires();
        }
        this.box = null; this.segDrag = null; this.probeDrag = null; this.isPanning = false;
        this.draw();
    }

    touchMove(e) {
        if (e.pointerType !== "touch" || !this.touches) return false;
        if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch && this.touches.size >= 2) {
            const [a, b] = [...this.touches.values()];
            const r = this.canvas.getBoundingClientRect();
            const p = this.pinch, d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
            const zoom = Math.min(3, Math.max(0.25, p.zoom * d / p.d)), k = zoom / p.zoom;
            this.zoom = zoom;
            this.panX = cx - (p.cx - p.panX) * k;          // the sheet point that was under the fingers stays under them
            this.panY = cy - (p.cy - p.panY) * k;
            this.draw();
            return true;
        }
        if (this.lpTimer && this.lpStart && Math.hypot(e.clientX - this.lpStart.x, e.clientY - this.lpStart.y) > 10) { clearTimeout(this.lpTimer); this.lpTimer = 0; }
        return false;
    }

    touchUp(e) {
        if (e.pointerType !== "touch" || !this.touches) return false;
        const had = this.touches.has(e.pointerId);
        this.touches.delete(e.pointerId);
        clearTimeout(this.lpTimer); this.lpTimer = 0;
        if (this.pinch) { if (this.touches.size < 2) this.pinch = null; this.draw(); return true; }
        if (!had) return false;
        if (this.longPressed) { this.longPressed = false; this.isPanning = false; return true; }
        // double tap: two short taps close together in time and place
        if (e.type === "pointerup" && this.lpStart && Math.hypot(e.clientX - this.lpStart.x, e.clientY - this.lpStart.y) < 12) {
            const now = performance.now(), last = this.lastTap;
            if (last && now - last.t < 380 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
                this.lastTap = null;
                this.pointerUpCore(e);
                this.doubleClick(e);
                return true;
            }
            this.lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
        return false;
    }

    longPress() {
        this.lpTimer = 0;
        if (!this.touches || this.touches.size !== 1 || this.pinch) return;
        this.longPressed = true;
        this.isPanning = false; this.box = null;
        if (this.move) { for (const [c, o] of this.move.orig) { c.x = o.x; c.y = o.y; } this.move = null; this.refreshWires(); }
        const s = this.lpStart;
        this.canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 2 }));
    }
}
applyMixin(SchematicEditor, TouchInput);

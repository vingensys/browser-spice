// ISIS-style Overview: a miniature of the whole sheet with the visible area outlined.
// Click or drag in it to move the main view.

class Overview {
    constructor(canvas, editor) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.editor = editor;
        this.dragging = false;
        this.pending = false;

        editor.onDraw = () => this.schedule();
        Theme.onChange(() => this.schedule());
        new ResizeObserver(() => this.schedule()).observe(canvas);

        const move = (e) => {
            const r = this.geometry();
            const rect = canvas.getBoundingClientRect();
            const wx = (e.clientX - rect.left - r.ox) / r.k;
            const wy = (e.clientY - rect.top - r.oy) / r.k;
            editor.panX = editor.width / 2 - wx * editor.zoom;
            editor.panY = editor.height / 2 - wy * editor.zoom;
            editor.draw();
        };
        canvas.addEventListener("pointerdown", (e) => { this.dragging = true; canvas.setPointerCapture(e.pointerId); move(e); });
        canvas.addEventListener("pointermove", (e) => { if (this.dragging) move(e); });
        canvas.addEventListener("pointerup", () => { this.dragging = false; });
    }

    schedule() {
        if (this.pending) return;
        this.pending = true;
        requestAnimationFrame(() => { this.pending = false; this.draw(); });
    }

    // mapping from sheet coordinates to canvas pixels
    geometry() {
        const rect = this.canvas.getBoundingClientRect();
        const sheet = this.editor.sheetRect();
        const k = Math.min((rect.width - 6) / sheet.w, (rect.height - 6) / sheet.h);
        return { k, ox: (rect.width - sheet.w * k) / 2, oy: (rect.height - sheet.h * k) / 2, sheet, rect };
    }

    draw() {
        const ctx = this.ctx;
        const { k, ox, oy, sheet, rect } = this.geometry();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, rect.width * dpr);
        this.canvas.height = Math.max(1, rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.fillStyle = Theme.token("workspace");
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.fillStyle = Theme.token("sheet");
        ctx.fillRect(ox, oy, sheet.w * k, sheet.h * k);
        ctx.strokeStyle = Theme.token("border");
        ctx.lineWidth = 1;
        ctx.strokeRect(ox + 0.5, oy + 0.5, sheet.w * k, sheet.h * k);

        const ed = this.editor;
        ctx.strokeStyle = Theme.token("wire");
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const w of ed.wires) {
            if (!w.route || w.route.length < 2) continue;
            ctx.moveTo(ox + w.route[0].x * k, oy + w.route[0].y * k);
            for (let i = 1; i < w.route.length; i++) ctx.lineTo(ox + w.route[i].x * k, oy + w.route[i].y * k);
        }
        ctx.stroke();

        ctx.fillStyle = Theme.map("#ffb86c");
        for (const c of ed.components) {
            const b = ed.getComponentBox(c);
            ctx.fillRect(ox + b.x1 * k, oy + b.y1 * k, Math.max(2, (b.x2 - b.x1) * k), Math.max(2, (b.y2 - b.y1) * k));
        }

        // the visible area
        const vx = -ed.panX / ed.zoom, vy = -ed.panY / ed.zoom;
        const vw = ed.width / ed.zoom, vh = ed.height / ed.zoom;
        ctx.strokeStyle = "#0000ff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ox + vx * k, oy + vy * k, vw * k, vh * k);
    }
}

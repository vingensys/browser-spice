// A 3D picture of the board: the green slab with copper, pads, vias, silkscreen and a box for every part, drawn on a 2D canvas
// with a small perspective projection (painter's algorithm, no WebGL). The parts are simple bodies from the footprint outline
// and typical package heights, not the real shapes.
//
//   const scene = Pcb3D.scene(pcb);                 plain data in millimetres: board, copper, pads, vias, silk, boxes
//   const v = new Pcb3D(canvas); v.setScene(scene); v.draw();   v.yaw / v.pitch / v.zoom; v.preset("top" | "iso" | "bottom")

class Pcb3D {
    static T = 1.6;                  // board thickness, mm
    static COLORS = { R: "#d8c79a", C: "#4a73b8", L: "#8a5a3a", D: "#2b2b2f", Q: "#26262b", IC: "#232328", V: "#c25b5b", default: "#7d8590" };

    // typical body height (mm) of a footprint
    static height(part) {
        const n = String((part.fp && part.fp.name) || ""), k = part.kind;
        if (/0402/.test(n)) return 0.4;
        if (/0603/.test(n)) return 0.5;
        if (/0805|1206|SOD/i.test(n)) return 0.7;
        if (/SOT/i.test(n)) return 1.1;
        if (/SOIC|SO-?\d/i.test(n)) return 1.6;
        if (/TO-?220/i.test(n)) return 4.6;
        if (/TO-?92/i.test(n)) return 5;
        if (/DIP/i.test(n)) return 4.6;
        if (/header|pin/i.test(n)) return 8.5;
        if (part.fp && part.fp.smd) return 1;
        if (k === "C") return /radial/i.test(n) ? 9 : 5;
        if (k === "L") return 6;
        if (k === "R" || k === "D") return 2.4;
        return 5;
    }

    static scene(pcb) {
        const W = pcb.outline.w, H = pcb.outline.h, T = Pcb3D.T;
        const sc = { board: { w: W, h: H, t: T }, tracks: [], pads: [], vias: [], silk: [], boxes: [], fills: [] };
        const quad = (a, b, w) => {
            const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * w / 2, ny = (dx / L) * w / 2;
            return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
        };
        for (const t of pcb.tracks || []) for (let i = 0; i + 1 < t.pts.length; i++) sc.tracks.push({ layer: t.layer, poly: quad(t.pts[i], t.pts[i + 1], t.w) });
        for (const v of pcb.vias || []) sc.vias.push({ x: v.x, y: v.y, d: v.d, drill: v.drill || pcb.rules.viaDrill });
        for (const p of Pcb.pads(pcb)) {
            const layers = p.layers || (p.smd ? ["F"] : ["F", "B"]);
            sc.pads.push({ x: p.x, y: p.y, w: p.w, h: p.h, shape: p.shape, drill: p.drill || 0, layers, net: p.net, ref: p.part.ref });
        }
        for (const side of ["F", "B"]) for (const l of Pcb.silk(pcb, side)) sc.silk.push({ layer: side, pts: l });
        for (const part of pcb.parts || []) {
            if (!part.fp) continue;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const l of part.fp.silk || []) for (const q of l) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
            if (!isFinite(x0) || x1 - x0 < 0.5 || y1 - y0 < 0.5) { x0 = -part.fp.w / 2 + 0.3; x1 = part.fp.w / 2 - 0.3; y0 = -part.fp.h / 2 + 0.3; y1 = part.fp.h / 2 - 0.3; }
            const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(q => { const w = Pcb.xf(part, q[0], q[1]); return [w.x, w.y]; });
            sc.boxes.push({ ref: part.ref, side: part.flip ? "B" : "F", poly: corners, h: Pcb3D.height(part), color: Pcb3D.COLORS[part.kind] || Pcb3D.COLORS.default });
        }
        return sc;
    }

    constructor(canvas) {
        this.cv = canvas; this.ctx = canvas.getContext("2d");
        this.scene = null; this.yaw = -0.5; this.pitch = 0.9; this.zoom = 1;
        this.show = { parts: true, copper: true, silk: true };
    }

    setScene(s) { this.scene = s; }

    preset(name) {
        if (name === "top") { this.yaw = 0; this.pitch = Math.PI / 2; }
        else if (name === "bottom") { this.yaw = 0; this.pitch = -Math.PI / 2; }
        else { this.yaw = -0.5; this.pitch = 0.9; }
        this.zoom = 1;
    }

    // board mm -> screen: centred on the board, the board's y runs down the screen in the top view (as in the 2D layout), z is up,
    // seen in perspective from a distance of 3 board diagonals. yaw turns the board about the vertical, pitch tilts it
    // (90° = looking straight down from the front side, -90° = from the back).
    project(x, y, z, cam) {
        const { sc } = cam;
        const px = x - this.scene.board.w / 2, py = y - this.scene.board.h / 2, pz = z - Pcb3D.T / 2;
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        const rx = px * cy - py * sy, ry = px * sy + py * cy;
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
        const up = -ry * sp + pz * cp;               // up on screen
        const depth = -(ry * cp + pz * sp);          // negative: towards the viewer
        const f = cam.dist / (cam.dist + depth);
        return { x: cam.cx + rx * sc * f, y: cam.cy - up * sc * f, d: depth };
    }

    camera() {
        const b = this.scene.board, diag = Math.hypot(b.w, b.h);
        const w = this.cv.width, h = this.cv.height;
        return { sc: Math.min(w, h) / (diag * 1.15) * this.zoom, cx: w / 2, cy: h / 2, dist: diag * 3 };
    }

    // unit vector from the board towards the viewer, in board coordinates (z up)
    toViewer() {
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        return { x: cp * sy, y: cp * cy, z: sp };
    }

    // faces of the scene in painting order. Groups, bottom to top: back parts 0, back copper 1, the board 2, front copper 3, front parts 4;
    // seen from below the order is reversed. Faces that point away from the viewer are left out, and what is left in a group is sorted far to near.
    faces() {
        const S = this.scene, T = Pcb3D.T, cam = this.camera(), out = [], v = this.toViewer();
        const above = v.z >= 0;
        const P = (x, y, z) => this.project(x, y, z, cam);
        const poly = (pts, z) => pts.map(q => P(q[0], q[1], z));
        const add = (pts, fill, group, stroke) => { if (pts.length > 2) out.push({ pts, fill, group, stroke, depth: pts.reduce((a, p) => a + p.d, 0) / pts.length }); };
        const zFace = (side) => (side === "F" ? T : 0);
        const W = S.board.w, H = S.board.h;
        const eps = 0.02;
        const ring = (x, y, r, n = 14) => Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * 2 * Math.PI) * r, y + Math.sin((i / n) * 2 * Math.PI) * r]);
        const centroid = (pts) => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
        // side walls of a prism over `base` between z0 and z1: only those whose outward normal faces the viewer
        const walls = (base, z0, z1, fill, group, stroke, shadeFn) => {
            const c = centroid(base);
            for (let i = 0; i < base.length; i++) {
                const a = base[i], b = base[(i + 1) % base.length];
                let nx = b[1] - a[1], ny = -(b[0] - a[0]);
                if (nx * ((a[0] + b[0]) / 2 - c[0]) + ny * ((a[1] + b[1]) / 2 - c[1]) < 0) { nx = -nx; ny = -ny; }
                const L = Math.hypot(nx, ny) || 1;
                if ((nx * v.x + ny * v.y) / L <= 1e-9) continue;
                add([P(a[0], a[1], z0), P(b[0], b[1], z0), P(b[0], b[1], z1), P(a[0], a[1], z1)], shadeFn ? shadeFn(i, (nx * v.x + ny * v.y) / L) : fill, group, stroke);
            }
        };
        const rect = [[0, 0], [W, 0], [W, H], [0, H]];
        // the slab
        add(poly(rect, above ? T : 0), above ? "#1b6b45" : "#124d33", 2);
        walls(rect, 0, T, "#0e3b28", 2);
        if (this.show.copper) {
            const flat = (side, pts, z, fill, extraGroupShift = 0) => {
                if ((side === "F") !== above) return;                         // the board hides the other side
                add(poly(pts, z), fill, side === "F" ? 3 : 1);
            };
            for (const t of S.tracks) flat(t.layer, t.poly, zFace(t.layer) + (t.layer === "F" ? eps : -eps), t.layer === "F" ? "#c9a24a" : "#a9822f");
            for (const p of S.pads) for (const l of p.layers) {
                const z = zFace(l) + (l === "F" ? eps * 2 : -eps * 2), dz = l === "F" ? eps : -eps;
                const shape = p.shape === "round" ? ring(p.x, p.y, Math.min(p.w, p.h) / 2) : [[p.x - p.w / 2, p.y - p.h / 2], [p.x + p.w / 2, p.y - p.h / 2], [p.x + p.w / 2, p.y + p.h / 2], [p.x - p.w / 2, p.y + p.h / 2]];
                flat(l, shape, z, "#d9b861");
                if (p.drill) flat(l, ring(p.x, p.y, p.drill / 2), z + dz, "#0a0d10");
            }
            for (const vi of S.vias) for (const l of ["F", "B"]) {
                const z = zFace(l) + (l === "F" ? eps * 2 : -eps * 2), dz = l === "F" ? eps : -eps;
                flat(l, ring(vi.x, vi.y, vi.d / 2), z, "#cdb066"); flat(l, ring(vi.x, vi.y, vi.drill / 2), z + dz, "#0a0d10");
            }
        }
        if (this.show.silk) for (const l of S.silk) {
            if ((l.layer === "F") !== above) continue;
            const z = zFace(l.layer) + (l.layer === "F" ? 3 * eps : -3 * eps);
            for (let i = 0; i + 1 < l.pts.length; i++) {
                const a = l.pts[i], b = l.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, w = 0.15, nx = (-dy / L) * w / 2, ny = (dx / L) * w / 2;
                add(poly([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], z), "#f2f2ee", l.layer === "F" ? 3 : 1);
            }
        }
        if (this.show.parts) for (const b of S.boxes) {
            const front = b.side === "F", z0 = front ? T : 0, z1 = front ? T + b.h : -b.h, g = front ? 4 : 0;
            const shade = (c, f) => { const n = parseInt(c.slice(1), 16), ch = (sh) => Math.min(255, Math.round(((n >> sh) & 255) * f)); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };
            walls(b.poly, z0, z1, null, g, "rgba(0,0,0,.4)", (i, facing) => shade(b.color, 0.5 + 0.5 * facing));
            if ((front ? 1 : -1) * v.z > 1e-9) add(poly(b.poly, z1), shade(b.color, 1.15), g, "rgba(0,0,0,.4)");
        }
        // painting order: group (reversed when seen from below), then far to near
        out.sort((a, b) => (a.group !== b.group ? (above ? a.group - b.group : b.group - a.group) : b.depth - a.depth));
        return out;
    }

    draw() {
        const c = this.ctx, w = this.cv.width, h = this.cv.height;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = "#14181d"; c.fillRect(0, 0, w, h);
        if (!this.scene) return;
        c.lineJoin = "round";
        for (const f of this.faces()) {
            c.beginPath();
            f.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
            c.closePath();
            c.fillStyle = f.fill; c.fill();
            if (f.stroke) { c.strokeStyle = f.stroke; c.lineWidth = 1; c.stroke(); }
        }
    }
}

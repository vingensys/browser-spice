// Randomised editor stress test. Load it in the running app and call stress():
//   await import('/tests/stress.js')  (or eval a fetch of it) -> window.stress(seed, moves)
//
// It builds a 9-part circuit with 12 wires, then drags / rotates parts at random through
// real pointer events and, after every operation, checks the wire invariants:
//   diag / through / edge-through / backtrack / detached / lead-start / lead-end / blocked
// "lead" violations are only counted when a clean one-grid pin stub was actually possible.

window.stress = function (seed0 = 12345, N = 250, rotateP = 0.1) {
    const e = editor, cv = e.canvas, rc = cv.getBoundingClientRect();
    e.resetView(); e.components = []; e.wires = []; e.nextId = 1; e.historyStack = [];

    const mk = (t, x, y, r = 0) => e.addComponent(t, x, y, r);
    const v = mk('V', 100, 300), r1 = mk('R', 260, 300), q = mk('BJT_NPN', 420, 300), ic = mk('IC555', 620, 300),
        g = mk('GND', 100, 460), op = mk('OPAMP', 420, 140), d = mk('D', 260, 460, 90), n = mk('NAND', 620, 140),
        c1 = mk('C', 260, 140);
    const W = (a, ta, b, tb) => e.wires.push({
        id: e.nextId++,
        start: { type: 'terminal', component: a.id, terminal: ta },
        end: { type: 'terminal', component: b.id, terminal: tb },
        route: null
    });
    W(v, '2', r1, '1'); W(r1, '2', q, 'B'); W(q, 'C', ic, 'VCC'); W(q, 'E', g, '1'); W(v, '1', g, '1');
    W(op, 'OUT', n, 'A'); W(d, '1', ic, 'GND'); W(ic, 'OUT', op, 'IN-'); W(n, 'Y', ic, 'RESET');
    W(d, '2', q, 'E'); W(c1, '1', op, 'IN+'); W(c1, '2', r1, '1');
    e.refreshWires();

    const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, {
        clientX: rc.left + e.panX + x * e.zoom, clientY: rc.top + e.panY + y * e.zoom,
        button: 0, bubbles: true, pointerId: 1
    }));

    let degenerate = 0;
    const check = () => {
        const bad = [];
        const G = e.gridSize;
        for (const w of e.wires) {
            if (!w.route) { bad.push('noroute ' + w.id); continue; }
            if (w.blocked) { bad.push('blocked ' + w.id); continue; }
            const R = w.route;
            if (R.length < 2) { degenerate++; continue; }

            for (let i = 0; i < R.length - 1; i++) {
                const a = R[i], b = R[i + 1];
                if (a.x !== b.x && a.y !== b.y) bad.push('diag ' + w.id);
                const steps = Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / G);
                const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
                for (let s = 0; s <= steps; s++) {
                    const x = a.x + sx * s * G, y = a.y + sy * s * G;
                    for (const c of e.components) {
                        const B = e.getComponentBox(c);
                        if (x > B.x1 && x < B.x2 && y > B.y1 && y < B.y2) bad.push('through ' + c.type + ' w' + w.id);
                        if (s < steps) {
                            const mx = x + sx * G / 2, my = y + sy * G / 2;
                            if (mx > B.x1 && mx < B.x2 && my > B.y1 && my < B.y2) bad.push('edge-through ' + c.type + ' w' + w.id);
                        }
                    }
                }
            }
            if (e.hasBacktrack(R)) bad.push('backtrack ' + w.id);

            const sI = e.getTerminalInfo(w.start.component, w.start.terminal);
            const eI = e.getTerminalInfo(w.end.component, w.end.terminal);
            if (R[0].x !== sI.position.x || R[0].y !== sI.position.y ||
                R[R.length - 1].x !== eI.position.x || R[R.length - 1].y !== eI.position.y) bad.push('detached ' + w.id);

            const stubFree = (info) => {
                const sx = info.position.x + info.dir.x * G, sy = info.position.y + info.dir.y * G;
                return !e.components.some(c => {
                    const B = e.getComponentBox(c);
                    return sx > B.x1 && sx < B.x2 && sy > B.y1 && sy < B.y2;
                });
            };
            const u0 = { x: Math.sign(R[1].x - R[0].x), y: Math.sign(R[1].y - R[0].y) };
            if ((u0.x !== sI.dir.x || u0.y !== sI.dir.y) && stubFree(sI) && stubFree(eI)) bad.push('lead-start ' + w.id);
            const L = R.length - 1;
            const u1 = { x: Math.sign(R[L - 1].x - R[L].x), y: Math.sign(R[L - 1].y - R[L].y) };
            if ((u1.x !== eI.dir.x || u1.y !== eI.dir.y) && stubFree(sI) && stubFree(eI)) bad.push('lead-end ' + w.id);
        }
        return bad;
    };

    let seed = seed0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const fails = {}, samples = {};
    let moves = 0, rejected = 0, tms = 0, maxms = 0, frames = 0;
    const initBad = check();

    for (let i = 0; i < N; i++) {
        const c = e.components[Math.floor(rnd() * e.components.length)];
        const x0 = c.x, y0 = c.y;
        const dx = Math.round((rnd() - 0.5) * 10) * 20, dy = Math.round((rnd() - 0.5) * 8) * 20;

        ev('pointerdown', x0, y0);
        for (let s = 1; s <= 3; s++) {
            const t0 = performance.now();
            ev('pointermove', x0 + dx * s / 3, y0 + dy * s / 3);
            const ms = performance.now() - t0;
            tms += ms; frames++; maxms = Math.max(maxms, ms);
        }
        ev('pointerup', x0 + dx, y0 + dy);
        moves++;
        if (c.x === x0 && c.y === y0) rejected++;

        if (rnd() < rotateP) { ev('pointerdown', c.x, c.y); ev('pointerup', c.x, c.y); e.rotateSelected(); }

        for (const b of check()) {
            const k = b.split(' ')[0];
            fails[k] = (fails[k] || 0) + 1;
            samples[k] = samples[k] || ('move#' + i + ' ' + b);
        }
    }

    return {
        initBad, moves, rejected, degenerate, fails, samples,
        avgMs: +(tms / frames).toFixed(2), maxMs: +maxms.toFixed(1),
        totalBends: e.wires.reduce((a, w) => a + Math.max(0, w.route.length - 2), 0)
    };
};

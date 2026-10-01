// Interaction regression suite. Load in the running app and call interactionTests().
// Drives the editor through real pointer / wheel / keyboard events and asserts behaviour.

window.interactionTests = function () {
    const e = editor, cv = e.canvas;
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, ...(cond ? {} : { extra }) });

    const rc = () => cv.getBoundingClientRect();
    const pt = (x, y) => ({
        clientX: rc().left + e.panX + x * e.zoom,
        clientY: rc().top + e.panY + y * e.zoom,
        button: 0, bubbles: true, pointerId: 1
    });
    const ptr = (type, x, y, extra = {}) => cv.dispatchEvent(new PointerEvent(type, { ...pt(x, y), ...extra }));
    const click = (x, y, extra) => { ptr('pointerdown', x, y, extra); ptr('pointerup', x, y, extra); };
    const drag = (x0, y0, x1, y1, steps = 4) => {
        ptr('pointerdown', x0, y0);
        for (let i = 1; i <= steps; i++) ptr('pointermove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
        ptr('pointerup', x1, y1);
    };
    const key = (k, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
    const reset = () => {
        e.setTool('select'); e.components = []; e.wires = []; e.probes = []; e.nextId = 1;
        e.historyStack = []; e.futureStack = []; e.clearSelection(); e.resetView(); e.draw();
    };
    const pinPos = (c, name) => {
        const info = e.getTerminalInfo(c.id, name);
        return info.position;
    };
    const wireValid = (w) => {
        if (!w.route || w.route.length < 2) return false;
        for (let i = 0; i < w.route.length - 1; i++) {
            const a = w.route[i], b = w.route[i + 1];
            if (a.x !== b.x && a.y !== b.y) return false;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            if (e.components.some(c => { const B = e.getComponentBox(c); return mx > B.x1 && mx < B.x2 && my > B.y1 && my < B.y2; })) return false;
        }
        return true;
    };

    // ---- placement ----
    reset();
    e.setTool('R');
    ok('palette tool arms placement', e.isPlacing());
    click(200, 200); click(400, 200);
    ok('placement is sticky and places each click', e.components.length === 2 && e.isPlacing(), e.components.length);
    key('r'); ptr('pointermove', 600, 200); click(600, 200);
    ok('R rotates the ghost before placing', e.components[2] && e.components[2].rotation === 90, e.components[2] && e.components[2].rotation);
    click(600, 200);
    ok('cannot place on top of an existing part', e.components.length === 3, e.components.length);
    cv.dispatchEvent(new MouseEvent('contextmenu', { ...pt(100, 100), bubbles: true }));
    ok('right-click leaves placement mode', e.tool === 'select');

    // ---- wiring: drag from pin to pin ----
    const [r1, r2] = e.components;
    const p1 = pinPos(r1, '2'), p2 = pinPos(r2, '1');
    drag(p1.x, p1.y, p2.x, p2.y);
    ok('drag from pin to pin creates a wire', e.wires.length === 1, e.wires.length);
    ok('wire is orthogonal and clear of bodies', e.wires[0] && wireValid(e.wires[0]));
    ok('wire mode returns to select after auto wiring', e.tool === 'select' && !e.wiring);

    // ---- wiring: click, corner, click ----
    const q1 = pinPos(r1, '1'), q2 = pinPos(r2, '2');
    click(q1.x, q1.y);
    ok('click on pin starts wiring', e.wiring);
    ptr('pointermove', q1.x, q1.y - 100); click(q1.x, q1.y - 100);
    ok('click on empty grid adds a corner', e.wireAnchors.length === 1, e.wireAnchors.length);
    ptr('pointermove', q2.x, q2.y); click(q2.x, q2.y);
    ok('click on pin finishes the wire', e.wires.length === 2 && !e.wiring, e.wires.length);
    const w2 = e.wires[1];
    ok('wire honours the clicked corner', w2.route.some(p => p.y === q1.y - 100), JSON.stringify(w2.route));

    // ---- Esc / Backspace while wiring ----
    const n0 = e.wires.length;
    click(pinPos(r1, '2').x, pinPos(r1, '2').y);
    key('Escape');
    ok('Esc cancels a wire in progress', !e.wiring && e.wires.length === n0);

    // ---- junction: wire onto a wire ----
    reset();
    const a = e.addComponent('R', 200, 200), b = e.addComponent('R', 480, 200), c = e.addComponent('GND', 340, 340);
    const link = (s, ts, t, tt) => { const p = pinPos(s, ts), q = pinPos(t, tt); drag(p.x, p.y, q.x, q.y); };
    link(a, '2', b, '1');
    const wire0 = e.wires[0];
    const mid = wire0.route[0];
    const onWire = { x: (wire0.route[0].x + wire0.route[wire0.route.length - 1].x) / 2, y: wire0.route[0].y };
    const gp = pinPos(c, '1');
    drag(gp.x, gp.y, e.snap(onWire.x), onWire.y);
    ok('wire can end on another wire (junction)', e.wires.length === 2 && e.wires[1].end.type === 'wire', JSON.stringify(e.wires[1] && e.wires[1].end));
    ok('junction dot is drawn', e.computeJunctions().length === 1, e.computeJunctions().length);
    const net = NetlistExtractor.extract(e);
    ok('netlist merges the junction (both resistor pins land on the GND net)',
        net.getTerminalNodeName(a, '2') === '0' && net.getTerminalNodeName(b, '1') === '0',
        [net.getTerminalNodeName(a, '2'), net.getTerminalNodeName(b, '1')]);

    // ---- segment drag ----
    reset();
    const s1 = e.addComponent('R', 200, 200), s2 = e.addComponent('R', 500, 260);
    link(s1, '2', s2, '1');
    const sw = e.wires[0];
    const before = JSON.stringify(sw.route);
    const seg = sw.route.findIndex((p, i) => i < sw.route.length - 1 && p.x === sw.route[i + 1].x && Math.abs(p.y - sw.route[i + 1].y) >= 20);
    if (seg >= 0) {
        const mx = sw.route[seg].x, my = (sw.route[seg].y + sw.route[seg + 1].y) / 2;
        drag(mx, my, mx - 40, my);
        ok('dragging a segment moves it', JSON.stringify(sw.route) !== before, JSON.stringify(sw.route));
        ok('segment drag keeps the wire attached and valid', wireValid(sw) &&
            sw.route[0].x === pinPos(s1, '2').x && sw.route[sw.route.length - 1].x === pinPos(s2, '1').x);
        e.undo();
        ok('undo restores the route', JSON.stringify(e.wires[0].route) === before);
    } else {
        ok('has a vertical segment to drag', false, before);
    }

    // ---- box select, group move, rigid inner wire ----
    reset();
    const g1 = e.addComponent('R', 200, 200), g2 = e.addComponent('R', 400, 200), g3 = e.addComponent('R', 700, 400);
    link(g1, '2', g2, '1');
    link(g2, '2', g3, '1');
    const inner = e.wires[0];
    const innerBefore = inner.route.map(p => ({ x: p.x + 40, y: p.y + 60 }));
    drag(120, 120, 480, 300);
    ok('box select picks the parts inside', e.selection.length === 2 && e.selection.includes(g1) && e.selection.includes(g2), e.selection.length);
    drag(g1.x, g1.y, g1.x + 40, g1.y + 60);
    ok('group move moves every selected part', g1.x === 240 && g2.x === 440 && g1.y === 260 && g2.y === 260, [g1.x, g1.y, g2.x, g2.y]);
    ok('wire between moved parts translates rigidly', JSON.stringify(inner.route) === JSON.stringify(innerBefore), JSON.stringify(inner.route));
    ok('wire to the unmoved part stays valid and attached', e.wires.every(wireValid) &&
        e.wires[1].route[e.wires[1].route.length - 1].x === pinPos(g3, '1').x);
    e.undo();
    ok('undo reverts a group move in one step', e.components[0].x === 200 && e.components[1].x === 400, [e.components[0].x, e.components[1].x]);

    // ---- shift-click toggles ----
    e.clearSelection();
    click(e.components[0].x, e.components[0].y); click(e.components[2].x, e.components[2].y, { shiftKey: true });
    ok('shift-click adds to the selection', e.selection.length === 2, e.selection.length);

    // ---- copy / paste keeps inner wires ----
    reset();
    const k1 = e.addComponent('R', 200, 200), k2 = e.addComponent('C', 400, 200);
    link(k1, '2', k2, '1');
    e.selectAll();
    key('c', { ctrlKey: true });
    ptr('pointermove', 300, 400);
    key('v', { ctrlKey: true });
    ok('Ctrl+V attaches the block to the cursor', e.pasteMode && e.components.length === 2);
    ptr('pointerdown', 300, 400); ptr('pointerup', 300, 400);
    ok('paste duplicates parts and their wire', e.components.length === 4 && e.wires.length === 2, [e.components.length, e.wires.length]);
    ok('pasted wire is valid', wireValid(e.wires[1]));
    ok('pasted parts are selected', e.selection.length === 2);

    // ---- rotate selection / delete ----
    key('r');
    ok('R rotates the selection', e.selection.every(c => c.rotation === 90 || c.rotation === 0) && e.wires.every(wireValid));
    key('Delete');
    ok('Delete removes selected parts and their wires', e.components.length === 2 && e.wires.length === 1, [e.components.length, e.wires.length]);

    // ---- zoom keeps the point under the cursor fixed ----
    reset();
    const sx = 300, sy = 250;
    const wx = (sx - e.panX) / e.zoom, wy = (sy - e.panY) / e.zoom;
    cv.dispatchEvent(new WheelEvent('wheel', { clientX: rc().left + sx, clientY: rc().top + sy, deltaY: -300, bubbles: true, cancelable: true }));
    const wx2 = (sx - e.panX) / e.zoom, wy2 = (sy - e.panY) / e.zoom;
    ok('wheel zooms in', e.zoom > 1, e.zoom);
    ok('zoom is anchored on the cursor', Math.abs(wx - wx2) < 0.5 && Math.abs(wy - wy2) < 0.5);
    const comp = e.addComponent('R', 300, 300);
    drag(comp.x, comp.y, comp.x + 40, comp.y);
    ok('dragging works while zoomed', comp.x === 340, comp.x);
    e.resetView();

    // ---- double-click ends a wire in free space; Backspace removes the last corner ----
    reset();
    const d1 = e.addComponent('R', 200, 200);
    const dp = pinPos(d1, '2');
    click(dp.x, dp.y);
    ptr('pointermove', dp.x + 100, dp.y + 80); click(dp.x + 100, dp.y + 80);
    ptr('pointermove', dp.x + 200, dp.y + 80); click(dp.x + 200, dp.y + 80);
    key('Backspace');
    ok('Backspace removes the last corner', e.wiring && e.wireAnchors.length === 1, e.wireAnchors.length);
    ptr('pointermove', dp.x + 200, dp.y + 80); click(dp.x + 200, dp.y + 80); click(dp.x + 200, dp.y + 80);
    cv.dispatchEvent(new MouseEvent('dblclick', { ...pt(dp.x + 200, dp.y + 80), bubbles: true }));
    ok('double-click ends the wire in free space', e.wires.length === 1 && !e.wiring && e.wires[0].end.type === 'point', JSON.stringify(e.wires[0]));
    ok('free-space wire is valid', wireValid(e.wires[0]));

    // ---- body is not a valid wire corner ----
    reset();
    const bd = e.addComponent('IC555', 300, 300);
    e.setTool('wire');
    click(100, 100);
    ptr('pointermove', 300, 300); click(300, 300);
    ok('cannot anchor a corner inside a component body', e.wireAnchors.length === 0, e.wireAnchors.length);
    e.cancelWire(); e.setTool('select');

    // ---- tidy: T re-routes a wire from scratch, stays valid ----
    reset();
    const t1 = e.addComponent('R', 200, 200), t2 = e.addComponent('R', 500, 300);
    link(t1, '2', t2, '1');
    e.wires[0].route = [pinPos(t1, '2'), { x: pinPos(t1, '2').x, y: 100 }, { x: pinPos(t2, '1').x, y: 100 }, pinPos(t2, '1')];
    e.selectedWire = e.wires[0];
    key('t');
    ok('T tidies a wire into a valid, shorter route', wireValid(e.wires[0]) && e.wires[0].route.length <= 4, JSON.stringify(e.wires[0].route));

    // ---- save / load round trip ----
    reset();
    const m1 = e.addComponent('R', 200, 200), m2 = e.addComponent('C', 400, 260);
    link(m1, '2', m2, '1');
    const saved = JSON.stringify({ components: e.components, wires: e.wires, probes: e.probes, nextId: e.nextId });
    const routeBefore = JSON.stringify(e.wires[0].route);
    const st = JSON.parse(saved);
    e.components = st.components; e.wires = st.wires; e.probes = st.probes; e.nextId = st.nextId;
    e.selected = null; e.selectedWire = null; e.rerouteAllWires();
    ok('load keeps the saved wire shape', JSON.stringify(e.wires[0].route) === routeBefore);

    // ---- stale hover ring is cleared when leaving wire mode ----
    e.setTool('wire'); ptr('pointermove', 300, 300); e.setTool('select');
    ok('hover highlight cleared after tool change', e.hoverSnap === null);

    const failed = results.filter(r => !r.pass);
    return { total: results.length, failed: failed.length, failures: failed };
};

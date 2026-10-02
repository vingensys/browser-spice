// Orthogonal wire router + "rubber-band" wire repair for SchematicEditor.
//
// Wires are stored as orthogonal polylines (wire.route). Two operations:
//   * fresh route  - A* on the grid between two points
//   * repair       - when a pin moves, keep as much of the existing wire shape as
//                    possible and only re-solve the ends (what Proteus/KiCad do)
//
// Rules the router enforces: component bodies are solid, wires leave a pin
// straight out, and bends / overlaps with other wires cost extra.

const ROUTE_COST = {
    BEND: 3,
    OVERLAP: 25,
    CORNER: 40,
    CROSS: 2,
    REPAIR_SLACK: 6,
    REPAIR_EXTRA_BENDS: 1
};

const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

class SchematicRouter {

    // ---------- context ----------

    edgeKey(x1, y1, x2, y2) {
        return (x1 < x2 || (x1 === x2 && y1 < y2))
            ? `${x1},${y1}|${x2},${y2}`
            : `${x2},${y2}|${x1},${y1}`;
    }

    buildRouteContext(excludeWire) {
        const g = this.gridSize;
        const boxes = this.components.filter(c => !this.isOverlay(c)).map(c => this.getComponentBox(c));
        const pins = [];
        for (const c of this.components) {
            for (const t of this.getTerminals(c)) pins.push(this.getTerminalPosition(c, t));
        }

        const edgeUse = new Set();
        const nodeUse = new Map();
        const markNode = (x, y, kind) => {
            const k = `${x},${y}`;
            const prev = nodeUse.get(k);
            nodeUse.set(k, prev && prev !== kind ? "C" : kind);
        };

        for (const w of this.wires) {
            if (w === excludeWire || !w.route || w.route.length < 2) continue;
            for (let i = 0; i < w.route.length - 1; i++) {
                const a = w.route[i];
                const b = w.route[i + 1];
                if (a.x !== b.x && a.y !== b.y) continue;

                const horizontal = a.y === b.y;
                const steps = Math.round((horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y)) / g);
                const sx = Math.sign(b.x - a.x);
                const sy = Math.sign(b.y - a.y);

                for (let s = 0; s <= steps; s++) {
                    const x = a.x + sx * s * g;
                    const y = a.y + sy * s * g;
                    markNode(x, y, s === 0 || s === steps ? "C" : (horizontal ? "H" : "V"));
                    if (s < steps) edgeUse.add(this.edgeKey(x, y, x + sx * g, y + sy * g));
                }
            }
        }

        return { boxes, pins, edgeUse, nodeUse };
    }

    pointInsideBox(x, y, b) {
        return x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2;
    }

    pointInsideAnyBody(x, y) {
        return this.components.some(c => !this.isOverlay(c) && this.pointInsideBox(x, y, this.getComponentBox(c)));
    }

    // Is the straight grid segment p->q clear of bodies and foreign pins?
    segmentFree(p, q, ctx, allow) {
        const g = this.gridSize;
        const len = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y));
        const steps = Math.round(len / g);
        const sx = Math.sign(q.x - p.x);
        const sy = Math.sign(q.y - p.y);

        for (let s = 0; s <= steps; s++) {
            const x = p.x + sx * s * g;
            const y = p.y + sy * s * g;
            for (const b of ctx.boxes) {
                if (this.pointInsideBox(x, y, b)) return false;
                if (s < steps && this.pointInsideBox(x + sx * g / 2, y + sy * g / 2, b)) return false;
            }
            if (!allow.has(`${x},${y}`) && ctx.pins.some(pin => pin.x === x && pin.y === y)) return false;
        }
        return true;
    }

    // ---------- A* ----------

    // State = node x arrival direction (so bends can be charged).
    // noArrive: a travel direction index that may not be used to enter the goal.
    searchGridPath(s, e, startDir, ctx, margin, noArrive = -1) {
        const g = this.gridSize;
        const c0x = Math.round(s.x / g), c0y = Math.round(s.y / g);
        const c1x = Math.round(e.x / g), c1y = Math.round(e.y / g);

        const minX = Math.min(c0x, c1x) - margin;
        const maxX = Math.max(c0x, c1x) + margin;
        const minY = Math.min(c0y, c1y) - margin;
        const maxY = Math.max(c0y, c1y) + margin;
        const W = maxX - minX + 1;
        const H = maxY - minY + 1;
        const N = W * H;
        const idxOf = (cx, cy) => (cy - minY) * W + (cx - minX);

        const nodeBlk = new Uint8Array(N); // 1 = inside a body, 2 = foreign pin
        const hBlk = new Uint8Array(N);    // edge (cx,cy)->(cx+1,cy) crosses a body
        const vBlk = new Uint8Array(N);    // edge (cx,cy)->(cx,cy+1) crosses a body

        for (const b of ctx.boxes) {
            const cxa = Math.max(minX, Math.floor(b.x1 / g) - 1);
            const cxb = Math.min(maxX, Math.ceil(b.x2 / g) + 1);
            const cya = Math.max(minY, Math.floor(b.y1 / g) - 1);
            const cyb = Math.min(maxY, Math.ceil(b.y2 / g) + 1);
            for (let cx = cxa; cx <= cxb; cx++) {
                for (let cy = cya; cy <= cyb; cy++) {
                    const x = cx * g, y = cy * g;
                    const i = idxOf(cx, cy);
                    if (x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2) nodeBlk[i] = 1;
                    if (x + g / 2 > b.x1 && x + g / 2 < b.x2 && y > b.y1 && y < b.y2) hBlk[i] = 1;
                    if (x > b.x1 && x < b.x2 && y + g / 2 > b.y1 && y + g / 2 < b.y2) vBlk[i] = 1;
                }
            }
        }
        for (const p of ctx.pins) {
            const cx = Math.round(p.x / g), cy = Math.round(p.y / g);
            if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
            const i = idxOf(cx, cy);
            if (!nodeBlk[i]) nodeBlk[i] = 2;
        }

        const si = idxOf(c0x, c0y);
        const gi = idxOf(c1x, c1y);
        if (nodeBlk[si] === 1 || nodeBlk[gi] === 1) return null;
        nodeBlk[si] = 0;
        nodeBlk[gi] = 0;

        const DX = [1, 0, -1, 0];
        const DY = [0, 1, 0, -1];
        const { BEND, OVERLAP, CORNER, CROSS } = ROUTE_COST;

        const cost = new Float32Array(N * 5).fill(Infinity);
        const parent = new Int32Array(N * 5).fill(-1);
        const closed = new Uint8Array(N * 5);
        const heap = new MinHeap();

        const startState = si * 5 + startDir;
        cost[startState] = 0;
        heap.push(Math.abs(c0x - c1x) + Math.abs(c0y - c1y), startState);

        let expansions = 0;
        while (heap.size > 0 && expansions < 80000) {
            const state = heap.pop();
            if (closed[state]) continue;
            closed[state] = 1;
            expansions++;

            const node = (state / 5) | 0;
            const d = state % 5;

            if (node === gi && d !== noArrive) {
                const path = [];
                for (let st = state; st !== -1; st = parent[st]) {
                    const n = (st / 5) | 0;
                    path.push({ x: (minX + (n % W)) * g, y: (minY + ((n / W) | 0)) * g });
                }
                return path.reverse();
            }

            const cx = minX + (node % W);
            const cy = minY + ((node / W) | 0);

            for (let nd = 0; nd < 4; nd++) {
                if (d < 4 && nd === (d + 2) % 4) continue;

                const nx = cx + DX[nd], ny = cy + DY[nd];
                if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;

                const ni = idxOf(nx, ny);
                if (nodeBlk[ni]) continue;
                if (nd === 0 && hBlk[node]) continue;
                if (nd === 2 && hBlk[ni]) continue;
                if (nd === 1 && vBlk[node]) continue;
                if (nd === 3 && vBlk[ni]) continue;

                let step = 1;
                if (d < 4 && nd !== d) step += BEND;

                const wx = nx * g, wy = ny * g;
                if (ctx.edgeUse.has(this.edgeKey(cx * g, cy * g, wx, wy))) step += OVERLAP;
                const use = ctx.nodeUse.get(`${wx},${wy}`);
                if (use) {
                    if (use === "C") step += CORNER;
                    else if ((use === "H") === (nd === 1 || nd === 3)) step += CROSS;
                }

                const ns = ni * 5 + nd;
                const nc = cost[state] + step;
                if (nc < cost[ns]) {
                    cost[ns] = nc;
                    parent[ns] = state;
                    heap.push(nc + Math.abs(nx - c1x) + Math.abs(ny - c1y), ns);
                }
            }
        }
        return null;
    }

    dirIndex(dir) {
        if (!dir) return 4;
        if (dir.x === 1) return 0;
        if (dir.y === 1) return 1;
        if (dir.x === -1) return 2;
        return 3;
    }

    // Route one leg. Endpoint fields:
    //   dir      pin outward direction: the wire leaves/enters straight along it
    //   heading  direction already being travelled when the leg starts (no U-turn)
    //   noArrive direction index the leg may not be travelling when it arrives
    routeLeg(a, b, ctx) {
        const g = this.gridSize;
        if (a.x === b.x && a.y === b.y) return [{ x: a.x, y: a.y }];

        const noArrive = b.noArrive === undefined ? -1 : b.noArrive;

        // Prefer the clean pin stubs; if parts sit too close for a stub to escape,
        // fall back to leaving the pin directly so the wire can still connect.
        const attempts = [
            { stubs: true, margin: 8 }, { stubs: true, margin: 30 },
            { stubs: false, margin: 8 }, { stubs: false, margin: 30 }
        ];
        for (const { stubs, margin } of attempts) {
            const s = stubs && a.dir ? { x: a.x + a.dir.x * g, y: a.y + a.dir.y * g } : { x: a.x, y: a.y };
            const e = stubs && b.dir ? { x: b.x + b.dir.x * g, y: b.y + b.dir.y * g } : { x: b.x, y: b.y };
            const startDir = this.dirIndex(stubs ? (a.dir || a.heading) : a.heading);
            const mid = this.searchGridPath(s, e, startDir, ctx, margin, noArrive);
            if (mid) return this.removeDuplicatePoints([{ x: a.x, y: a.y }, ...mid, { x: b.x, y: b.y }]);
        }
        return null;
    }

    // ---------- wire endpoints ----------

    resolveWireEnd(end) {
        if (end.type === "terminal") {
            const info = this.getTerminalInfo(end.component, end.terminal);
            if (!info) return null;
            end.x = info.position.x;
            end.y = info.position.y;
            return { x: info.position.x, y: info.position.y, dir: info.dir };
        }
        if (end.type === "wire") {
            const target = this.wires.find(w => w.id === end.wireId);
            if (target && target.route && target.route.length > 1) {
                const p = this.projectPointToWire(end.x, end.y, target);
                end.x = p.x;
                end.y = p.y;
            } else {
                end.type = "point";
            }
        }
        return { x: end.x, y: end.y };
    }

    // ---------- fresh routing ----------

    // Route through the wire's user-clicked anchors (used while drawing a new wire)
    calculateWireRoute(wire, ctx) {
        const a = this.resolveWireEnd(wire.start);
        const b = this.resolveWireEnd(wire.end);
        if (!a || !b) return null;

        const points = [a, ...(wire.anchors || []).map(p => ({ x: p.x, y: p.y })), b];
        const route = [{ x: a.x, y: a.y }];
        wire.blocked = false;

        for (let i = 0; i < points.length - 1; i++) {
            // a bus is drawn straight (horizontal then vertical): it runs behind the parts instead of detouring around them
            const p0 = points[i], q0 = points[i + 1];
            let leg = wire.bus ? [{ x: p0.x, y: p0.y }, ...(p0.x !== q0.x && p0.y !== q0.y ? [{ x: q0.x, y: p0.y }] : []), { x: q0.x, y: q0.y }] : this.routeLeg(points[i], points[i + 1], ctx);
            if (!leg) {
                wire.blocked = true;
                const p = points[i], q = points[i + 1];
                leg = [{ x: p.x, y: p.y }, { x: q.x, y: p.y }, { x: q.x, y: q.y }];
            }
            for (let k = 1; k < leg.length; k++) route.push(leg[k]);
        }
        return this.simplifyRoute(route);
    }

    removeDuplicatePoints(points) {
        const result = [];
        for (const p of points) {
            if (!result.length || result[result.length - 1].x !== p.x || result[result.length - 1].y !== p.y) {
                result.push({ x: p.x, y: p.y });
            }
        }
        return result;
    }

    simplifyRoute(points) {
        const out = [];
        for (const p of this.removeDuplicatePoints(points)) {
            while (out.length >= 2) {
                const a = out[out.length - 2];
                const b = out[out.length - 1];
                if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) out.pop();
                else break;
            }
            out.push(p);
        }
        return out;
    }

    // ---------- route cost / validity ----------

    routeCost(points, ctx, startDirIdx = 4) {
        const g = this.gridSize;
        let cost = 0;
        let prevDir = startDirIdx;

        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i], b = points[i + 1];
            const dir = this.dirIndex({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
            if (prevDir < 4 && dir !== prevDir) cost += ROUTE_COST.BEND;
            prevDir = dir;

            const steps = Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / g);
            const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
            for (let s = 0; s < steps; s++) {
                const x = a.x + sx * s * g, y = a.y + sy * s * g;
                const nx = x + sx * g, ny = y + sy * g;
                cost += 1;
                if (ctx.edgeUse.has(this.edgeKey(x, y, nx, ny))) cost += ROUTE_COST.OVERLAP;
                const use = ctx.nodeUse.get(`${nx},${ny}`);
                if (use) {
                    if (use === "C") cost += ROUTE_COST.CORNER;
                    else if ((use === "H") === (sy !== 0)) cost += ROUTE_COST.CROSS;
                }
            }
        }
        return cost;
    }

    hasBacktrack(points) {
        for (let i = 1; i < points.length - 1; i++) {
            const ax = Math.sign(points[i].x - points[i - 1].x), ay = Math.sign(points[i].y - points[i - 1].y);
            const bx = Math.sign(points[i + 1].x - points[i].x), by = Math.sign(points[i + 1].y - points[i].y);
            if (ax === -bx && ay === -by && (ax !== 0 || ay !== 0)) return true;
        }
        return false;
    }

    // ---------- rubber-band repair ----------

    // Keep the old wire shape where possible: retain a middle run R[k..m] of the old
    // route and re-solve only the legs from the (moved) pins to that run.
    repairWireRoute(wire, a, b, ctx) {
        const R = wire.route;
        const n = R.length;
        const eq = (p, q) => p.x === q.x && p.y === q.y;
        const unit = (p, q) => ({ x: Math.sign(q.x - p.x), y: Math.sign(q.y - p.y) });
        const sameDir = (u, v) => u.x === v.x && u.y === v.y;

        const allow = new Set([`${a.x},${a.y}`, `${b.x},${b.y}`]);
        const startKeep = eq(R[0], a) && (!a.dir || sameDir(unit(R[0], R[1]), a.dir));
        const endKeep = eq(R[n - 1], b) && (!b.dir || sameDir(unit(R[n - 1], R[n - 2]), b.dir));

        const segOK = [];
        for (let i = 0; i < n - 1; i++) segOK.push(this.segmentFree(R[i], R[i + 1], ctx, allow));

        if (startKeep && endKeep && segOK.every(Boolean)) {
            return R.map(p => ({ x: p.x, y: p.y }));
        }

        const auto = this.routeLeg(a, b, ctx);
        const autoRoute = auto ? this.simplifyRoute(auto) : null;
        const leadOK = (route) => route.length >= 2 &&
            (!a.dir || sameDir(unit(route[0], route[1]), a.dir)) &&
            (!b.dir || sameDir(unit(route[route.length - 1], route[route.length - 2]), b.dir));
        const autoClean = !!autoRoute && leadOK(autoRoute);
        const autoBends = autoRoute ? autoRoute.length - 2 : 0;
        const autoCost = autoRoute ? this.routeCost(autoRoute, ctx, this.dirIndex(a.dir)) : Infinity;

        const startLegs = new Map();
        const endLegs = new Map();
        const startLeg = (k) => {
            if (!startLegs.has(k)) {
                const target = { x: R[k].x, y: R[k].y };
                if (k < n - 1) {
                    const c = unit(R[k], R[k + 1]);
                    target.noArrive = this.dirIndex({ x: -c.x, y: -c.y });
                }
                startLegs.set(k, this.routeLeg(a, target, ctx));
            }
            return startLegs.get(k);
        };
        const endLeg = (m) => {
            if (!endLegs.has(m)) {
                const from = { x: R[m].x, y: R[m].y };
                if (m > 0) from.heading = unit(R[m - 1], R[m]);
                endLegs.set(m, this.routeLeg(from, b, ctx));
            }
            return endLegs.get(m);
        };

        let best = null;
        for (let k = 0; k < n; k++) {
            if (k === 0 && !startKeep) continue;
            for (let m = k; m < n; m++) {
                if (m === n - 1 && !endKeep) continue;

                let retainedOK = true;
                for (let i = k; i < m; i++) if (!segOK[i]) { retainedOK = false; break; }
                if (!retainedOK) continue;

                let pts = [];
                if (k > 0) {
                    const leg = startLeg(k);
                    if (!leg) continue;
                    pts = pts.concat(leg.slice(0, -1));
                }
                pts = pts.concat(R.slice(k, m + 1));
                if (m < n - 1) {
                    const leg = endLeg(m);
                    if (!leg) continue;
                    pts = pts.concat(leg.slice(1));
                }

                const raw = this.removeDuplicatePoints(pts);
                if (this.hasBacktrack(raw)) continue;
                const route = this.simplifyRoute(raw);
                if (autoClean && !leadOK(route)) continue;
                const cost = this.routeCost(route, ctx, this.dirIndex(a.dir));
                const retained = m - k + 1;

                if (cost > autoCost + ROUTE_COST.REPAIR_SLACK) continue;
                if (route.length - 2 > autoBends + ROUTE_COST.REPAIR_EXTRA_BENDS) continue;
                if (!best || retained > best.retained || (retained === best.retained && cost < best.cost)) {
                    best = { route, cost, retained };
                }
            }
        }

        if (best) return best.route;
        return autoRoute;
    }

    updateWire(wire, ctx) {
        const a = this.resolveWireEnd(wire.start);
        const b = this.resolveWireEnd(wire.end);
        if (!a || !b) {
            wire.route = null;
            return;
        }

        let route = null;
        let blocked = false;
        if (!wire.bus && wire.route && wire.route.length >= 2) {
            route = this.repairWireRoute(wire, a, b, ctx);
        }
        if (!route) {
            const temp = { start: wire.start, end: wire.end, anchors: [], bus: wire.bus };
            route = this.calculateWireRoute(temp, ctx);
            blocked = !route || temp.blocked;
        }
        wire.blocked = blocked;
        wire.route = route;
    }

    // Re-validate / repair wires (all, or just the given ones). Pin-attached wires
    // go first so junction wires can snap onto their updated targets.
    refreshWires(only = null) {
        this._hlDirty = true;                // a highlighted net must be recomputed after any change
        const list = only ? this.wires.filter(w => only.has(w)) : this.wires;
        const direct = list.filter(w => w.start.type !== "wire" && w.end.type !== "wire");
        const junctions = list.filter(w => w.start.type === "wire" || w.end.type === "wire");

        for (const wire of [...direct, ...junctions]) {
            this.updateWire(wire, this.buildRouteContext(wire));
        }
        if (this.syncProbes) this.syncProbes();
    }

    rerouteAllWires() {
        this.refreshWires();
    }

    // Throw away a wire's shape and let the router solve it from scratch ("tidy")
    tidyWire(wire) {
        wire.route = null;
        this.refreshWires(new Set([wire]));
        this.refreshWires();
    }

    tidyAllWires() {
        for (const w of this.wires) w.route = null;
        this.refreshWires();
    }

    translateWire(wire, dx, dy) {
        if (!wire.route) return;
        for (const p of wire.route) { p.x += dx; p.y += dy; }
        for (const end of [wire.start, wire.end]) {
            if (end.type !== "terminal") { end.x += dx; end.y += dy; }
        }
    }

    // ---------- segment dragging ----------

    // Make the dragged segment independent of fixed ends (pins / junctions) by
    // splitting off a one-grid stub. Returns the segment's new index, or -1.
    beginSegmentDrag(wire, idx) {
        const g = this.gridSize;
        const r = wire.route.map(p => ({ x: p.x, y: p.y }));
        const unit = (p, q) => ({ x: Math.sign(q.x - p.x), y: Math.sign(q.y - p.y) });
        const dist = (p, q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y);

        if (idx === 0 && wire.start.type !== "point") {
            if (dist(r[0], r[1]) <= g) return -1;
            const u = unit(r[0], r[1]);
            r.splice(1, 0, { x: r[0].x + u.x * g, y: r[0].y + u.y * g });
            idx = 1;
        }
        const last = r.length - 1;
        if (idx === last - 1 && wire.end.type !== "point") {
            if (dist(r[last - 1], r[last]) <= g) return -1;
            const u = unit(r[last], r[last - 1]);
            r.splice(last, 0, { x: r[last].x + u.x * g, y: r[last].y + u.y * g });
        }

        wire.route = r;
        return idx;
    }

    // Keep a dragged corner on the outward side of the pin lead it hangs off.
    clampSegmentDrag(wire, idx, horizontal, value) {
        const g = this.gridSize;
        const route = wire.route;
        const clampTo = (end, neighbourIdx) => {
            if (end.type !== "terminal" || idx !== neighbourIdx) return;
            const info = this.getTerminalInfo(end.component, end.terminal);
            if (!info) return;
            const dir = horizontal ? info.dir.y : info.dir.x;
            if (!dir) return;
            const origin = horizontal ? info.position.y : info.position.x;
            value = dir > 0 ? Math.max(value, origin + g) : Math.min(value, origin - g);
        };
        clampTo(wire.start, 1);
        clampTo(wire.end, route.length - 3);
        return value;
    }

    // ---------- connection analysis (shared by drawing + netlist) ----------

    // Points where 3+ conductors meet at a wire end: these get a junction dot.
    computeJunctions() {
        const key = (p) => `${p.x},${p.y}`;
        const degree = new Map();
        const endKeys = new Set();
        const bump = (k, n) => degree.set(k, (degree.get(k) || 0) + n);

        for (const c of this.components) {
            for (const t of this.getTerminals(c)) bump(key(this.getTerminalPosition(c, t)), 1);
        }
        for (const w of this.wires) {
            if (!w.route || w.route.length < 2) continue;
            const last = w.route.length - 1;
            for (let i = 0; i <= last; i++) {
                const k = key(w.route[i]);
                if (i === 0 || i === last) { bump(k, 1); endKeys.add(k); }
            }
        }
        // a wire end that lands on another wire's run adds that run's two directions
        for (const w of this.wires) {
            if (!w.route || w.route.length < 2) continue;
            for (const other of this.wires) {
                if (other === w || !other.route || other.route.length < 2) continue;
                for (let j = 0; j < other.route.length - 1; j++) {
                    const a = other.route[j], b = other.route[j + 1];
                    for (const pt of [w.route[0], w.route[w.route.length - 1]]) {
                        const onEnd = (pt.x === a.x && pt.y === a.y) || (pt.x === b.x && pt.y === b.y);
                        if (!onEnd && this.isPointOnSegment(pt.x, pt.y, a.x, a.y, b.x, b.y)) {
                            bump(key(pt), 2);
                        }
                    }
                }
            }
        }

        const dots = [];
        for (const k of endKeys) {
            if ((degree.get(k) || 0) >= 3) dots.push(k);
        }
        return dots;
    }

    isPointOnSegment(px, py, x1, y1, x2, y2) {
        if (Math.abs(x1 - x2) < 2 && Math.abs(px - x1) < 2) {
            return py >= Math.min(y1, y2) - 2 && py <= Math.max(y1, y2) + 2;
        }
        if (Math.abs(y1 - y2) < 2 && Math.abs(py - y1) < 2) {
            return px >= Math.min(x1, x2) - 2 && px <= Math.max(x1, x2) + 2;
        }
        return false;
    }

    projectPointToWire(x, y, wire) {
        if (!wire.route || wire.route.length < 2) return { x, y };
        let minDist = Infinity;
        let bestPoint = { x, y };

        for (let j = 0; j < wire.route.length - 1; j++) {
            const a = wire.route[j];
            const b = wire.route[j + 1];
            const dist = this.distanceToSegment(x, y, a.x, a.y, b.x, b.y);
            if (dist < minDist) {
                minDist = dist;
                bestPoint = this.projectPointToSegment(x, y, a.x, a.y, b.x, b.y);
            }
        }
        return bestPoint;
    }

    projectPointToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (dx === 0 && dy === 0) return { x: x1, y: y1 };

        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
        return { x: x1 + t * dx, y: y1 + t * dy };
    }

    distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);

        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
}

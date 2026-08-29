class SchematicEditor {

    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");

        this.gridSize = 20;

        this.components = [];
        this.wires = [];
        this.probes = [];

        this.selected = null;
        this.selectedWire = null;

        this.tool = "select";

        this.dragging = false;
        this.draggingWire = false;
        this.draggingWireTarget = null; // { wire, type: 'segment' | 'waypoint', index }

        this.isPanning = false;

        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        // Viewport Pan
        this.panX = 0;
        this.panY = 0;
        this.panStart = { x: 0, y: 0 };
        this.isSpacePressed = false;

        this.clipboard = null;

        // History Stacks
        this.historyStack = [];
        this.futureStack = [];

        // Wiring state
        this.wiring = false;
        this.wireStart = null;
        this.wireWaypoints = [];
        this.hoverSnap = null;

        this.mouse = { x: 0, y: 0 };
        this.nextId = 1;

        this.resize();

        window.addEventListener("resize", () => {
            this.resize();
        });

        canvas.addEventListener("pointerdown", e => {
            this.pointerDown(e);
        });

        canvas.addEventListener("pointermove", e => {
            this.pointerMove(e);
        });

        canvas.addEventListener("pointerup", e => {
            this.pointerUp(e);
        });

        canvas.addEventListener("pointerleave", e => {
            this.pointerUp(e);
        });

        canvas.addEventListener("contextmenu", e => {
            e.preventDefault();
            if (this.wiring) {
                this.cancelWire();
                return;
            }

            const pos = this.getMousePosition(e);
            const comp = this.findComponent(pos.x, pos.y);
            if (comp) {
                this.selected = comp;
                this.selectedWire = null;
            } else {
                const wireHit = this.findWire(pos.x, pos.y);
                if (wireHit) {
                    this.selectedWire = wireHit.wire;
                    this.selected = null;
                }
            }
            this.draw();

            if (typeof window.showContextMenu === "function") {
                window.showContextMenu(e);
            }
        });

        document.addEventListener("keydown", e => {
            if (e.code === "Space" && !this.isSpacePressed) {
                const active = document.activeElement;
                if (!active || (active.tagName !== "INPUT" && active.tagName !== "SELECT" && active.tagName !== "TEXTAREA")) {
                    this.isSpacePressed = true;
                    this.canvas.style.cursor = "grab";
                }
            }
            this.keyDown(e);
        });

        document.addEventListener("keyup", e => {
            if (e.code === "Space") {
                this.isSpacePressed = false;
                this.canvas.style.cursor = this.tool === "select" ? "default" : "crosshair";
            }
        });

        this.draw();
    }


    // ============================================================
    // UNDO / REDO HISTORY SYSTEM
    // ============================================================

    saveState() {
        const snapshot = JSON.stringify({
            components: this.components,
            wires: this.wires,
            probes: this.probes,
            nextId: this.nextId,
            panX: this.panX,
            panY: this.panY
        });

        if (this.historyStack.length > 0 && this.historyStack[this.historyStack.length - 1] === snapshot) {
            return;
        }

        this.historyStack.push(snapshot);
        if (this.historyStack.length > 50) this.historyStack.shift();

        this.futureStack = [];
    }

    undo() {
        if (this.historyStack.length === 0) return;

        const currentSnapshot = JSON.stringify({
            components: this.components,
            wires: this.wires,
            probes: this.probes,
            nextId: this.nextId,
            panX: this.panX,
            panY: this.panY
        });
        this.futureStack.push(currentSnapshot);

        const previousSnapshot = this.historyStack.pop();
        const state = JSON.parse(previousSnapshot);

        this.components = state.components;
        this.wires = state.wires;
        this.probes = state.probes;
        this.nextId = state.nextId;
        this.panX = state.panX || 0;
        this.panY = state.panY || 0;

        this.selected = null;
        this.selectedWire = null;
        this.cancelWire();
        this.rerouteAllWires();
        this.draw();
    }

    redo() {
        if (this.futureStack.length === 0) return;

        const currentSnapshot = JSON.stringify({
            components: this.components,
            wires: this.wires,
            probes: this.probes,
            nextId: this.nextId,
            panX: this.panX,
            panY: this.panY
        });
        this.historyStack.push(currentSnapshot);

        const nextSnapshot = this.futureStack.pop();
        const state = JSON.parse(nextSnapshot);

        this.components = state.components;
        this.wires = state.wires;
        this.probes = state.probes;
        this.nextId = state.nextId;
        this.panX = state.panX || 0;
        this.panY = state.panY || 0;

        this.selected = null;
        this.selectedWire = null;
        this.cancelWire();
        this.rerouteAllWires();
        this.draw();
    }


    // ============================================================
    // COPY & PASTE
    // ============================================================

    copySelected() {
        if (!this.selected) return null;

        this.clipboard = {
            type: this.selected.type,
            value: this.selected.value,
            rotation: this.selected.rotation,
            sourceType: this.selected.sourceType,
            dcVoltage: this.selected.dcVoltage,
            dcOffset: this.selected.dcOffset,
            acMagnitude: this.selected.acMagnitude,
            acPhase: this.selected.acPhase,
            frequency: this.selected.frequency
        };

        return this.selected;
    }

    paste() {
        if (!this.clipboard) return null;

        this.saveState();

        let targetX = 200;
        let targetY = 200;

        if (this.mouse.x > 0 && this.mouse.y > 0) {
            targetX = this.snap(this.mouse.x);
            targetY = this.snap(this.mouse.y);
        } else if (this.selected) {
            targetX = this.selected.x + 40;
            targetY = this.selected.y + 40;
        }

        const newComp = this.addComponent(this.clipboard.type, targetX, targetY);
        newComp.value = this.clipboard.value;
        newComp.rotation = this.clipboard.rotation;

        if (this.clipboard.type === "V") {
            newComp.sourceType = this.clipboard.sourceType;
            newComp.dcVoltage = this.clipboard.dcVoltage;
            newComp.dcOffset = this.clipboard.dcOffset;
            newComp.acMagnitude = this.clipboard.acMagnitude;
            newComp.acPhase = this.clipboard.acPhase;
            newComp.frequency = this.clipboard.frequency;
        }

        this.selected = newComp;
        this.selectedWire = null;
        this.draw();
        return newComp;
    }


    // ============================================================
    // GEOMETRY & VIEWPORT PANNING
    // ============================================================

    snap(value) {
        return Math.round(value / this.gridSize) * this.gridSize;
    }

    getMousePosition(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left - this.panX,
            y: event.clientY - rect.top - this.panY,
            screenX: event.clientX - rect.left,
            screenY: event.clientY - rect.top
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


    // ============================================================
    // TOOLS & PROBES
    // ============================================================

    setTool(tool) {
        this.cancelWire();
        this.tool = tool;

        this.canvas.style.cursor = tool === "select" ? "default" : "crosshair";
        this.draw();
    }

    cancelWire() {
        this.wiring = false;
        this.wireStart = null;
        this.wireWaypoints = [];
        this.draw();
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
            y: snap.y
        };
        this.probes.push(probe);
        this.draw();
        return probe;
    }

    addCurrentProbe(component) {
        this.saveState();
        const count = this.probes.filter(p => p.type === 'I').length + 1;
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
    // COMPONENTS & BOUNDING BOXES
    // ============================================================

    addComponent(type, x, y) {
        const count = this.components.filter(c => c.type === type).length + 1;

        let defaultValue = "";
        if (type === "R") defaultValue = "4.7 kΩ";
        else if (type === "C") defaultValue = "10 µF";
        else if (type === "L") defaultValue = "10 mH";
        else if (type === "V") defaultValue = "5 V";

        const component = {
            id: this.nextId++,
            type,
            name: type === "GND" ? "GND" : `${type}${count}`,
            x: this.snap(x),
            y: this.snap(y),
            rotation: 0,
            value: defaultValue,
            sourceType: type === "V" ? "DC" : undefined,
            dcVoltage: type === "V" ? 5 : undefined,
            dcOffset: type === "V" ? 0 : undefined,
            acMagnitude: type === "V" ? 5 : undefined,
            acPhase: type === "V" ? 0 : undefined,
            frequency: type === "V" ? 1000 : undefined
        };

        this.components.push(component);

        this.selected = component;
        this.selectedWire = null;

        this.rerouteAllWires();
        this.draw();

        return component;
    }

    getComponentWidth(component) {
        return component.type === "GND" ? 40 : 100;
    }

    getComponentHeight(component) {
        return component.type === "GND" ? 50 : 60;
    }

    getComponentBoundingBox(component, clearance = 0) {
        const width = this.getComponentWidth(component);
        const height = this.getComponentHeight(component);
        const rotated = component.rotation === 90 || component.rotation === 270;

        const w = (rotated ? height : width) / 2 + clearance;
        const h = (rotated ? width : height) / 2 + clearance;

        return {
            x1: component.x - w,
            x2: component.x + w,
            y1: component.y - h,
            y2: component.y + h
        };
    }

    getComponentObstacleBox(component) {
        const rotated = component.rotation === 90 || component.rotation === 270;
        const hw = rotated ? 50 : 70;
        const hh = rotated ? 70 : 50;

        return {
            x1: component.x - hw,
            x2: component.x + hw,
            y1: component.y - hh,
            y2: component.y + hh
        };
    }

    findComponent(x, y) {
        for (let i = this.components.length - 1; i >= 0; i--) {
            const component = this.components[i];
            const box = this.getComponentBoundingBox(component, 0);

            if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) {
                return component;
            }
        }
        return null;
    }

    getTerminals(component) {
        switch (component.type) {
            case "R":
            case "C":
            case "L":
            case "V":
                return [
                    { name: "1", x: -40, y: 0 },
                    { name: "2", x: 40, y: 0 }
                ];
            case "GND":
                return [
                    { name: "1", x: 0, y: -15 }
                ];
            default:
                return [];
        }
    }

    getTerminalPosition(component, terminal) {
        const angle = (component.rotation * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        return {
            x: component.x + terminal.x * cos - terminal.y * sin,
            y: component.y + terminal.x * sin + terminal.y * cos
        };
    }

    findTerminal(x, y) {
        const tolerance = 16;

        for (let i = this.components.length - 1; i >= 0; i--) {
            const component = this.components[i];
            for (const terminal of this.getTerminals(component)) {
                const p = this.getTerminalPosition(component, terminal);
                if (Math.hypot(x - p.x, y - p.y) <= tolerance) {
                    return {
                        component,
                        terminal,
                        x: p.x,
                        y: p.y
                    };
                }
            }
        }
        return null;
    }

    getTerminalInfo(componentId, terminalName) {
        const component = this.components.find(c => c.id === componentId);
        if (!component) return null;

        const terminal = this.getTerminals(component).find(t => t.name === terminalName);
        if (!terminal) return null;

        return {
            component,
            terminal,
            position: this.getTerminalPosition(component, terminal)
        };
    }


    // ============================================================
    // CAD SNAP DETECTION
    // ============================================================

    findSnapTarget(x, y) {
        const term = this.findTerminal(x, y);
        if (term) {
            return {
                type: "terminal",
                component: term.component,
                terminal: term.terminal,
                x: term.x,
                y: term.y
            };
        }

        const wireHit = this.findWire(x, y);
        if (wireHit) {
            const pointOnWire = this.projectPointToWire(x, y, wireHit.wire);
            return {
                type: "wire",
                wire: wireHit.wire,
                x: this.snap(pointOnWire.x),
                y: this.snap(pointOnWire.y)
            };
        }

        return {
            type: "grid",
            x: this.snap(x),
            y: this.snap(y)
        };
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


    // ============================================================
    // OBSTACLE ROUTING & WIRE SEPARATION ENGINE
    // ============================================================

    lineIntersectsBox(p1, p2, box) {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);

        if (maxX <= box.x1 || minX >= box.x2 || maxY <= box.y1 || minY >= box.y2) {
            return false;
        }

        if (p1.x === p2.x) {
            return p1.x > box.x1 && p1.x < box.x2 && maxY > box.y1 && minY < box.y2;
        }
        if (p1.y === p2.y) {
            return p1.y > box.y1 && p1.y < box.y2 && maxX > box.x1 && minX < box.x2;
        }

        const pointInside = (x, y) => x > box.x1 && x < box.x2 && y > box.y1 && y < box.y2;
        return pointInside(p1.x, p1.y) || pointInside(p2.x, p2.y);
    }

    getComponentBodyBox(component) {
        const rotated = component.rotation === 90 || component.rotation === 270;
        const hw = rotated ? 20 : 30;
        const hh = rotated ? 30 : 20;

        return {
            x1: component.x - hw,
            x2: component.x + hw,
            y1: component.y - hh,
            y2: component.y + hh
        };
    }

    getTerminalPinStub(component, terminal, stubLength = 20) {
        const angle = (component.rotation * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        let dirX = Math.sign(terminal.x) || -1;
        let dirY = Math.sign(terminal.y);

        const rotatedDirX = dirX * cos - dirY * sin;
        const rotatedDirY = dirX * sin + dirY * cos;

        const pos = this.getTerminalPosition(component, terminal);

        return {
            x: pos.x + rotatedDirX * stubLength,
            y: pos.y + rotatedDirY * stubLength
        };
    }

    isSegmentBlocked(p1, p2, sourceComp, destComp, targetWire = null) {
        for (const comp of this.components) {
            const bodyBox = this.getComponentBodyBox(comp);

            if (this.lineIntersectsBox(p1, p2, bodyBox)) {
                return true;
            }
        }

        for (const existingWire of this.wires) {
            if (existingWire === targetWire || !existingWire.route || existingWire.route.length < 2) continue;

            for (let i = 0; i < existingWire.route.length - 1; i++) {
                const ep1 = existingWire.route[i];
                const ep2 = existingWire.route[i + 1];

                if (p1.y === p2.y && ep1.y === ep2.y && Math.abs(p1.y - ep1.y) < 1) {
                    const min1 = Math.min(p1.x, p2.x);
                    const max1 = Math.max(p1.x, p2.x);
                    const min2 = Math.min(ep1.x, ep2.x);
                    const max2 = Math.max(ep1.x, ep2.x);

                    if (Math.max(min1, min2) < Math.min(max1, max2)) {
                        return true;
                    }
                }

                if (p1.x === p2.x && ep1.x === ep2.x && Math.abs(p1.x - ep1.x) < 1) {
                    const min1 = Math.min(p1.y, p2.y);
                    const max1 = Math.max(p1.y, p2.y);
                    const min2 = Math.min(ep1.y, ep2.y);
                    const max2 = Math.max(ep1.y, ep2.y);

                    if (Math.max(min1, min2) < Math.min(max1, max2)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    calculateWireRoute(wire) {
        let startPos = null;
        let endPos = null;
        let startStub = null;
        let endStub = null;
        let sourceComp = null;
        let destComp = null;

        if (wire.start.type === "terminal" || wire.start.component) {
            const info = this.getTerminalInfo(wire.start.component, wire.start.terminal);
            if (info) {
                startPos = info.position;
                sourceComp = info.component;
                startStub = this.getTerminalPinStub(info.component, info.terminal, 20);
                wire.start.x = startPos.x;
                wire.start.y = startPos.y;
            }
        } else {
            startPos = { x: wire.start.x, y: wire.start.y };
            startStub = startPos;
        }

        if (wire.end.type === "terminal" || wire.end.component) {
            const info = this.getTerminalInfo(wire.end.component, wire.end.terminal);
            if (info) {
                endPos = info.position;
                destComp = info.component;
                endStub = this.getTerminalPinStub(info.component, info.terminal, 20);
                wire.end.x = endPos.x;
                wire.end.y = endPos.y;
            }
        } else {
            endPos = { x: wire.end.x, y: wire.end.y };
            endStub = endPos;
        }

        if (!startPos || !endPos) return null;

        // PRESERVE USER-DRAWN INTERMEDIATE WAYPOINTS ACROSS LAYOUT/ROTATION/ALIGNMENT
        if (wire.userWaypoints && wire.userWaypoints.length >= 3) {
            const fullRoute = [startPos];
            if (startStub && (startStub.x !== startPos.x || startStub.y !== startPos.y)) {
                fullRoute.push(startStub);
            }

            const firstUserPoint = wire.userWaypoints[1];
            const startLink = this.findObstacleFreePath(startStub || startPos, firstUserPoint, sourceComp, null, wire);
            if (startLink && startLink.length >= 2) {
                for (let k = 1; k < startLink.length; k++) {
                    fullRoute.push(startLink[k]);
                }
            } else {
                fullRoute.push(firstUserPoint);
            }

            for (let i = 1; i < wire.userWaypoints.length - 2; i++) {
                const ptA = wire.userWaypoints[i];
                const ptB = wire.userWaypoints[i + 1];
                const midLink = this.findObstacleFreePath(ptA, ptB, null, null, wire);
                if (midLink && midLink.length >= 2) {
                    for (let k = 1; k < midLink.length; k++) {
                        fullRoute.push(midLink[k]);
                    }
                } else {
                    fullRoute.push(ptB);
                }
            }

            const lastUserPoint = wire.userWaypoints[wire.userWaypoints.length - 2];
            const endLink = this.findObstacleFreePath(lastUserPoint, endStub || endPos, null, destComp, wire);
            if (endLink && endLink.length >= 2) {
                for (let k = 1; k < endLink.length; k++) {
                    fullRoute.push(endLink[k]);
                }
            } else {
                fullRoute.push(endStub || endPos);
            }

            if (endStub && (endStub.x !== endPos.x || endStub.y !== endPos.y)) {
                fullRoute.push(endPos);
            }

            return this.removeDuplicatePoints(fullRoute);
        }

        // Auto-route between stubs if no custom waypoints
        const pathFromStubs = this.findObstacleFreePath(startStub, endStub, sourceComp, destComp, wire);
        if (!pathFromStubs) return [startPos, endPos];

        const fullRoute = [startPos];
        for (const pt of pathFromStubs) {
            fullRoute.push(pt);
        }
        fullRoute.push(endPos);

        return this.removeDuplicatePoints(fullRoute);
    }

    findObstacleFreePath(start, end, sourceComp, destComp, targetWire = null) {
        const midHV = { x: end.x, y: start.y };
        if (!this.isSegmentBlocked(start, midHV, sourceComp, destComp, targetWire) &&
            !this.isSegmentBlocked(midHV, end, sourceComp, destComp, targetWire)) {
            return this.removeDuplicatePoints([start, midHV, end]);
        }

        const midVH = { x: start.x, y: end.y };
        if (!this.isSegmentBlocked(start, midVH, sourceComp, destComp, targetWire) &&
            !this.isSegmentBlocked(midVH, end, sourceComp, destComp, targetWire)) {
            return this.removeDuplicatePoints([start, midVH, end]);
        }

        const xCandidates = new Set([this.snap(start.x), this.snap(end.x)]);
        const yCandidates = new Set([this.snap(start.y), this.snap(end.y)]);

        for (const comp of this.components) {
            const box = this.getComponentObstacleBox(comp);
            xCandidates.add(this.snap(box.x1 - 20));
            xCandidates.add(this.snap(box.x2 + 20));
            yCandidates.add(this.snap(box.y1 - 20));
            yCandidates.add(this.snap(box.y2 + 20));
        }

        xCandidates.add(this.snap(start.x - 20));
        xCandidates.add(this.snap(start.x + 20));
        yCandidates.add(this.snap(start.y - 20));
        yCandidates.add(this.snap(start.y + 20));

        const xList = Array.from(xCandidates).sort((a, b) => a - b);
        const yList = Array.from(yCandidates).sort((a, b) => a - b);

        const path = this.searchCandidateGrid(start, end, xList, yList, sourceComp, destComp, targetWire);
        if (path && path.length >= 2) {
            return path;
        }

        const detourY = Math.min(...Array.from(yCandidates)) - 40;
        return this.removeDuplicatePoints([
            start,
            { x: start.x, y: detourY },
            { x: end.x, y: detourY },
            end
        ]);
    }

    searchCandidateGrid(start, end, xList, yList, sourceComp, destComp, targetWire = null) {
        const keyOf = (p) => `${p.x},${p.y}`;
        const startKey = keyOf(start);
        const endKey = keyOf(end);

        const open = new Map();
        const closed = new Set();

        open.set(startKey, { point: start, g: 0, f: Math.abs(start.x - end.x) + Math.abs(start.y - end.y), parent: null });

        let iterations = 0;
        while (open.size > 0 && iterations < 5000) {
            iterations++;

            let currentKey = null;
            let current = null;
            for (const [k, node] of open) {
                if (!current || node.f < current.f) {
                    current = node;
                    currentKey = k;
                }
            }

            if (currentKey === endKey) {
                const path = [];
                let curr = current;
                while (curr) {
                    path.push(curr.point);
                    curr = curr.parent;
                }
                path.reverse();
                return this.removeDuplicatePoints(path);
            }

            open.delete(currentKey);
            closed.add(currentKey);

            const neighbors = [];
            const currP = current.point;

            const xIdx = xList.indexOf(currP.x);
            if (xIdx > 0) neighbors.push({ x: xList[xIdx - 1], y: currP.y });
            if (xIdx >= 0 && xIdx < xList.length - 1) neighbors.push({ x: xList[xIdx + 1], y: currP.y });

            const yIdx = yList.indexOf(currP.y);
            if (yIdx > 0) neighbors.push({ x: currP.x, y: yList[yIdx - 1] });
            if (yIdx >= 0 && yIdx < yList.length - 1) neighbors.push({ x: currP.x, y: yList[yIdx + 1] });

            for (const n of neighbors) {
                const nKey = keyOf(n);
                if (closed.has(nKey)) continue;

                if (this.isSegmentBlocked(currP, n, sourceComp, destComp, targetWire)) continue;

                const dist = Math.abs(n.x - currP.x) + Math.abs(n.y - currP.y);
                const g = current.g + dist;
                const h = Math.abs(n.x - end.x) + Math.abs(n.y - end.y);
                const existing = open.get(nKey);

                if (!existing || g < existing.g) {
                    open.set(nKey, { point: n, g, f: g + h, parent: current });
                }
            }
        }

        return null;
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

    rerouteAllWires() {
        for (const wire of this.wires) {
            wire.route = this.calculateWireRoute(wire);
        }
    }


    // ============================================================
    // CLICK-TO-ANCHOR MULTI-SEGMENT WIRING
    // ============================================================

    startWire(snapTarget) {
        this.wiring = true;
        this.wireStart = snapTarget;
        this.wireWaypoints = [{ x: snapTarget.x, y: snapTarget.y }];
        this.selected = null;
        this.selectedWire = null;
        this.draw();
    }

    addWireWaypoint(snapTarget) {
        const last = this.wireWaypoints[this.wireWaypoints.length - 1];
        const nextPoint = { x: snapTarget.x, y: snapTarget.y };

        if (last.x !== nextPoint.x || last.y !== nextPoint.y) {
            const subPath = this.findObstacleFreePath(last, nextPoint, null, null);
            for (let i = 1; i < subPath.length; i++) {
                this.wireWaypoints.push(subPath[i]);
            }
        }
        this.draw();
    }

    finishWire(snapTarget) {
        if (!this.wiring || !this.wireStart) return;

        const start = this.wireStart;
        const end = snapTarget;

        if (start.type === "terminal" && end.type === "terminal") {
            if (start.component.id === end.component.id && start.terminal.name === end.terminal.name) {
                this.cancelWire();
                return;
            }
        }

        if (start.x === end.x && start.y === end.y && this.wireWaypoints.length <= 1) {
            this.cancelWire();
            return;
        }

        this.saveState();

        const sourceComp = start.type === "terminal" ? start.component : null;
        const destComp = end.type === "terminal" ? end.component : null;

        const finalWaypoints = [];
        for (let i = 0; i < this.wireWaypoints.length; i++) {
            if (i === 0) {
                finalWaypoints.push(this.wireWaypoints[0]);
            } else {
                const p1 = finalWaypoints[finalWaypoints.length - 1];
                const p2 = this.wireWaypoints[i];
                const subPath = this.findObstacleFreePath(p1, p2, sourceComp, destComp);
                for (let k = 1; k < subPath.length; k++) {
                    finalWaypoints.push(subPath[k]);
                }
            }
        }

        const lastWp = finalWaypoints[finalWaypoints.length - 1];
        if (lastWp.x !== end.x || lastWp.y !== end.y) {
            const endSubPath = this.findObstacleFreePath(lastWp, { x: end.x, y: end.y }, sourceComp, destComp);
            for (let k = 1; k < endSubPath.length; k++) {
                finalWaypoints.push(endSubPath[k]);
            }
        }

        const cleanRoute = this.removeDuplicatePoints(finalWaypoints);

        const newWire = {
            id: this.nextId++,
            start: this.formatWireEndpoint(start),
            end: this.formatWireEndpoint(end),
            route: cleanRoute,
            userWaypoints: cleanRoute.map(p => ({ x: p.x, y: p.y }))
        };

        this.wires.push(newWire);
        this.rerouteAllWires();

        this.wiring = false;
        this.wireStart = null;
        this.wireWaypoints = [];
        this.draw();
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

    formatWireEndpoint(snap) {
        if (snap.type === "terminal") {
            return {
                type: "terminal",
                component: snap.component.id,
                terminal: snap.terminal.name,
                x: snap.x,
                y: snap.y
            };
        } else if (snap.type === "wire") {
            return {
                type: "wire",
                wireId: snap.wire.id,
                x: snap.x,
                y: snap.y
            };
        } else {
            return {
                type: "point",
                x: snap.x,
                y: snap.y
            };
        }
    }


    // ============================================================
    // WIRE SEGMENT & WAYPOINT HIT TESTING
    // ============================================================

    findWire(x, y) {
        const hit = this.findWireTarget(x, y);
        return hit ? hit.wire : null;
    }

    findWireTarget(x, y) {
        const waypointTolerance = 10;
        const segmentTolerance = 8;

        for (let i = this.wires.length - 1; i >= 0; i--) {
            const wire = this.wires[i];
            if (!wire.route || wire.route.length < 2) continue;

            // 1. Waypoint Corner Handle Check
            for (let j = 0; j < wire.route.length; j++) {
                const pt = wire.route[j];
                if (Math.hypot(x - pt.x, y - pt.y) <= waypointTolerance) {
                    return { wire, type: "waypoint", index: j };
                }
            }

            // 2. Individual Edge Segment Check
            for (let j = 0; j < wire.route.length - 1; j++) {
                const a = wire.route[j];
                const b = wire.route[j + 1];

                if (this.distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= segmentTolerance) {
                    return { wire, type: "segment", index: j };
                }
            }
        }
        return null;
    }

    distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);

        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
        const cx = x1 + t * dx;
        const cy = y1 + t * dy;

        return Math.hypot(px - cx, py - cy);
    }


    // ============================================================
    // POINTER & KEYBOARD EVENTS (EDGE & WAYPOINT BEAUTIFYING)
    // ============================================================

    pointerDown(event) {
        const pos = this.getMousePosition(event);
        this.mouse = pos;

        if (event.button === 1 || (event.button === 0 && this.isSpacePressed)) {
            this.isPanning = true;
            this.panStart = { x: event.clientX, y: event.clientY };
            this.canvas.style.cursor = "grabbing";
            return;
        }

        if (event.button !== 0) return;

        if (this.tool === "vProbe") {
            this.addVoltageProbe(pos.x, pos.y);
            this.tool = "select";
            this.canvas.style.cursor = "default";
            return;
        }

        if (this.tool === "iProbe") {
            const component = this.findComponent(pos.x, pos.y);
            if (component && component.type !== "GND") {
                this.addCurrentProbe(component);
            }
            this.tool = "select";
            this.canvas.style.cursor = "default";
            return;
        }

        if (this.tool === "wire") {
            const snap = this.findSnapTarget(pos.x, pos.y);

            if (!this.wiring) {
                this.startWire(snap);
            } else {
                if (snap.type === "terminal" || snap.type === "wire") {
                    this.finishWire(snap);
                } else {
                    this.addWireWaypoint(snap);
                }
            }
            return;
        }

        if (this.tool !== "select") {
            this.addComponent(this.tool, pos.x, pos.y);
            this.tool = "select";
            this.canvas.style.cursor = "default";
            return;
        }

        const component = this.findComponent(pos.x, pos.y);
        if (component) {
            this.selected = component;
            this.selectedWire = null;
            this.dragging = true;
            this.dragOffsetX = pos.x - component.x;
            this.dragOffsetY = pos.y - component.y;
            this.draw();
            return;
        }

        const wireTarget = this.findWireTarget(pos.x, pos.y);
        if (wireTarget) {
            this.selectedWire = wireTarget.wire;
            this.selected = null;
            this.draggingWire = true;
            this.draggingWireTarget = wireTarget;
            this.dragOffsetX = pos.x;
            this.dragOffsetY = pos.y;
            this.draw();
            return;
        }

        this.selected = null;
        this.selectedWire = null;
        this.draw();
    }

    pointerMove(event) {
        if (this.isPanning) {
            const dx = event.clientX - this.panStart.x;
            const dy = event.clientY - this.panStart.y;
            this.panStart = { x: event.clientX, y: event.clientY };

            this.panX += dx;
            this.panY += dy;
            this.draw();
            return;
        }

        const pos = this.getMousePosition(event);
        this.mouse = pos;

        if (this.tool === "wire" || this.wiring) {
            this.hoverSnap = this.findSnapTarget(pos.x, pos.y);
            this.draw();
            return;
        }

        if (this.dragging && this.selected) {
            const newX = this.snap(pos.x - this.dragOffsetX);
            const newY = this.snap(pos.y - this.dragOffsetY);

            if (newX !== this.selected.x || newY !== this.selected.y) {
                this.selected.x = newX;
                this.selected.y = newY;
                this.rerouteAllWires();

                for (const prb of this.probes) {
                    if (prb.type === 'I' && prb.target === this.selected.id) {
                        prb.x = newX;
                        prb.y = newY - 35;
                    }
                }
                this.draw();
            }
            return;
        }

        // DRAG INDIVIDUAL EDGE SEGMENT OR WAYPOINT HANDLE
        if (this.draggingWire && this.selectedWire && this.draggingWireTarget) {
            const wire = this.selectedWire;
            const route = wire.route;
            if (!route || route.length < 2) return;

            const target = this.draggingWireTarget;

            if (target.type === "waypoint") {
                // Move single waypoint corner handle
                const idx = target.index;
                const newX = this.snap(pos.x);
                const newY = this.snap(pos.y);

                if (route[idx].x !== newX || route[idx].y !== newY) {
                    route[idx].x = newX;
                    route[idx].y = newY;
                    this.draw();
                }
            } else if (target.type === "segment") {
                // Move single edge segment parallel to its orientation
                const idx = target.index;
                const p1 = route[idx];
                const p2 = route[idx + 1];

                const isHorizontal = p1.y === p2.y;

                if (isHorizontal) {
                    const newY = this.snap(pos.y);
                    if (p1.y !== newY) {
                        p1.y = newY;
                        p2.y = newY;
                        this.draw();
                    }
                } else {
                    const newX = this.snap(pos.x);
                    if (p1.x !== newX) {
                        p1.x = newX;
                        p2.x = newX;
                        this.draw();
                    }
                }
            }
        }
    }

    pointerUp() {
        if (this.dragging || this.draggingWire) {
            this.saveState();
        }
        this.dragging = false;
        this.draggingWire = false;
        this.draggingWireTarget = null;

        if (this.isPanning) {
            this.isPanning = false;
            this.canvas.style.cursor = this.isSpacePressed ? "grab" : (this.tool === "select" ? "default" : "crosshair");
        }
    }

    keyDown(event) {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA")) {
            return;
        }

        const key = (event.key || "").toLowerCase();
        const code = event.code || "";
        const isCtrl = event.ctrlKey || event.metaKey;

        if (isCtrl && (key === "c" || code === "KeyC")) {
            event.preventDefault();
            this.copySelected();
            return;
        }

        if (isCtrl && (key === "v" || code === "KeyV")) {
            event.preventDefault();
            this.paste();
            return;
        }

        if (isCtrl && (key === "z" || code === "KeyZ")) {
            event.preventDefault();
            if (event.shiftKey) {
                this.redo();
            } else {
                this.undo();
            }
            return;
        }

        if (isCtrl && (key === "y" || code === "KeyY")) {
            event.preventDefault();
            this.redo();
            return;
        }

        if (key === "r" || code === "KeyR") {
            event.preventDefault();
            this.rotateSelected();
            return;
        }

        if (key === "escape" || code === "Escape") {
            this.cancelWire();
            this.setTool("select");
            return;
        }

        if (key === "delete" || key === "backspace" || code === "Delete" || code === "Backspace") {
            this.removeSelected();
            return;
        }
    }

    rotateSelected() {
        if (this.selected) {
            this.saveState();
            this.selected.rotation = (this.selected.rotation + 90) % 360;
            this.rerouteAllWires();
            this.draw();
        }
    }

    removeSelected() {
        if (this.selected) {
            this.saveState();
            const id = this.selected.id;
            this.components = this.components.filter(c => c.id !== id);

            this.wires = this.wires.filter(
                w =>
                    !(w.start.type === "terminal" && w.start.component === id) &&
                    !(w.end.type === "terminal" && w.end.component === id)
            );

            this.probes = this.probes.filter(p => !(p.type === 'I' && p.target === id));

            this.selected = null;
            this.rerouteAllWires();
            this.draw();
            return;
        }

        if (this.selectedWire) {
            this.saveState();
            this.wires = this.wires.filter(w => w !== this.selectedWire);
            this.selectedWire = null;
            this.rerouteAllWires();
            this.draw();
        }
    }


    // ============================================================
    // RENDERING STAGE: WIRES, HANDLES & CROSSING HOPS
    // ============================================================

    draw() {
        const ctx = this.ctx;

        ctx.clearRect(0, 0, this.width, this.height);

        ctx.save();
        ctx.translate(this.panX, this.panY);

        this.drawGrid();
        this.drawWires();
        this.drawWirePreview();
        this.drawComponents();
        this.drawProbes();
        this.drawSnapHighlight();

        ctx.restore();
    }

    drawGrid() {
        const ctx = this.ctx;
        ctx.fillStyle = "#202633";

        const startX = Math.floor(-this.panX / this.gridSize) * this.gridSize - this.gridSize;
        const endX = startX + this.width + 2 * this.gridSize;

        const startY = Math.floor(-this.panY / this.gridSize) * this.gridSize - this.gridSize;
        const endY = startY + this.height + 2 * this.gridSize;

        for (let x = startX; x < endX; x += this.gridSize) {
            for (let y = startY; y < endY; y += this.gridSize) {
                ctx.fillRect(x - 1, y - 1, 2, 2);
            }
        }
    }

    drawWires() {
        const ctx = this.ctx;

        const pointCounts = new Map();
        const recordPoint = (p) => {
            const key = `${Math.round(p.x)},${Math.round(p.y)}`;
            pointCounts.set(key, (pointCounts.get(key) || 0) + 1);
        };

        const horizontalSegments = [];
        const verticalSegments = [];
        const junctionPoints = new Set();

        for (const wireA of this.wires) {
            if (!wireA.route || wireA.route.length < 2) continue;

            const endPoints = [wireA.route[0], wireA.route[wireA.route.length - 1]];
            for (const pt of endPoints) {
                for (const wireB of this.wires) {
                    if (wireA === wireB || !wireB.route || wireB.route.length < 2) continue;

                    for (let j = 0; j < wireB.route.length - 1; j++) {
                        const a = wireB.route[j];
                        const b = wireB.route[j + 1];

                        if (this.isPointOnSegment(pt.x, pt.y, a.x, a.y, b.x, b.y)) {
                            junctionPoints.add(`${Math.round(pt.x)},${Math.round(pt.y)}`);
                        }
                    }
                }
            }
        }

        for (const wire of this.wires) {
            if (!wire.route || wire.route.length < 2) continue;

            const isSelected = wire === this.selectedWire;

            for (let i = 0; i < wire.route.length - 1; i++) {
                const p1 = wire.route[i];
                const p2 = wire.route[i + 1];

                recordPoint(p1);
                if (i === wire.route.length - 2) recordPoint(p2);

                if (p1.y === p2.y) {
                    horizontalSegments.push({ wire, p1, p2, minX: Math.min(p1.x, p2.x), maxX: Math.max(p1.x, p2.x), y: p1.y, isSelected });
                } else if (p1.x === p2.x) {
                    verticalSegments.push({ wire, p1, p2, minY: Math.min(p1.y, p2.y), maxY: Math.max(p1.y, p2.y), x: p1.x, isSelected });
                }
            }
        }

        const crossingHops = new Map();

        for (const hSeg of horizontalSegments) {
            for (const vSeg of verticalSegments) {
                if (hSeg.wire === vSeg.wire) continue;

                const crossKey = `${Math.round(vSeg.x)},${Math.round(hSeg.y)}`;
                if (junctionPoints.has(crossKey)) continue;

                if (vSeg.x > hSeg.minX && vSeg.x < hSeg.maxX && hSeg.y > vSeg.minY && hSeg.y < vSeg.maxY) {
                    const count = pointCounts.get(crossKey) || 0;

                    if (count < 3) {
                        crossingHops.set(crossKey, { x: vSeg.x, y: hSeg.y });
                    }
                }
            }
        }

        for (const wire of this.wires) {
            if (!wire.route || wire.route.length < 2) continue;

            const isSelected = wire === this.selectedWire;
            ctx.strokeStyle = isSelected ? "#50fa7b" : "#6ea8fe";
            ctx.lineWidth = isSelected ? 3 : 2;

            for (let i = 0; i < wire.route.length - 1; i++) {
                const p1 = wire.route[i];
                const p2 = wire.route[i + 1];

                if (p1.x === p2.x) {
                    const x = p1.x;
                    const yStart = p1.y;
                    const yEnd = p2.y;

                    const segmentHops = [];
                    for (const [key, hop] of crossingHops) {
                        if (hop.x === x && hop.y > Math.min(yStart, yEnd) && hop.y < Math.max(yStart, yEnd)) {
                            segmentHops.push(hop.y);
                        }
                    }

                    segmentHops.sort((a, b) => yStart < yEnd ? a - b : b - a);

                    ctx.beginPath();
                    ctx.moveTo(x, yStart);

                    const direction = yEnd > yStart ? 1 : -1;

                    for (const hopY of segmentHops) {
                        const arcStart = hopY - direction * 8;
                        const arcEnd = hopY + direction * 8;

                        ctx.lineTo(x, arcStart);
                        ctx.arc(x, hopY, 8, direction > 0 ? -Math.PI / 2 : Math.PI / 2, direction > 0 ? Math.PI / 2 : -Math.PI / 2, false);
                    }

                    ctx.lineTo(x, yEnd);
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }

            // Draw Corner Waypoint Drag Handles on Selected Wire
            if (isSelected) {
                for (let i = 0; i < wire.route.length; i++) {
                    const pt = wire.route[i];
                    ctx.fillStyle = "#8be9fd";
                    ctx.strokeStyle = "#ffffff";
                    ctx.lineWidth = 1.5;

                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            }
        }

        ctx.fillStyle = "#6ea8fe";
        for (const [key, count] of pointCounts) {
            if (count >= 3 || junctionPoints.has(key)) {
                const [x, y] = key.split(",").map(Number);
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        for (const key of junctionPoints) {
            const [x, y] = key.split(",").map(Number);
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    }

    drawWirePreview() {
        if (!this.wiring || !this.wireWaypoints || this.wireWaypoints.length === 0 || !this.hoverSnap) return;

        const ctx = this.ctx;
        const lastWp = this.wireWaypoints[this.wireWaypoints.length - 1];
        const target = { x: this.hoverSnap.x, y: this.hoverSnap.y };

        const activeSegment = this.findObstacleFreePath(lastWp, target, null, null);

        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);

        ctx.beginPath();
        ctx.moveTo(this.wireWaypoints[0].x, this.wireWaypoints[0].y);
        for (let i = 1; i < this.wireWaypoints.length; i++) {
            ctx.lineTo(this.wireWaypoints[i].x, this.wireWaypoints[i].y);
        }

        for (let i = 1; i < activeSegment.length; i++) {
            ctx.lineTo(activeSegment[i].x, activeSegment[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    drawProbes() {
        const ctx = this.ctx;
        for (const prb of this.probes) {
            if (prb.type === 'V') {
                ctx.fillStyle = "#ff79c6";
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;

                ctx.beginPath();
                ctx.arc(prb.x, prb.y, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.font = "11px system-ui";
                ctx.fillStyle = "#ff79c6";
                ctx.textAlign = "center";
                ctx.fillText(prb.label, prb.x, prb.y - 12);
            } else if (prb.type === 'I') {
                ctx.fillStyle = "#bd93f9";
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;

                ctx.beginPath();
                ctx.arc(prb.x, prb.y, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.font = "11px system-ui";
                ctx.fillStyle = "#bd93f9";
                ctx.textAlign = "center";
                ctx.fillText(prb.label, prb.x, prb.y - 12);
            }
        }
    }

    drawSnapHighlight() {
        if ((this.tool !== "wire" && !this.wiring) || !this.hoverSnap) return;

        const ctx = this.ctx;
        const { x, y, type } = this.hoverSnap;

        ctx.lineWidth = 2;
        if (type === "terminal") {
            ctx.strokeStyle = "#50fa7b";
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.stroke();
        } else if (type === "wire") {
            ctx.strokeStyle = "#8be9fd";
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = "#6ea8fe";
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawComponents() {
        for (const component of this.components) {
            this.drawComponent(component);
        }
    }

    drawComponent(component) {
        const ctx = this.ctx;

        ctx.save();
        ctx.translate(component.x, component.y);
        ctx.rotate((component.rotation * Math.PI) / 180);

        if (component === this.selected) {
            ctx.strokeStyle = "#6ea8fe";
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.strokeRect(-50, -30, 100, 60);
            ctx.setLineDash([]);
        }

        switch (component.type) {
            case "R":
                this.drawResistor(component);
                break;
            case "C":
                this.drawCapacitor(component);
                break;
            case "L":
                this.drawInductor(component);
                break;
            case "V":
                this.drawVoltageSource(component);
                break;
            case "D":
                this.drawDiode(component);
                break;
            case "DZ":
                this.drawZener(component);
                break;
            case "LED":
                this.drawLED(component);
                break;
            case "BJT_NPN":
                this.drawTransistorNPN(component);
                break;
            case "BJT_PNP":
                this.drawTransistorPNP(component);
                break;
            case "NMOS":
                this.drawMOSFETN(component);
                break;
            case "PMOS":
                this.drawMOSFETP(component);
                break;
            case "OPAMP":
                this.drawOpAmp(component);
                break;
            case "IC555":
                this.drawIC555(component);
                break;
            case "AND":
            case "OR":
            case "NOT":
            case "NAND":
            case "NOR":
            case "XOR":
                this.drawLogicGate(component);
                break;
            case "GND":
                this.drawGround(component);
                break;
        }

        ctx.restore();
    }

    drawResistor(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ffb86c";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-28, 0);
        ctx.lineTo(-20, -10);
        ctx.lineTo(-8, 10);
        ctx.lineTo(4, -10);
        ctx.lineTo(16, 10);
        ctx.lineTo(28, -10);
        ctx.lineTo(36, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawCapacitor(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#8be9fd";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-8, 0);
        ctx.moveTo(8, 0);
        ctx.lineTo(40, 0);
        ctx.moveTo(-8, -20);
        ctx.lineTo(-8, 20);
        ctx.moveTo(8, -20);
        ctx.lineTo(8, 20);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawInductor(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#bd93f9";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-25, 0);
        ctx.arc(-15, 0, 10, Math.PI, 0);
        ctx.arc(5, 0, 10, Math.PI, 0);
        ctx.arc(25, 0, 10, Math.PI, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawVoltageSource(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-24, 0);
        ctx.moveTo(24, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = "18px system-ui";
        ctx.fillStyle = "#50fa7b";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("+", 0, -8);
        ctx.fillText("−", 0, 10);

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawDiode(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ff79c6";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-14, 0);
        ctx.moveTo(14, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.fillStyle = "#ff79c6";
        ctx.beginPath();
        ctx.moveTo(-14, -12);
        ctx.lineTo(14, 0);
        ctx.lineTo(-14, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(14, -12);
        ctx.lineTo(14, 12);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawZener(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ff79c6";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-14, 0);
        ctx.moveTo(14, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.fillStyle = "#ff79c6";
        ctx.beginPath();
        ctx.moveTo(-14, -12);
        ctx.lineTo(14, 0);
        ctx.lineTo(-14, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(8, -16);
        ctx.lineTo(14, -12);
        ctx.lineTo(14, 12);
        ctx.lineTo(20, 16);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawLED(component) {
        this.drawDiode(component);
        const ctx = this.ctx;
        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(2, -14);
        ctx.lineTo(10, -24);
        ctx.moveTo(10, -14);
        ctx.lineTo(18, -24);
        ctx.stroke();
    }

    drawTransistorNPN(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#bd93f9";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-10, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -20);
        ctx.lineTo(-10, 20);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(20, -40);
        ctx.moveTo(-10, 10);
        ctx.lineTo(20, 40);
        ctx.stroke();

        ctx.fillStyle = "#bd93f9";
        ctx.beginPath();
        ctx.moveTo(20, 40);
        ctx.lineTo(10, 32);
        ctx.lineTo(14, 22);
        ctx.closePath();
        ctx.fill();

        this.drawTerminal(-40, 0);
        this.drawTerminal(20, -40);
        this.drawTerminal(20, 40);
        this.drawLabel(component);
    }

    drawTransistorPNP(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#bd93f9";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-10, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -20);
        ctx.lineTo(-10, 20);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(20, -40);
        ctx.moveTo(-10, 10);
        ctx.lineTo(20, 40);
        ctx.stroke();

        ctx.fillStyle = "#bd93f9";
        ctx.beginPath();
        ctx.moveTo(-10, 10);
        ctx.lineTo(0, 18);
        ctx.lineTo(-4, 28);
        ctx.closePath();
        ctx.fill();

        this.drawTerminal(-40, 0);
        this.drawTerminal(20, -40);
        this.drawTerminal(20, 40);
        this.drawLabel(component);
    }

    drawMOSFETN(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-12, 0);
        ctx.moveTo(-12, -18);
        ctx.lineTo(-12, 18);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-4, -18);
        ctx.lineTo(-4, 18);
        ctx.moveTo(-4, -15);
        ctx.lineTo(20, -40);
        ctx.moveTo(-4, 15);
        ctx.lineTo(20, 40);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(20, -40);
        this.drawTerminal(20, 40);
        this.drawLabel(component);
    }

    drawMOSFETP(component) {
        this.drawMOSFETN(component);
    }

    drawOpAmp(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ffb86c";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(25, 0);
        ctx.lineTo(40, 0);
        ctx.moveTo(-40, -20);
        ctx.lineTo(-25, -20);
        ctx.moveTo(-40, 20);
        ctx.lineTo(-25, 20);
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 184, 108, 0.1)";
        ctx.beginPath();
        ctx.moveTo(-25, -35);
        ctx.lineTo(25, 0);
        ctx.lineTo(-25, 35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 14px system-ui";
        ctx.fillStyle = "#ffb86c";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("−", -15, -20);
        ctx.fillText("+", -15, 20);

        this.drawTerminal(-40, -20);
        this.drawTerminal(-40, 20);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawIC555(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#8be9fd";
        ctx.lineWidth = 3;

        ctx.fillStyle = "#171b23";
        ctx.beginPath();
        ctx.rect(-35, -45, 70, 90);
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 13px system-ui";
        ctx.fillStyle = "#8be9fd";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("NE555", 0, 0);

        const pins = [
            { name: "GND", y: -30 }, { name: "TRIG", y: -10 },
            { name: "OUT", y: 10 }, { name: "RESET", y: 30 },
            { name: "CTRL", y: 30, right: true }, { name: "THRES", y: 10, right: true },
            { name: "DISCH", y: -10, right: true }, { name: "VCC", y: -30, right: true }
        ];

        for (const p of pins) {
            const x1 = p.right ? 35 : -35;
            const x2 = p.right ? 50 : -50;
            ctx.beginPath();
            ctx.moveTo(x1, p.y);
            ctx.lineTo(x2, p.y);
            ctx.stroke();
            this.drawTerminal(x2, p.y);
        }

        this.drawLabel(component);
    }

    drawLogicGate(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#f1fa8c";
        ctx.lineWidth = 3;

        const isNot = component.type === "NOT";
        if (isNot) {
            ctx.beginPath();
            ctx.moveTo(-40, 0);
            ctx.lineTo(-20, 0);
            ctx.moveTo(20, 0);
            ctx.lineTo(40, 0);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(-20, -20);
            ctx.lineTo(15, 0);
            ctx.lineTo(-20, 20);
            ctx.closePath();
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(18, 0, 4, 0, Math.PI * 2);
            ctx.stroke();

            this.drawTerminal(-40, 0);
            this.drawTerminal(40, 0);
        } else {
            ctx.beginPath();
            ctx.moveTo(-40, -15);
            ctx.lineTo(-20, -15);
            ctx.moveTo(-40, 15);
            ctx.lineTo(-20, 15);
            ctx.moveTo(20, 0);
            ctx.lineTo(40, 0);
            ctx.stroke();

            ctx.font = "bold 13px system-ui";
            ctx.fillStyle = "#f1fa8c";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(component.type, 0, 0);

            ctx.beginPath();
            ctx.rect(-20, -25, 40, 50);
            ctx.stroke();

            this.drawTerminal(-40, -15);
            this.drawTerminal(-40, 15);
            this.drawTerminal(40, 0);
        }

        this.drawLabel(component);
    }

    drawGround(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#e8edf5";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(0, -15);
        ctx.lineTo(0, 5);
        ctx.moveTo(-20, 5);
        ctx.lineTo(20, 5);
        ctx.moveTo(-13, 12);
        ctx.lineTo(13, 12);
        ctx.moveTo(-6, 19);
        ctx.lineTo(6, 19);
        ctx.stroke();

        this.drawTerminal(0, -15);

        ctx.font = "12px system-ui";
        ctx.fillStyle = "#e8edf5";
        ctx.textAlign = "center";
        ctx.fillText("GND", 0, 35);
    }

    drawTerminal(x, y) {
        const ctx = this.ctx;
        ctx.fillStyle = "#e8edf5";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    drawLabel(component) {
        const ctx = this.ctx;

        ctx.font = "12px system-ui";
        ctx.fillStyle = "#e8edf5";
        ctx.textAlign = "center";
        ctx.fillText(component.name, 0, -25);

        ctx.font = "10px system-ui";
        ctx.fillStyle = "#9aa4b5";
        ctx.fillText(component.value, 0, 38);
    }

    loadExample() {
        this.saveState();
        this.components = [];
        this.wires = [];
        this.probes = [];
        this.panX = 0;
        this.panY = 0;
        this.nextId = 1;

        const y = 200;

        const v = this.addComponent("V", 100, y);
        const r1 = this.addComponent("R", 240, y);
        const r2 = this.addComponent("R", 380, y);
        const c1 = this.addComponent("C", 520, y);
        const c2 = this.addComponent("C", 660, y);
        const gnd = this.addComponent("GND", 800, y + 80);

        v.value = "10 V";
        r1.value = "1 kΩ";
        r2.value = "2.2 kΩ";
        c1.value = "10 µF";
        c2.value = "4.7 µF";

        this.wires.push(
            { id: this.nextId++, start: { type: "terminal", component: v.id, terminal: "2" }, end: { type: "terminal", component: r1.id, terminal: "1" }, route: null },
            { id: this.nextId++, start: { type: "terminal", component: r1.id, terminal: "2" }, end: { type: "terminal", component: r2.id, terminal: "1" }, route: null },
            { id: this.nextId++, start: { type: "terminal", component: r2.id, terminal: "2" }, end: { type: "terminal", component: c1.id, terminal: "1" }, route: null },
            { id: this.nextId++, start: { type: "terminal", component: c1.id, terminal: "2" }, end: { type: "terminal", component: c2.id, terminal: "1" }, route: null },
            { id: this.nextId++, start: { type: "terminal", component: c2.id, terminal: "2" }, end: { type: "terminal", component: gnd.id, terminal: "1" }, route: null }
        );

        this.rerouteAllWires();
        this.selected = null;
        this.selectedWire = null;
        this.draw();
    }
}
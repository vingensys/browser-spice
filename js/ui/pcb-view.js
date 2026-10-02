// The PCB layout window (a full-window overlay on the schematic): footprints from the schematic's netlist, ratsnest,
// manual routing on two layers, a grid autorouter, a design-rule check and Gerber / Excellon output. The board lives
// in the design file (editor.pcb); the geometry and rules are in js/pcb/pcb.js.
//   Keys: S select / move, T route (click points, Enter or double-click to finish, Esc to cancel), V via while routing,
//   F other layer, R rotate part, Delete remove a track or via, Ctrl+Z undo, wheel zoom, right / middle drag pans.

class PcbView {
    constructor(editor, doc, runner) {
        this.editor = editor;
        this.doc = doc;
        this.runner = runner;
        this.tool = "select";
        this.layer = "F";
        this.sel = null;                 // { kind: "part" | "track" | "via", ref }
        this.draft = null;               // track being routed: { layer, pts }
        this.issues = [];
        this.undoStack = [];
        this.view = { s: 8, ox: 20, oy: 20 };
        this.mouse = { x: 0, y: 0 };
        this.isOpen = false;

        const root = this.root = document.createElement("div");
        root.id = "pcbview";
        root.className = "hidden";
        root.innerHTML = `
            <div class="pcb-bar">
                <b>PCB</b>
                <button class="tb-btn txt" data-a="sync" title="Bring parts and nets in from the schematic (keeps placement and routing of parts that stay)">Update from schematic</button>
                <button class="tb-btn txt" data-a="place" title="Arrange every part in rows, grouping the ones that share nets">Auto-place</button>
                <button class="tb-btn txt" data-a="route" title="Route every unrouted connection (two layers, vias)">Auto-route</button>
                <button class="tb-btn txt" data-a="unroute" title="Remove all tracks and vias">Clear routing</button>
                <span class="sep"></span>
                <button class="tb-btn txt" data-tool="select" title="Select and move (S)">Select</button>
                <button class="tb-btn txt" data-tool="route" title="Route a track (T)">Route</button>
                <button class="tb-btn txt" data-a="layer" title="Active copper layer (F)">Layer: <span id="pcbLayer">F.Cu</span></button>
                <button class="tb-btn txt" data-a="rotate" title="Rotate the selected part (R)">Rotate</button>
                <button class="tb-btn txt" data-a="delete" title="Delete the selected track or via (Del)">Delete</button>
                <button class="tb-btn txt" data-a="undo" title="Undo (Ctrl+Z)">Undo</button>
                <span class="sep"></span>
                <label title="Board width, height (mm)">Board <input id="pcbW" type="number" min="10" max="400" step="1"> × <input id="pcbH" type="number" min="10" max="400" step="1"> mm</label>
                <label title="Track width (mm)">Track <input id="pcbTrack" type="number" min="0.1" max="5" step="0.05"></label>
                <label title="Copper clearance (mm)">Clearance <input id="pcbClr" type="number" min="0.05" max="2" step="0.05"></label>
                <span class="sep"></span>
                <button class="tb-btn txt" data-a="drc" title="Check clearances, shorts, board edge, track width and unrouted nets">Check rules</button>
                <button class="tb-btn txt" data-a="export" title="Download Gerber (F.Cu, B.Cu, edge) and Excellon drill files as a ZIP">Export Gerber…</button>
                <span class="grow"></span>
                <button class="tb-btn" data-a="close" title="Back to the schematic (Esc)">✕</button>
            </div>
            <div class="pcb-main">
                <canvas id="pcbCanvas" tabindex="0"></canvas>
                <div class="pcb-side"><div id="pcbIssues" class="pcb-issues"></div></div>
            </div>
            <div class="pcb-status" id="pcbStatus"></div>`;
        document.body.appendChild(root);
        this.cv = root.querySelector("#pcbCanvas");
        this.ctx = this.cv.getContext("2d");
        this.statusEl = root.querySelector("#pcbStatus");
        this.bind();
    }

    get pcb() { return this.editor.pcb; }

    // ---------------------------------------------------------------- open / close
    open() {
        if (!this.editor.pcb) this.editor.pcb = Pcb.blank();
        this.root.classList.remove("hidden");
        this.isOpen = true;
        this.sync(true);
        this.fit();
        this.fields();
        this.cv.focus();
    }

    close() {
        this.root.classList.add("hidden");
        this.isOpen = false;
        this.draft = null;
        this.editor.canvas.focus();
    }

    toggle() { this.isOpen ? this.close() : this.open(); }

    fields() {
        const p = this.pcb, q = (id) => this.root.querySelector(id);
        q("#pcbW").value = p.outline.w; q("#pcbH").value = p.outline.h;
        q("#pcbTrack").value = p.rules.track; q("#pcbClr").value = p.rules.clearance;
        q("#pcbLayer").textContent = this.layer === "F" ? "F.Cu" : "B.Cu";
        this.root.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === this.tool));
    }

    // ---------------------------------------------------------------- actions
    snapshot() { this.undoStack.push(JSON.stringify(this.pcb)); if (this.undoStack.length > 60) this.undoStack.shift(); }
    changed() { this.doc.emit(); this.draw(); }

    undo() {
        if (!this.undoStack.length) return;
        this.editor.pcb = JSON.parse(this.undoStack.pop());
        this.sel = null; this.draft = null; this.issues = []; this.renderIssues(); this.fields(); this.changed();
    }

    sync(quiet) {
        let info;
        try { info = NetlistExtractor.extract(this.editor); }
        catch (e) { this.say(`Could not read the schematic: ${e.message}`, true); return; }
        this.snapshot();
        const r = Pcb.sync(this.pcb, info.elements);
        if (r.added) { if (this.pcb.parts.some(p => p.placed)) this.placeNew(); else { Pcb.autoPlace(this.pcb, { fit: true }); this.fields(); this.fit(); } }
        this.dropOrphans();
        if (!quiet || r.added || r.removed) this.say(`${this.pcb.parts.length} part(s): ${r.added} added, ${r.removed} removed.`);
        this.changed();
    }

    // new parts go in a row below everything that is already placed
    placeNew() {
        const p = this.pcb, placed = p.parts.filter(q => q.placed);
        let y = Math.max(4, ...placed.map(q => q.y + q.fp.h / 2 + 3)), x = 4;
        for (const q of p.parts.filter(q => !q.placed)) { q.x = x + q.fp.w / 2; q.y = y + q.fp.h / 2; q.placed = true; x += q.fp.w + 2.5; }
        p.outline.h = Math.max(p.outline.h, Math.ceil(y + 14));
        p.outline.w = Math.max(p.outline.w, Math.ceil(x + 2));
        this.fields();
    }

    // tracks and vias that no longer touch any pad (their parts are gone)
    dropOrphans() {
        const p = this.pcb;
        if (!p.tracks.length && !p.vias.length) return;
        const conn = Pcb.connectivity(p);
        const live = new Set();
        for (const g of conn) if (g.pads.length) { g.tracks.forEach(t => live.add(t)); g.vias.forEach(v => live.add(v)); }
        p.tracks = p.tracks.filter(t => live.has(t));
        p.vias = p.vias.filter(v => live.has(v));
    }

    act(a) {
        const p = this.pcb;
        switch (a) {
            case "close": this.close(); break;
            case "sync": this.sync(false); break;
            case "place": this.snapshot(); Pcb.autoPlace(p, { fit: true }); p.tracks = []; p.vias = []; this.fields(); this.fit(); this.say("Parts placed; routing cleared because the parts moved."); this.changed(); break;
            case "route": {
                this.snapshot();
                const t0 = performance.now();
                const r = Pcb.autoRoute(p);
                this.say(`Routed ${r.routed} of ${r.total} connection(s) in ${Math.round(performance.now() - t0)} ms${r.failed ? `; ${r.failed} could not be routed (try a larger board or move parts, then route again)` : ""}.`, r.failed > 0);
                this.changed();
                break;
            }
            case "unroute": this.snapshot(); p.tracks = []; p.vias = []; this.issues = []; this.renderIssues(); this.say("Routing cleared."); this.changed(); break;
            case "layer": this.layer = this.layer === "F" ? "B" : "F"; this.fields(); if (this.draft && this.draft.pts.length < 2) this.draft.layer = this.layer; this.draw(); break;
            case "rotate": if (this.sel && this.sel.kind === "part") { this.snapshot(); this.sel.ref.rot = (this.sel.ref.rot + 90) % 360; this.changed(); } break;
            case "delete":
                if (this.sel && this.sel.kind === "track") { this.snapshot(); p.tracks = p.tracks.filter(t => t !== this.sel.ref); this.sel = null; this.changed(); }
                else if (this.sel && this.sel.kind === "via") { this.snapshot(); p.vias = p.vias.filter(v => v !== this.sel.ref); this.sel = null; this.changed(); }
                break;
            case "undo": this.undo(); break;
            case "drc": this.runDrc(); break;
            case "export": this.exportGerber(); break;
        }
    }

    runDrc() {
        this.issues = Pcb.drc(this.pcb);
        this.renderIssues();
        const real = this.issues.filter(i => i.type !== "unrouted").length, un = this.issues.length - real;
        this.say(this.issues.length ? `${real} rule violation(s), ${un} unrouted connection(s).` : "No rule violations and every net is routed.");
        this.draw();
    }

    renderIssues() {
        const el = this.root.querySelector("#pcbIssues");
        if (!this.issues.length) { el.innerHTML = `<div class="pcb-note">No issues listed. Use <b>Check rules</b>.</div>`; return; }
        el.innerHTML = this.issues.map((i, k) => `<div class="pcb-issue ${i.type}" data-k="${k}"><b>${i.type}</b> ${String(i.msg).replace(/</g, "&lt;")}</div>`).join("");
        el.querySelectorAll(".pcb-issue").forEach(d => d.onclick = () => { const i = this.issues[Number(d.dataset.k)]; this.view.ox = this.cv.width / 2 - i.x * this.view.s; this.view.oy = this.cv.height / 2 - i.y * this.view.s; this.draw(); });
    }

    exportGerber() {
        const issues = Pcb.drc(this.pcb).filter(i => i.type !== "unrouted");
        const name = (this.doc.name || "board").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "board";
        const zip = Pcb.zip(Pcb.files(this.pcb, name));
        window.downloadFile(`${name}-gerber.zip`, zip, "application/zip");
        this.say(`Downloaded ${name}-gerber.zip (F.Cu, B.Cu, edge cuts, drill).${issues.length ? ` Note: ${issues.length} rule violation(s) are still open.` : ""}`, issues.length > 0);
    }

    say(msg, warn = false) { this.statusEl.textContent = msg; this.statusEl.classList.toggle("warn", !!warn); if (this.runner && this.runner.toast && warn) this.runner.toast(msg, "warn"); }

    // ---------------------------------------------------------------- view
    fit() {
        const r = this.cv.getBoundingClientRect(), o = this.pcb.outline;
        this.resize();
        const s = Math.min((this.cv.width - 40) / o.w, (this.cv.height - 40) / o.h);
        this.view.s = Math.max(2, s);
        this.view.ox = (this.cv.width - o.w * this.view.s) / 2;
        this.view.oy = (this.cv.height - o.h * this.view.s) / 2;
        this.draw();
    }

    resize() {
        const m = this.cv.parentElement, r = m.getBoundingClientRect(), d = window.devicePixelRatio || 1;
        const w = Math.max(100, Math.round(r.width - (this.root.querySelector(".pcb-side").offsetWidth || 0))), h = Math.max(100, Math.round(r.height));
        if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    }

    toWorld(px, py) { return { x: (px - this.view.ox) / this.view.s, y: (py - this.view.oy) / this.view.s }; }
    snap(x, y, free) {
        // snap to a pad centre when over one, otherwise to the 0.25 mm grid
        const pad = Pcb.padAt(this.pcb, x, y, 0.3);
        if (pad && !free) return { x: pad.x, y: pad.y, pad };
        return { x: Math.round(x / 0.25) * 0.25, y: Math.round(y / 0.25) * 0.25 };
    }

    // ---------------------------------------------------------------- pointer + keys
    bind() {
        const cv = this.cv;
        this.root.querySelectorAll("[data-a]").forEach(b => b.onclick = () => this.act(b.dataset.a));
        this.root.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => this.setTool(b.dataset.tool));
        const num = (id, fn) => this.root.querySelector(id).addEventListener("change", (e) => { const v = Number(e.target.value); if (isFinite(v) && v > 0) { this.snapshot(); fn(v); this.changed(); } });
        num("#pcbW", v => { this.pcb.outline.w = v; }); num("#pcbH", v => { this.pcb.outline.h = v; });
        num("#pcbTrack", v => { this.pcb.rules.track = v; }); num("#pcbClr", v => { this.pcb.rules.clearance = v; });
        window.addEventListener("resize", () => { if (this.isOpen) { this.resize(); this.draw(); } });
        cv.addEventListener("contextmenu", (e) => e.preventDefault());
        cv.addEventListener("wheel", (e) => {
            e.preventDefault();
            const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, w = this.toWorld(px, py);
            const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            this.view.s = Math.max(1.5, Math.min(80, this.view.s * k));
            this.view.ox = px - w.x * this.view.s; this.view.oy = py - w.y * this.view.s;
            this.draw();
        }, { passive: false });
        cv.addEventListener("pointerdown", (e) => this.down(e));
        cv.addEventListener("pointermove", (e) => this.move(e));
        cv.addEventListener("pointerup", (e) => this.up(e));
        cv.addEventListener("dblclick", () => { if (this.draft) this.finishTrack(); });
        this.root.addEventListener("keydown", (e) => this.key(e));
    }

    setTool(t) { this.tool = t; if (t !== "route") this.draft = null; this.fields(); this.draw(); }

    pos(e) { const r = this.cv.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; }

    hit(x, y) {
        const p = this.pcb;
        for (const v of p.vias) if (Math.hypot(v.x - x, v.y - y) <= v.d / 2 + 0.2) return { kind: "via", ref: v };
        for (const t of p.tracks) for (let i = 0; i + 1 < t.pts.length; i++) if (Pcb.segDist(x, y, t.pts[i][0], t.pts[i][1], t.pts[i + 1][0], t.pts[i + 1][1]) <= t.w / 2 + 0.25) return { kind: "track", ref: t };
        for (let i = p.parts.length - 1; i >= 0; i--) {
            const q = p.parts[i], swap = (Math.round(q.rot / 90) % 2) !== 0, w = swap ? q.fp.h : q.fp.w, h = swap ? q.fp.w : q.fp.h;
            if (Math.abs(x - q.x) <= w / 2 && Math.abs(y - q.y) <= h / 2) return { kind: "part", ref: q };
        }
        return null;
    }

    down(e) {
        this.cv.focus();
        const { px, py } = this.pos(e), w = this.toWorld(px, py);
        if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) { this.pan = { px, py, ox: this.view.ox, oy: this.view.oy }; this.cv.setPointerCapture(e.pointerId); return; }
        if (e.button !== 0) return;
        if (this.tool === "route") { this.routeClick(w, e); return; }
        const h = this.hit(w.x, w.y);
        this.sel = h;
        if (h && h.kind === "part") { this.snapshot(); this.drag = { part: h.ref, dx: h.ref.x - w.x, dy: h.ref.y - w.y, moved: false }; this.cv.setPointerCapture(e.pointerId); }
        else if (!h) { this.pan = { px, py, ox: this.view.ox, oy: this.view.oy }; this.cv.setPointerCapture(e.pointerId); }
        this.draw();
    }

    move(e) {
        const { px, py } = this.pos(e), w = this.toWorld(px, py);
        this.mouse = w;
        if (this.pan) { this.view.ox = this.pan.ox + px - this.pan.px; this.view.oy = this.pan.oy + py - this.pan.py; this.draw(); return; }
        if (this.drag) {
            const q = this.drag.part;
            q.x = Math.round((w.x + this.drag.dx) * 2) / 2; q.y = Math.round((w.y + this.drag.dy) * 2) / 2;
            this.drag.moved = true;
            this.draw();
            return;
        }
        this.draw();
    }

    up(e) {
        if (this.pan) { this.pan = null; return; }
        if (this.drag) {
            if (!this.drag.moved) this.undoStack.pop();
            else { this.dropOrphansOfMoved(); this.changed(); }
            this.drag = null;
        }
    }

    // moving a part leaves its tracks where they were: they stay, and the rule check shows what no longer connects
    dropOrphansOfMoved() { this.issues = []; this.renderIssues(); }

    routeClick(w, e) {
        const free = e.shiftKey;
        let s = this.snap(w.x, w.y, free);
        if (!this.draft) { this.draft = { layer: this.layer, pts: [[s.x, s.y]] }; this.draw(); return; }
        const last = this.draft.pts[this.draft.pts.length - 1];
        s = this.constrain(last, s, free);
        if (Math.hypot(s.x - last[0], s.y - last[1]) < 1e-6) return;
        this.draft.pts.push([s.x, s.y]);
        if (s.pad) this.finishTrack();
        else this.draw();
    }

    // moves are horizontal, vertical or 45° unless Shift is held
    constrain(last, s, free) {
        if (free || s.pad) return s;
        const dx = s.x - last[0], dy = s.y - last[1], ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax > 2 * ay) return { x: s.x, y: last[1] };
        if (ay > 2 * ax) return { x: last[0], y: s.y };
        const m = Math.max(ax, ay);
        return { x: last[0] + Math.sign(dx) * m, y: last[1] + Math.sign(dy) * m };
    }

    finishTrack() {
        const d = this.draft;
        this.draft = null;
        if (d && d.pts.length >= 2) {
            this.snapshot();
            this.pcb.tracks.push({ id: this.pcb.nextId++, layer: d.layer, w: this.pcb.rules.track, pts: d.pts });
            this.changed();
        } else this.draw();
    }

    viaHere() {
        if (!this.draft || this.draft.pts.length < 1) return;
        const R = this.pcb.rules, last = this.draft.pts[this.draft.pts.length - 1], other = this.draft.layer === "F" ? "B" : "F";
        this.snapshot();
        if (this.draft.pts.length >= 2) this.pcb.tracks.push({ id: this.pcb.nextId++, layer: this.draft.layer, w: R.track, pts: this.draft.pts });
        this.pcb.vias.push({ id: this.pcb.nextId++, x: last[0], y: last[1], d: R.via, drill: R.viaDrill });
        this.layer = other;
        this.draft = { layer: other, pts: [[last[0], last[1]]] };
        this.fields();
        this.changed();
    }

    key(e) {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { if (e.key === "Escape") e.target.blur(); return; }
        const k = e.key.toLowerCase();
        if (e.ctrlKey && k === "z") { this.undo(); e.preventDefault(); }
        else if (k === "escape") { if (this.draft) { this.draft = null; this.draw(); } else this.close(); }
        else if (k === "enter" && this.draft) this.finishTrack();
        else if (k === "s") this.setTool("select");
        else if (k === "t") this.setTool("route");
        else if (k === "v") this.viaHere();
        else if (k === "f") this.act("layer");
        else if (k === "r") this.act("rotate");
        else if (k === "delete" || k === "backspace") this.act("delete");
        else return;
        e.preventDefault();
        e.stopPropagation();
    }

    // ---------------------------------------------------------------- drawing
    draw() {
        if (!this.isOpen) return;
        this.resize();
        const c = this.ctx, v = this.view, p = this.pcb;
        const dark = true;                       // the board is always drawn on a dark canvas, as in most PCB tools
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = dark ? "#10151c" : "#e8ece8";
        c.fillRect(0, 0, this.cv.width, this.cv.height);
        c.setTransform(v.s, 0, 0, v.s, v.ox, v.oy);
        const lw = (px) => px / v.s;
        // board
        c.fillStyle = dark ? "#16352a" : "#2d6a4f";
        c.fillRect(0, 0, p.outline.w, p.outline.h);
        c.strokeStyle = "#d8c85a"; c.lineWidth = lw(1.5); c.strokeRect(0, 0, p.outline.w, p.outline.h);
        // 5 mm grid dots
        if (v.s > 5) { c.fillStyle = "rgba(255,255,255,0.12)"; for (let x = 5; x < p.outline.w; x += 5) for (let y = 5; y < p.outline.h; y += 5) c.fillRect(x - lw(1), y - lw(1), lw(2), lw(2)); }
        const colour = { F: "#d9534f", B: "#4a90d9" };
        const drawTrack = (t, alpha, col) => {
            c.globalAlpha = alpha; c.strokeStyle = col || colour[t.layer]; c.lineWidth = t.w; c.lineCap = "round"; c.lineJoin = "round";
            c.beginPath(); t.pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
        };
        const other = this.layer === "F" ? "B" : "F";
        for (const t of p.tracks) if (t.layer === other) drawTrack(t, 0.4);
        for (const t of p.tracks) if (t.layer === this.layer) drawTrack(t, 0.95);
        if (this.sel && this.sel.kind === "track") drawTrack(this.sel.ref, 0.9, "#ffe066");
        c.globalAlpha = 1;
        // part outlines and pads
        for (const q of p.parts) {
            const swap = (Math.round(q.rot / 90) % 2) !== 0, w = swap ? q.fp.h : q.fp.w, h = swap ? q.fp.w : q.fp.h;
            c.strokeStyle = this.sel && this.sel.ref === q ? "#ffe066" : "rgba(235,235,235,0.7)"; c.lineWidth = lw(1);
            c.strokeRect(q.x - w / 2, q.y - h / 2, w, h);
            c.fillStyle = "rgba(235,235,235,0.9)"; c.font = `${Math.max(1.4, 11 / v.s)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
            c.fillText(`${q.ref}`, q.x, q.y - h / 2 - 1.2);
        }
        for (const pd of Pcb.pads(p)) {
            c.fillStyle = "#c8a84b";
            if (pd.shape === "round") { c.beginPath(); c.arc(pd.x, pd.y, Math.min(pd.w, pd.h) / 2, 0, 7); c.fill(); }
            else c.fillRect(pd.x - pd.w / 2, pd.y - pd.h / 2, pd.w, pd.h);
            c.fillStyle = "#10151c"; c.beginPath(); c.arc(pd.x, pd.y, pd.drill / 2, 0, 7); c.fill();
            if (v.s > 10 && pd.net) { c.fillStyle = "#fff"; c.font = `${Math.max(0.8, 8 / v.s)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "alphabetic"; c.fillText(pd.net, pd.x, pd.y - pd.h / 2 - 0.2); }
        }
        for (const via of p.vias) {
            c.fillStyle = this.sel && this.sel.ref === via ? "#ffe066" : "#9aa4b0"; c.beginPath(); c.arc(via.x, via.y, via.d / 2, 0, 7); c.fill();
            c.fillStyle = "#10151c"; c.beginPath(); c.arc(via.x, via.y, via.drill / 2, 0, 7); c.fill();
        }
        // ratsnest
        c.strokeStyle = "#f2e35c"; c.lineWidth = lw(1); c.setLineDash([lw(5), lw(4)]);
        for (const l of Pcb.ratsnest(p)) { c.beginPath(); c.moveTo(l.a.x, l.a.y); c.lineTo(l.b.x, l.b.y); c.stroke(); }
        c.setLineDash([]);
        // the track being routed
        if (this.draft) {
            const last = this.draft.pts[this.draft.pts.length - 1];
            let s = this.snap(this.mouse.x, this.mouse.y, false); s = this.constrain(last, s, false);
            drawTrack({ layer: this.draft.layer, w: p.rules.track, pts: [...this.draft.pts, [s.x, s.y]] }, 0.8, "#ffffff");
        }
        // rule issues
        c.strokeStyle = "#ff3b3b"; c.lineWidth = lw(2);
        for (const i of this.issues) if (i.type !== "unrouted") { c.beginPath(); c.arc(i.x, i.y, 1.2, 0, 7); c.stroke(); }
        c.setTransform(1, 0, 0, 1, 0, 0);
        this.statusEl.dataset.pos = `${this.mouse.x.toFixed(2)}, ${this.mouse.y.toFixed(2)} mm`;
    }
}

// The logic analyser window: eight digital traces against time, a threshold, an edge trigger, scrolling back
// through the history, two cursors with the bus value (hex) at each, and CSV / PNG export.
// Double-click a logic analyser on the sheet (or right-click > Open Logic Analyser) and press Play.

class LogicWindow {
    static windows = new Map();
    static COLORS = ["#ffd54a", "#4fc3f7", "#ff6e9a", "#7cf08a", "#ffab40", "#b388ff", "#80deea", "#e6ee9c"];

    static open(editor, live, comp) {
        const key = Instruments.key(editor, comp);
        let w = LogicWindow.windows.get(key);
        if (w) { w.root.style.display = "flex"; w.toFront(); return w; }
        w = new LogicWindow(editor, live, comp);
        LogicWindow.windows.set(key, w);
        return w;
    }
    static closeAll() { for (const w of [...LogicWindow.windows.values()]) w.close(); }

    constructor(editor, live, comp) {
        this.editor = editor; this.live = live; this.compId = comp.id; this.key = Instruments.key(editor, comp); this.sheetId = editor.activeSheet.id;
        comp.logan = LogicCore.merge(comp.logan);
        this.comp = comp;
        this.idle = new LogicCore(comp.logan);
        this.W = 720; this.H = 340;
        this.build();
        this.live.applyScopeResolution && this.live.applyScopeResolution();
        this.loop();
    }

    get s() { return this.comp.logan; }
    get core() { const e = this.live.logans && this.live.logans.get(this.key); return e ? e.core : this.idle; }

    build() {
        const root = document.createElement("div");
        root.className = "scope-win logan-win";
        const tdivs = LogicCore.TDIV.map(v => `<option value="${v}">${Units.formatSI(v, "s")}</option>`).join("");
        root.innerHTML = `
            <div class="scope-title"><span>LOGIC ANALYSER <b>${PropertiesPanel.esc(this.comp.name)}</b></span><span class="scope-status" data-role="status">STOP</span><button class="scope-close" title="Close">✕</button></div>
            <div class="scope-main" style="flex-direction:column">
                <canvas class="scope-screen" width="${this.W}" height="${this.H}" style="width:${this.W}px;height:${this.H}px"></canvas>
                <div class="logan-bar">
                    <button data-act="run">Stop</button><button data-act="auto" title="Pick a timebase from the fastest signal">Auto set</button>
                    <label>Time/div <select data-k="tdiv">${tdivs}</select></label>
                    <label>Threshold <input type="number" data-k="thresh" step="0.1" style="width:56px"> V</label>
                    <label>Trigger <select data-k="tch">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<option value="${i}">D${i}</option>`).join("")}</select>
                        <select data-k="tedge"><option value="none">Off</option><option value="rise">Rising</option><option value="fall">Falling</option><option value="both">Either</option></select></label>
                    <label>History <input type="range" data-k="back" min="0" max="50" step="0.5" style="width:120px" title="Scroll back in time (divisions)"></label>
                    <button data-act="cur" title="Cursors: click or drag on the traces">Cursors</button>
                    <button data-act="csv">CSV</button><button data-act="png">PNG</button>
                </div>
                <div class="scope-readout" data-role="cur"></div>
            </div>`;
        document.body.appendChild(root);
        this.root = root; this.canvas = root.querySelector("canvas"); this.ctx = this.canvas.getContext("2d");
        const n = LogicWindow.windows.size;
        root.style.left = `${Math.max(8, Math.min(200 + 28 * n, window.innerWidth - 760))}px`;
        root.style.top = `${80 + 28 * n}px`;
        const bar = root.querySelector(".scope-title");
        bar.addEventListener("pointerdown", (e) => {
            if (e.target.closest("button")) return;
            const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
            bar.setPointerCapture(e.pointerId);
            const move = (ev) => { root.style.left = `${Math.max(0, ev.clientX - dx)}px`; root.style.top = `${Math.max(0, ev.clientY - dy)}px`; };
            const up = () => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); };
            bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
        });
        root.addEventListener("pointerdown", () => this.toFront());
        root.querySelector(".scope-close").onclick = () => this.close();
        root.addEventListener("input", (e) => this.onControl(e));
        root.addEventListener("change", (e) => this.onControl(e));
        root.querySelectorAll("[data-act]").forEach(b => { b.onclick = () => this.act(b.dataset.act); });
        const cv = this.canvas, left = 46;
        const divAt = (e) => { const r = cv.getBoundingClientRect(); return Math.min(10, Math.max(0, (((e.clientX - r.left) / r.width) * this.W - left) / ((this.W - left) / 10))); };
        cv.addEventListener("pointerdown", (e) => {
            if (!this.s.cur.on) return;
            const d = divAt(e), x = this.s.cur.x, k = Math.abs(d - x[0]) <= Math.abs(d - x[1]) ? 0 : 1;
            x[k] = d; cv.setPointerCapture(e.pointerId);
            const move = (ev) => { x[k] = divAt(ev); };
            const up = () => { cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); };
            cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
        });
        this.syncControls();
    }

    toFront() { LogicWindow.z = (LogicWindow.z || 1100) + 1; this.root.style.zIndex = LogicWindow.z; }

    syncControls() {
        const s = this.s, r = this.root;
        const set = (k, v) => { const el = r.querySelector(`[data-k="${k}"]`); if (el && document.activeElement !== el) el.value = String(v); };
        set("tdiv", s.tdiv); set("thresh", s.thresh); set("tch", s.trig.ch); set("tedge", s.trig.edge); set("back", s.back);
        r.querySelector('[data-act="run"]').textContent = s.run ? "Stop" : "Run";
        r.querySelector('[data-act="run"]').classList.toggle("on", !s.run);
        r.querySelector('[data-act="cur"]').classList.toggle("on", !!s.cur.on);
    }

    onControl(e) {
        const t = e.target, k = t.dataset && t.dataset.k;
        if (!k) return;
        const s = this.s;
        if (k === "tdiv") { s.tdiv = Number(t.value); this.live.applyScopeResolution && this.live.applyScopeResolution(); }
        else if (k === "thresh") s.thresh = Number(t.value);
        else if (k === "tch") s.trig.ch = Number(t.value);
        else if (k === "tedge") s.trig.edge = t.value;
        else if (k === "back") s.back = Number(t.value);
        this.syncControls(); this.editor.notify();
    }

    act(name) {
        const s = this.s, core = this.core;
        if (name === "run") s.run = !s.run;
        else if (name === "cur") s.cur.on = !s.cur.on;
        else if (name === "auto") { if (!core.autoset() && this.live.runner) this.live.runner.toast("Auto set needs a running simulation with a switching input.", "info"); else this.live.applyScopeResolution && this.live.applyScopeResolution(); }
        else if (name === "csv") ScopeWindow.download(`${this.comp.name}.csv`, new Blob([core.csv()], { type: "text/csv" }));
        else if (name === "png") this.canvas.toBlob(b => b && ScopeWindow.download(`${this.comp.name}.png`, b));
        this.syncControls();
    }

    close() {
        this.stopped = true; cancelAnimationFrame(this.raf); this.root.remove();
        LogicWindow.windows.delete(this.key);
        if (this.live.applyScopeResolution) this.live.applyScopeResolution();
    }

    loop() {
        const frame = (now) => {
            if (this.stopped) return;
            try { this.render(now); } catch (e) { console.error(e); }
            this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
    }

    render(now) {
        const st = this.editor.sheetState(this.sheetId), comp = st && st.components.find(c => c.id === this.compId);
        if (!comp) { this.close(); return; }
        if (comp !== this.comp) { this.comp = comp; comp.logan = LogicCore.merge(comp.logan); this.idle = new LogicCore(comp.logan); this.syncControls(); }
        const core = this.core, cap = core.capture();
        this.draw(core, cap);
        const running = this.live.logans && this.live.logans.has(this.key);
        this.root.querySelector('[data-role="status"]').textContent = running ? core.status : "NO SIM";
        if (!this.lastRead || now - this.lastRead > 250) { this.lastRead = now; this.readout(core, cap); this.syncControls(); }
    }

    draw(core, cap) {
        const ctx = this.ctx, W = this.W, H = this.H, s = this.s, left = 46, dx = (W - left) / 10, rows = 8, rh = H / rows;
        ctx.fillStyle = "#06100a"; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = "#173d22"; ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(left + i * dx + 0.5, 0); ctx.lineTo(left + i * dx + 0.5, H); ctx.stroke(); }
        ctx.font = "11px Consolas, monospace"; ctx.textBaseline = "middle";
        for (let c = 0; c < rows; c++) {
            const y0 = c * rh, hi = y0 + rh * 0.22, lo = y0 + rh * 0.78, col = LogicWindow.COLORS[c];
            ctx.strokeStyle = "#173d22"; ctx.beginPath(); ctx.moveTo(0, y0 + 0.5); ctx.lineTo(W, y0 + 0.5); ctx.stroke();
            ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(s.names[c], 6, y0 + rh / 2);
            if (!cap) continue;
            ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath();
            let prev = null;
            for (const sg of core.segments(c, cap)) {
                const y = sg.level ? hi : lo, x0 = left + sg.x0 * dx, x1 = left + sg.x1 * dx;
                if (prev === null) ctx.moveTo(x0, y); else { ctx.lineTo(x0, prev); ctx.lineTo(x0, y); }
                ctx.lineTo(x1, y); prev = y;
            }
            ctx.stroke();
        }
        if (!cap) {
            ctx.fillStyle = "#4f9d63"; ctx.font = "14px system-ui"; ctx.textAlign = "center";
            const live = this.live.logans && this.live.logans.has(this.key);
            ctx.fillText(live ? "Waiting for samples…" : "Press Play (F12) to start the simulation", left + (W - left) / 2, H / 2);
        } else if (s.cur.on) {
            ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = "#e8edf5"; ctx.fillStyle = "#e8edf5"; ctx.textAlign = "center"; ctx.font = "bold 10px system-ui";
            s.cur.x.forEach((d, k) => { const x = left + d * dx; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.fillText(String(k + 1), x, 8); });
            ctx.restore();
        }
        if (cap && cap.trigged) { const x = left + 2 * dx; ctx.fillStyle = "#e8edf5"; ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x - 5, H - 8); ctx.lineTo(x + 5, H - 8); ctx.fill(); }
        ctx.font = "11px Consolas, monospace"; ctx.fillStyle = "#e8edf5"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
        ctx.fillText(`${Units.formatSI(s.tdiv, "s")}/div   threshold ${Units.formatSI(s.thresh, "V")}`, W - 6, H - 4);
    }

    readout(core, cap) {
        const el = this.root.querySelector('[data-role="cur"]');
        if (!this.s.cur.on || !cap) { el.textContent = ""; return; }
        const [d1, d2] = this.s.cur.x, hex = (n) => (n === null ? "—" : `0x${n.toString(16).toUpperCase().padStart(2, "0")} (${n})`);
        const dt = Math.abs(d2 - d1) * cap.tdiv;
        el.innerHTML = `1: bus ${hex(core.bus(cap, d1))}   2: bus ${hex(core.bus(cap, d2))}   Δt ${Units.formatSI(dt, "s")}${dt > 0 ? ` (${Units.formatSI(1 / dt, "Hz")})` : ""}`;
    }
}

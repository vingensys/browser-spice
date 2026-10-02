// The oscilloscope window: a 10 x 8 division screen, timebase, trigger (source, level, slope, AUTO / NORMAL /
// SINGLE), four channels with volts/div, position and coupling, run / stop, auto set, XY mode and measurements.
// It reads the samples LiveSim collects for the SCOPE part (see ScopeCore) and draws a triggered, stable picture.
// Double-click a scope on the sheet (or right-click > Open Oscilloscope) to open it; press Play to feed it.

class ScopeWindow {
    static windows = new Map();     // component id -> ScopeWindow

    static open(editor, live, comp) {
        let w = ScopeWindow.windows.get(comp.id);
        if (w) { w.root.style.display = "flex"; w.toFront(); return w; }
        w = new ScopeWindow(editor, live, comp);
        ScopeWindow.windows.set(comp.id, w);
        return w;
    }

    static closeAll() { for (const w of [...ScopeWindow.windows.values()]) w.close(); }

    constructor(editor, live, comp) {
        this.editor = editor;
        this.live = live;
        this.compId = comp.id;
        comp.scope = ScopeCore.merge(comp.scope);
        this.comp = comp;
        this.idle = new ScopeCore(comp.scope);          // used while no simulation has been started
        this.W = 480; this.H = 384;                     // 10 x 8 divisions of 48 px
        this.build();
        this.live.applyScopeResolution && this.live.applyScopeResolution();
        this.loop();
    }

    // the settings object may be replaced when the design is reloaded: always go through the component
    get s() { return this.comp.scope; }
    get core() {
        const entry = this.live.scopes && this.live.scopes.get(this.compId);
        return entry ? entry.core : this.idle;
    }

    build() {
        const esc = PropertiesPanel.esc;
        const root = document.createElement("div");
        root.className = "scope-win";
        const tdivs = ScopeCore.TDIV.map(v => `<option value="${v}">${Units.formatSI(v, "s")}</option>`).join("");
        const vdivs = ScopeCore.VDIV.map(v => `<option value="${v}">${Units.formatSI(v, "V")}</option>`).join("");
        const chan = (c) => `<div class="scope-ch" data-ch="${c}" style="--ch:${ScopeCore.COLORS[c]}">
                <label class="scope-on"><input type="checkbox" data-k="on"><b>${c}</b></label>
                <select data-k="vdiv" title="Volts per division">${vdivs}</select><span class="u">/div</span>
                <select data-k="coup" title="Coupling"><option>DC</option><option>AC</option><option>GND</option></select>
                <input type="range" data-k="pos" min="-4" max="4" step="0.1" title="Vertical position">
            </div>`;
        root.innerHTML = `
            <div class="scope-title"><span>OSCILLOSCOPE <b>${esc(this.comp.name)}</b></span><span class="scope-status" data-role="status">STOP</span><button class="scope-close" title="Close">✕</button></div>
            <div class="scope-main">
                <canvas class="scope-screen" width="${this.W}" height="${this.H}"></canvas>
                <div class="scope-controls">
                    <div class="scope-buttons">
                        <button data-act="run" title="Run / stop the display">Run</button>
                        <button data-act="single" title="Wait for one trigger, catch it and hold">Single</button>
                        <button data-act="auto" title="Pick timebase, volts/div and trigger for the signals">Auto set</button>
                        <button data-act="xy" title="Plot A against B">XY</button>
                    </div>
                    <fieldset><legend>Timebase</legend>
                        <label>Time/div <select data-k="tdiv">${tdivs}</select></label>
                        <label>Position <input type="range" data-k="hpos" min="-5" max="5" step="0.1"></label>
                    </fieldset>
                    <fieldset><legend>Trigger</legend>
                        <label>Source <select data-t="src"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
                        <label>Slope <select data-t="slope"><option value="rise">Rising</option><option value="fall">Falling</option></select></label>
                        <label>Mode <select data-t="mode"><option value="auto">Auto</option><option value="normal">Normal</option><option value="single">Single</option></select></label>
                        <label>Level <input type="number" data-t="level" step="0.1" style="width:64px"> V</label>
                        <label title="Keep the level in the middle of the signal"><input type="checkbox" data-t="autoLevel"> Auto level</label>
                    </fieldset>
                    <fieldset><legend>Channels</legend>${["A", "B", "C", "D"].map(chan).join("")}</fieldset>
                    <table class="scope-meas" data-role="meas"></table>
                </div>
            </div>`;
        document.body.appendChild(root);
        this.root = root;
        this.canvas = root.querySelector("canvas");
        this.ctx = this.canvas.getContext("2d");
        const n = ScopeWindow.windows.size;
        const w = root.offsetWidth || 830;
        root.style.left = `${Math.max(8, Math.min(240 + 28 * n, window.innerWidth - w - 12))}px`;
        root.style.top = `${60 + 28 * n}px`;

        // drag by the title bar
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

        // controls write straight into the part's settings
        root.addEventListener("input", (e) => this.onControl(e));
        root.addEventListener("change", (e) => this.onControl(e));
        root.querySelectorAll("[data-act]").forEach(b => { b.onclick = () => this.act(b.dataset.act); });
        this.syncControls();
    }

    toFront() { ScopeWindow.z = (ScopeWindow.z || 1000) + 1; this.root.style.zIndex = ScopeWindow.z; }

    syncControls() {
        const s = this.s, root = this.root;
        const set = (el, v) => { if (el && document.activeElement !== el) { if (el.type === "checkbox") el.checked = !!v; else el.value = String(v); } };
        set(root.querySelector('[data-k="tdiv"]'), s.tdiv);
        set(root.querySelector('[data-k="hpos"]'), s.hpos);
        for (const k of ["src", "slope", "mode", "autoLevel"]) set(root.querySelector(`[data-t="${k}"]`), s.trig[k]);
        const lvl = root.querySelector('[data-t="level"]');
        if (document.activeElement !== lvl) lvl.value = String(Number(s.trig.level.toPrecision(4)));
        lvl.disabled = !!s.trig.autoLevel;
        for (const c of ["A", "B", "C", "D"]) {
            const row = root.querySelector(`.scope-ch[data-ch="${c}"]`), ch = s.chan[c];
            for (const k of ["on", "vdiv", "coup", "pos"]) set(row.querySelector(`[data-k="${k}"]`), ch[k]);
        }
        root.querySelector('[data-act="run"]').textContent = s.run ? "Stop" : "Run";
        root.querySelector('[data-act="run"]').classList.toggle("on", !s.run);
        root.querySelector('[data-act="xy"]').classList.toggle("on", !!s.xy);
        root.querySelector('[data-act="single"]').classList.toggle("on", s.trig.mode === "single");
    }

    onControl(e) {
        const t = e.target;
        if (!t.matches || !t.matches("[data-k],[data-t]")) return;
        const s = this.s;
        const num = (v) => Number(v);
        if (t.dataset.t) {
            const k = t.dataset.t;
            s.trig[k] = k === "level" ? num(t.value) : (k === "autoLevel" ? t.checked : t.value);
            if (k === "mode" && t.value === "single") this.core.arm();
            if (k === "mode" && t.value !== "single") s.run = true;
        } else {
            const row = t.closest(".scope-ch");
            const k = t.dataset.k;
            if (row) {
                const ch = s.chan[row.dataset.ch];
                ch[k] = k === "on" ? t.checked : (k === "coup" ? t.value : num(t.value));
            } else if (k === "tdiv") {
                s.tdiv = num(t.value);
                if (this.live.applyScopeResolution) this.live.applyScopeResolution();
            } else if (k === "hpos") s.hpos = num(t.value);
        }
        this.syncControls();
        this.editor.notify();
    }

    act(name) {
        const s = this.s, core = this.core;
        if (name === "run") {
            s.run = !s.run;
            if (s.run && s.trig.mode === "single") core.arm();
        } else if (name === "single") core.arm();
        else if (name === "xy") s.xy = !s.xy;
        else if (name === "auto") {
            const ok = core.autoset();
            if (!ok && this.live.runner) this.live.runner.toast("Auto set needs a running simulation with a signal on a wired channel.", "info");
            if (this.live.applyScopeResolution) this.live.applyScopeResolution();
        }
        this.syncControls();
    }

    close() {
        this.stopped = true;
        cancelAnimationFrame(this.raf);
        this.root.remove();
        ScopeWindow.windows.delete(this.compId);
        if (this.live.applyScopeResolution) this.live.applyScopeResolution();
    }

    // ---- drawing ---------------------------------------------------------------------------------------

    loop() {
        const frame = (now) => {
            if (this.stopped) return;
            try { this.render(now); } catch (e) { console.error(e); }
            this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
    }

    render(now = performance.now()) {
        // the component may have been replaced (undo, open): follow it by id
        const comp = this.editor.components.find(c => c.id === this.compId);
        if (!comp) { this.close(); return; }
        if (comp !== this.comp) { this.comp = comp; comp.scope = ScopeCore.merge(comp.scope); this.idle = new ScopeCore(comp.scope); this.syncControls(); }
        const core = this.core;
        const cap = core.capture();
        if (this.shownRun !== this.s.run || this.shownMode !== this.s.trig.mode) { this.shownRun = this.s.run; this.shownMode = this.s.trig.mode; this.syncControls(); }   // e.g. SINGLE caught its trigger
        this.draw(core, cap);
        if (!this.lastMeas || now - this.lastMeas > 250) { this.lastMeas = now; this.measure(core, cap); this.syncControls(); }
        this.root.querySelector('[data-role="status"]').textContent = (!this.live.scopes || !this.live.scopes.has(this.compId)) ? "NO SIM" : core.status;
    }

    draw(core, cap) {
        const ctx = this.ctx, W = this.W, H = this.H, dx = W / 10, dy = H / 8, s = this.s;
        ctx.fillStyle = "#06100a";
        ctx.fillRect(0, 0, W, H);
        // graticule
        ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) { ctx.strokeStyle = i === 5 ? "#2f7a3f" : "#173d22"; ctx.beginPath(); ctx.moveTo(i * dx + 0.5, 0); ctx.lineTo(i * dx + 0.5, H); ctx.stroke(); }
        for (let j = 0; j <= 8; j++) { ctx.strokeStyle = j === 4 ? "#2f7a3f" : "#173d22"; ctx.beginPath(); ctx.moveTo(0, j * dy + 0.5); ctx.lineTo(W, j * dy + 0.5); ctx.stroke(); }
        ctx.strokeStyle = "#2f7a3f";
        for (let i = 0; i < 50; i++) { const x = i * dx / 5; ctx.beginPath(); ctx.moveTo(x, H / 2 - 3); ctx.lineTo(x, H / 2 + 3); ctx.stroke(); }
        for (let j = 0; j < 40; j++) { const y = j * dy / 5; ctx.beginPath(); ctx.moveTo(W / 2 - 3, y); ctx.lineTo(W / 2 + 3, y); ctx.stroke(); }

        const yOf = (v, ch) => H / 2 - (v / s.chan[ch].vdiv + s.chan[ch].pos) * dy;
        const active = ["A", "B", "C", "D"].filter(c => s.chan[c].on);

        if (!cap) {
            ctx.fillStyle = "#4f9d63"; ctx.font = "14px system-ui"; ctx.textAlign = "center";
            const live = this.live.scopes && this.live.scopes.has(this.compId);
            ctx.fillText(live ? (s.trig.mode === "single" ? "Waiting for a trigger…" : s.trig.mode === "normal" ? "Waiting for a trigger…" : "Waiting for samples…") : "Press Play (F12) to start the simulation", W / 2, H / 2 - 8);
            if (!live) { ctx.font = "11px system-ui"; ctx.fillText("Wire the circuit to inputs A–D of the scope", W / 2, H / 2 + 12); }
        } else if (s.xy) {
            const xs = core.samples("A", 600, cap), ys = core.samples("B", 600, cap);
            ctx.strokeStyle = ScopeCore.COLORS.A; ctx.lineWidth = 1.6; ctx.beginPath();
            let started = false;
            for (let i = 0; i < xs.length; i++) {
                if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) { started = false; continue; }
                const px = W / 2 + (xs[i] / s.chan.A.vdiv + s.chan.A.pos) * dx, py = yOf(ys[i], "B");
                if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
            }
            ctx.stroke();
        } else {
            ctx.save();
            ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
            for (const c of active) {
                const ys = core.samples(c, W, cap);
                ctx.strokeStyle = ScopeCore.COLORS[c]; ctx.lineWidth = 1.8; ctx.lineJoin = "round";
                ctx.beginPath();
                let started = false;
                ys.forEach((v, i) => {
                    if (!Number.isFinite(v)) { started = false; return; }
                    const py = yOf(v, c);
                    if (started) ctx.lineTo(i, py); else { ctx.moveTo(i, py); started = true; }
                });
                ctx.stroke();
            }
            ctx.restore();
        }

        // markers: channel zero levels on the left, trigger level on the right, trigger position on top
        for (const c of active) {
            const y = yOf(0, c);
            ctx.fillStyle = ScopeCore.COLORS[c];
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(9, y - 5); ctx.lineTo(9, y + 5); ctx.closePath(); ctx.fill();
        }
        if (!s.xy && s.chan[s.trig.src] && s.chan[s.trig.src].on) {
            const y = yOf(s.trig.level, s.trig.src);
            ctx.fillStyle = ScopeCore.COLORS[s.trig.src];
            ctx.beginPath(); ctx.moveTo(W, y); ctx.lineTo(W - 10, y - 5); ctx.lineTo(W - 10, y + 5); ctx.closePath(); ctx.fill();
            ctx.font = "bold 9px system-ui"; ctx.fillStyle = "#06100a"; ctx.textAlign = "center"; ctx.fillText("T", W - 6, y + 3);
            const tx = (5 + s.hpos) * dx;
            ctx.fillStyle = "#e8edf5"; ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx - 5, 8); ctx.lineTo(tx + 5, 8); ctx.closePath(); ctx.fill();
        }

        // readout line
        ctx.font = "11px Consolas, monospace"; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
        let x = 6;
        for (const c of active) { ctx.fillStyle = ScopeCore.COLORS[c]; const txt = `${c} ${Units.formatSI(s.chan[c].vdiv, "V")}${s.chan[c].coup === "DC" ? "" : " " + s.chan[c].coup}`; ctx.fillText(txt, x, H - 6); x += ctx.measureText(txt).width + 14; }
        ctx.fillStyle = "#e8edf5";
        const info = s.xy ? "XY" : `M ${Units.formatSI(s.tdiv, "s")}   T ${s.trig.src}${s.trig.slope === "rise" ? "↑" : "↓"} ${Units.formatSI(s.trig.level, "V")}`;
        ctx.textAlign = "right"; ctx.fillText(info, W - 6, H - 6);
    }

    measure(core, cap) {
        const table = this.root.querySelector('[data-role="meas"]');
        const f = (v, u) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Units.formatSI(v, u));
        const rows = ["A", "B", "C", "D"].filter(c => this.s.chan[c].on).map(c => {
            const m = cap ? core.measure(c, cap) : null;
            return `<tr style="color:${ScopeCore.COLORS[c]}"><td>${c}</td><td>${m ? f(m.vpp, "V") : "—"}</td><td>${m ? f(m.vrms, "V") : "—"}</td><td>${m ? f(m.vavg, "V") : "—"}</td><td>${m ? f(m.freq, "Hz") : "—"}</td></tr>`;
        });
        table.innerHTML = `<tr><th></th><th>Vpp</th><th>Vrms</th><th>Vavg</th><th>Freq</th></tr>${rows.join("")}`;
    }
}

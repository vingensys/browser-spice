// The oscilloscope window: a 10 x 8 division screen, timebase, trigger (source, level, slope, AUTO / NORMAL /
// SINGLE), four channels with volts/div, position and coupling, run / stop, auto set, XY mode and measurements.
// It reads the samples LiveSim collects for the SCOPE part (see ScopeCore) and draws a triggered, stable picture.
// Double-click a scope on the sheet (or right-click > Open Oscilloscope) to open it; press Play to feed it.

class ScopeWindow {
    static windows = new Map();     // component id -> ScopeWindow

    static open(editor, live, comp) {
        const key = Instruments.key(editor, comp);
        let w = ScopeWindow.windows.get(key);
        if (w) { w.root.style.display = "flex"; w.toFront(); return w; }
        w = new ScopeWindow(editor, live, comp);
        ScopeWindow.windows.set(key, w);
        return w;
    }

    // the oscilloscope for the probes: not a part on the sheet, its channels are the probes (see LiveSim.attachProbeScope)
    static openProbes(editor, live) {
        const comp = editor.probeScopeComp();
        let w = ScopeWindow.windows.get("probes");
        if (live.attachProbeScope) live.attachProbeScope();
        if (w) { w.root.style.display = "flex"; w.toFront(); return w; }
        w = new ScopeWindow(editor, live, comp, "probes");
        ScopeWindow.windows.set("probes", w);
        return w;
    }

    static vdivOptions(unit) { return ScopeCore.VDIV.map(v => `<option value="${v}">${Units.formatSI(v, unit)}</option>`).join(""); }

    static closeAll() { for (const w of [...ScopeWindow.windows.values()]) w.close(); }

    constructor(editor, live, comp, key) {
        this.editor = editor;
        this.live = live;
        this.compId = comp.id;
        this.key = key !== undefined ? key : Instruments.key(editor, comp);
        this.sheetId = editor.activeSheet.id;
        comp.scope = ScopeCore.complete(comp.scope);          // (a scope already running keeps the settings object its buffer uses)
        this.comp = comp;
        this.idle = new ScopeCore(comp.scope);          // used while no simulation has been started
        this.W = 480; this.H = 384;                     // the screen's size in pixels (10 x 8 divisions); follows the window
        this.sel = "A";                                  // the channel the mouse wheel / shift-drag acts on
        this.win = window;                              // the browser window the scope lives in (a popup after Pop out)
        this.build();
        this.live.applyScopeResolution && this.live.applyScopeResolution();
        this.loop();
    }

    // the settings object may be replaced when the design is reloaded: always go through the component
    get s() { return this.comp.scope; }
    get core() {
        const entry = this.live.scopes && this.live.scopes.get(this.key);
        return entry ? entry.core : this.idle;
    }

    build() {
        const esc = PropertiesPanel.esc;
        const root = document.createElement("div");
        root.className = "scope-win";
        const tdivs = ScopeCore.TDIV.map(v => `<option value="${v}">${Units.formatSI(v, "s")}</option>`).join("");
        const vdivs = ScopeWindow.vdivOptions("V");
        const chOpts = (list) => list.map(c => `<option>${c}</option>`).join("");
        const chan = (c) => `<div class="scope-ch" data-ch="${c}" style="--ch:${ScopeCore.COLORS[c]}">
                <label class="scope-on"><input type="checkbox" data-k="on"><b>${c}</b></label>
                <select data-k="vdiv" title="Units per division">${vdivs}</select><span class="u" data-role="unit">/div</span>
                <select data-k="coup" title="Coupling"><option>DC</option><option>AC</option><option>GND</option></select>
                <input type="range" data-k="pos" min="-4" max="4" step="0.1" title="Vertical position">
                ${c === "M" ? "" : `<select data-k="src" class="scope-src" title="What feeds this channel: the scope pin, or a probe on the sheet"></select>`}
            </div>`;
        root.innerHTML = `
            <div class="scope-title"><span>${this.key === "probes" ? "PROBE SCOPE" : "OSCILLOSCOPE"} <b>${this.key === "probes" ? "" : esc(this.comp.name)}</b></span><span class="scope-status" data-role="status">STOP</span><button class="scope-pop" data-act="pop" title="Pop out into its own window (and back)">⧉</button><button class="scope-close" title="Close">✕</button></div>
            <div class="scope-main">
                <div class="scope-left">
                    <div class="scope-cv"><canvas class="scope-screen" width="${this.W}" height="${this.H}"></canvas></div>
                    <input type="range" class="scope-scrub" data-role="scrub" min="0" max="1000" step="1" value="1000" title="Scroll back through the recorded history (stopped or paused)">
                    <div class="scope-hint" data-role="hint"></div>
                </div>
                <div class="scope-controls">
                    <div class="scope-buttons">
                        <button data-act="pause" title="Pause the simulation itself so you can look around (scroll, zoom, cursors), then resume">Pause sim</button>
                        <button data-act="run" title="Run / stop the display (the simulation keeps going)">Run</button>
                        <button data-act="single" title="Wait for one trigger, catch it and hold">Single</button>
                        <button data-act="auto" title="Pick timebase, volts/div and trigger for the signals">Auto set</button>
                        <button data-act="xy" title="Plot A against B">XY</button>
                        <button data-act="cur" title="Measurement cursors: click or drag on the screen">Cursors</button>
                        <button data-act="fft" title="Show the spectrum of one channel instead of the waveform">FFT</button>
                    </div>
                    <div class="scope-buttons">
                        <button data-act="save" title="Keep the picture on screen as a grey reference trace (up to 4)">Save trace</button>
                        <button data-act="clearrefs" title="Remove the saved reference traces">Clear saved</button>
                        <button data-act="csv" title="Download the displayed data as CSV">CSV</button>
                        <button data-act="png" title="Download the screen as a picture">PNG</button>
                    </div>
                    <fieldset data-role="curbox" style="display:none"><legend>Cursors</legend>
                        <label>Channel <select data-c="ch">${chOpts(ScopeCore.ALL)}</select></label>
                        <div class="scope-readout" data-role="cur"></div>
                    </fieldset>
                    <fieldset data-role="fftbox" style="display:none"><legend>Spectrum</legend>
                        <label>Channel <select data-f="chan">${chOpts(ScopeCore.ALL)}</select></label>
                        <label>Window <select data-f="window">${Object.entries(Spectrum.WINDOWS).map(([k, w]) => `<option value="${k}">${w.label}</option>`).join("")}</select></label>
                        <div class="scope-readout" data-role="fftread"></div>
                    </fieldset>
                    <fieldset><legend>Timebase</legend>
                        <label>Time/div <select data-k="tdiv">${tdivs}</select></label>
                        <label>Position <input type="range" data-k="hpos" min="-5" max="5" step="0.1"></label>
                        <label title="How much recorded signal is kept for scrolling back">History <select data-k="keep"><option value="30">30 screens</option><option value="300">300 screens</option><option value="3000">3000 screens</option><option value="0">As much as fits</option></select></label>
                    </fieldset>
                    <fieldset><legend>Trigger</legend>
                        <label>Source <select data-t="src">${chOpts(ScopeCore.CHANNELS)}</select></label>
                        <label>Slope <select data-t="slope"><option value="rise">Rising</option><option value="fall">Falling</option></select></label>
                        <label>Mode <select data-t="mode"><option value="auto">Auto</option><option value="normal">Normal</option><option value="single">Single</option></select></label>
                        <label>Level <input type="number" data-t="level" step="0.1" style="width:64px"> V</label>
                        <label title="Keep the level in the middle of the signal"><input type="checkbox" data-t="autoLevel"> Auto level</label>
                        <label title="Pause the whole simulation at the first trigger after this is ticked, so you can inspect the moment"><input type="checkbox" data-t="pauseOnTrigger"> Pause sim on trigger</label>
                    </fieldset>
                    <fieldset><legend>Channels</legend>
                        <div class="scope-all" title="Put every channel of a kind on the same scale, to compare them">
                            <span class="u">All</span>
                            <select data-all="V"><option value="">volts/div…</option>${ScopeWindow.vdivOptions("V")}</select>
                            <select data-all="A"><option value="">amps/div…</option>${ScopeWindow.vdivOptions("A")}</select>
                            <label title="Changing one channel's scale changes every channel of the same kind"><input type="checkbox" data-link> link</label>
                        </div>
                        ${ScopeCore.CHANNELS.map(chan).join("")}
                        <button type="button" class="scope-more" data-act="more" title="Show or hide the channels that are off">Show all channels</button></fieldset>
                    <fieldset><legend>Math</legend>
                        <div class="scope-ch" data-ch="M" style="--ch:${ScopeCore.COLORS.M}">
                            <label class="scope-on"><input type="checkbox" data-k="on"><b>M</b></label>
                            <select data-m="op" title="What to compute">${Object.entries(ScopeCore.MATH_OPS).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select>
                            <span class="u">A</span><select data-m="a">${chOpts(ScopeCore.CHANNELS)}</select>
                            <span class="u">B</span><select data-m="b">${chOpts(ScopeCore.CHANNELS)}</select>
                        </div>
                        <div class="scope-ch" data-ch="M" style="--ch:${ScopeCore.COLORS.M}">
                            <span class="u">M /div</span><select data-k="vdiv">${vdivs}</select><span class="u" data-role="unit"></span>
                            <input type="range" data-k="pos" min="-4" max="4" step="0.1" title="Vertical position">
                        </div>
                    </fieldset>
                    <table class="scope-meas" data-role="meas"></table>
                </div>
            </div>
            <div class="scope-grip" title="Drag to resize the scope"></div>`;
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
            if (e.target.closest("button") || this.popped) return;
            const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
            bar.setPointerCapture(e.pointerId);
            const move = (ev) => { root.style.left = `${Math.max(0, ev.clientX - dx)}px`; root.style.top = `${Math.max(0, ev.clientY - dy)}px`; };
            const up = () => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); };
            bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
        });
        // initial size (remembered with the design), and a grip in the bottom-right corner to resize
        const win = this.s.win && this.s.win.w ? this.s.win : { w: 860, h: 560 };
        root.style.width = `${win.w}px`; root.style.height = `${win.h}px`;
        const grip = root.querySelector(".scope-grip");
        grip.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            const r0 = root.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
            try { grip.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
            const move = (ev) => this.resizeTo(r0.width + ev.clientX - x0, r0.height + ev.clientY - y0);
            const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
            grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
        });
        // click a channel row to make it the one the wheel and shift-drag act on
        root.addEventListener("pointerdown", (e) => { const row = e.target.closest && e.target.closest(".scope-ch"); if (row && row.dataset.ch) { this.sel = row.dataset.ch; this.markSelected(); } });
        root.addEventListener("pointerdown", () => this.toFront());
        root.querySelector(".scope-close").onclick = () => this.close();
        this.refs = [];
        this.attachScreen();

        // controls write straight into the part's settings
        root.addEventListener("input", (e) => this.onControl(e));
        root.addEventListener("change", (e) => this.onControl(e));
        root.querySelectorAll("[data-act]").forEach(b => { b.onclick = () => this.act(b.dataset.act); });
        this.syncControls();
    }

    toFront() { ScopeWindow.z = (ScopeWindow.z || 1000) + 1; this.root.style.zIndex = ScopeWindow.z; }

    syncControls() {
        const s = this.s, root = this.root, core = this.core;
        const doc = root.ownerDocument;
        const set = (el, v) => { if (el && doc.activeElement !== el) { if (el.type === "checkbox") el.checked = !!v; else el.value = String(v); } };
        set(root.querySelector('[data-k="tdiv"]'), s.tdiv);
        set(root.querySelector('[data-k="hpos"]'), s.hpos);
        set(root.querySelector('[data-k="keep"]'), s.keep);
        for (const k of ["src", "slope", "mode", "autoLevel", "pauseOnTrigger"]) set(root.querySelector(`[data-t="${k}"]`), s.trig[k]);
        const lvl = root.querySelector('[data-t="level"]');
        if (doc.activeElement !== lvl) lvl.value = String(Number(s.trig.level.toPrecision(4)));
        lvl.disabled = !!s.trig.autoLevel;
        const probes = this.editor.allProbes ? this.editor.allProbes() : this.editor.probes;
        const srcSig = probes.map(p => `${p.id}:${p.label}`).join("|");
        for (const row of root.querySelectorAll(".scope-ch")) {
            const c = row.dataset.ch, ch = s.chan[c];
            for (const k of ["on", "vdiv", "coup", "pos"]) set(row.querySelector(`[data-k="${k}"]`), ch[k]);
            // volts or amps per division, whatever the channel carries
            const unit = core.unitOf(c), u = row.querySelector('[data-role="unit"]'), vd = row.querySelector('[data-k="vdiv"]');
            if (vd && vd.dataset.unit !== unit) { vd.innerHTML = ScopeWindow.vdivOptions(unit); vd.dataset.unit = unit; set(vd, ch.vdiv); }
            if (u) u.textContent = `${unit}/div`;
            // the source list: the scope pin (A-D) or nothing, then every probe on the design
            const src = row.querySelector('[data-k="src"]');
            if (src && src.dataset.sig !== srcSig) {
                src.innerHTML = `<option value="">${"ABCD".includes(c) ? "scope pin" : "(none)"}</option>` + probes.map(p => `<option value="${p.id}">${PropertiesPanel.esc(p.label)}</option>`).join("");
                src.dataset.sig = srcSig;
            }
            if (src && doc.activeElement !== src) src.value = ch.src && ch.src.probe !== undefined ? String(ch.src.probe) : "";
            // the channels that are off are tucked away until asked for
            if (c !== "M") row.style.display = this.showAll || ch.on || "ABCD".includes(c) || (ch.src && ch.src.probe !== undefined) ? "" : "none";
        }
        this.markSelected();
        set(root.querySelector("[data-link]"), s.link);
        root.querySelector('[data-act="more"]').textContent = this.showAll ? "Hide unused channels" : "Show all channels";
        const m = s.math;
        set(root.querySelector('[data-m="op"]'), m.op); set(root.querySelector('[data-m="a"]'), m.a); set(root.querySelector('[data-m="b"]'), m.b);
        root.querySelector('[data-m="b"]').style.visibility = m.op === "int" || m.op === "diff" ? "hidden" : "";
        const sim = this.live.state;
        const pb = root.querySelector('[data-act="pause"]');
        pb.textContent = sim === "paused" ? "Resume sim" : "Pause sim";
        pb.classList.toggle("on", sim === "paused");
        pb.disabled = sim === "stopped";
        root.querySelector('[data-act="run"]').textContent = s.run ? "Stop" : "Run";
        root.querySelector('[data-act="run"]').classList.toggle("on", !s.run);
        root.querySelector('[data-act="xy"]').classList.toggle("on", !!s.xy);
        root.querySelector('[data-act="single"]').classList.toggle("on", s.trig.mode === "single");
        root.querySelector('[data-act="cur"]').classList.toggle("on", !!s.cur.on);
        root.querySelector('[data-act="fft"]').classList.toggle("on", !!s.fft.on);
        root.querySelector('[data-role="curbox"]').style.display = s.cur.on ? "flex" : "none";
        root.querySelector('[data-role="fftbox"]').style.display = s.fft.on ? "flex" : "none";
        set(root.querySelector('[data-c="ch"]'), s.cur.ch);
        set(root.querySelector('[data-f="chan"]'), s.fft.chan);
        set(root.querySelector('[data-f="window"]'), s.fft.window);
    }

    onControl(e) {
        const t = e.target;
        if (!t.matches || !t.matches("[data-k],[data-t],[data-c],[data-f],[data-m],[data-all],[data-link]")) return;
        const s = this.s;
        if (t.dataset.all !== undefined) {           // every voltage (or current) channel to one scale, for comparing them
            if (t.value !== "") this.setAllDiv(t.dataset.all, Number(t.value));
            t.value = "";
            this.syncControls();
            return;
        }
        if (t.dataset.link !== undefined) { s.link = t.checked; if (s.link) this.setAllDiv(this.core.unitOf(this.sel), s.chan[this.sel].vdiv); this.syncControls(); return; }
        if (t.dataset.m) { s.math[t.dataset.m] = t.value; this.core.recomputeMath(); this.syncControls(); return; }
        if (t.dataset.c) { s.cur.ch = t.value; this.syncControls(); return; }
        if (t.dataset.f) { s.fft[t.dataset.f] = t.value; this.syncControls(); return; }
        const num = (v) => Number(v);
        if (t.dataset.t) {
            const k = t.dataset.t;
            s.trig[k] = k === "level" ? num(t.value) : (k === "autoLevel" || k === "pauseOnTrigger" ? t.checked : t.value);
            if (k === "pauseOnTrigger") this.pauseArmedAt = t.checked ? this.core.tNow : null;
            if (k === "mode" && t.value === "single") this.core.arm();
            if (k === "mode" && t.value !== "single") s.run = true;
        } else {
            const row = t.closest(".scope-ch");
            const k = t.dataset.k;
            if (row && k === "src") {
                const ch = s.chan[row.dataset.ch];
                if (t.value === "") delete ch.src; else { ch.src = { probe: Number(t.value) }; ch.on = true; }
                if (this.live.refreshSources) this.live.refreshSources(this.key);
            } else if (row) {
                const ch = s.chan[row.dataset.ch];
                ch[k] = k === "on" ? t.checked : (k === "coup" ? t.value : num(t.value));
                if (k === "vdiv" && s.link) this.setAllDiv(this.core.unitOf(row.dataset.ch), ch.vdiv);       // linked: the others follow
            } else if (k === "keep") s.keep = num(t.value);
            else if (k === "tdiv") {
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
        } else if (name === "pause") {
            if (this.live.state === "running") this.live.pause();
            else if (this.live.state === "paused") this.live.start();
        } else if (name === "more") this.showAll = !this.showAll;
        else if (name === "pop") this.popped ? this.dock() : this.popOut();
        else if (name === "single") core.arm();
        else if (name === "xy") { s.xy = !s.xy; if (s.xy) s.fft.on = false; }
        else if (name === "cur") s.cur.on = !s.cur.on;
        else if (name === "fft") { s.fft.on = !s.fft.on; if (s.fft.on) { s.xy = false; if (!s.chan[s.fft.chan].on) s.fft.chan = ScopeCore.ALL.find(c => s.chan[c].on) || "A"; } }
        else if (name === "save") {
            const snap = core.snapshot();
            if (!snap) { if (this.live.runner) this.live.runner.toast("Nothing on the screen to save yet.", "info"); }
            else { this.refs.push(snap); if (this.refs.length > 4) this.refs.shift(); }
        } else if (name === "clearrefs") this.refs = [];
        else if (name === "csv") ScopeWindow.download(`${this.comp.name}.csv`, new Blob([core.csv()], { type: "text/csv" }));
        else if (name === "png") this.canvas.toBlob(b => b && ScopeWindow.download(`${this.comp.name}.png`, b));
        else if (name === "auto") {
            const ok = core.autoset();
            if (!ok && this.live.runner) this.live.runner.toast("Auto set needs a running simulation with a signal on a wired channel.", "info");
            if (this.live.applyScopeResolution) this.live.applyScopeResolution();
        }
        this.syncControls();
    }

    // ---- size, scale and window helpers ----------------------------------------------------------------------------

    // every channel that carries `unit` (V or A) gets the same units per division
    setAllDiv(unit, value) {
        const core = this.core;
        for (const c of ScopeCore.ALL) if (core.unitOf(c) === unit) this.s.chan[c].vdiv = value;
    }

    // step a channel's units per division along the 1-2-5 list (dir > 0: bigger), and every channel of its kind when linked
    stepDiv(c, dir) {
        const list = ScopeCore.VDIV, cur = this.s.chan[c].vdiv;
        let i = list.findIndex(v => v >= cur - 1e-15);
        if (i < 0) i = list.length - 1;
        const j = Math.min(list.length - 1, Math.max(0, i + dir));
        this.s.chan[c].vdiv = list[j];
        if (this.s.link) this.setAllDiv(this.core.unitOf(c), list[j]);
    }

    markSelected() {
        for (const row of this.root.querySelectorAll(".scope-ch")) row.classList.toggle("sel", row.dataset.ch === this.sel);
    }

    // resize the window (docked); the screen follows, the controls scroll
    resizeTo(w, h) {
        const root = this.root, maxW = (this.win.innerWidth || 1600) - 8, maxH = (this.win.innerHeight || 1000) - 8;
        const W = Math.round(Math.min(maxW, Math.max(720, w))), H = Math.round(Math.min(maxH, Math.max(440, h)));
        root.style.width = `${W}px`; root.style.height = `${H}px`;
        this.s.win = { w: W, h: H };
    }

    // make the canvas match the room it has (called every frame; cheap when nothing changed)
    fitCanvas() {
        const wrap = this.canvas.parentElement, r = wrap.getBoundingClientRect();
        const w = Math.max(160, Math.floor(r.width)), h = Math.max(120, Math.floor(r.height));
        const dpr = this.win.devicePixelRatio || 1;
        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr) || this.W !== w || this.H !== h) {
            this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
            this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
            this.W = w; this.H = h;
        }
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // which channel's trace is nearest the point (x, y) on the screen, within 14 px; null when none is
    pickChannel(x, y) {
        const core = this.core, cap = core.last, s = this.s;
        if (!cap || s.xy || s.fft.on) return null;
        const H = this.H, dy = H / 8, col = Math.min(this.W - 1, Math.max(0, Math.round(x)));
        let best = null, bd = 14;
        for (const c of ScopeCore.ALL) {
            if (!s.chan[c].on) continue;
            const ys = core.samples(c, this.W, cap), v = ys[col];
            if (!Number.isFinite(v)) continue;
            const py = H / 2 - (v / s.chan[c].vdiv + s.chan[c].pos) * dy, d = Math.abs(py - y);
            if (d < bd) { bd = d; best = c; }
        }
        return best;
    }

    // Pop out: the whole scope moves into its own browser window (same page state, so it keeps running), and back again
    popOut() {
        if (this.popped) return;
        const w = window.open("", `scope-${this.key}`, "popup,width=1120,height=720");
        if (!w) { if (this.live.runner) this.live.runner.toast("The browser blocked the pop-up window. Allow pop-ups for this page and try again.", "warn"); return; }
        const d = w.document;
        d.title = `Oscilloscope ${this.key === "probes" ? "(probes)" : this.comp.name} - Browser SPICE`;
        for (const el of document.querySelectorAll('link[rel="stylesheet"], style')) d.head.appendChild(el.cloneNode(true));
        d.body.style.cssText = "margin:0;background:#20252b;overflow:hidden";
        this.docked = { left: this.root.style.left, top: this.root.style.top, width: this.root.style.width, height: this.root.style.height };
        d.body.appendChild(this.root);
        this.root.classList.add("popped");
        this.root.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;width:auto;height:auto;border:none;border-radius:0;box-shadow:none";
        this.popup = w;
        this.popped = true;
        cancelAnimationFrame(this.raf);
        this.win = w;
        this.onPopupClose = () => { if (this.popped && !this.stopped) this.dock(); };
        w.addEventListener("pagehide", this.onPopupClose);
        this.root.querySelector('[data-act="pop"]').textContent = "⇲";
        this.root.querySelector('[data-act="pop"]').title = "Dock the scope back into the app";
        this.loop();
    }

    dock() {
        if (!this.popped) return;
        const w = this.popup;
        this.popped = false;
        cancelAnimationFrame(this.raf);
        try { w.removeEventListener("pagehide", this.onPopupClose); } catch (e) { /* the popup is already gone */ }
        document.body.appendChild(this.root);
        this.root.classList.remove("popped");
        this.root.style.cssText = "";
        Object.assign(this.root.style, this.docked || {});
        this.win = window;
        this.popup = null;
        this.root.querySelector('[data-act="pop"]').textContent = "⧉";
        this.root.querySelector('[data-act="pop"]').title = "Pop out into its own window (and back)";
        try { w.close(); } catch (e) { /* ignore */ }
        this.loop();
    }

    static download(name, blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    // On the screen: with the cursors on, click or drag moves the nearer cursor. Otherwise dragging scrolls back through
    // the history (this stops the display, like pausing a real scope), and the wheel changes time/div.
    attachScreen() {
        const cv = this.canvas, root = this.root;
        const divAt = (e) => { const r = cv.getBoundingClientRect(); return Math.min(10, Math.max(0, ((e.clientX - r.left) / r.width) * 10)); };
        cv.addEventListener("pointerdown", (e) => {
            const s = this.s;
            if (s.xy || s.fft.on) return;
            if (s.cur.on) {
                const d = divAt(e), x = s.cur.x;
                const k = Math.abs(d - x[0]) <= Math.abs(d - x[1]) ? 0 : 1;
                x[k] = d;
                try { cv.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
                const move = (ev) => { x[k] = divAt(ev); };
                const up = () => { cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); };
                cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
                return;
            }
            const core = this.core;
            const r0 = cv.getBoundingClientRect(), px = e.clientX - r0.left, py = e.clientY - r0.top;
            const hit = this.pickChannel(px, py);
            if (hit) { this.sel = hit; this.markSelected(); }
            if (!core.last) return;
            if (e.shiftKey) {                    // shift-drag moves the selected channel up and down
                const ch = s.chan[this.sel];
                let lastY = e.clientY;
                try { cv.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
                const moveV = (ev) => { ch.pos = Math.max(-4, Math.min(4, ch.pos + (lastY - ev.clientY) / (this.H / 8))); lastY = ev.clientY; };
                const upV = () => { cv.removeEventListener("pointermove", moveV); cv.removeEventListener("pointerup", upV); this.syncControls(); };
                cv.addEventListener("pointermove", moveV); cv.addEventListener("pointerup", upV);
                return;
            }
            s.run = false;                       // grab the picture
            let lastX = e.clientX;
            try { cv.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
            const move = (ev) => {
                const dd = ((ev.clientX - lastX) / cv.getBoundingClientRect().width) * 10;      // divisions dragged
                lastX = ev.clientX;
                core.scrub(-dd * core.last.tdiv);
            };
            const up = () => { cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); this.syncControls(); };
            cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
        });
        cv.addEventListener("wheel", (e) => {
            e.preventDefault();
            if (e.shiftKey) {                         // shift + wheel: the selected channel's volts (amps) per division
                this.stepDiv(this.sel, e.deltaY > 0 || (e.deltaY === 0 && e.deltaX > 0) ? 1 : -1);
                this.syncControls();
                return;
            }
            const list = ScopeCore.TDIV, i = list.findIndex(v => v >= this.s.tdiv - 1e-15);
            const j = Math.min(list.length - 1, Math.max(0, (i < 0 ? list.length - 1 : i) + (e.deltaY > 0 ? 1 : -1)));
            this.s.tdiv = list[j];
            if (this.live.applyScopeResolution) this.live.applyScopeResolution();
            this.syncControls();
        }, { passive: false });
        const scrub = root.querySelector('[data-role="scrub"]');
        scrub.addEventListener("input", () => {
            const core = this.core, r = core.range();
            if (!r) return;
            this.s.run = false;
            core.seek(r.min + (Number(scrub.value) / 1000) * (r.max - r.min));
            this.syncControls();
        });
        cv.title = "Drag: scroll back through the history. Wheel: time/div. Shift+wheel: volts (amps) per div of the selected channel (click a trace or a channel row to select it). Shift+drag: move the selected channel. With Cursors on: click or drag to place the nearer cursor.";
    }

    close() {
        this.stopped = true;
        cancelAnimationFrame(this.raf);
        if (this.popup) { try { this.popup.removeEventListener("pagehide", this.onPopupClose); this.popup.close(); } catch (e) { /* ignore */ } }
        this.root.remove();
        ScopeWindow.windows.delete(this.key);
        if (this.live.applyScopeResolution) this.live.applyScopeResolution();
    }

    // ---- drawing ---------------------------------------------------------------------------------------

    loop() {
        const frame = (now) => {
            if (this.stopped) return;
            try { this.render(now); } catch (e) { console.error(e); }
            this.raf = this.win.requestAnimationFrame(frame);
        };
        this.raf = this.win.requestAnimationFrame(frame);
    }

    render(now = performance.now()) {
        // the component may have been replaced (undo, open): follow it by id
        const st = this.editor.sheetState(this.sheetId), comp = this.key === "probes" ? this.editor.probeScopeComp() : (st && st.components.find(c => c.id === this.compId));
        if (!comp) { this.close(); return; }
        if (comp !== this.comp) { this.comp = comp; comp.scope = ScopeCore.merge(comp.scope); this.idle = new ScopeCore(comp.scope); this.syncControls(); }
        this.fitCanvas();
        const core = this.core;
        const simOn = !!(this.live.scopes && this.live.scopes.has(this.key));
        core.frozen = simOn && this.live.state === "paused";               // a paused simulation holds the picture so it can be inspected
        const cap = core.capture();
        this.checkPauseOnTrigger(core, cap);
        if (this.shownRun !== this.s.run || this.shownMode !== this.s.trig.mode) { this.shownRun = this.s.run; this.shownMode = this.s.trig.mode; this.syncControls(); }   // e.g. SINGLE caught its trigger
        this.draw(core, cap);
        if (!this.lastMeas || now - this.lastMeas > 250) { this.lastMeas = now; this.measure(core, cap); this.syncControls(); }
        this.root.querySelector('[data-role="status"]').textContent = !simOn ? "NO SIM" : (this.live.state === "paused" ? "SIM PAUSED" : core.status);
        this.updateScrub(core);
    }

    // "Pause sim on trigger": the first trigger after the box was ticked stops the whole simulation there
    checkPauseOnTrigger(core, cap) {
        const s = this.s;
        if (!s.trig.pauseOnTrigger) { this.pauseArmedAt = null; return; }
        if (this.pauseArmedAt === null || this.pauseArmedAt === undefined) this.pauseArmedAt = core.tNow;
        if (cap && cap.trigged && cap.trigT > this.pauseArmedAt && this.live.state === "running") {
            s.trig.pauseOnTrigger = false; this.pauseArmedAt = null;
            this.live.pause();
            if (this.live.runner) this.live.runner.toast(`Paused at the trigger (t = ${Units.formatSI(cap.trigT, "s")}). Drag the screen or the bar below to look around, then Resume sim.`, "info");
            this.syncControls();
        }
    }

    // the scroll bar follows the recorded range; it only moves the picture when the display is stopped or the sim paused
    updateScrub(core) {
        const sc = this.root.querySelector('[data-role="scrub"]'), r = core.range();
        const held = !this.s.run || core.frozen;
        sc.disabled = !r;
        if (r && sc.ownerDocument.activeElement !== sc) sc.value = String(r.max > r.min ? Math.round(1000 * (r.mid - r.min) / (r.max - r.min)) : 1000);
        const hint = this.root.querySelector('[data-role="hint"]');
        hint.textContent = !r ? "" : held && r.max > r.min ? `Recorded ${Units.formatSI(r.min, "s")} to ${Units.formatSI(r.max, "s")}. Drag the screen or this bar to scroll; the wheel changes time/div.` : "Pause the simulation or Stop the display to scroll back; drag the screen to grab it.";
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
        const active = ScopeCore.ALL.filter(c => s.chan[c].on);

        if (!cap) {
            ctx.fillStyle = "#4f9d63"; ctx.font = "14px system-ui"; ctx.textAlign = "center";
            const live = this.live.scopes && this.live.scopes.has(this.key);
            ctx.fillText(live ? (s.trig.mode === "single" ? "Waiting for a trigger…" : s.trig.mode === "normal" ? "Waiting for a trigger…" : "Waiting for samples…") : "Press Play (F12) to start the simulation", W / 2, H / 2 - 8);
            if (!live) { ctx.font = "11px system-ui"; ctx.fillText("Wire the circuit to inputs A–D of the scope", W / 2, H / 2 + 12); }
        } else if (s.fft.on) {
            this.drawSpectrum(ctx, core, cap, W, H, dx, dy);
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
                ctx.strokeStyle = ScopeCore.COLORS[c]; ctx.lineWidth = c === this.sel && active.length > 1 ? 2.8 : 1.8; ctx.lineJoin = "round";
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

        if (cap && !s.xy && !s.fft.on) {
            // saved reference traces, drawn grey under the channel's current scale
            ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
            this.refs.forEach((r, k) => {
                for (const c of Object.keys(r.traces)) {
                    ctx.strokeStyle = `rgba(200,205,215,${0.35 + 0.1 * k})`; ctx.lineWidth = 1.2; ctx.setLineDash([5, 3]); ctx.beginPath();
                    let st = false;
                    r.traces[c].forEach((v, i) => { if (!Number.isFinite(v)) { st = false; return; } const px = (i / (r.traces[c].length - 1)) * W, py = yOf(v, c); if (st) ctx.lineTo(px, py); else { ctx.moveTo(px, py); st = true; } });
                    ctx.stroke();
                }
            });
            ctx.restore(); ctx.setLineDash([]);
            // the live traces are drawn after these (below), so redraw them on top
            ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
            for (const c of active) {
                if (!this.refs.length) break;
                const ys = core.samples(c, W, cap);
                ctx.strokeStyle = ScopeCore.COLORS[c]; ctx.lineWidth = 1.8; ctx.beginPath(); let st = false;
                ys.forEach((v, i) => { if (!Number.isFinite(v)) { st = false; return; } const py = yOf(v, c); if (st) ctx.lineTo(i, py); else { ctx.moveTo(i, py); st = true; } });
                ctx.stroke();
            }
            ctx.restore();
            if (s.cur.on) this.drawCursors(ctx, core, cap, W, H, dx, yOf);
        }

        // markers: channel zero levels on the left, trigger level on the right, trigger position on top
        for (const c of s.fft.on ? [] : active) {
            const y = yOf(0, c);
            ctx.fillStyle = ScopeCore.COLORS[c];
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(9, y - 5); ctx.lineTo(9, y + 5); ctx.closePath(); ctx.fill();
        }
        if (!s.xy && !s.fft.on && s.chan[s.trig.src] && s.chan[s.trig.src].on) {
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
        for (const c of active) { ctx.fillStyle = ScopeCore.COLORS[c]; const txt = `${c} ${Units.formatSI(s.chan[c].vdiv, core.unitOf(c))}${s.chan[c].coup === "DC" ? "" : " " + s.chan[c].coup}`; ctx.fillText(txt, x, H - 6); x += ctx.measureText(txt).width + 14; }
        ctx.fillStyle = "#e8edf5";
        const info = s.xy ? "XY" : `${Units.formatSI(s.tdiv, "s")}/div   T ${s.trig.src}${s.trig.slope === "rise" ? "↑" : "↓"} ${Units.formatSI(s.trig.level, core.unitOf(s.trig.src))}`;
        ctx.textAlign = "right"; ctx.fillText(info, W - 6, H - 6);
    }

    drawCursors(ctx, core, cap, W, H, dx, yOf) {
        const s = this.s, ch = s.cur.ch;
        ctx.save();
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center";
        s.cur.x.forEach((d, k) => {
            const x = d * dx;
            ctx.strokeStyle = "#e8edf5"; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = "#e8edf5"; ctx.fillText(String(k + 1), x, 12);
            const v = core.voltageAt(ch, d, cap);
            if (v !== null && s.chan[ch].on) { ctx.fillStyle = ScopeCore.COLORS[ch]; ctx.beginPath(); ctx.arc(x, yOf(v, ch), 4, 0, 7); ctx.fill(); }
            ctx.setLineDash([6, 4]);
        });
        ctx.restore();
    }

    // spectrum of one channel across the displayed window: 0 .. a useful frequency, 10 dB per division
    drawSpectrum(ctx, core, cap, W, H, dx, dy) {
        const s = this.s, c = s.fft.chan;
        this.fftInfo = null;
        const sp = cap ? core.spectrum(c, cap, s.fft.window) : null;
        ctx.font = "13px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#4f9d63";
        if (!sp) { ctx.fillText(cap ? `Channel ${c} is off or grounded` : "Waiting for samples…", W / 2, H / 2); return; }
        const f1 = sp.fundamental ? sp.fundamental.f : 0;
        let K = sp.freq.length;
        if (f1) K = Math.min(K, Math.ceil((12 * f1) / (sp.freq[1] || 1)) + 2);
        const fmax = sp.freq[K - 1];
        const peak = Math.max(...Array.from(sp.db).slice(1, K));
        const top = Math.ceil(peak / 10) * 10 + (peak > -1e8 ? 0 : 0);
        const yOf = (db) => ((top - db) / 10) * dy;
        ctx.strokeStyle = ScopeCore.COLORS[c]; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let k = 1; k < K; k++) {
            const x = (sp.freq[k] / fmax) * W, y = Math.min(H, Math.max(0, yOf(Math.max(sp.db[k], top - 80))));
            if (k === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = "#8fbf9a"; ctx.font = "10px Consolas, monospace"; ctx.textAlign = "left";
        for (let j = 0; j <= 8; j += 2) ctx.fillText(`${top - j * 10} dBV`, 4, Math.max(10, j * dy - 3));
        ctx.textAlign = "right";
        for (let i = 2; i <= 10; i += 2) ctx.fillText(Units.formatSI((i / 10) * fmax, "Hz"), i * dx - 3, H - 18);
        this.fftInfo = { sp, f1 };
    }

    measureFFT(core = this.core) {
        const el = this.root.querySelector('[data-role="fftread"]');
        const i = this.fftInfo;
        if (!i) { el.textContent = ""; return; }
        const f = i.sp.fundamental;
        el.innerHTML = f ? `Fundamental ${Units.formatSI(f.f, "Hz")}, ${(20 * Math.log10(f.mag)).toFixed(1)} dBV<br>THD ${(i.sp.thd * 100).toFixed(2)} %   DC ${Units.formatSI(i.sp.mean, core.unitOf(this.s.fft.chan))}` : "No tone found";
    }

    measureCursors(core, cap) {
        const el = this.root.querySelector('[data-role="cur"]');
        const r = cap ? core.cursorReadout(cap) : null;
        if (!r) { el.textContent = ""; return; }
        const u = core.unitOf(this.s.cur.ch), v = (x) => (x === null ? "—" : Units.formatSI(x, u));
        el.innerHTML = `1: ${Units.formatSI(r.t1, "s")}, ${v(r.v1)}<br>2: ${Units.formatSI(r.t2, "s")}, ${v(r.v2)}<br>Δt ${Units.formatSI(Math.abs(r.dt), "s")} (${r.freq ? Units.formatSI(r.freq, "Hz") : "—"})   ΔV ${v(r.dv)}`;
    }

    measure(core, cap) {
        if (this.s.cur.on) this.measureCursors(core, cap);
        if (this.s.fft.on) this.measureFFT(core);
        const table = this.root.querySelector('[data-role="meas"]');
        const f = (v, u) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Units.formatSI(v, u));
        const rows = ScopeCore.ALL.filter(c => this.s.chan[c].on).map(c => {
            const m = cap ? core.measure(c, cap) : null, u = core.unitOf(c);
            return `<tr style="color:${ScopeCore.COLORS[c]}"><td title="${PropertiesPanel.esc(core.labelOf(c))}">${c}</td><td>${m ? f(m.vpp, u) : "—"}</td><td>${m ? f(m.vrms, u) : "—"}</td><td>${m ? f(m.vavg, u) : "—"}</td><td>${m ? f(m.freq, "Hz") : "—"}</td></tr>`;
        });
        table.innerHTML = `<tr><th></th><th>Pk-pk</th><th>RMS</th><th>Mean</th><th>Freq</th></tr>${rows.join("")}`;
    }
}

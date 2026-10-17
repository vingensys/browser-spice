// Debug > Memory...: a hex view of a memory chip's contents (ROM image or RAM, live while the simulation runs or is paused),
// with the bytes that changed since the last refresh highlighted, and an export of the current image as Intel HEX.

class MemoryWindow {
    static current = null;

    // the memory chips on the sheet (the ones with contents to look at)
    static chips(editor) { return editor.components.filter(c => PartLib.defs[c.type] && LOGIC_ICS[c.type] && LOGIC_ICS[c.type].memory); }

    static open(editor, live, comp = null) {
        const chips = MemoryWindow.chips(editor);
        if (!chips.length) { if (live.runner) live.runner.toast("There is no memory chip (ROM / RAM) on the sheet. Add one from Pick Devices > Memory.", "info"); return null; }
        let w = MemoryWindow.current;
        if (!w) w = MemoryWindow.current = new MemoryWindow(editor, live);
        w.root.style.display = "flex";
        if (comp) w.chip = comp.name;
        w.render(true);
        return w;
    }

    static close() { if (MemoryWindow.current) { MemoryWindow.current.close(); } }

    constructor(editor, live) {
        this.editor = editor; this.live = live;
        this.chip = null; this.prev = null; this.prevChip = null; this.changed = new Set();
        const root = document.createElement("div");
        root.className = "mem-win";
        root.innerHTML = `<div class="mem-title"><span>MEMORY</span><select data-role="chip"></select><span class="mem-status" data-role="status"></span>
                <button data-act="hex" title="Download the current contents as an Intel HEX file">Export .hex</button><button class="mem-close" title="Close">✕</button></div>
            <div class="mem-body" data-role="body"></div>`;
        document.body.appendChild(root);
        this.root = root;
        root.style.left = "120px"; root.style.top = "90px";
        const bar = root.querySelector(".mem-title");
        bar.addEventListener("pointerdown", (e) => {
            if (e.target.closest("button,select")) return;
            const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
            try { bar.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
            const move = (ev) => { root.style.left = `${Math.max(0, ev.clientX - dx)}px`; root.style.top = `${Math.max(0, ev.clientY - dy)}px`; };
            const up = () => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); };
            bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
        });
        root.querySelector(".mem-close").onclick = () => this.close();
        root.querySelector('[data-role="chip"]').onchange = (e) => { this.chip = e.target.value; this.render(true); };
        root.querySelector('[data-act="hex"]').onclick = () => this.exportHex();
        this.timer = setInterval(() => this.render(), 250);
    }

    close() {
        clearInterval(this.timer);
        this.root.remove();
        MemoryWindow.current = null;
    }

    // the chip's words now: from the running engine if there is one, else the part's own image
    image() {
        const comp = this.editor.components.find(c => c.name === this.chip);
        if (!comp) return null;
        const spec = LOGIC_ICS[comp.type], m = spec.memory;
        const el = this.live.engine && this.live.run ? this.live.engine.c.elements.find(e => e.name === comp.name && e.memoryImage) : null;
        if (el) return { words: el.memoryImage(), spec, comp, live: true };
        return { words: Uint16Array.from(LogicIC.parseMemory(comp.mem || "", m.size, m.bits)), spec, comp, live: false };
    }

    render(force = false) {
        const chips = MemoryWindow.chips(this.editor);
        const sel = this.root.querySelector('[data-role="chip"]');
        if (!chips.length) { this.close(); return; }
        if (!this.chip || !chips.some(c => c.name === this.chip)) this.chip = chips[0].name;
        const sig = chips.map(c => c.name).join("|");
        if (sel.dataset.sig !== sig) { sel.innerHTML = chips.map(c => `<option>${PropertiesPanel.esc(c.name)}</option>`).join(""); sel.dataset.sig = sig; }
        if (sel.ownerDocument.activeElement !== sel) sel.value = this.chip;
        const img = this.image();
        if (!img) return;
        const { words, spec } = img, m = spec.memory, digits = m.bits > 8 ? 4 : 2;
        // what changed since the last look (only meaningful for the same chip)
        if (this.prevChip !== this.chip) { this.prev = null; this.prevChip = this.chip; this.changed = new Set(); }
        if (this.prev && this.prev.length === words.length) for (let i = 0; i < words.length; i++) if (words[i] !== this.prev[i]) this.changed.add(i);
        this.prev = Uint16Array.from(words);
        this.root.querySelector('[data-role="status"]').textContent = `${spec.title}  ${m.size.toLocaleString()} x ${m.bits}  ${img.live ? (this.live.state === "running" ? "LIVE" : "PAUSED") : "image"}`;
        const body = this.root.querySelector('[data-role="body"]');
        const per = 16, rows = Math.min(Math.ceil(m.size / per), 4096);
        // rebuild the table only when the chip or its size changed; otherwise update the cells in place
        if (force || body.dataset.chip !== this.chip) {
            const aw = Math.max(4, (m.size - 1).toString(16).length);
            let html = `<table class="mem-table"><tr><th></th>${Array.from({ length: per }, (_, i) => `<th>${i.toString(16).toUpperCase()}</th>`).join("")}<th>ASCII</th></tr>`;
            for (let r = 0; r < rows; r++) html += `<tr><th>${(r * per).toString(16).toUpperCase().padStart(aw, "0")}</th>${Array.from({ length: per }, (_, i) => `<td data-a="${r * per + i}"></td>`).join("")}<td class="mem-ascii" data-r="${r}"></td></tr>`;
            body.innerHTML = html + "</table>";
            body.dataset.chip = this.chip;
            this.cells = [...body.querySelectorAll("td[data-a]")];
            this.ascii = [...body.querySelectorAll("td.mem-ascii")];
        }
        this.cells.forEach((td, a) => {
            if (a >= words.length) return;
            const t = words[a].toString(16).toUpperCase().padStart(digits, "0");
            if (td.textContent !== t) td.textContent = t;
            td.classList.toggle("chg", this.changed.has(a));
            td.classList.toggle("nz", words[a] !== 0);
        });
        this.ascii.forEach((td, r) => {
            let s = "";
            for (let i = 0; i < per; i++) { const w = words[r * per + i]; s += w >= 32 && w < 127 && m.bits <= 8 ? String.fromCharCode(w) : "."; }
            if (td.textContent !== s) td.textContent = s;
        });
    }

    exportHex() {
        const img = this.image();
        if (!img) return;
        const words = img.words, lines = [];
        const hex2 = (v) => (v & 255).toString(16).toUpperCase().padStart(2, "0");
        const rec = (addr, type, data) => { const body = [data.length, (addr >> 8) & 255, addr & 255, type, ...data]; const sum = (256 - (body.reduce((a, b) => a + b, 0) & 255)) & 255; lines.push(":" + body.map(hex2).join("") + hex2(sum)); };
        let seg = 0;
        for (let a = 0; a < words.length; a += 16) {
            if ((a >> 16) !== seg) { seg = a >> 16; rec(0, 4, [(seg >> 8) & 255, seg & 255]); }
            rec(a & 0xFFFF, 0, Array.from(words.slice(a, a + 16), v => v & 255));
        }
        rec(0, 1, []);
        ScopeWindow.download(`${img.comp.name}.hex`, new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
    }
}

// The microcontroller debugger (Debug > Microcontroller…, or Debug… in the chip's properties): the program with the instruction about to
// run, breakpoints (click an address), the registers, the I/O pins, RAM and EEPROM; Step runs one instruction. It reads the running
// chip (PicMcu) from the simulation, or shows the program as loaded when nothing is running.

class McuWindow {
    static current = null;

    static chips(editor) { return editor.components.filter(c => c.type === "PIC16F84A"); }

    static open(editor, live, comp = null) {
        const chips = McuWindow.chips(editor);
        if (!chips.length) { if (live.runner) live.runner.toast("There is no microcontroller on the sheet. Add a PIC16F84A from Pick Devices > Microcontrollers.", "info"); return null; }
        let w = McuWindow.current;
        if (!w) w = McuWindow.current = new McuWindow(editor, live);
        w.root.style.display = "flex";
        if (comp) w.chip = comp.name;
        w.render(true);
        return w;
    }

    static close() { if (McuWindow.current) McuWindow.current.close(); }

    constructor(editor, live) {
        this.editor = editor; this.live = live;
        this.chip = null; this.prevRam = null; this.changed = new Set();
        const root = document.createElement("div");
        root.className = "mcu-win";
        root.innerHTML = `<div class="mcu-title"><span>MICROCONTROLLER</span><select data-role="chip"></select><span class="mem-status" data-role="status"></span><button class="mem-close" title="Close">✕</button></div>
            <div class="mcu-bar"><button data-act="step" title="Run one instruction (the simulation advances to its end)">Step</button><button data-act="step10">Step ×10</button>
                <button data-act="go" title="Run (the simulation's Play) until a breakpoint">Run</button><button data-act="pause">Pause</button><button data-act="reset" title="Restart the simulation: the chip resets">Reset</button>
                <span class="u" data-role="hint"></span></div>
            <div class="mcu-main"><div class="mcu-prog" data-role="prog"></div><div class="mcu-side" data-role="side"></div></div>`;
        document.body.appendChild(root);
        this.root = root;
        root.style.left = "80px"; root.style.top = "70px";
        const bar = root.querySelector(".mcu-title");
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
        root.addEventListener("click", (e) => {
            const b = e.target.closest("button[data-act]");
            if (b) { this.act(b.dataset.act); return; }
            const row = e.target.closest("tr[data-addr]");
            if (row && e.target.closest("td.bp")) this.toggleBreakpoint(Number(row.dataset.addr));
        });
        this.timer = setInterval(() => this.render(), 200);
    }

    close() { clearInterval(this.timer); this.root.remove(); McuWindow.current = null; }

    comp() { return this.editor.components.find(c => c.name === this.chip); }
    element() { return this.live.engine && this.live.run ? this.live.engine.c.elements.find(e => e.name === this.chip && e.core) || null : null; }

    toggleBreakpoint(addr) {
        const comp = this.comp();
        if (!comp) return;
        const set = new Set(Array.isArray(comp.bps) ? comp.bps : []);
        if (set.has(addr)) set.delete(addr); else set.add(addr);
        comp.bps = [...set].sort((a, b) => a - b);
        const el = this.element();
        if (el) { el.bps.clear(); comp.bps.forEach(a => el.bps.add(a)); el.makePlan(); }       // the plan stops at the new breakpoint
        this.render(true);
    }

    act(name) {
        const live = this.live, el = this.element();
        if (name === "go") { if (el) el.passBp = el.core.pc; if (live.state === "paused" || live.state === "stopped") live.start(); }
        else if (name === "pause") live.pause();
        else if (name === "reset") { live.restart(); if (live.state === "stopped") live.start(); }
        else if (name === "step" || name === "step10") live.stepMcu(this.chip, name === "step" ? 1 : 10);
        this.render();
    }

    render(force = false) {
        const chips = McuWindow.chips(this.editor);
        if (!chips.length) { this.close(); return; }
        const sel = this.root.querySelector('[data-role="chip"]');
        if (!this.chip || !chips.some(c => c.name === this.chip)) this.chip = chips[0].name;
        const sig = chips.map(c => c.name).join("|");
        if (sel.dataset.sig !== sig) { sel.innerHTML = chips.map(c => `<option>${PropertiesPanel.esc(c.name)}</option>`).join(""); sel.dataset.sig = sig; }
        if (sel.ownerDocument.activeElement !== sel) sel.value = this.chip;
        const comp = this.comp();
        let prog;
        try { prog = PicMcu.program({ src: comp.src, hex: comp.hex }); } catch (e) { this.root.querySelector('[data-role="prog"]').innerHTML = `<div class="prop-note" style="color:#ff8080;padding:8px">${PropertiesPanel.esc(e.message)}</div>`; return; }
        const el = this.element(), core = el ? el.core : null;
        const bps = new Set(el ? el.bps : (Array.isArray(comp.bps) ? comp.bps : []));
        const pc = core ? core.pc : 0;
        const state = el ? (el.held ? "IN RESET" : core.sleeping ? "SLEEP" : this.live.state === "running" ? "RUNNING" : "PAUSED") : "not running";
        this.root.querySelector('[data-role="status"]').textContent = `${state}${core ? `  t = ${Units.formatSI(el.cpuT, "s")}  ${core.cycles.toLocaleString()} cycles` : ""}`;
        this.root.querySelector('[data-role="hint"]').textContent = bps.size ? `breakpoints: ${[...bps].map(a => "0x" + a.toString(16).toUpperCase().padStart(3, "0")).join(" ")}` : "click an address to set a breakpoint";

        // the program: assembled listing if there is one, else a disassembly of the loaded words
        const progEl = this.root.querySelector('[data-role="prog"]');
        const rows = prog.listing ? prog.listing.slice().sort((a, b) => a.addr - b.addr) : (() => { const out = []; prog.words.forEach((w, a) => { if (w !== 0x3FFF) out.push({ addr: a, word: w, text: "" }); }); return out; })();
        const key = this.chip + "|" + rows.length + "|" + [...bps].join(",") + "|" + (rows[0] ? rows[0].word : "") + "|" + (rows.length ? rows[rows.length - 1].word : "");
        if (force || progEl.dataset.key !== key) {
            progEl.innerHTML = `<table class="mcu-table">${rows.map(r => `<tr data-addr="${r.addr}"><td class="bp${bps.has(r.addr) ? " on" : ""}" title="Click to set or clear a breakpoint">${bps.has(r.addr) ? "●" : ""}</td><td class="ad">${r.addr.toString(16).toUpperCase().padStart(3, "0")}</td><td class="wd">${r.word.toString(16).toUpperCase().padStart(4, "0")}</td><td class="ds">${PropertiesPanel.esc(PicAsm.disasm(r.word))}</td><td class="sr">${PropertiesPanel.esc((r.text || "").trim())}</td></tr>`).join("")}</table>`;
            progEl.dataset.key = key;
        }
        let cur = null;
        for (const tr of progEl.querySelectorAll("tr")) { const on = core && Number(tr.dataset.addr) === pc; tr.classList.toggle("pc", !!on); if (on) cur = tr; }
        if (cur && el && this.lastPc !== pc) { cur.scrollIntoView({ block: "nearest" }); }
        this.lastPc = pc;

        // registers, ports, memory
        const side = this.root.querySelector('[data-role="side"]');
        const hx = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, "0");
        const flags = (v, names) => names.map((n, i) => `<span class="${(v >> (7 - i)) & 1 ? "on" : ""}">${n}</span>`).join("");
        if (!core) { side.innerHTML = `<div class="prop-note" style="padding:8px">Press Play (F12), or Step, to start the chip. The registers appear here while it runs.</div>`; return; }
        const s = core.sfr, d = core.driven();
        const ports = (name, bits, tris, latch, pins, dr) => `<tr><th>${name}</th>${Array.from({ length: bits }, (_, i) => bits - 1 - i).map(i => {
            const out = dr[i] !== "in";
            return `<td class="${(pins >> i) & 1 ? "hi" : "lo"} ${out ? "out" : "inp"}" title="${name}${i}: ${out ? "output" : "input"}, pin ${(pins >> i) & 1 ? "high" : "low"}">${i}</td>`;
        }).join("")}</tr>`;
        const ram = Array.from({ length: 68 }, (_, i) => core.ram[0x0C + i]);
        if (this.prevRamChip !== this.chip) { this.prevRam = null; this.changed = new Set(); this.prevRamChip = this.chip; }
        if (this.prevRam) ram.forEach((v, i) => { if (v !== this.prevRam[i]) this.changed.add(i); });
        this.prevRam = ram.slice();
        const stack = Array.from({ length: 8 }, (_, i) => core.stack[i]);
        side.innerHTML = `<table class="mcu-regs"><tr><th>PC</th><td>${hx(pc, 3)}</td><th>W</th><td>${hx(core.w)}</td><th>FSR</th><td>${hx(s.fsr)}</td><th>PCLATH</th><td>${hx(s.pclath)}</td></tr>
            <tr><th>TMR0</th><td>${hx(s.tmr0)}</td><th>OPTION</th><td colspan="2">${hx(s.option)}</td><th>EEADR</th><td>${hx(s.eeadr)}</td><th>EEDATA</th><td>${hx(s.eedata)}</td></tr></table>
            <div class="mcu-flags"><b>STATUS</b> ${flags(s.status, ["IRP", "RP1", "RP0", "TO", "PD", "Z", "DC", "C"])}</div>
            <div class="mcu-flags"><b>INTCON</b> ${flags(s.intcon, ["GIE", "EEIE", "T0IE", "INTE", "RBIE", "T0IF", "INTF", "RBIF"])}</div>
            <table class="mcu-ports"><tr><th></th><td class="u" colspan="8">pin levels (blue = output)</td></tr>${ports("PORTA", 5, s.trisA, s.latchA, core.pins.a, d.a)}${ports("PORTB", 8, s.trisB, s.latchB, core.pins.b, d.b)}</table>
            <div class="mcu-flags"><b>Stack</b> ${stack.map((v, i) => `<span class="${i === ((core.sp - 1) & 7) && core.sp ? "on" : ""}">${hx(v, 3)}</span>`).join(" ")}</div>
            <div class="mcu-ram"><b>RAM 0C-4F</b><div class="mcu-grid">${ram.map((v, i) => `<span class="${this.changed.has(i) ? "chg" : ""}${v ? " nz" : ""}" title="${hx(0x0C + i)}">${hx(v)}</span>`).join("")}</div></div>
            <div class="mcu-ram"><b>EEPROM</b><div class="mcu-grid">${Array.from(core.eeprom, v => `<span class="${v ? "nz" : ""}">${hx(v)}</span>`).join("")}</div></div>`;
    }
}

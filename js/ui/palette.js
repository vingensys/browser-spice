// Command palette (Ctrl+K): type a few letters of any command and press Enter.

const Palette = {
    open() {
        const all = [...Commands.all.values()].filter(c => c.label && c.id !== "palette.open");
        const wrap = document.createElement("div");
        wrap.className = "palette";
        wrap.innerHTML = `<input type="text" class="palette-input" placeholder="Type a command…" autocomplete="off"><div class="palette-list"></div>`;
        const input = wrap.querySelector("input"), list = wrap.querySelector(".palette-list");
        let hits = [], sel = 0;
        const score = (title, q) => {
            const t = title.toLowerCase(); if (!q) return 1;
            if (t.startsWith(q)) return 100; if (t.includes(q)) return 50;
            let i = 0; for (const ch of t) if (ch === q[i]) i++;
            return i === q.length ? 10 : 0;
        };
        const render = () => {
            const q = input.value.trim().toLowerCase();
            hits = all.map(c => ({ c, s: score(c.label, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label)).slice(0, 12).map(x => x.c);
            sel = Math.min(sel, Math.max(hits.length - 1, 0));
            list.innerHTML = hits.map((c, i) => {
                const en = Commands.enabled(c.id) !== false;
                return `<div class="palette-row${i === sel ? " sel" : ""}${en ? "" : " off"}" data-i="${i}"><span>${PropertiesPanel.esc(c.label)}</span><kbd>${PropertiesPanel.esc(c.keys || "")}</kbd></div>`;
            }).join("") || `<div class="palette-row off">No command matches</div>`;
            list.querySelectorAll(".palette-row[data-i]").forEach(el => { el.onclick = () => run(Number(el.dataset.i)); });
        };
        const run = (i) => { const c = hits[i]; if (!c || Commands.enabled(c.id) === false) return; Dialog.close("run"); setTimeout(() => Commands.run(c.id), 0); };
        input.oninput = () => { sel = 0; render(); };
        input.onkeydown = (e) => {
            if (e.key === "ArrowDown") { sel = Math.min(sel + 1, hits.length - 1); render(); e.preventDefault(); }
            else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
            else if (e.key === "Enter") { run(sel); e.preventDefault(); e.stopPropagation(); }
        };
        render();
        Dialog.open({ title: "Command Palette", content: wrap, width: "520px", buttons: [] });
        setTimeout(() => input.focus(), 0);
    }
};

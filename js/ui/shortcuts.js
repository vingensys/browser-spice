// Customisable keyboard shortcuts. Commands marked `global` can be given another key (or none) in
// Help > Customize Shortcuts…; the choice is kept in this browser. The editor's own editing keys
// (R, X, Y, W, Del …) act inside the schematic and are listed as fixed.

const Shortcuts = {
    KEY: "browser-spice/shortcuts",

    defaults: new Map(),         // id -> the key a command shipped with

    load() {
        try { const o = JSON.parse(localStorage.getItem(Shortcuts.KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
    },

    save(o) { try { localStorage.setItem(Shortcuts.KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } },

    // remember the shipped keys, then apply the saved choices
    init() {
        for (const c of Commands.all.values()) if (!Shortcuts.defaults.has(c.id)) Shortcuts.defaults.set(c.id, c.keys || "");
        const o = Shortcuts.load();
        for (const [id, keys] of Object.entries(o)) { const c = Commands.get(id); if (c && c.global) c.keys = keys; }
        Shortcuts.paintMenus();
    },

    // "Ctrl+Shift+K" from a keydown; null for a lone modifier
    describe(e) {
        const k = e.key;
        if (!k || ["Control", "Shift", "Alt", "Meta"].includes(k)) return null;
        const name = k === " " ? "Space" : k === "Escape" ? "Esc" : k === "Delete" ? "Del" : k.length === 1 ? k.toUpperCase() : k;
        return [(e.ctrlKey || e.metaKey) ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey && !(k.length === 1 && !/[a-z0-9]/i.test(k)) ? "Shift" : "", name].filter(Boolean).join("+");
    },

    // the command that already uses `keys`, if any (other than `except`)
    owner(keys, except) {
        if (!keys) return null;
        for (const c of Commands.all.values()) if (c.id !== except && c.keys && c.keys.toLowerCase() === keys.toLowerCase()) return c;
        return null;
    },

    // returns an error message, or null when the key was set
    set(id, keys) {
        const c = Commands.get(id);
        if (!c || !c.global) return "This key is fixed.";
        const other = Shortcuts.owner(keys, id);
        if (other) return `${keys} is already used by "${other.label}".`;
        c.keys = keys;
        const o = Shortcuts.load();
        if (keys === (Shortcuts.defaults.get(id) || "")) delete o[id]; else o[id] = keys;
        Shortcuts.save(o);
        Shortcuts.paintMenus();
        return null;
    },

    resetAll() {
        Shortcuts.save({});
        for (const [id, keys] of Shortcuts.defaults) { const c = Commands.get(id); if (c && c.global) c.keys = keys; }
        Shortcuts.paintMenus();
    },

    paintMenus() {
        document.querySelectorAll("#menubar .menu-item[data-cmd]").forEach(row => {
            const c = Commands.get(row.dataset.cmd), k = row.querySelector(".keys");
            if (c && k) k.textContent = c.keys || "";
        });
    },

    open() {
        const wrap = document.createElement("div");
        wrap.className = "shortcuts-dlg";
        const msg = document.createElement("div"); msg.className = "prop-note";
        const table = document.createElement("table"); table.style.borderCollapse = "collapse";
        const cmds = [...Commands.all.values()].filter(c => c.label && (c.global || c.keys));
        const rowsOf = () => {
            table.innerHTML = "";
            for (const c of cmds.sort((a, b) => (b.global ? 1 : 0) - (a.global ? 1 : 0) || a.label.localeCompare(b.label))) {
                const tr = document.createElement("tr");
                const td1 = document.createElement("td"); td1.textContent = c.label; td1.style.padding = "2px 14px 2px 0";
                const td2 = document.createElement("td");
                if (c.global) {
                    const inp = document.createElement("input");
                    inp.value = c.keys || ""; inp.placeholder = "(none)"; inp.size = 16; inp.readOnly = true; inp.title = "Click, then press the new key. Backspace clears it.";
                    inp.setAttribute("aria-label", `Shortcut for ${c.label}`);
                    inp.onkeydown = (e) => {
                        e.preventDefault(); e.stopPropagation();
                        if (e.key === "Tab") { return; }
                        const keys = e.key === "Backspace" && !e.ctrlKey && !e.altKey ? "" : Shortcuts.describe(e);
                        if (keys === null) return;
                        const err = Shortcuts.set(c.id, keys);
                        msg.textContent = err || "";
                        inp.value = c.keys || "";
                    };
                    td2.appendChild(inp);
                } else td2.textContent = c.keys || "";
                const td3 = document.createElement("td"); td3.className = "dim"; td3.style.paddingLeft = "10px";
                td3.textContent = c.global ? "" : "fixed";
                tr.append(td1, td2, td3); table.appendChild(tr);
            }
        };
        rowsOf();
        const box = document.createElement("div"); box.style.cssText = "max-height:55vh;overflow:auto"; box.appendChild(table);
        wrap.append(msg, box);
        Dialog.open({
            title: "Customize Shortcuts", content: wrap, width: "520px",
            buttons: [{ label: "Reset all", onClick: () => { Shortcuts.resetAll(); rowsOf(); msg.textContent = "Back to the shipped keys."; return false; } }, { label: "Close", primary: true }]
        });
    }
};

// One registry of commands feeds the menus, the toolbars and the keyboard, so a feature
// is defined once and shows up everywhere (with its shortcut and enabled state).

const Commands = {
    all: new Map(),

    add(def) {
        Commands.all.set(def.id, def);
        return def;
    },

    get(id) { return Commands.all.get(id); },

    run(id) {
        const c = Commands.all.get(id);
        if (!c || Commands.enabled(id) === false) return;
        c.run();
        Commands.refresh();
    },

    enabled(id) {
        const c = Commands.all.get(id);
        return c && (typeof c.enabled === "function" ? c.enabled() : c.enabled !== false);
    },

    checked(id) {
        const c = Commands.all.get(id);
        return !!(c && typeof c.checked === "function" && c.checked());
    },

    listeners: [],
    onRefresh(fn) { Commands.listeners.push(fn); },
    refresh() { Commands.listeners.forEach(fn => fn()); },

    // "Ctrl+Shift+S" style accelerator test against a KeyboardEvent
    matches(keys, e) {
        const parts = keys.toLowerCase().split("+");
        const key = parts.pop();
        const want = { ctrl: parts.includes("ctrl"), shift: parts.includes("shift"), alt: parts.includes("alt") };
        if (!!(e.ctrlKey || e.metaKey) !== want.ctrl || e.shiftKey !== want.shift || e.altKey !== want.alt) return false;
        const k = (e.key || "").toLowerCase();
        return k === key || (key === "space" && e.code === "Space") || (key === "esc" && k === "escape");
    },

    // global shortcuts (the schematic editor handles its own editing keys)
    bindKeyboard() {
        document.addEventListener("keydown", (e) => {
            const a = document.activeElement;
            if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return;
            for (const c of Commands.all.values()) {
                if (c.global && c.keys && Commands.matches(c.keys, e)) {
                    e.preventDefault();
                    Commands.run(c.id);
                    return;
                }
            }
        });
    }
};

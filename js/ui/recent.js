// Recent designs. A browser cannot reopen a file from disk by name, so each save / open keeps a
// copy (newest first, at most MAX, each under LIMIT characters) in localStorage.

const RecentDesigns = {
    KEY: "browser-spice/recent", MAX: 8, LIMIT: 400000,

    list() {
        try { const a = JSON.parse(localStorage.getItem(RecentDesigns.KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    },

    add(name, state) {
        if (!name) return false;
        let text;
        try { text = JSON.stringify(state); } catch (e) { return false; }
        if (text.length > RecentDesigns.LIMIT) return false;
        const rest = RecentDesigns.list().filter(r => r.name !== name);
        const next = [{ name, at: Date.now(), text }, ...rest].slice(0, RecentDesigns.MAX);
        while (next.length) {
            try { localStorage.setItem(RecentDesigns.KEY, JSON.stringify(next)); return true; } catch (e) { next.pop(); }
        }
        return false;
    },

    get(name) {
        const r = RecentDesigns.list().find(x => x.name === name);
        if (!r) return null;
        try { return JSON.parse(r.text); } catch (e) { return null; }
    },

    clear() { try { localStorage.removeItem(RecentDesigns.KEY); } catch (e) { /* ignore */ } }
};

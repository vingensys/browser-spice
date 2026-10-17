// The design file format: its name, its version, how an older file is brought up to date, and a structural check.
// Pure data in, data out (no DOM), so the app, the tests and the MCP server can all use it. See docs/FILE-FORMAT.md.
//
//   v0  no "format" field; the view was panX / panY at the top level (the first saved files)
//   v1  "browser-spice/1": components, wires, probes, sheets, params, measures, subckts, pcb, view, settings
//   v2  "browser-spice/2": the same content, every list always present, so readers need no defaults

class DesignFormat {
    static NAME = "browser-spice";
    static VERSION = 2;

    // each entry upgrades a state of version N to N + 1; it gets a private copy and returns it
    static MIGRATIONS = {
        0: (s) => {
            if (!s.view) s.view = { zoom: 1, panX: Number(s.panX) || 0, panY: Number(s.panY) || 0 };
            delete s.panX; delete s.panY;
            return s;
        },
        1: (s) => {
            for (const k of ["wires", "probes", "measures", "params", "subckts"]) if (!Array.isArray(s[k])) s[k] = [];
            if (!s.titleBlock || typeof s.titleBlock !== "object") s.titleBlock = {};
            if (!s.view || typeof s.view !== "object") s.view = { zoom: 1, panX: 0, panY: 0 };
            return s;
        }
    };

    // the version a state claims: 0 when it has no format field but looks like a design, null when it is not one
    static versionOf(state) {
        if (!state || typeof state !== "object" || Array.isArray(state) || !Array.isArray(state.components)) return null;
        if (state.format === undefined) return 0;
        const m = /^browser-spice\/(\d+)$/.exec(String(state.format));
        return m ? Number(m[1]) : null;
    }

    // Bring any supported design up to the current version. Throws a readable error for anything else.
    // Returns { state, from, to, migrated } and never changes the object it was given.
    static migrate(input) {
        const from = DesignFormat.versionOf(input);
        if (from === null) throw new Error("this is not a Browser SPICE design file");
        if (from > DesignFormat.VERSION) throw new Error(`this design was saved by a newer Browser SPICE (format ${DesignFormat.NAME}/${from}; this version reads up to ${DesignFormat.VERSION}). Reload the app to update it.`);
        let state = JSON.parse(JSON.stringify(input));
        for (let v = from; v < DesignFormat.VERSION; v++) state = DesignFormat.MIGRATIONS[v](state);
        state.format = `${DesignFormat.NAME}/${DesignFormat.VERSION}`;
        return { state, from, to: DesignFormat.VERSION, migrated: from !== DesignFormat.VERSION };
    }

    // Structural problems that loading would otherwise hide or trip over. Returns a list of strings (empty = clean).
    static validate(state) {
        const out = [];
        const v = DesignFormat.versionOf(state);
        if (v === null) return ["not a Browser SPICE design"];
        const isNum = (n) => typeof n === "number" && isFinite(n);
        const list = (name) => Array.isArray(state[name]) ? state[name] : (out.push(`"${name}" is not a list`), []);
        const seen = new Map();
        const note = (kind, o) => {
            if (!o || typeof o !== "object") return;
            if (o.id === undefined) { out.push(`${kind} without an id`); return; }
            const key = `${kind}:${o.id}`;
            if (seen.has(key)) out.push(`duplicate ${kind} id ${o.id}`); else seen.set(key, true);
        };
        const comps = list("components");
        for (const c of comps) {
            note("component", c);
            if (!c || typeof c.type !== "string") out.push("a component has no type");
            else if (!isNum(c.x) || !isNum(c.y)) out.push(`component ${c.id} (${c.type}) has no position`);
        }
        const ids = new Set(comps.filter(c => c && c.id !== undefined).map(c => c.id));
        if (state.wires !== undefined) for (const w of list("wires")) {
            note("wire", w);
            if (!w || !w.start || !w.end) { out.push(`wire ${w && w.id} lacks an end`); continue; }
            for (const e of [w.start, w.end]) if (e.type === "terminal" && !ids.has(e.component)) out.push(`wire ${w.id} ends on missing component ${e.component}`);
        }
        if (state.probes !== undefined) for (const p of list("probes")) note("probe", p);
        const top = [...ids, ...(state.wires || []).map(w => w && w.id), ...(state.probes || []).map(p => p && p.id)].filter(isNum);
        if (state.nextId !== undefined && top.length && !(state.nextId > Math.max(...top))) out.push(`nextId ${state.nextId} is not above the highest id ${Math.max(...top)}`);
        if (state.sheets !== undefined && !Array.isArray(state.sheets)) out.push('"sheets" is not a list');
        return out;
    }
}

if (typeof window !== "undefined") window.DesignFormat = DesignFormat;

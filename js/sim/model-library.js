// User model library: .model cards from vendor files (.lib / .mod / any SPICE deck) become
// selectable parts in the Properties panel dropdowns and are remembered between sessions.

class SimModelLibrary {
    static STORAGE_KEY = "browser-spice/user-models/1";

    // SPICE .model type -> the symbol kinds that can use it
    static kindsFor(model, params) {
        switch (model.type) {
            case "d": {
                const kinds = ["D"];
                if (isFinite(params.bv) && params.bv < 30) kinds.push("DZ");
                if (/led/.test(model.name)) kinds.push("LED");
                return kinds;
            }
            case "npn": return ["BJT_NPN"];
            case "pnp": return ["BJT_PNP"];
            case "nmos": return ["NMOS"];
            case "pmos": return ["PMOS"];
            case "njf": return ["JFET_N"];
            case "pjf": return ["JFET_P"];
            default: return [];
        }
    }

    static paramsFor(model) {
        switch (model.type) {
            case "d": return SpiceParser.diodeParams(model);
            case "npn": case "pnp": return SpiceParser.bjtParams(model);
            case "nmos": case "pmos": return SpiceParser.mosParams(model, 1e-6, 1e-6);
            case "njf": case "pjf": return SpiceParser.jfetParams(model);
            default: return null;
        }
    }

    // Register every supported .model card in a deck. Returns { added: [...], skipped: [...] }.
    static register(deck, persist = true) {
        const added = [], skipped = [];
        const stored = [];
        for (const model of Object.values(deck.models)) {
            const params = SimModelLibrary.paramsFor(model);
            const kinds = params ? SimModelLibrary.kindsFor(model, params) : [];
            if (!kinds.length) { skipped.push(`${model.name} (${model.type})`); continue; }
            const name = model.name.toUpperCase();
            for (const kind of kinds) {
                SIM_MODELS[kind] = SIM_MODELS[kind] || {};
                SIM_MODELS[kind][name] = { desc: "Imported from a SPICE file", params, imported: true };
                added.push(`${kind}:${name}`);
            }
            stored.push({ type: model.type, name: model.name, params: model.params });
        }
        if (persist && stored.length) SimModelLibrary.persist(stored);
        return { added, skipped };
    }

    static importText(text) {
        return SimModelLibrary.register(SpiceParser.parse(text));
    }

    static storage() {
        try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
    }

    static persist(models) {
        const ls = SimModelLibrary.storage();
        if (!ls) return;
        try {
            const old = JSON.parse(ls.getItem(SimModelLibrary.STORAGE_KEY) || "[]");
            const merged = old.filter(o => !models.some(m => m.name.toLowerCase() === o.name.toLowerCase())).concat(models);
            ls.setItem(SimModelLibrary.STORAGE_KEY, JSON.stringify(merged));
        } catch (e) { /* storage full or blocked: models still work for this session */ }
    }

    static restore() {
        const ls = SimModelLibrary.storage();
        if (!ls) return 0;
        try {
            const models = JSON.parse(ls.getItem(SimModelLibrary.STORAGE_KEY) || "[]");
            const deck = { models: {} };
            for (const m of models) deck.models[m.name.toLowerCase()] = { name: m.name, type: m.type, params: m.params };
            return SimModelLibrary.register(deck, false).added.length;
        } catch (e) { return 0; }
    }

    static clear() {
        const ls = SimModelLibrary.storage();
        if (ls) ls.removeItem(SimModelLibrary.STORAGE_KEY);
    }
}

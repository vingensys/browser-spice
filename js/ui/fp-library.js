// A footprint library kept in this browser (not in the design): import a whole KiCad .pretty folder (or any number of
// .kicad_mod files) once, then search it from the PCB window and copy the ones a board uses into the design.

const FootprintLibrary = {
    KEY: "browser-spice/fp-library",

    all() {
        try { const o = JSON.parse(localStorage.getItem(FootprintLibrary.KEY) || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
    },

    names(filter = "") {
        const q = filter.trim().toLowerCase(), all = Object.keys(FootprintLibrary.all()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (!q) return all;
        const words = q.split(/\s+/);
        return all.filter(n => words.every(w => n.toLowerCase().includes(w)));
    },

    get(name) { return FootprintLibrary.all()[name] || null; },

    // returns { added, replaced, stored } ; stored is false when the browser refused (storage full)
    add(defs) {
        const lib = FootprintLibrary.all();
        let added = 0, replaced = 0;
        for (const d of defs) { if (lib[d.name]) replaced++; else added++; lib[d.name] = { name: d.name, pads: d.pads, silk: d.silk || [], pinMap: d.pinMap || null }; }
        try { localStorage.setItem(FootprintLibrary.KEY, JSON.stringify(lib)); return { added, replaced, stored: true }; } catch (e) { return { added: 0, replaced: 0, stored: false }; }
    },

    remove(name) {
        const lib = FootprintLibrary.all();
        if (!(name in lib)) return false;
        delete lib[name];
        try { localStorage.setItem(FootprintLibrary.KEY, JSON.stringify(lib)); return true; } catch (e) { return false; }
    },

    clear() { try { localStorage.removeItem(FootprintLibrary.KEY); } catch (e) { /* ignore */ } },

    // read File objects (a folder pick or several files) and import the footprints among them
    async importFiles(fileList) {
        const files = [...fileList].filter(f => /\.(kicad_mod|mod)$/i.test(f.name));
        const texts = await Promise.all(files.map(async f => ({ name: f.webkitRelativePath || f.name, text: await f.text() })));
        const { defs, errors } = Pcb.importKicadLibrary(texts);
        const res = FootprintLibrary.add(defs);
        return { found: files.length, imported: defs.length, errors, ...res };
    }
};

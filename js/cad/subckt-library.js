// Subcircuits as parts: a `.subckt` from a vendor file (an op-amp macromodel, a regulator, a driver ...) becomes a
// part with one pin per port. The part keeps the subcircuit's SPICE text, so the built-in engine simulates it
// as written (flattened into the circuit) and the SPICE export writes it back as a `.subckt`.
//
//   SubcktLibrary.importText(text)   -> { added: ["LM358", ...], skipped: [...] }   (also remembered between sessions)
//   a design file embeds the subcircuits it uses, so it opens on any machine

class SubcktLibrary {
    static KEY = "browser-spice/subckts/1";
    static defs = new Map();            // lower-case name -> { name, ports, text, models }

    static typeOf(name) { return `SUB:${String(name).toUpperCase()}`; }

    static header(line) {
        const t = line.trim().replace(/\s*=\s*/g, "=").replace(/[(),]/g, " ").split(/\s+/);
        const ps = t.slice(2), stop = ps.findIndex(x => x.includes("=") || /:$/.test(x));
        return { name: t[1], ports: (stop < 0 ? ps : ps.slice(0, stop)).map(x => x.toLowerCase()) };
    }

    // pull every .subckt block (with the .model cards it uses and any subcircuit it instantiates) out of a SPICE file
    static extract(text) {
        const raw = String(text).replace(/\r/g, "").split("\n");
        const logical = [];            // { text (merged), lines: [raw lines] }
        for (const line of raw) {
            const t = line.replace(/\$.*$/, "");
            if (/^\s*\+/.test(t) && logical.length) { const l = logical[logical.length - 1]; l.text += " " + t.replace(/^\s*\+/, ""); l.lines.push(line); }
            else logical.push({ text: t, lines: [line] });
        }
        const blocks = new Map(), models = [];
        let open = null, depth = 0;
        for (const l of logical) {
            if (/^\s*\.subckt\b/i.test(l.text)) {
                if (!open) { open = { head: SubcktLibrary.header(l.text), lines: [] }; depth = 0; }
                depth++;
            }
            if (open) open.lines.push(...l.lines);
            if (/^\s*\.ends\b/i.test(l.text) && open && --depth === 0) { blocks.set(open.head.name.toLowerCase(), open); open = null; }
            if (!open && /^\s*\.model\b/i.test(l.text)) models.push(l.text.trim());
        }
        // models are cards outside any subcircuit; the ones inside a subcircuit stay in its text
        const mname = (card) => (card.split(/\s+/)[1] || "").toLowerCase();
        const mentions = (text, name) => new RegExp(`(^|[\\s(,])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s),=])`, "im").test(text);
        const out = [];
        for (const [key, blk] of blocks) {
            let body = blk.lines.join("\n");
            const nested = new Set([key]);
            // subcircuits this one instantiates (transitively) are carried along
            for (let changed = true; changed;) {
                changed = false;
                for (const [k2, b2] of blocks) if (!nested.has(k2) && mentions(body, b2.head.name)) { nested.add(k2); body = `${b2.lines.join("\n")}\n${body}`; changed = true; }
            }
            out.push({ name: blk.head.name, ports: blk.head.ports, text: body, models: models.filter(c => mentions(body, mname(c))) });
        }
        return out;
    }

    static register(defs, { persist = true } = {}) {
        const added = [];
        for (const d of defs) {
            if (!d || !d.name || !Array.isArray(d.ports) || !d.ports.length || typeof d.text !== "string") continue;
            const def = { name: d.name, ports: d.ports.slice(), text: d.text, models: Array.isArray(d.models) ? d.models.slice() : [] };
            SubcktLibrary.defs.set(def.name.toLowerCase(), def);
            SubcktLibrary.addPart(def);
            added.push(def.name.toUpperCase());
        }
        if (persist && added.length) SubcktLibrary.persist();
        return added;
    }

    static importText(text) {
        const defs = SubcktLibrary.extract(text), skipped = [];
        const ok = defs.filter(d => { if (!d.ports.length) { skipped.push(d.name); return false; } return true; });
        return { added: SubcktLibrary.register(ok), skipped };
    }

    // one part type per subcircuit: inputs (first half of the ports) on the left, the rest on the right
    static addPart(def) {
        const type = SubcktLibrary.typeOf(def.name);
        const half = Math.ceil(def.ports.length / 2), spec = { left: def.ports.slice(0, half), right: def.ports.slice(half) };
        const g = logicICGeometry(spec), name = def.name.toUpperCase();
        PartLib.add(type, {
            prefix: "X", value: name, props: {}, symbol: g.symbol, quietPins: true,
            label: () => name,
            draw(r, c) {
                const ctx = r.ctx, col = "#8be9fd";
                ctx.strokeStyle = r.col(col); ctx.fillStyle = r.col("#171b23"); ctx.lineWidth = r.lw(3);
                ctx.beginPath(); ctx.rect(-60, g.top, 120, g.bottom - g.top); ctx.fill(); ctx.stroke();
                r.partText(name.length > 16 ? name.slice(0, 15) + "…" : name, 0, g.top + 9, { size: 11, bold: true, color: col });
                const side = (names, sign) => names.forEach((pn, i) => {
                    const y = g.top + 20 + 20 * i;
                    r.partLine([[sign * 80, y], [sign * 60, y]], col, 2);
                    r.partText(pn.length > 7 ? pn.slice(0, 6) + "…" : pn, sign * 54, y, { size: 9, color: "#c8d0dc", align: sign < 0 ? "left" : "right" });
                });
                side(spec.left, -1); side(spec.right, 1);
                r.drawLabel(c);
            },
            rows: () => `<div class="prop-note">Subcircuit ${PropertiesPanel.esc(name)} with ports ${PropertiesPanel.esc(def.ports.join(", "))}. It is simulated as written in the SPICE file it came from.</div>`,
            netlist(c, k) { return [{ ...k.base, kind: "SUBCKT", def, nodes: def.ports.map(p => k.pin(p)), params: {} }]; },
            catalog: [{ name, category: "Subcircuits", desc: `Imported subcircuit with ports ${def.ports.join(" ")}`, props: { value: name } }]
        });
    }

    static storage() { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; } }

    static persist() {
        const ls = SubcktLibrary.storage();
        if (!ls) return;
        try { ls.setItem(SubcktLibrary.KEY, JSON.stringify([...SubcktLibrary.defs.values()].map(({ name, ports, text, models }) => ({ name, ports, text, models })))); }
        catch (e) { /* storage full: they still work this session and are embedded in saved designs */ }
    }

    static restore() {
        const ls = SubcktLibrary.storage();
        if (!ls) return 0;
        try { return SubcktLibrary.register(JSON.parse(ls.getItem(SubcktLibrary.KEY) || "[]"), { persist: false }).length; } catch (e) { return 0; }
    }

    static clear() {
        const ls = SubcktLibrary.storage();
        if (ls) ls.removeItem(SubcktLibrary.KEY);
    }

    // the definitions a design uses (embedded in its file)
    static used(editor) {
        const out = new Map();
        for (const c of editor.components) {
            if (!/^SUB:/.test(c.type)) continue;
            const d = SubcktLibrary.defs.get(c.type.slice(4).toLowerCase());
            if (d) out.set(d.name.toLowerCase(), { name: d.name, ports: d.ports, text: d.text, models: d.models });
        }
        return [...out.values()];
    }
}

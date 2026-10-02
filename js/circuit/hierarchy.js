// Flattening a multi-sheet design into one netlist. Every SHEET symbol is replaced by the elements of the sheet it
// uses, with names and nets prefixed by the instance path (U1.R3, U1.7); the sheet's PORTs are joined to the nets on
// the symbol's pins; ground and POWER nets of the same name are shared by all sheets.

class Hierarchy {
    static MAX_DEPTH = 8;

    // els / warnings: the root sheet's elements (extended in place); nets: the root's connectivity
    static expand(editor, nets, els, warnings) {
        const sheets = editor.sheets || [];
        if (sheets.length < 2 && !editor.components.some(c => c.type === "SHEET")) return;
        const power = new Map();           // POWER name -> node name used everywhere
        const sourced = new Set();         // POWER names that already have their supply source
        for (const c of editor.components) {
            if (c.type !== "POWER") continue;
            const name = String(c.net || "VCC").trim().toUpperCase();
            if (name === "GND" || name === "0") continue;
            const id = nets.terminalNode(c, "1");
            if (id !== null && id !== undefined && !power.has(name)) power.set(name, id);
            sourced.add(name);
        }
        const ctx = { editor, els, warnings, power, sourced, instances: 0 };
        for (const c of editor.components) if (c.type === "SHEET") Hierarchy.instance(ctx, editor, nets, c, c.name, 1, (id) => id, editor.params || []);
        els.instances = ctx.instances;
    }

    // "rv=2k; cv=gain*1n" on a sheet symbol: values for this instance's parameters, evaluated in the parent's context
    static overrideParams(parentParams, text, warnings, where) {
        const src = String(text || "").trim();
        if (!src) return parentParams;
        const { values } = DesignParams.resolve(parentParams);
        const out = parentParams.map(p => ({ ...p })), seen = new Set();
        for (const part of src.split(/[;\n]/).map(s => s.trim()).filter(Boolean)) {
            const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(part);
            if (!m) { warnings.push(`${where}: "${part}" is not name=value`); continue; }
            let v;
            try { v = Expr.compile(m[2].replace(/^\{|\}$/g, ""), values).eval([], 0); } catch (e) { warnings.push(`${where}: ${m[1]}: ${e.message.replace(/ in expression.*$/, "")}`); continue; }
            const i = out.findIndex(p => String(p.name).toLowerCase() === m[1].toLowerCase());
            if (i >= 0) out[i] = { name: out[i].name, value: String(v) }; else out.push({ name: m[1], value: String(v) });
            seen.add(m[1].toLowerCase());
        }
        return out;
    }

    static instance(ctx, parent, parentNets, comp, path, depth, mapParent, parentParams) {
        const { editor, els, warnings, power, sourced } = ctx;
        if (depth > Hierarchy.MAX_DEPTH) { warnings.push(`${path}: sheets contain each other more than ${Hierarchy.MAX_DEPTH} levels deep (a sheet that uses itself?); not expanded`); return; }
        const sheetId = Number(comp.sheet);
        const state = editor.sheetState(sheetId);
        if (!state) { warnings.push(`${comp.name}: no sheet selected`); return; }
        ctx.instances++;
        const isTarget = editor.hierarchyTarget !== undefined && Number(editor.hierarchyTarget) === sheetId && !ctx.located;
        const params = Hierarchy.overrideParams(parentParams, comp.overrides, warnings, path);
        const child = SchematicEditor.headless(state, params);
        const cnets = NetlistExtractor.nets(child);
        if (cnets.hasGround) els.childGround = true;

        // ports: child net -> the node of the parent's net on the symbol's pin of the same name
        const portNode = new Map();
        for (const pc of child.components) {
            if (pc.type !== "PORT") continue;
            const name = String(pc.net || "PORT").trim().toUpperCase();
            const cid = cnets.terminalNode(pc, "1");
            if (cid === null || cid === undefined) continue;
            const pid = parentNets.terminalNode(comp, name);
            if (pid === null || pid === undefined) { warnings.push(`${path}: port ${name} is not connected on the sheet symbol`); continue; }
            portNode.set(cid, mapParent(pid));
        }
        // power ports: shared by name
        const powerNode = new Map();
        for (const pc of child.components) {
            if (pc.type !== "POWER") continue;
            const name = String(pc.net || "VCC").trim().toUpperCase();
            if (name === "GND" || name === "0") continue;
            const cid = cnets.terminalNode(pc, "1");
            if (cid === null || cid === undefined) continue;
            if (!power.has(name)) power.set(name, name);
            powerNode.set(cid, power.get(name));
        }
        const node = (id) => (id === "0" ? "0" : portNode.has(id) ? portNode.get(id) : powerNode.has(id) ? powerNode.get(id) : `${path}__${id}`);

        const { els: cels, warnings: cw } = DesignParams.with(child, () => NetlistExtractor.elements(child, cnets));
        for (const w of cw) warnings.push(`${path}: ${w}`);
        if ((cels.instruments || []).length) warnings.push(`${path}: instruments inside a sub-sheet are not shown; put them on the first sheet`);
        for (const e of cels) {
            if (e.comp && e.comp.type === "POWER") {
                const name = String(e.comp.net || "VCC").trim().toUpperCase();
                if (sourced.has(name)) continue;                    // another sheet already supplies this rail
                sourced.add(name);
            }
            const copy = { ...e, name: `${path}__${e.name}`, nodes: e.nodes.map(node) };
            if (e.kind === "CCCS") copy.ctrl = `${path}__${e.ctrl}`;
            if (e.kind === "BSRC") {
                copy.params = { ...e.params, expr: e.params.expr.replace(/\bv\(\s*([^),\s]+)\s*(?:,\s*([^)\s]+)\s*)?\)/gi, (_, a, b) => `v(${node(a)}${b ? "," + node(b) : ""})`).replace(/\bi\(\s*([^)\s]+)\s*\)/gi, (_, a) => `i(${path}__${a})`) };
            }
            els.push(copy);
        }
        for (const [net, v] of Object.entries(cels.nodeIC || {})) els.nodeIC[node(net)] = v;
        // probes placed on the sub-sheet measure this instance (one entry per use of the sheet)
        if (isTarget) ctx.located = els.located = { path, node, sheetId, nets: cnets };
        els.subProbes = els.subProbes || [];
        for (const pr of child.probes) {
            const tag = `${pr.label}@${path.replace(/__/g, "/")}`;
            if (pr.type === "V") {
                const id = cnets.getPointNodeName(pr.x, pr.y);
                els.subProbes.push({ ...pr, label: tag, _node: id === null || id === undefined ? "0" : node(id), _orig: pr, _path: path, _sub: true });
            } else if (pr.type === "I") {
                const target = child.components.find(c => c.id === pr.target);
                if (target) els.subProbes.push({ ...pr, label: tag, _target: `${path}__${target.name}`, _orig: pr, _path: path, _sub: true });
            }
        }
        for (const sc of child.components) if (sc.type === "SHEET") Hierarchy.instance(ctx, child, cnets, sc, `${path}__${sc.name}`, depth + 1, node, params);
    }

    // every component of the design with its instance path: [{ comp, path, ref }], the sheets expanded once per use
    static flatComponents(editor, state = null, path = "", depth = 0) {
        const out = [];
        const comps = state ? state.components : editor.components;
        for (const c of comps) {
            if (c.type === "SHEET") {
                const st = depth < Hierarchy.MAX_DEPTH ? editor.sheetState(c.sheet) : null;
                if (st) out.push(...Hierarchy.flatComponents(editor, st, `${path}${c.name}.`, depth + 1));
                continue;
            }
            out.push({ comp: c, path, ref: `${path}${c.name}` });
        }
        return out;
    }

    // Where the first use of sheet `sheetId` sits in the flattened design, for showing simulation values on that sheet:
    // { info (of the first sheet), path, node(netIdOfThatSheet) -> node name in the flattened circuit } or null
    static locate(editor, sheetId) {
        const rootSheet = editor.sheets[0];
        if (!rootSheet || rootSheet.id === Number(sheetId)) return null;
        const root = SchematicEditor.headless(editor.sheetState(rootSheet.id), editor.params);
        root.sheets = editor.sheets; root.sheetIndex = editor.sheetIndex; root.sheetState = (id) => editor.sheetState(id); root.sheetIndexOf = (id) => editor.sheetIndexOf(id);
        root.hierarchyTarget = sheetId;
        const info = NetlistExtractor.extract(root);
        return info.located ? { info, path: info.located.path, node: info.located.node, nets: info.located.nets } : null;
    }
}

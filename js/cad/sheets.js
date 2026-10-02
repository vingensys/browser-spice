// Multi-sheet designs. A design is a list of sheets; the first is the root. Another sheet is used by placing a
// SHEET symbol (a box whose pins are the PORT parts of the referenced sheet); the netlist is flattened through the
// instances (see Hierarchy), so every analysis works on the whole design. POWER ports of the same name are one net
// across all sheets; ground is global; every other net belongs to its own sheet instance.
//
// The editor edits one sheet at a time; the others are kept here. Mixed into SchematicEditor.

// the part symbols look sheets up through this (set by the app to its editor)
const SheetHub = {
    editor: null,
    ports(sheetId) { return SheetHub.editor ? SheetHub.editor.portsOf(sheetId) : []; }
};

class SheetManager {

    static blankState() { return { components: [], wires: [], probes: [], titleBlock: SchematicEditor.defaultTitleBlock(), nextId: 1 }; }

    // ---- the live sheet ---------------------------------------------------------------------------------

    liveSheetState() { return { components: this.components, wires: this.wires, probes: this.probes, titleBlock: this.titleBlock, nextId: this.nextId, view: { zoom: this.zoom, panX: this.panX, panY: this.panY } }; }

    get activeSheet() { return this.sheets[this.sheetIndex]; }

    sheetIndexOf(id) { return this.sheets.findIndex(s => s.id === Number(id)); }

    // the stored state of a sheet (the live one for the active sheet)
    sheetState(id) {
        const i = this.sheetIndexOf(id);
        if (i < 0) return null;
        return i === this.sheetIndex ? this.liveSheetState() : this.sheets[i].data;
    }

    // names of the PORT parts on a sheet, sorted
    portsOf(id) {
        const st = this.sheetState(id);
        if (!st) return [];
        const names = new Set();
        for (const c of st.components) if (c.type === "PORT") names.add(String(c.net || "PORT").trim().toUpperCase());
        return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    // ---- switching --------------------------------------------------------------------------------------

    flushSheet() {
        const s = this.activeSheet;
        s.data = this.liveSheetState();
        s.history = this.historyStack; s.future = this.futureStack;
    }

    loadSheetState(st, history = [], future = []) {
        this.components = st.components; this.wires = st.wires; this.probes = st.probes;
        this.titleBlock = Object.assign(SchematicEditor.defaultTitleBlock(), st.titleBlock || {});
        this.nextId = st.nextId || 1;
        this.historyStack = history; this.futureStack = future;
        const v = st.view || { zoom: 1, panX: 0, panY: 0 };
        this.zoom = v.zoom || 1; this.panX = v.panX || 0; this.panY = v.panY || 0;
        this.clearSelection();
        this.netHighlight = null; this.ercMarks = null;
        this.refreshWires();
    }

    switchSheet(i) {
        if (i < 0 || i >= this.sheets.length || i === this.sheetIndex) return false;
        this.flushSheet();
        this.sheetIndex = i;
        const s = this.sheets[i];
        this.loadSheetState(s.data || SheetManager.blankState(), s.history || [], s.future || []);
        this.draw();
        this.notify();
        if (typeof this.onSheetChange === "function") this.onSheetChange();
        return true;
    }

    // the whole design is simulated from the first sheet
    ensureRootSheet() {
        if (this.sheetIndex === 0) return false;
        this.sheetStack = [];
        return this.switchSheet(0);
    }

    openChild(comp) {
        const i = this.sheetIndexOf(comp.sheet);
        if (i < 0) return false;
        const from = this.sheetIndex;
        if (this.switchSheet(i)) { this.sheetStack.push(from); return true; }
        return false;
    }

    sheetUp() {
        const to = this.sheetStack.length ? this.sheetStack.pop() : 0;
        return this.switchSheet(to);
    }

    sheetsChanged() { this.notify(); if (typeof this.onSheetChange === "function") this.onSheetChange(); }

    // ---- editing the list ---------------------------------------------------------------------------------

    addSheet(name) {
        const id = Math.max(0, ...this.sheets.map(s => s.id)) + 1;
        const sheet = { id, name: String(name || `Sheet ${id}`).trim() || `Sheet ${id}`, data: SheetManager.blankState(), history: [], future: [] };
        this.sheets.push(sheet);
        this.numberSheets();
        this.sheetsChanged();
        return sheet;
    }

    renameSheet(i, name) {
        const n = String(name).trim();
        if (!n || !this.sheets[i]) return false;
        this.sheets[i].name = n;
        this.sheetsChanged();
        return true;
    }

    // which sheets contain a SHEET symbol that uses sheet `id`
    usersOf(id) {
        const out = [];
        this.sheets.forEach((s, i) => {
            const st = i === this.sheetIndex ? this.liveSheetState() : s.data;
            if (st && st.components.some(c => c.type === "SHEET" && Number(c.sheet) === Number(id))) out.push(s.name);
        });
        return out;
    }

    deleteSheet(i) {
        if (this.sheets.length < 2) throw new Error("A design needs at least one sheet.");
        if (i === 0) throw new Error("The first sheet is the root of the design and cannot be deleted.");
        const users = this.usersOf(this.sheets[i].id);
        if (users.length) throw new Error(`Sheet ${this.sheets[i].name} is used by a sheet symbol on ${users.join(", ")}. Remove those symbols first.`);
        const target = this.sheets[i];
        if (i === this.sheetIndex) this.switchSheet(0);
        const active = this.activeSheet;
        this.sheets.splice(this.sheets.indexOf(target), 1);
        this.sheetIndex = this.sheets.indexOf(active);
        this.sheetStack = [];
        this.numberSheets();
        this.sheetsChanged();
    }

    duplicateSheet(i) {
        const src = this.sheetState(this.sheets[i].id);
        const id = Math.max(0, ...this.sheets.map(s => s.id)) + 1;
        const data = JSON.parse(JSON.stringify({ components: src.components, wires: src.wires.map(({ blocked, ...w }) => w), probes: src.probes, titleBlock: src.titleBlock, nextId: src.nextId }));
        const sheet = { id, name: `${this.sheets[i].name} copy`, data, history: [], future: [] };
        this.sheets.push(sheet);
        this.numberSheets();
        this.sheetsChanged();
        return sheet;
    }

    numberSheets() { /* the title block of each sheet shows "n / total" */
        this.sheets.forEach((s, i) => {
            const st = i === this.sheetIndex ? this : s.data;
            const tb = st && (i === this.sheetIndex ? this.titleBlock : st.titleBlock);
            if (tb) tb.sheet = `${i + 1}/${this.sheets.length}`;
        });
    }

    resetSheets() {
        this.sheets = [{ id: 1, name: "Main", data: null, history: [], future: [] }];
        this.sheetIndex = 0;
        this.sheetStack = [];
    }

    // the probes the simulation reads: this sheet's, plus those placed on sub-sheets (one per use of the sheet, labelled
    // with the instance path). Falls back to this sheet's own probes when the design cannot be extracted.
    allProbes() {
        if (this.sheets.length < 2) return this.probes;
        try { return NetlistExtractor.extract(this).probes; } catch (e) { return this.probes; }
    }

    // every component of every sheet (for the parts list, subcircuit library ...)
    allComponents() {
        return this.sheets.flatMap((s, i) => (i === this.sheetIndex ? this.components : ((s.data && s.data.components) || [])));
    }

    // ---- saving / loading ---------------------------------------------------------------------------------

    // [{ id, name, active, state }]: the active sheet's state is the design's top-level fields
    sheetsForSave(strip) {
        return this.sheets.map((s, i) => (i === this.sheetIndex
            ? { id: s.id, name: s.name, active: true }
            : { id: s.id, name: s.name, state: { components: s.data.components.map(strip), wires: s.data.wires.map(({ blocked, ...w }) => w), probes: s.data.probes.map(strip), titleBlock: s.data.titleBlock, nextId: s.data.nextId } }));
    }

    loadSheets(list) {
        this.resetSheets();
        if (!Array.isArray(list) || list.length < 1) return;
        const ok = list.filter(s => s && typeof s === "object" && Number.isFinite(Number(s.id)));
        if (!ok.some(s => s.active)) return;
        this.sheets = ok.map(s => ({
            id: Number(s.id), name: String(s.name || `Sheet ${s.id}`), history: [], future: [],
            data: s.active ? null : {
                components: Array.isArray(s.state && s.state.components) ? s.state.components.filter(c => c && SYMBOL_DEFS[c.type]) : [],
                wires: Array.isArray(s.state && s.state.wires) ? s.state.wires : [],
                probes: Array.isArray(s.state && s.state.probes) ? s.state.probes : [],
                titleBlock: Object.assign(SchematicEditor.defaultTitleBlock(), (s.state && s.state.titleBlock) || {}), nextId: Number(s.state && s.state.nextId) || 1
            }
        }));
        this.sheetIndex = ok.findIndex(s => s.active);
        this.sheetStack = [];
    }
}
applyMixin(SchematicEditor, SheetManager);

// an editor with no canvas or event handlers, holding one sheet's state: enough to extract its netlist
SchematicEditor.headless = function (state, params = []) {
    const e = Object.create(SchematicEditor.prototype);
    Object.assign(e, {
        gridSize: 20, components: state.components, wires: state.wires, probes: state.probes || [], titleBlock: state.titleBlock, measures: [], params, nextId: state.nextId || 1,
        selection: [], selectedWire: null, selectedProbe: null, hoverSnap: null, connectedPins: new Set(), historyStack: [], futureStack: [], width: 800, height: 600, zoom: 1, panX: 0, panY: 0,
        sheets: [], sheetIndex: 0, sheetStack: []
    });
    e.draw = () => { };
    if (e.wires.some(w => !w.route || w.route.length < 2)) e.refreshWires();
    return e;
};

SchematicEditor.REF_PREFIX.SHEET = "S";
SchematicEditor.REF_PREFIX.PORT = "PT";

// ---- parts --------------------------------------------------------------------------------------------------------

// a hierarchical port: the name connects it to the pin of the same name on the sheet symbol that uses this sheet
PartLib.add("PORT", {
    prefix: "PT", value: "IN", props: { net: "IN" },
    symbol: { pins: [["1", 0, 20, 0, 1]], box: [-24, -30, 24, 20] },
    label: (c) => c.net || "PORT",
    draw(r, c) {
        const col = "#ffb86c", ctx = r.ctx, name = String(c.net || "PORT");
        r.partLine([[0, 20], [0, 0]], BusUtil.parse(c.net) ? "#2f55d4" : col, BusUtil.parse(c.net) ? 5 : 3);
        ctx.strokeStyle = r.col(col); ctx.lineWidth = r.lw(2); ctx.fillStyle = r.col("#171b23");
        ctx.beginPath(); ctx.moveTo(-26, -8); ctx.lineTo(-16, -18); ctx.lineTo(22, -18); ctx.lineTo(22, 2); ctx.lineTo(-16, 2); ctx.closePath(); ctx.fill(); ctx.stroke();
        r.partText(name.length > 7 ? name.slice(0, 6) + "…" : name, 0, -8, { size: 10, bold: true, color: col });
    },
    rows: (p, c) => p.text("Port name", "net", c.net, "IN") +
        `<div class="prop-note">The connection of this sheet to the sheet that uses it: the sheet symbol gets a pin with this name. On the first sheet (and for the name of a net) it works like a net label. A name like <b>D[0..7]</b> is a <b>bus</b> port: attach it to a bus wire; the symbol gets one bus pin and the members D0..D7 cross together.</div>`,
    netlist: () => [],
    catalog: [{ name: "HIERARCHICAL PORT", category: "Terminals", desc: "Port of this sheet: becomes a pin on the sheet symbol that uses it", props: { net: "IN", value: "IN" } }]
});

// a sheet symbol: a box with one pin per port of the sheet it uses
function sheetSymbolGeometry(ports) {
    const half = Math.ceil(ports.length / 2), spec = { left: ports.slice(0, half), right: ports.slice(half) };
    return { spec, geo: logicICGeometry(spec) };
}

PartLib.add("SHEET", {
    prefix: "S", value: "SHEET", props: { sheet: 0 },
    symbol: { pins: [], box: [-80, -40, 80, 40], dynamic(c) { const { geo } = sheetSymbolGeometry(SheetHub.ports(c.sheet)); return geo.symbol.pins.length ? geo.symbol : { pins: [], box: [-80, -40, 80, 40] }; } },
    quietPins: false,
    label: (c) => { const ed = SheetHub.editor, i = ed ? ed.sheetIndexOf(c.sheet) : -1; return i >= 0 ? ed.sheets[i].name : "(no sheet)"; },
    draw(r, c) {
        const ctx = r.ctx, col = "#8be9fd";
        const ed = SheetHub.editor, i = ed ? ed.sheetIndexOf(c.sheet) : -1;
        const { spec, geo } = sheetSymbolGeometry(SheetHub.ports(c.sheet));
        const top = geo.pins ? geo.top : -40, bottom = geo.bottom || 40;
        ctx.strokeStyle = r.col(col); ctx.fillStyle = r.col("#171b23"); ctx.lineWidth = r.lw(3);
        ctx.beginPath(); ctx.rect(-60, top, 120, bottom - top); ctx.fill(); ctx.stroke();
        ctx.setLineDash([6, 3]); ctx.lineWidth = r.lw(1); ctx.strokeRect(-56, top + 4, 112, bottom - top - 8); ctx.setLineDash([]);
        r.partText(i >= 0 ? ed.sheets[i].name : "(no sheet)", 0, top + 12, { size: 11, bold: true, color: col });
        r.partText("sheet", 0, bottom - 10, { size: 8, color: "#9aa4b5" });
        const side = (names, sign) => names.forEach((pn, k) => {
            const y = top + 20 + 20 * k;
            const bus = !!BusUtil.parse(pn);
            r.partLine([[sign * 80, y], [sign * 60, y]], bus ? "#2f55d4" : col, bus ? 5 : 2);
            r.partText(pn.length > 8 ? pn.slice(0, 7) + "…" : pn, sign * 54, y, { size: 9, color: "#c8d0dc", align: sign < 0 ? "left" : "right" });
        });
        side(spec.left, -1); side(spec.right, 1);
        r.drawLabel(c);
    },
    rows: (p, c) => {
        const ed = SheetHub.editor;
        const options = ed ? ed.sheets.filter((s, i) => i !== ed.sheetIndex).map(s => [String(s.id), s.name]) : [];
        return p.select("Sheet", "sheet", [["0", "(none)"], ...options], String(c.sheet || 0), "Double-click the symbol to open the sheet. Its PORT parts become the pins.") +
            p.text("Parameters for this use", "overrides", c.overrides || "", "rv=2k; cv=10n") +
            `<div class="prop-note">Gives the sheet's design parameters other values for this symbol only, so one sheet can be used twice with different values.</div>`;
    },
    netlist: () => [],
    catalog: [{ name: "SHEET SYMBOL", category: "Terminals", desc: "Uses another sheet of this design (hierarchy)", props: { sheet: 0, value: "SHEET" } }]
});

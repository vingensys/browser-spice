// PCB tools for the MCP server: build a board from a SPICE deck (or a KiCad schematic / netlist), place and route it,
// check the rules, look at it (SVG) and export Gerber / Excellon. A board lives in the server process under an id.
// The kernel is the same js/pcb/pcb.js the web app's PCB view uses.
const fs = require("fs"), path = require("path");
const { SpiceParser, Pcb, KicadImporter } = require("./engine.cjs");

const boards = new Map();
let counter = 0;

const round = (v, d = 3) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : v);
const netName = (n) => (String(n) === "0" ? "GND" : String(n));

function get(id) {
    const b = boards.get(String(id));
    if (!b) throw new Error(`no board "${id}" (create one with pcb_create; this server holds ${[...boards.keys()].join(", ") || "none"})`);
    return b;
}

// parsed deck elements -> the neutral elements the board code uses (pin order of the schematic's netlist)
function boardElements(deckText, warnings) {
    const deck = SpiceParser.parse(deckText);
    const els = SpiceParser.flatten(deck, deck.elements, "", null, warnings);
    const out = [];
    for (const e of els) {
        if (!e.nodes || !e.nodes.length || e.kind === "K") continue;
        const n = e.nodes.map(String), name = String(e.name).toUpperCase();
        if (e.kind === "Q") out.push({ name, kind: "Q", nodes: [n[1], n[0], n[2]] });           // netlist order C B E -> schematic order B C E
        // (the parser already gives MOSFETs and JFETs in the schematic's order G D S)
        else out.push({ name, kind: e.kind, nodes: n });
    }
    return { elements: out, title: deck.title };
}

function summary(b) {
    const pcb = b.pcb, conn = Pcb.connectivity(pcb), rats = Pcb.ratsnest(pcb, conn);
    return {
        board_id: b.id, title: b.title, board_mm: { width: pcb.outline.w, height: pcb.outline.h },
        parts: pcb.parts.length, tracks: pcb.tracks.length, vias: pcb.vias.length, pours: (pcb.zones || []).length,
        unrouted_connections: rats.length,
        rules_mm: { clearance: pcb.rules.clearance, track: pcb.rules.track, via: pcb.rules.via, via_drill: pcb.rules.viaDrill, edge: pcb.rules.edge }
    };
}

function create(args) {
    const warnings = [];
    let text = args.kicad || args.netlist;
    if (!text) throw new Error("give netlist (a SPICE deck) or kicad (the text of a .kicad_sch or KiCad .net)");
    if (args.kicad || KicadImporter.isKicad(text)) { const k = KicadImporter.toSpice(text); text = k.deck; warnings.push(...k.warnings); }
    const { elements, title } = boardElements(text, warnings);
    if (!elements.length) throw new Error("the deck has no parts to put on a board");
    if (elements.length > 400) throw new Error("at most 400 parts");
    const pcb = Pcb.blank(Number(args.width) || 80, Number(args.height) || 60);
    if (args.track_width) pcb.rules.track = Number(args.track_width);
    if (args.clearance) pcb.rules.clearance = Number(args.clearance);
    Pcb.sync(pcb, elements);
    for (const [ref, pkg] of Object.entries(args.packages || {})) {
        const part = pcb.parts.find(p => p.ref === String(ref).toUpperCase());
        if (!part) { warnings.push(`no part ${ref} to give the package ${pkg}`); continue; }
        Pcb.setPackage(part, pkg, pcb.footprints);
        if (part.pkg !== pkg) warnings.push(`${ref}: package "${pkg}" is not available for a ${part.kind} (try ${Pcb.packages(part.kind, pcb.footprints).map(x => x[0]).join(", ") || "none"}); using ${part.fp.name}`);
    }
    if (args.auto_place !== false) Pcb.autoPlace(pcb, { fit: !args.width && !args.height });
    const id = `b${++counter}`;
    if (boards.size >= 20) boards.delete(boards.keys().next().value);
    const b = { id, pcb, title };
    boards.set(id, b);
    return { ...summary(b), warnings, parts_list: pcb.parts.map(p => ({ ref: p.ref, kind: p.kind, footprint: p.fp.name, x: round(p.x), y: round(p.y), rot: p.rot, side: p.flip ? "back" : "front", nets: p.nets.map(netName) })) };
}

// the actions of pcb_edit, one at a time
function act(b, a) {
    const pcb = b.pcb, R = pcb.rules;
    const part = (ref) => { const p = pcb.parts.find(q => q.ref === String(ref).toUpperCase()); if (!p) throw new Error(`no part ${ref}`); return p; };
    switch (a.op) {
        case "move": { const p = part(a.ref); if (a.x !== undefined) p.x = Number(a.x); if (a.y !== undefined) p.y = Number(a.y); if (a.rot !== undefined) p.rot = ((Number(a.rot) % 360) + 360) % 360; p.placed = true; return { moved: p.ref, x: round(p.x), y: round(p.y), rot: p.rot, note: "tracks that ended on this part need routing again" }; }
        case "flip": { const p = part(a.ref); if (!p.fp.smd) throw new Error(`${p.ref} is through-hole and cannot go on the back`); p.flip = !p.flip; return { flipped: p.ref, side: p.flip ? "back" : "front" }; }
        case "package": { const p = part(a.ref); Pcb.setPackage(p, a.package, pcb.footprints); if (p.pkg !== a.package) throw new Error(`package "${a.package}" is not available for ${p.ref} (${Pcb.packages(p.kind, pcb.footprints).map(x => x[0]).join(", ") || "none"})`); return { part: p.ref, footprint: p.fp.name, pads: p.fp.pads.length }; }
        case "outline": { pcb.outline.w = Number(a.width); pcb.outline.h = Number(a.height); if (!(pcb.outline.w >= 10 && pcb.outline.h >= 10)) throw new Error("the board must be at least 10 x 10 mm"); return { board_mm: { width: pcb.outline.w, height: pcb.outline.h } }; }
        case "rules": { for (const [k, key] of [["clearance", "clearance"], ["track_width", "track"], ["via", "via"], ["via_drill", "viaDrill"], ["edge", "edge"]]) if (a[k] !== undefined) R[key] = Number(a[k]); return { rules_mm: { clearance: R.clearance, track: R.track, via: R.via, via_drill: R.viaDrill, edge: R.edge } }; }
        case "auto_place": { Pcb.autoPlace(pcb, { fit: a.fit !== false }); pcb.tracks = []; pcb.vias = []; return { placed: pcb.parts.length, board_mm: { width: pcb.outline.w, height: pcb.outline.h }, note: "routing was cleared" }; }
        case "clear_routing": pcb.tracks = []; pcb.vias = []; return { cleared: true };
        case "define_footprint": { const def = Pcb.parseFootprint(a.definition); pcb.footprints[def.name] = def; for (const p of pcb.parts) if (p.pkg === `user:${def.name}`) Pcb.setPackage(p, p.pkg, pcb.footprints); return { footprint: def.name, pads: def.pads.length, use_as: `user:${def.name}` }; }
        case "import_kicad_footprint": { const def = Pcb.importKicadFootprint(a.text); pcb.footprints[def.name] = def; return { footprint: def.name, pads: def.pads.length, use_as: `user:${def.name}` }; }
        case "via": {
            const via = { id: pcb.nextId++, x: Number(a.x), y: Number(a.y), d: R.via, drill: R.viaDrill };
            if (a.shove !== false) { const r = Pcb.shoveVia(pcb, "F", [], R.track, a.net === undefined ? Pcb.netAt(pcb, "F", via.x, via.y) : a.net, via); if (!r.ok) throw new Error(`cannot place the via: ${r.reason}`); Pcb.applyShove(pcb, r); }
            pcb.vias.push(via); return { via: via.id, x: via.x, y: via.y };
        }
        case "track": return laytrack(b, a);
        case "pour": {
            const layer = a.layer === "B" ? "B" : "F", net = String(a.net === undefined ? "0" : a.net);
            if (!Pcb.pads(pcb).some(p => String(p.net) === net)) throw new Error(`net "${net}" has no pad on the board (nets: ${[...new Set(Pcb.pads(pcb).map(p => p.net).filter(Boolean))].join(", ")})`);
            const pts = a.points && a.points.length >= 3 ? a.points.map(q => [Number(q[0]), Number(q[1])]) : [[0.5, 0.5], [pcb.outline.w - 0.5, 0.5], [pcb.outline.w - 0.5, pcb.outline.h - 0.5], [0.5, pcb.outline.h - 0.5]];
            const z = { id: pcb.nextId++, layer, net, pts, thermal: a.thermal !== false };
            pcb.zones.push(z);
            const fz = Pcb.fillZones(pcb).find(f => f.zone === z);
            return { pour: z.id, layer, net: netName(net), copper_mm2: round(fz.rects.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0), 1), pads_connected: fz.connected.length, pads_cut_off: fz.islands.map(p => `${p.part.ref}.${p.i + 1}`) };
        }
        case "remove_pour": { const before = pcb.zones.length; pcb.zones = pcb.zones.filter(z => z.id !== a.id && !(a.layer && z.layer === a.layer && a.id === undefined)); return { removed: before - pcb.zones.length }; }
        case "delete_track": { const before = pcb.tracks.length; pcb.tracks = pcb.tracks.filter(t => t.id !== a.id); return { removed: before - pcb.tracks.length }; }
        default: throw new Error(`unknown op "${a.op}" (move, flip, package, outline, rules, auto_place, clear_routing, define_footprint, import_kicad_footprint, via, track, pour, remove_pour, delete_track)`);
    }
}

// lay a track along `points` the way the interactive router does: each segment shoves, walks around or just goes
function laytrack(b, a) {
    const pcb = b.pcb, R = pcb.rules, layer = a.layer === "B" ? "B" : "F", mode = a.mode || "shove";
    if (!Array.isArray(a.points) || a.points.length < 2) throw new Error("a track needs at least two points [[x, y], ...]");
    const pts = a.points.map(q => [Number(q[0]), Number(q[1])]);
    const net = a.net !== undefined ? String(a.net) : Pcb.netAt(pcb, layer, pts[0][0], pts[0][1]);
    const w = Number(a.width) || R.track;
    const draft = [pts[0]], pushed = { tracks: 0, vias: 0 };
    for (let i = 1; i < pts.length; i++) {
        const next = [...draft, pts[i]];
        if (mode === "walk") {
            const r = Pcb.walkaround(pcb, layer, next, w, net);
            if (!r.ok) throw new Error(`segment ${i} (to ${pts[i]}): ${r.reason}`);
            draft.push(...r.pts);
        } else {
            if (mode === "shove") {
                const r = Pcb.shove(pcb, layer, next, w, net);
                if (!r.ok) throw new Error(`segment ${i} (to ${pts[i]}): ${r.reason}`);
                Pcb.applyShove(pcb, r); pushed.tracks += r.changes.length; pushed.vias += r.vias.length;
            }
            draft.push(pts[i]);
        }
    }
    const t = { id: pcb.nextId++, layer, w, pts: draft };
    pcb.tracks.push(t);
    return { track: t.id, layer, net: net === null ? null : netName(net), mode, points: draft.length, pushed_tracks: pushed.tracks, pushed_vias: pushed.vias };
}

function edit(args) {
    const b = get(args.board_id), results = [];
    const snapshot = JSON.stringify(b.pcb);
    for (let i = 0; i < (args.actions || []).length; i++) {
        try { results.push({ ok: true, ...act(b, args.actions[i]) }); }
        catch (e) {
            // an action that fails leaves the board as it was before this call (all or nothing)
            b.pcb = JSON.parse(snapshot);
            return { applied: 0, failed_at: i, action: args.actions[i], error: e.message, results: results.map((r, k) => ({ ...r, rolled_back: true })), board: summary(b) };
        }
    }
    return { applied: results.length, results, board: summary(b) };
}

function route(args) {
    const b = get(args.board_id), pcb = b.pcb;
    const before = Pcb.ratsnest(pcb).length, t0 = Date.now();
    const r = Pcb.autoRoute(pcb, args.grid ? { grid: Number(args.grid) } : {});
    const left = Pcb.ratsnest(pcb);
    return { ...r, connections_before: before, still_unrouted: left.map(l => ({ net: netName(l.net), from: `${l.a.part.ref}.${l.a.i + 1}`, to: `${l.b.part.ref}.${l.b.i + 1}`, mm: round(l.d, 1) })).slice(0, 30), tracks: pcb.tracks.length, vias: pcb.vias.length, ms: Date.now() - t0, tip: r.failed ? "enlarge the board (pcb_edit outline), move parts apart or flip SMD parts to the back, then route again" : undefined };
}

function check(args) {
    const b = get(args.board_id), issues = Pcb.drc(b.pcb);
    const by = {};
    for (const i of issues) (by[i.type] = by[i.type] || []).push({ message: i.msg, x: round(i.x, 2), y: round(i.y, 2) });
    return { clean: issues.length === 0, counts: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])), issues: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.slice(0, 25)])), board: summary(b) };
}

function describe(args) {
    const b = get(args.board_id), pcb = b.pcb, want = new Set(args.include || ["parts", "nets", "tracks"]);
    const out = { ...summary(b) };
    if (want.has("parts")) out.parts_list = pcb.parts.map(p => ({ ref: p.ref, kind: p.kind, footprint: p.fp.name, x: round(p.x), y: round(p.y), rot: p.rot, side: p.flip ? "back" : "front", pads: Pcb.pads(pcb).filter(q => q.part === p).map(q => ({ n: q.i + 1, x: round(q.x), y: round(q.y), net: netName(q.net || "") })) }));
    if (want.has("nets")) {
        const nets = {};
        for (const p of Pcb.pads(pcb)) if (p.net) (nets[netName(p.net)] = nets[netName(p.net)] || []).push(`${p.part.ref}.${p.i + 1}`);
        out.nets = nets;
        out.unrouted = Pcb.ratsnest(pcb).map(l => `${netName(l.net)}: ${l.a.part.ref}.${l.a.i + 1} - ${l.b.part.ref}.${l.b.i + 1}`);
    }
    if (want.has("tracks")) { out.track_list = pcb.tracks.map(t => ({ id: t.id, layer: t.layer, width: t.w, points: t.pts.map(q => [round(q[0], 2), round(q[1], 2)]) })); out.via_list = pcb.vias.map(v => ({ id: v.id, x: round(v.x, 2), y: round(v.y, 2) })); }
    if (want.has("pours")) out.pour_list = (pcb.zones || []).map(z => ({ id: z.id, layer: z.layer, net: netName(z.net), thermal: z.thermal !== false, points: z.pts }));
    if (want.has("json")) out.board_json = pcb;
    return out;
}

function render(args) {
    const b = get(args.board_id), svg = Pcb.svg(b.pcb, { layers: args.layer || "all", scale: Number(args.scale) || 10 });
    const out = { svg_bytes: svg.length, layer: args.layer || "all" };
    if (args.file) { fs.mkdirSync(path.dirname(path.resolve(args.file)), { recursive: true }); fs.writeFileSync(args.file, svg); out.written_to = path.resolve(args.file); } else out.svg = svg;
    return out;
}

function exportBoard(args) {
    const b = get(args.board_id), pcb = b.pcb, name = String(args.name || "board").replace(/[^A-Za-z0-9_-]/g, "_");
    const blocking = Pcb.drc(pcb).filter(i => !["unrouted", "zone", "pins", "silk"].includes(i.type));
    if (blocking.length && !args.force) throw new Error(`the board has ${blocking.length} rule violation(s) (first: ${blocking[0].msg}); fix them, or pass force: true to export anyway`);
    const files = Pcb.files(pcb, name), zip = Pcb.zip(files);
    const out = { clean: blocking.length === 0, files: files.map(([n, t]) => ({ name: n, bytes: t.length, lines: t.split("\n").length - 1 })), zip_bytes: zip.length, unrouted_connections: Pcb.ratsnest(pcb).length };
    if (args.directory) {
        const dir = path.resolve(args.directory);
        fs.mkdirSync(dir, { recursive: true });
        for (const [n, t] of files) fs.writeFileSync(path.join(dir, n), t);
        fs.writeFileSync(path.join(dir, `${name}-gerber.zip`), zip);
        out.written_to = dir;
    }
    if (args.zip_base64) out.zip_base64 = Buffer.from(zip).toString("base64");
    return out;
}

const BOARD_ID = { type: "string", description: "The id returned by pcb_create." };
const TOOLS = [
    {
        name: "pcb_create",
        description: "Start a PCB from a circuit: a SPICE deck (netlist) or a KiCad schematic / netlist text (kicad). Every part gets a footprint (R/L/C axial or radial, TO-92, TO-220, DIP, headers; choose SMD sizes with packages), the parts are placed in rows grouped by shared nets, and the nets are known from the circuit. Returns a board_id for the other pcb_* tools plus the parts with their pads' nets.",
        inputSchema: { type: "object", properties: { netlist: { type: "string", description: "A SPICE deck. Pin order follows the schematic: transistors E/B/C as in the package, MOSFETs G/D/S." }, kicad: { type: "string", description: "Text of a .kicad_sch or KiCad .net instead of a deck." }, width: { type: "number", description: "Board width in mm (default: fitted to the parts)." }, height: { type: "number" }, packages: { type: "object", description: 'Footprint per reference, e.g. {"R1": "0805", "Q1": "sot23", "U1": "soic"}. R/L/C: axial|radial|0603|0805|1206; D: axial|sod123; Q/J: to92|sot23; M: to220|sot23; DIGITAL: dip|soic.' }, track_width: { type: "number" }, clearance: { type: "number" }, auto_place: { type: "boolean", description: "Default true." } } },
        run: create
    },
    {
        name: "pcb_edit",
        description: "Change a board with a list of actions, applied in order and all-or-nothing (if one fails, none of them stay and you are told which). Ops: move {ref,x,y,rot}, flip {ref} (SMD only), package {ref,package}, outline {width,height}, rules {clearance,track_width,via,via_drill,edge}, auto_place {fit} (clears routing), clear_routing, define_footprint {definition} (text: footprint NAME / pad N X Y W H [round|rect] [drill D] / line … / circle X Y R / map …), import_kicad_footprint {text}, via {x,y,shove}, track {layer,points:[[x,y],…],net,width,mode:'shove'|'walk'|'off'} (lays a track the way the interactive router does: 'shove' pushes other nets' tracks and vias aside, 'walk' routes around them at 0/45/90 degrees, 'off' places it as given), pour {layer,net,points,thermal} (copper pour; net '0' is ground), remove_pour {id}, delete_track {id}.",
        inputSchema: { type: "object", required: ["board_id", "actions"], properties: { board_id: BOARD_ID, actions: { type: "array", items: { type: "object", properties: { op: { type: "string" } }, required: ["op"] } } } },
        run: edit
    },
    {
        name: "pcb_route",
        description: "Auto-route every unrouted connection (A* on a 0.25 mm grid, two layers with vias, shortest first). Returns how many were routed, which could not be, and what to try for those.",
        inputSchema: { type: "object", required: ["board_id"], properties: { board_id: BOARD_ID, grid: { type: "number", description: "Grid in mm (default 0.25)." } } },
        run: route
    },
    {
        name: "pcb_check",
        description: "Design-rule check: clearance, shorts, board edge, track width, copper pours that cut a pad off, footprint pin counts and unrouted connections, grouped by kind with positions.",
        inputSchema: { type: "object", required: ["board_id"], properties: { board_id: BOARD_ID } },
        run: check
    },
    {
        name: "pcb_describe",
        description: "Read a board back: parts with positions and each pad's net, nets with their pads, unrouted connections, tracks and vias, pours, or the whole board as JSON. include: any of parts, nets, tracks, pours, json (default parts, nets, tracks).",
        inputSchema: { type: "object", required: ["board_id"], properties: { board_id: BOARD_ID, include: { type: "array", items: { type: "string" } } } },
        run: describe
    },
    {
        name: "pcb_render",
        description: "An SVG picture of the board (outline, pours, tracks red front / blue back, pads, vias, silkscreen with references). Returned as text, or written to a file when file is given. layer: all, F or B.",
        inputSchema: { type: "object", required: ["board_id"], properties: { board_id: BOARD_ID, layer: { type: "string", enum: ["all", "F", "B"] }, scale: { type: "number", description: "Pixels per mm (default 10)." }, file: { type: "string", description: "Write the SVG here instead of returning it." } } },
        run: render
    },
    {
        name: "pcb_export",
        description: "Gerber (front / back copper, silkscreen, solder mask, paste, edge cuts) and Excellon drill files plus a ZIP. Refuses a board with rule violations unless force is true. With directory the files and the ZIP are written there; zip_base64 returns the ZIP inline.",
        inputSchema: { type: "object", required: ["board_id"], properties: { board_id: BOARD_ID, name: { type: "string" }, directory: { type: "string" }, zip_base64: { type: "boolean" }, force: { type: "boolean" } } },
        run: exportBoard
    }
];

module.exports = { TOOLS, boards };

// The PCB layout window (a full-window overlay on the schematic): footprints from the schematic's netlist, ratsnest,
// manual routing on two layers, a grid autorouter, a design-rule check and Gerber / Excellon output. The board lives
// in the design file (editor.pcb); the geometry and rules are in js/pcb/pcb.js.
//   Keys: S select / move, T route (click points, Enter or double-click to finish, Esc to cancel), V via while routing,
//   F other layer, R rotate part, Delete remove a track or via, Ctrl+Z undo, wheel zoom, right / middle drag pans.

class PcbView {
    constructor(editor, doc, runner) {
        this.editor = editor;
        this.doc = doc;
        this.runner = runner;
        this.tool = "select";
        this.layer = "F";
        this.sel = null;                 // { kind: "part" | "track" | "via", ref }
        this.draft = null;               // track being routed: { layer, pts }
        this.issues = [];
        this.fills = [];
        this.rev = 0;
        this.zdraft = null;
        this.tdrag = null;
        this.undoStack = [];
        this.view = { s: 8, ox: 20, oy: 20 };
        this.mouse = { x: 0, y: 0 };
        this.isOpen = false;

        const root = this.root = document.createElement("div");
        root.id = "pcbview";
        root.className = "hidden";
        root.innerHTML = `
            <div class="pcb-bar">
                <b>PCB</b>
                <button class="tb-btn txt" data-a="sync" title="Bring parts and nets in from the schematic (keeps placement and routing of parts that stay)">Update from schematic</button>
                <button class="tb-btn txt" data-a="backannotate" title="Send the board's part numbering and footprints back to the schematic">Back-annotate…</button>
                <button class="tb-btn txt" data-a="place" title="Arrange every part in rows, grouping the ones that share nets">Auto-place</button>
                <button class="tb-btn txt" data-a="route" title="Route every unrouted connection (two layers, vias)">Auto-route</button>
                <button class="tb-btn txt" data-a="unroute" title="Remove all tracks and vias">Clear routing</button>
                <span class="sep"></span>
                <button class="tb-btn txt" data-tool="select" title="Select and move (S)">Select</button>
                <button class="tb-btn txt" data-tool="route" title="Route a track (T)">Route</button>
                <label title="How the track you lay deals with other copper: Shove pushes tracks and vias aside; Walk around routes the new track around them (0°/45°/90°); Off lets it violate (the rule check reports it)">Route <select id="pcbMode"><option value="shove">Shove</option><option value="walk">Walk around</option><option value="off">Off</option></select></label>
                <button class="tb-btn txt" data-a="layer" title="Active copper layer (F)">Layer: <span id="pcbLayer">F.Cu</span></button>
                <button class="tb-btn txt" data-a="rotate" title="Rotate the selected part (R)">Rotate</button>
                <button class="tb-btn txt" data-a="flip" title="Move the selected surface-mount part to the other side of the board (X)">Flip side</button>
                <label title="Footprint of the selected part">Footprint <select id="pcbPkg" disabled></select></label>
                <button class="tb-btn txt" data-a="delete" title="Delete the selected track or via (Del)">Delete</button>
                <button class="tb-btn txt" data-a="undo" title="Undo (Ctrl+Z)">Undo</button>
                <span class="sep"></span>
                <label title="Board width, height (mm)">Board <input id="pcbW" type="number" min="10" max="400" step="1"> × <input id="pcbH" type="number" min="10" max="400" step="1"> mm</label>
                <label title="Track width (mm)">Track <input id="pcbTrack" type="number" min="0.1" max="5" step="0.05"></label>
                <label title="Copper clearance (mm)">Clearance <input id="pcbClr" type="number" min="0.05" max="2" step="0.05"></label>
                <label title="Also check against the limits of a manufacturing service: minimum track, drill, annular ring, hole spacing, solder-mask webs, board size (Check rules lists what a fab would reject)">Fab <select id="pcbFab"><option value="">none</option>${Object.entries(Pcb.FAB_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select></label>
                <span class="sep"></span>
                <button class="tb-btn txt" data-tool="zone" title="Draw a copper pour: click the corners, Enter or double-click to finish (Z)">Pour</button>
                <label title="Net of the pour you draw">Net <select id="pcbZoneNet"></select></label>
                <label title="Thermal relief on the pour's own pads"><input type="checkbox" id="pcbThermal" checked> Thermal</label>
                <button class="tb-btn txt" data-a="pourboard" title="Pour the whole board on the active layer with the chosen net">Pour board</button>
                <button class="tb-btn txt" data-a="footprints" title="Define your own footprints, or import a KiCad .kicad_mod">Footprints…</button>
                <span class="sep"></span>
                <button class="tb-btn txt" data-a="lengths" title="Track lengths, length-match groups and differential pairs, with serpentine tuning">Lengths…</button>
                <button class="tb-btn txt" data-a="drc" title="Check clearances, shorts, board edge, track width and unrouted nets">Check rules</button>
                <button class="tb-btn txt" data-a="export" title="Download Gerber (F.Cu, B.Cu, edge) and Excellon drill files as a ZIP">Export Gerber…</button>
                <span class="grow"></span>
                <button class="tb-btn" data-a="close" title="Back to the schematic (Esc)">✕</button>
            </div>
            <div class="pcb-main">
                <canvas id="pcbCanvas" tabindex="0"></canvas>
                <div class="pcb-side"><div id="pcbIssues" class="pcb-issues"></div></div>
            </div>
            <div class="pcb-status" id="pcbStatus"></div>
            <div id="pcbLen" class="pcb-fped hidden">
                <div class="pcb-fped-box" style="width:640px;max-height:86vh;display:flex;flex-direction:column">
                    <div class="pcb-fped-head"><b>Track lengths</b><span class="grow"></span><button class="tb-btn" data-ln="close" title="Close">✕</button></div>
                    <div id="lnBody" style="padding:10px;overflow:auto;display:flex;flex-direction:column;gap:8px"></div>
                </div>
            </div>
            <div id="pcbBack" class="pcb-fped hidden">
                <div class="pcb-fped-box" style="width:460px">
                    <div class="pcb-fped-head"><b>Back-annotate to the schematic</b><span class="grow"></span><button class="tb-btn" data-ba="close" title="Close">✕</button></div>
                    <div style="padding:10px;display:flex;flex-direction:column;gap:6px">
                        <label><input type="checkbox" id="baRenumber" checked> Number the parts by their place on the board</label>
                        <div style="margin-left:22px"><label><input type="radio" name="baOrder" value="across" checked> left to right, then down</label>
                            <label style="margin-left:12px"><input type="radio" name="baOrder" value="down"> top to bottom, then right</label></div>
                        <label><input type="checkbox" id="baFootprints" checked> Write each part's footprint to the schematic</label>
                        <div class="pcb-note" id="baPreview" style="min-height:3em"></div>
                        <div class="pcb-note">The schematic's references are renamed to match (current probes follow their part). Parts inside sub-sheets are left alone. To take it back, undo in both places (Undo here for the board, Edit > Undo for the schematic).</div>
                    </div>
                    <div class="pcb-fped-foot"><button class="tb-btn txt" data-ba="apply">Apply</button><button class="tb-btn txt" data-ba="close">Cancel</button></div>
                </div>
            </div>
            <div id="pcbFpEd" class="pcb-fped hidden">
                <div class="pcb-fped-box">
                    <div class="pcb-fped-head"><b>User footprints</b><span class="grow"></span><button class="tb-btn" data-fp="close" title="Close">✕</button></div>
                    <div class="pcb-fped-body">
                        <div class="pcb-fped-left">
                            <select id="fpList" size="8"></select>
                            <button class="tb-btn txt" data-fp="new">New</button>
                            <button class="tb-btn txt" data-fp="import">Import .kicad_mod…</button>
                            <input type="file" id="fpFile" accept=".kicad_mod,.mod,.txt" class="hidden">
                            <div class="pcb-fplib">
                                <b>Library (this browser)</b>
                                <input id="fpLibFilter" placeholder="Search, e.g. 0805 or SOIC-8" autocomplete="off">
                                <select id="fpLib" size="7"></select>
                                <div class="pcb-note" id="fpLibInfo"></div>
                                <button class="tb-btn txt" data-fp="libfolder" title="Pick a KiCad .pretty folder">Import folder…</button>
                                <button class="tb-btn txt" data-fp="libfiles" title="Pick .kicad_mod files">Import files…</button>
                                <button class="tb-btn txt" data-fp="libdelete" title="Remove the selected footprint from the library">Remove</button>
                                <input type="file" id="fpLibFiles" accept=".kicad_mod,.mod" multiple class="hidden">
                                <input type="file" id="fpLibFolder" webkitdirectory multiple class="hidden">
                            </div>
                            <label>Template <select id="fpTpl"><option value="">(choose)</option><option value="smd2">2-pad SMD</option><option value="th3">3-pin through-hole</option><option value="dual">Dual row, 8 pins</option></select></label>
                        </div>
                        <div class="pcb-fped-mid">
                            <textarea id="fpText" spellcheck="false" rows="14"></textarea>
                            <div class="pcb-note" id="fpHelp">pad N X Y W H [round|rect] [drill D] (a drill makes it through-hole) · line X Y X Y … · circle X Y R · map I J K … (pad i takes pin map[i], counting from 0) · mm, y down</div>
                            <div class="pcb-fped-err" id="fpErr"></div>
                        </div>
                        <canvas id="fpPreview" width="300" height="240"></canvas>
                    </div>
                    <div class="pcb-fped-foot">
                        <button class="tb-btn txt" data-fp="save">Save</button>
                        <button class="tb-btn txt" data-fp="use" title="Give the selected part this footprint">Use on selected part</button>
                        <button class="tb-btn txt" data-fp="delete">Delete</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(root);
        this.cv = root.querySelector("#pcbCanvas");
        this.ctx = this.cv.getContext("2d");
        this.statusEl = root.querySelector("#pcbStatus");
        this.bind();
    }

    get pcb() { return this.editor.pcb; }

    // ---------------------------------------------------------------- open / close
    open() {
        if (!this.editor.pcb) this.editor.pcb = Pcb.blank();
        this.pcb.zones = this.pcb.zones || [];
        this.pcb.footprints = this.pcb.footprints || {};
        this.root.classList.remove("hidden");
        this.isOpen = true;
        this.sync(true);
        this.fills = Pcb.fillZones(this.pcb);
        this.fit();
        this.fields();
        this.cv.focus();
    }

    close() {
        this.root.classList.add("hidden");
        this.isOpen = false;
        this.draft = null;
        this.editor.canvas.focus();
    }

    toggle() { this.isOpen ? this.close() : this.open(); }

    fields() {
        const p = this.pcb, q = (id) => this.root.querySelector(id);
        q("#pcbW").value = p.outline.w; q("#pcbH").value = p.outline.h;
        q("#pcbTrack").value = p.rules.track; q("#pcbClr").value = p.rules.clearance; q("#pcbFab").value = p.rules.fab || "";
        q("#pcbLayer").textContent = this.layer === "F" ? "F.Cu" : "B.Cu";
        this.root.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === this.tool));
    }

    // ---------------------------------------------------------------- actions
    snapshot() { this.undoStack.push(JSON.stringify(this.pcb)); if (this.undoStack.length > 60) this.undoStack.shift(); }
    changed() { this.rev++; this.doc.emit(); this.scheduleFill(); this.draw(); }

    // the pours are recomputed shortly after the board stops changing (a fill takes tens of milliseconds)
    scheduleFill() {
        clearTimeout(this.fillTimer);
        if (!(this.pcb.zones || []).length) { this.fills = []; return; }
        this.fillTimer = setTimeout(() => { this.fills = Pcb.fillZones(this.pcb); this.draw(); }, 120);
    }

    undo() {
        if (!this.undoStack.length) return;
        this.editor.pcb = JSON.parse(this.undoStack.pop());
        this.sel = null; this.draft = null; this.issues = []; this.renderIssues(); this.fields(); this.changed();
    }

    sync(quiet) {
        let info;
        try { info = NetlistExtractor.extract(this.editor); }
        catch (e) { this.say(`Could not read the schematic: ${e.message}`, true); return; }
        this.snapshot();
        const r = Pcb.sync(this.pcb, info.elements);
        if (r.added) { if (this.pcb.parts.some(p => p.placed)) this.placeNew(); else { Pcb.autoPlace(this.pcb, { fit: true }); this.fields(); this.fit(); } }
        this.dropOrphans();
        if (!quiet || r.added || r.removed) this.say(`${this.pcb.parts.length} part(s): ${r.added} added, ${r.removed} removed.`);
        this.changed();
    }

    // new parts go in a row below everything that is already placed
    placeNew() {
        const p = this.pcb, placed = p.parts.filter(q => q.placed);
        let y = Math.max(4, ...placed.map(q => q.y + q.fp.h / 2 + 3)), x = 4;
        for (const q of p.parts.filter(q => !q.placed)) { q.x = x + q.fp.w / 2; q.y = y + q.fp.h / 2; q.placed = true; x += q.fp.w + 2.5; }
        p.outline.h = Math.max(p.outline.h, Math.ceil(y + 14));
        p.outline.w = Math.max(p.outline.w, Math.ceil(x + 2));
        this.fields();
    }

    // tracks and vias that no longer touch any pad (their parts are gone)
    dropOrphans() {
        const p = this.pcb;
        if (!p.tracks.length && !p.vias.length) return;
        const conn = Pcb.connectivity(p);
        const live = new Set();
        for (const g of conn) if (g.pads.length) { g.tracks.forEach(t => live.add(t)); g.vias.forEach(v => live.add(v)); }
        p.tracks = p.tracks.filter(t => live.has(t));
        p.vias = p.vias.filter(v => live.has(v));
    }

    act(a) {
        const p = this.pcb;
        switch (a) {
            case "close": this.close(); break;
            case "sync": this.sync(false); break;
            case "place": this.snapshot(); Pcb.autoPlace(p, { fit: true }); p.tracks = []; p.vias = []; this.fields(); this.fit(); this.say("Parts placed; routing cleared because the parts moved."); this.changed(); break;
            case "route": {
                this.snapshot();
                const t0 = performance.now();
                const r = Pcb.autoRoute(p);
                this.say(`Routed ${r.routed} of ${r.total} connection(s) in ${Math.round(performance.now() - t0)} ms${r.failed ? `; ${r.failed} could not be routed (try a larger board or move parts, then route again)` : ""}.`, r.failed > 0);
                this.changed();
                break;
            }
            case "unroute": this.snapshot(); p.tracks = []; p.vias = []; this.issues = []; this.renderIssues(); this.say("Routing cleared."); this.changed(); break;
            case "layer": this.layer = this.layer === "F" ? "B" : "F"; this.fields(); if (this.draft && this.draft.pts.length < 2) this.draft.layer = this.layer; this.draw(); break;
            case "flip": if (this.sel && this.sel.kind === "part" && this.sel.ref.fp.smd) { this.snapshot(); this.sel.ref.flip = !this.sel.ref.flip; this.say(`${this.sel.ref.ref} is now on the ${this.sel.ref.flip ? "back" : "front"}; tracks that ended on its pads need routing again.`); this.changed(); } else this.say("Select a surface-mount part to flip it to the other side.", true); break;
            case "rotate": if (this.sel && this.sel.kind === "part") { this.snapshot(); this.sel.ref.rot = (this.sel.ref.rot + 90) % 360; this.changed(); } break;
            case "delete":
                if (this.sel && this.sel.kind === "track") { this.snapshot(); p.tracks = p.tracks.filter(t => t !== this.sel.ref); this.sel = null; this.changed(); }
                else if (this.sel && this.sel.kind === "zone") { this.snapshot(); p.zones = p.zones.filter(z => z !== this.sel.ref); this.sel = null; this.changed(); }
                else if (this.sel && this.sel.kind === "via") { this.snapshot(); p.vias = p.vias.filter(v => v !== this.sel.ref); this.sel = null; this.changed(); }
                break;
            case "undo": this.undo(); break;
            case "pourboard": this.addZone([[0.5, 0.5], [p.outline.w - 0.5, 0.5], [p.outline.w - 0.5, p.outline.h - 0.5], [0.5, p.outline.h - 0.5]]); break;
            case "footprints": this.openFootprints(); break;
            case "backannotate": this.openBackAnnotate(); break;
            case "lengths": this.openLengths(); break;
            case "drc": this.runDrc(); break;
            case "export": this.exportGerber(); break;
        }
    }

    // ---------------------------------------------------------------- lengths, match groups, pairs
    openLengths() {
        const ed = this.root.querySelector("#pcbLen");
        ed.classList.remove("hidden");
        if (!this.lnBound) {
            this.lnBound = true;
            ed.addEventListener("click", (e) => {
                const b = e.target.closest("[data-ln]"); if (!b) return;
                const a = b.dataset.ln, p = this.pcb;
                if (a === "close") { ed.classList.add("hidden"); this.cv.focus(); return; }
                if (a === "add") {
                    const q = (id) => ed.querySelector("#" + id), nets = [...q("lnNets").selectedOptions].map(o => o.value);
                    const name = q("lnName").value.trim() || `group${(p.groups || []).length + 1}`;
                    if (nets.length < 2) { this.lengthsMsg("Pick at least two nets (Ctrl+click for several)."); return; }
                    const pair = q("lnPair").checked;
                    if (pair && nets.length !== 2) { this.lengthsMsg("A differential pair has exactly two nets."); return; }
                    const tv = q("lnTarget").value.trim(), tl = q("lnTol").value.trim();
                    this.snapshot();
                    (p.groups = p.groups || []).push({ name, nets, pair, target: tv === "" ? null : Number(tv), tol: tl === "" ? (pair ? 0.1 : 0.5) : Number(tl) });
                    this.changed(); this.renderLengths(); return;
                }
                const i = Number(b.dataset.i), g = (p.groups || [])[i];
                if (!g) return;
                if (a === "del") { this.snapshot(); p.groups.splice(i, 1); this.changed(); this.renderLengths(); return; }
                if (a === "tune") {
                    this.snapshot();
                    const res = PcbLength.tuneGroup(p, g);
                    const bad = res.filter(r => !r.ok);
                    this.changed(); this.renderLengths();
                    this.lengthsMsg(res.length ? `${res.length - bad.length} of ${res.length} net(s) tuned${bad.length ? `. ${bad.map(r => `Net ${r.net}: ${r.reason}`).join(" ")}` : "."}` : "Already within tolerance.");
                }
            });
        }
        this.renderLengths();
    }

    lengthsMsg(t) { const el = this.root.querySelector("#lnMsg"); if (el) el.textContent = t; }

    renderLengths() {
        const body = this.root.querySelector("#lnBody"), p = this.pcb, esc = PropertiesPanel.esc;
        const lens = PcbLength.netLengths(p), nets = new Map();
        for (const pad of Pcb.pads(p)) if (pad.net) { if (!nets.has(String(pad.net))) nets.set(String(pad.net), []); nets.get(String(pad.net)).push(`${pad.part.ref}.${pad.i + 1}`); }
        const list = [...nets.keys()].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
        const label = (n) => `${n}: ${nets.get(n).slice(0, 3).join(", ")}${nets.get(n).length > 3 ? ", …" : ""}`;
        const rows = list.filter(n => (nets.get(n) || []).length > 1).map(n => { const l = lens.get(n); return `<tr><td>${esc(label(n))}</td><td style="text-align:right">${l ? l.length.toFixed(2) : "–"}</td><td style="text-align:right">${l ? l.vias : "–"}</td></tr>`; }).join("");
        const rep = PcbLength.report(p);
        const groups = rep.map((r, i) => `<div style="border:1px solid var(--ui-border,#444);border-radius:4px;padding:6px">
            <b>${esc(r.group.name)}</b> ${r.group.pair ? "(differential pair)" : "(match group)"}: target ${r.target.toFixed(2)} mm, tolerance ${r.tol} mm, spread ${r.spread.toFixed(2)} mm ${r.ok ? "✓" : "✗"}
            <table style="margin-top:4px">${r.rows.map(x => `<tr><td>net ${esc(x.net)}</td><td style="text-align:right;padding-left:12px">${x.length ? x.length.toFixed(2) + " mm" : "not routed"}</td><td style="text-align:right;padding-left:12px">${x.length ? (x.delta >= 0 ? "+" : "") + x.delta.toFixed(2) : ""}</td></tr>`).join("")}</table>
            <button class="tb-btn txt" data-ln="tune" data-i="${i}" title="Add serpentine to the shorter nets until they meet the target">Tune to match</button>
            <button class="tb-btn txt" data-ln="del" data-i="${i}">Remove group</button></div>`).join("");
        body.innerHTML = `<div><b>Nets</b> (length of copper, vias)<div style="max-height:22vh;overflow:auto"><table style="width:100%"><tr><th style="text-align:left">Net</th><th style="text-align:right">mm</th><th style="text-align:right">Vias</th></tr>${rows || '<tr><td colspan="3">No nets with two or more pads.</td></tr>'}</table></div></div>
            <div><b>Match groups and pairs</b>${groups || '<div class="pcb-note">None yet.</div>'}</div>
            <fieldset style="border:1px solid var(--ui-border,#444)"><legend>New group</legend>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
                    <label>Name <input id="lnName" size="10"></label>
                    <label>Nets <select id="lnNets" multiple size="5">${list.filter(n => (nets.get(n) || []).length > 1).map(n => `<option value="${esc(n)}">${esc(label(n))}</option>`).join("")}</select></label>
                    <div style="display:flex;flex-direction:column;gap:4px">
                        <label><input type="checkbox" id="lnPair" style="width:auto"> differential pair</label>
                        <label>Target mm <input id="lnTarget" size="6" placeholder="longest"></label>
                        <label>Tolerance mm <input id="lnTol" size="6" placeholder="0.5 / 0.1"></label>
                        <button class="tb-btn txt" data-ln="add">Add group</button>
                    </div>
                </div></fieldset>
            <div class="pcb-note" id="lnMsg"></div>
            <div class="pcb-note">Tuning inserts square serpentine bumps in the middle of the net's longest straight run, on the side that creates no rule violation. A net's length is all its copper; the rule check lists groups outside tolerance.</div>`;
    }

    // ---------------------------------------------------------------- back-annotation
    baPlan() {
        const q = (id) => this.root.querySelector("#" + id);
        return BackAnnotate.plan(this.editor, this.pcb, { renumber: q("baRenumber").checked, footprints: q("baFootprints").checked, order: this.root.querySelector('input[name="baOrder"]:checked').value });
    }

    baRender() {
        const plan = this.baPlan(), el = this.root.querySelector("#baPreview");
        const bits = [];
        if (plan.renames.length) bits.push(`${plan.renames.length} of ${plan.parts} parts are renumbered: ${plan.renames.slice(0, 10).map(r => `${r.from} → ${r.to}`).join(", ")}${plan.renames.length > 10 ? ", …" : ""}`);
        if (plan.footprints.length) bits.push(`${plan.footprints.length} footprint field${plan.footprints.length === 1 ? "" : "s"} written`);
        if (plan.skipped.length) bits.push(`${plan.skipped.length} part${plan.skipped.length === 1 ? "" : "s"} skipped (${plan.skipped.slice(0, 3).map(s => s.part.ref).join(", ")}${plan.skipped.length > 3 ? ", …" : ""})`);
        el.textContent = bits.length ? bits.join(". ") + "." : "Nothing to change.";
    }

    openBackAnnotate() {
        const ed = this.root.querySelector("#pcbBack");
        ed.classList.remove("hidden");
        if (!this.baBound) {
            this.baBound = true;
            ed.querySelectorAll("[data-ba]").forEach(b => b.onclick = () => {
                if (b.dataset.ba === "close") { ed.classList.add("hidden"); this.cv.focus(); return; }
                const plan = this.baPlan();
                this.snapshot();
                const r = BackAnnotate.apply(this.editor, plan);
                ed.classList.add("hidden"); this.cv.focus();
                this.say(r.renamed || r.footprints ? `Back-annotated: ${r.renamed} part${r.renamed === 1 ? "" : "s"} renumbered, ${r.footprints} footprint${r.footprints === 1 ? "" : "s"} written to the schematic.` : "Nothing to change.");
                this.changed();
            });
            ed.addEventListener("change", () => this.baRender());
        }
        this.baRender();
    }

    addZone(pts) {
        const net = this.root.querySelector("#pcbZoneNet").value;
        if (!net) { this.say("There are no nets with pads to pour yet.", true); return; }
        this.snapshot();
        this.pcb.zones = this.pcb.zones || [];
        const z = { id: this.pcb.nextId++, layer: this.layer, net, pts, thermal: this.root.querySelector("#pcbThermal").checked };
        this.pcb.zones.push(z);
        this.sel = { kind: "zone", ref: z };
        this.say(`Pour ${z.id}: ${z.layer}.Cu, net ${net === "0" ? "GND" : net}. Moving or routing refills it; Check rules reports pads it cuts off.`);
        this.changed();
    }

    runDrc() {
        this.issues = Pcb.drc(this.pcb);
        this.renderIssues();
        const real = this.issues.filter(i => i.type !== "unrouted").length, un = this.issues.length - real;
        this.say(this.issues.length ? `${real} rule violation(s), ${un} unrouted connection(s).` : "No rule violations and every net is routed.");
        this.draw();
    }

    renderIssues() {
        const el = this.root.querySelector("#pcbIssues");
        if (!this.issues.length) { el.innerHTML = `<div class="pcb-note">No issues listed. Use <b>Check rules</b>.</div>`; return; }
        el.innerHTML = this.issues.map((i, k) => `<div class="pcb-issue ${i.type}" data-k="${k}"><b>${i.type}</b> ${String(i.msg).replace(/</g, "&lt;")}</div>`).join("");
        el.querySelectorAll(".pcb-issue").forEach(d => d.onclick = () => { const i = this.issues[Number(d.dataset.k)]; this.view.ox = this.cv.width / 2 - i.x * this.view.s; this.view.oy = this.cv.height / 2 - i.y * this.view.s; this.draw(); });
    }

    exportGerber() {
        const issues = Pcb.drc(this.pcb).filter(i => i.type !== "unrouted");
        const name = (this.doc.name || "board").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "board";
        const zip = Pcb.zip(Pcb.files(this.pcb, name));
        window.downloadFile(`${name}-gerber.zip`, zip, "application/zip");
        this.say(`Downloaded ${name}-gerber.zip (F.Cu, B.Cu, edge cuts, drill).${issues.length ? ` Note: ${issues.length} rule violation(s) are still open.` : ""}`, issues.length > 0);
    }

    say(msg, warn = false) { this.statusEl.textContent = msg; this.statusEl.classList.toggle("warn", !!warn); if (this.runner && this.runner.toast && warn) this.runner.toast(msg, "warn"); }

    // ---------------------------------------------------------------- view
    fit() {
        const r = this.cv.getBoundingClientRect(), o = this.pcb.outline;
        this.resize();
        const s = Math.min((this.cv.width - 40) / o.w, (this.cv.height - 40) / o.h);
        this.view.s = Math.max(2, s);
        this.view.ox = (this.cv.width - o.w * this.view.s) / 2;
        this.view.oy = (this.cv.height - o.h * this.view.s) / 2;
        this.draw();
    }

    resize() {
        const m = this.cv.parentElement, r = m.getBoundingClientRect(), d = window.devicePixelRatio || 1;
        const w = Math.max(100, Math.round(r.width - (this.root.querySelector(".pcb-side").offsetWidth || 0))), h = Math.max(100, Math.round(r.height));
        if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    }

    toWorld(px, py) { return { x: (px - this.view.ox) / this.view.s, y: (py - this.view.oy) / this.view.s }; }
    snap(x, y, free) {
        // snap to a pad centre when over one, otherwise to the 0.25 mm grid
        const pad = Pcb.padAt(this.pcb, x, y, 0.3);
        if (pad && !free) return { x: pad.x, y: pad.y, pad };
        return { x: Math.round(x / 0.25) * 0.25, y: Math.round(y / 0.25) * 0.25 };
    }

    // ---------------------------------------------------------------- pointer + keys
    bind() {
        const cv = this.cv;
        this.root.querySelectorAll("[data-a]").forEach(b => b.onclick = () => this.act(b.dataset.a));
        this.root.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => this.setTool(b.dataset.tool));
        const num = (id, fn) => this.root.querySelector(id).addEventListener("change", (e) => { const v = Number(e.target.value); if (isFinite(v) && v > 0) { this.snapshot(); fn(v); this.changed(); } });
        num("#pcbW", v => { this.pcb.outline.w = v; }); num("#pcbH", v => { this.pcb.outline.h = v; });
        num("#pcbTrack", v => { this.pcb.rules.track = v; }); num("#pcbClr", v => { this.pcb.rules.clearance = v; });
        this.root.querySelector("#pcbFab").addEventListener("change", (e) => { this.snapshot(); this.pcb.rules.fab = e.target.value || undefined; this.changed(); if (e.target.value) this.runDrc(); });
        this.root.querySelector("#pcbPkg").addEventListener("change", (e) => {
            if (!this.sel || this.sel.kind !== "part") return;
            this.snapshot();
            Pcb.setPackage(this.sel.ref, e.target.value, this.pcb.footprints);
            this.say(`${this.sel.ref.ref} is now ${this.sel.ref.fp.name}; its pads moved, so route it again.`);
            this.changed();
        });
        window.addEventListener("resize", () => { if (this.isOpen) { this.resize(); this.draw(); } });
        cv.addEventListener("contextmenu", (e) => e.preventDefault());
        cv.addEventListener("wheel", (e) => {
            e.preventDefault();
            const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, w = this.toWorld(px, py);
            const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            this.view.s = Math.max(1.5, Math.min(80, this.view.s * k));
            this.view.ox = px - w.x * this.view.s; this.view.oy = py - w.y * this.view.s;
            this.draw();
        }, { passive: false });
        cv.addEventListener("pointerdown", (e) => this.down(e));
        cv.addEventListener("pointermove", (e) => this.move(e));
        cv.addEventListener("pointerup", (e) => this.up(e));
        cv.addEventListener("dblclick", () => { if (this.draft) this.finishTrack(); else if (this.zdraft) this.finishZone(); });
        this.root.addEventListener("keydown", (e) => this.key(e));
    }

    setTool(t) { this.tool = t; if (t !== "route") this.draft = null; if (t !== "zone") this.zdraft = null; this.fields(); this.draw(); }

    pos(e) { const r = this.cv.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; }

    hit(x, y) {
        const p = this.pcb;
        for (const v of p.vias) if (Math.hypot(v.x - x, v.y - y) <= v.d / 2 + 0.2) return { kind: "via", ref: v };
        for (const t of p.tracks) for (let i = 0; i + 1 < t.pts.length; i++) if (Pcb.segDist(x, y, t.pts[i][0], t.pts[i][1], t.pts[i + 1][0], t.pts[i + 1][1]) <= t.w / 2 + 0.25) return { kind: "track", ref: t };
        for (let i = p.parts.length - 1; i >= 0; i--) {
            const q = p.parts[i], swap = (Math.round(q.rot / 90) % 2) !== 0, w = swap ? q.fp.h : q.fp.w, h = swap ? q.fp.w : q.fp.h;
            if (Math.abs(x - q.x) <= w / 2 && Math.abs(y - q.y) <= h / 2) return { kind: "part", ref: q };
        }
        // a pour is picked by its outline (so the rest of a board-wide pour still pans)
        for (const z of p.zones || []) for (let i = 0; i < z.pts.length; i++) { const a = z.pts[i], b = z.pts[(i + 1) % z.pts.length]; if (Pcb.segDist(x, y, a[0], a[1], b[0], b[1]) <= 0.7) return { kind: "zone", ref: z }; }
        return null;
    }

    down(e) {
        this.cv.focus();
        const { px, py } = this.pos(e), w = this.toWorld(px, py);
        if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) { this.pan = { px, py, ox: this.view.ox, oy: this.view.oy }; try { this.cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic pointers have no capture */ } return; }
        if (e.button !== 0) return;
        if (this.tool === "route") { this.routeClick(w, e); return; }
        if (this.tool === "zone") {
            const q = [Math.round(w.x * 2) / 2, Math.round(w.y * 2) / 2];
            this.zdraft = this.zdraft || { pts: [] };
            const last = this.zdraft.pts[this.zdraft.pts.length - 1];
            if (!last || last[0] !== q[0] || last[1] !== q[1]) this.zdraft.pts.push(q);
            this.draw();
            return;
        }
        const h = this.hit(w.x, w.y);
        this.sel = h;
        if (h && h.kind === "track" && !e.altKey) {
            // drag a vertex of the track (or make one where you grabbed a segment); other copper is pushed aside when Shove is on
            const t = h.ref, orig = t.pts.map(q => [q[0], q[1]]);
            let idx = t.pts.findIndex(q => Math.hypot(q[0] - w.x, q[1] - w.y) <= 0.8);
            if (idx < 0) {
                let best = null;
                for (let i = 0; i + 1 < t.pts.length; i++) { const a = t.pts[i], b = t.pts[i + 1], d = Pcb.segDist(w.x, w.y, a[0], a[1], b[0], b[1]); if (!best || d < best.d) best = { d, i }; }
                const g = [Math.round(w.x * 4) / 4, Math.round(w.y * 4) / 4];
                t.pts.splice(best.i + 1, 0, g); idx = best.i + 1;
            }
            this.snapshot();
            this.tdrag = { track: t, index: idx, orig, moved: false };
            try { this.cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic pointers have no capture */ }
            this.draw();
            return;
        }
        if (h && h.kind === "part") { this.snapshot(); this.drag = { part: h.ref, dx: h.ref.x - w.x, dy: h.ref.y - w.y, moved: false }; try { this.cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic pointers have no capture */ } }
        else if (!h) { this.pan = { px, py, ox: this.view.ox, oy: this.view.oy }; try { this.cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic pointers have no capture */ } }
        this.draw();
    }

    move(e) {
        const { px, py } = this.pos(e), w = this.toWorld(px, py);
        this.mouse = w;
        if (this.pan) { this.view.ox = this.pan.ox + px - this.pan.px; this.view.oy = this.pan.oy + py - this.pan.py; this.draw(); return; }
        if (this.tdrag) {
            const td = this.tdrag, to = [Math.round(w.x * 4) / 4, Math.round(w.y * 4) / 4], cur = td.track.pts[td.index];
            if (to[0] === cur[0] && to[1] === cur[1]) return;
            const res = this.shoving ? Pcb.shoveDrag(this.pcb, td.track, td.index, to) : { ok: true, changes: [], vias: [], drag: { track: td.track, pts: td.track.pts.map((q, i) => (i === td.index ? to : q)) } };
            if (res.ok) { Pcb.applyShove(this.pcb, res); td.moved = true; this.statusEl.classList.remove("warn"); this.statusEl.textContent = res.changes.length || (res.vias && res.vias.length) ? `Pushing ${res.changes.length} track(s) and ${res.vias.length} via(s).` : ""; }
            else { this.statusEl.textContent = `Blocked: ${res.reason}`; this.statusEl.classList.add("warn"); }
            this.draw();
            return;
        }
        if (this.drag) {
            const q = this.drag.part, nx = Math.round((w.x + this.drag.dx) * 2) / 2, ny = Math.round((w.y + this.drag.dy) * 2) / 2;
            if (nx === q.x && ny === q.y) return;
            if (this.shoving) {
                // the part pushes other nets' tracks and vias out of its way; a move that cannot work is refused and the part stays put
                const res = Pcb.shovePart(this.pcb, q, nx, ny);
                if (res.ok) { Pcb.applyShove(this.pcb, res); this.drag.moved = true; this.statusEl.classList.remove("warn"); this.statusEl.textContent = res.changes.length || res.vias.length ? `Pushing ${res.changes.length} track(s) and ${res.vias.length} via(s).` : ""; }
                else { this.statusEl.textContent = `Blocked: ${res.reason}`; this.statusEl.classList.add("warn"); }
            } else { q.x = nx; q.y = ny; this.drag.moved = true; }
            this.draw();
            return;
        }
        this.draw();
    }

    up(e) {
        if (this.pan) { this.pan = null; return; }
        if (this.tdrag) {
            const td = this.tdrag;
            this.tdrag = null;
            if (!td.moved) { this.undoStack.pop(); td.track.pts = td.orig; this.draw(); }
            else {
                // a vertex that ended up straight (or on top of its neighbour) is not needed
                const pts = td.track.pts;
                for (let i = pts.length - 2; i >= 1; i--) { const a = pts[i - 1], b = pts[i], c = pts[i + 1]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6 || Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < 1e-9) pts.splice(i, 1); }
                this.changed();
            }
            return;
        }
        if (this.drag) {
            if (!this.drag.moved) this.undoStack.pop();
            else { this.dropOrphansOfMoved(); this.changed(); }
            this.drag = null;
        }
    }

    // moving a part leaves its tracks where they were: they stay, and the rule check shows what no longer connects
    dropOrphansOfMoved() { this.issues = []; this.renderIssues(); }

    get mode() { return this.root.querySelector("#pcbMode").value; }
    get shoving() { return this.mode === "shove"; }

    // the net a track starting here belongs to: the pad, via or track it starts on (null when it starts on bare board)
    netAt(x, y) { return Pcb.netAt(this.pcb, this.layer, x, y); }

    routeClick(w, e) {
        const free = e.shiftKey;
        let s = this.snap(w.x, w.y, free);
        if (!this.draft) { this.draft = { layer: this.layer, pts: [[s.x, s.y]], net: this.netAt(s.x, s.y) }; this.draw(); return; }
        const last = this.draft.pts[this.draft.pts.length - 1];
        s = this.constrain(last, s, free);
        if (Math.hypot(s.x - last[0], s.y - last[1]) < 1e-6) return;
        if (this.mode === "walk") {
            const res = Pcb.walkaround(this.pcb, this.draft.layer, [...this.draft.pts, [s.x, s.y]], this.pcb.rules.track, this.draft.net);
            if (!res.ok) { this.say(`Blocked: ${res.reason}`, true); return; }
            this.draft.pts.push(...res.pts);
            if (res.pts.length > 1) this.say(`Routed around other copper (${res.pts.length} segments).`);
            if (s.pad) this.finishTrack(); else this.draw();
            return;
        }
        if (this.shoving) {
            const res = Pcb.shove(this.pcb, this.draft.layer, [...this.draft.pts, [s.x, s.y]], this.pcb.rules.track, this.draft.net);
            if (!res.ok) { this.say(`Blocked: ${res.reason}`, true); return; }
            if (res.changes.length) { this.snapshot(); Pcb.applyShove(this.pcb, res); this.say(`Pushed ${res.changes.length} track(s) out of the way.`); this.changed(); }
        }
        this.draft.pts.push([s.x, s.y]);
        if (s.pad) this.finishTrack();
        else this.draw();
    }

    // what the segment under the pointer would do (cached until the pointer or the board changes)
    shovePreview(last, s) {
        if (this.mode === "off") return null;
        const key = `${this.mode}|${this.rev}|${this.draft.layer}|${this.draft.pts.length}|${last}|${s.x},${s.y}`;
        if (!this.pv || this.pv.key !== key) {
            const draft = [...this.draft.pts, [s.x, s.y]];
            this.pv = { key, res: this.mode === "walk" ? Pcb.walkaround(this.pcb, this.draft.layer, draft, this.pcb.rules.track, this.draft.net) : Pcb.shove(this.pcb, this.draft.layer, draft, this.pcb.rules.track, this.draft.net) };
        }
        return this.pv.res;
    }

    // moves are horizontal, vertical or 45° unless Shift is held
    constrain(last, s, free) {
        if (free || s.pad) return s;
        const dx = s.x - last[0], dy = s.y - last[1], ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax > 2 * ay) return { x: s.x, y: last[1] };
        if (ay > 2 * ax) return { x: last[0], y: s.y };
        const m = Math.max(ax, ay);
        return { x: last[0] + Math.sign(dx) * m, y: last[1] + Math.sign(dy) * m };
    }

    finishZone() {
        const d = this.zdraft;
        this.zdraft = null;
        if (d && d.pts.length >= 3) this.addZone(d.pts); else { this.say("A pour needs at least three corners.", d && d.pts.length > 0); this.draw(); }
    }

    finishTrack() {
        const d = this.draft;
        this.draft = null;
        if (d && d.pts.length >= 2) {
            this.snapshot();
            this.pcb.tracks.push({ id: this.pcb.nextId++, layer: d.layer, w: this.pcb.rules.track, pts: d.pts });
            this.changed();
        } else this.draw();
    }

    viaHere() {
        if (!this.draft || this.draft.pts.length < 1) return;
        const R = this.pcb.rules, last = this.draft.pts[this.draft.pts.length - 1], other = this.draft.layer === "F" ? "B" : "F";
        const via = { id: 0, x: last[0], y: last[1], d: R.via, drill: R.viaDrill };
        let shoved = null;
        if (this.shoving) {
            // the via is copper too: it pushes tracks (both layers) and other vias out of its way
            shoved = Pcb.shoveVia(this.pcb, this.draft.layer, this.draft.pts, R.track, this.draft.net, via);
            if (!shoved.ok) { this.say(`Blocked: ${shoved.reason}`, true); return; }
        }
        this.snapshot();
        if (shoved && (shoved.changes.length || shoved.vias.length)) { Pcb.applyShove(this.pcb, shoved); this.say(`Pushed ${shoved.changes.length} track(s) and ${shoved.vias.length} via(s) out of the way.`); }
        if (this.draft.pts.length >= 2) this.pcb.tracks.push({ id: this.pcb.nextId++, layer: this.draft.layer, w: R.track, pts: this.draft.pts });
        via.id = this.pcb.nextId++;
        this.pcb.vias.push(via);
        this.layer = other;
        this.draft = { layer: other, pts: [[last[0], last[1]]], net: this.draft.net };
        this.fields();
        this.changed();
    }

    key(e) {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { if (e.key === "Escape") e.target.blur(); return; }
        const k = e.key.toLowerCase();
        if (e.ctrlKey && k === "z") { this.undo(); e.preventDefault(); }
        else if (k === "escape") { if (this.draft) { this.draft = null; this.draw(); } else if (this.zdraft) { this.zdraft = null; this.draw(); } else if (!this.root.querySelector("#pcbFpEd").classList.contains("hidden")) this.closeFootprints(); else this.close(); }
        else if (k === "enter" && this.draft) this.finishTrack();
        else if (k === "enter" && this.zdraft) this.finishZone();
        else if (k === "z" && !e.ctrlKey) this.setTool("zone");
        else if (k === "s") this.setTool("select");
        else if (k === "t") this.setTool("route");
        else if (k === "v") this.viaHere();
        else if (k === "f") this.act("layer");
        else if (k === "r") this.act("rotate");
        else if (k === "x") this.act("flip");
        else if (k === "delete" || k === "backspace") this.act("delete");
        else return;
        e.preventDefault();
        e.stopPropagation();
    }

    // nets for the pour: every net that has a pad
    zoneNetField() {
        const el = this.root.querySelector("#pcbZoneNet"), nets = [...new Set(Pcb.pads(this.pcb).map(p => p.net).filter(Boolean))].sort((a, b) => (a === "0" ? -1 : b === "0" ? 1 : String(a).localeCompare(String(b), undefined, { numeric: true })));
        const key = nets.join("|");
        if (el.dataset.key === key) return;
        const cur = el.value;
        el.dataset.key = key;
        el.innerHTML = nets.map(n => `<option value="${n}">${n === "0" ? "GND (0)" : n}</option>`).join("");
        if (nets.includes(cur)) el.value = cur;
    }


    // ---------------------------------------------------------------- user footprints
    static TEMPLATES = {
        smd2: "footprint MY_SMD2\npad 1 -1.2 0 1 1.4\npad 2 1.2 0 1 1.4\nline -0.6 -1 0.6 -1\nline -0.6 1 0.6 1\n",
        th3: "footprint MY_TH3\npad 1 -2.54 0 1.7 1.7 rect drill 1\npad 2 0 0 1.7 1.7 drill 1\npad 3 2.54 0 1.7 1.7 drill 1\nline -3.5 -2 3.5 -2 3.5 2 -3.5 2 -3.5 -2\n",
        dual: "footprint MY_DUAL8\n" + [0, 1, 2, 3].map(i => `pad ${i + 1} -3.6 ${(i - 1.5) * 1.27} 1.5 0.6`).join("\n") + "\n" + [3, 2, 1, 0].map((r, i) => `pad ${i + 5} 3.6 ${(r - 1.5) * 1.27} 1.5 0.6`).join("\n") + "\nline -1.8 -2.8 1.8 -2.8 1.8 2.8 -1.8 2.8 -1.8 -2.8\n"
    };

    openFootprints(name) {
        const ed = this.root.querySelector("#pcbFpEd");
        ed.classList.remove("hidden");
        if (!this.fpBound) {
            this.fpBound = true;
            ed.querySelectorAll("[data-fp]").forEach(b => b.onclick = () => this.fpAction(b.dataset.fp));
            ed.querySelector("#fpList").onchange = (e) => this.fpLoad(e.target.value);
            ed.querySelector("#fpText").oninput = () => this.fpPreview();
            ed.querySelector("#fpTpl").onchange = (e) => { if (e.target.value) { ed.querySelector("#fpText").value = PcbView.TEMPLATES[e.target.value]; e.target.value = ""; this.fpPreview(); } };
            const libImport = async (e) => {
                const files = e.target.files; if (!files || !files.length) return;
                const r = await FootprintLibrary.importFiles(files); e.target.value = "";
                this.fpLibList();
                if (!r.found) return this.fpError("No .kicad_mod files in that selection.");
                if (!r.stored) return this.fpError("The browser would not store the library (storage full?). Use fewer footprints.");
                this.fpError("");
                this.say(`Library: ${r.added} added, ${r.replaced} replaced${r.errors.length ? `, ${r.errors.length} skipped (${r.errors.slice(0, 2).map(x => `${x.name.split("/").pop()}: ${x.error}`).join("; ")}${r.errors.length > 2 ? " …" : ""})` : ""}.`);
            };
            ed.querySelector("#fpLibFiles").onchange = libImport;
            ed.querySelector("#fpLibFolder").onchange = libImport;
            ed.querySelector("#fpLibFilter").oninput = () => this.fpLibList();
            ed.querySelector("#fpLib").onchange = (e) => { const d = FootprintLibrary.get(e.target.value); if (d) { ed.querySelector("#fpList").value = ""; ed.querySelector("#fpText").value = Pcb.footprintText(d); this.fpPreview(); } };
            ed.querySelector("#fpFile").onchange = (e) => {
                const f = e.target.files[0]; if (!f) return;
                const r = new FileReader();
                r.onload = () => { try { const def = Pcb.importKicadFootprint(String(r.result)); ed.querySelector("#fpText").value = Pcb.footprintText(def); this.fpPreview(); this.say(`Imported ${def.name}: ${def.pads.length} pad(s). Check the pin order, then Save.`); } catch (er) { this.fpError(er.message); } };
                r.readAsText(f); e.target.value = "";
            };
        }
        this.fpList(name);
        this.fpLibList();
        if (!name && !ed.querySelector("#fpText").value) ed.querySelector("#fpText").value = PcbView.TEMPLATES.smd2;
        this.fpPreview();
    }

    closeFootprints() { this.root.querySelector("#pcbFpEd").classList.add("hidden"); this.cv.focus(); }

    fpList(select) {
        const el = this.root.querySelector("#fpList"), names = Object.keys(this.pcb.footprints || {}).sort();
        el.innerHTML = names.map(n => `<option>${n}</option>`).join("");
        if (select && names.includes(select)) { el.value = select; this.fpLoad(select); }
    }

    // the browser-wide library, narrowed by the search box (at most 400 shown)
    fpLibList() {
        const ed = this.root.querySelector("#pcbFpEd"), el = ed.querySelector("#fpLib"), names = FootprintLibrary.names(ed.querySelector("#fpLibFilter").value);
        el.innerHTML = names.slice(0, 400).map(n => `<option>${PropertiesPanel.esc(n)}</option>`).join("");
        const total = Object.keys(FootprintLibrary.all()).length;
        ed.querySelector("#fpLibInfo").textContent = total ? `${names.length} of ${total}${names.length > 400 ? " (first 400 shown: narrow the search)" : ""}. Pick one, then Use on selected part.` : "Empty. Import a KiCad .pretty folder to fill it.";
    }

    fpLoad(name) { const d = this.pcb.footprints[name]; if (d) { this.root.querySelector("#fpText").value = Pcb.footprintText(d); this.fpPreview(); } }

    fpError(msg) { this.root.querySelector("#fpErr").textContent = msg || ""; }

    fpPreview() {
        const text = this.root.querySelector("#fpText").value, cv = this.root.querySelector("#fpPreview"), c = cv.getContext("2d");
        c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = "#16352a"; c.fillRect(0, 0, cv.width, cv.height);
        let def;
        try { def = Pcb.parseFootprint(text); this.fpError(""); } catch (e) { this.fpError(e.message); return; }
        const fp = Pcb.userFootprint(def), sc = Math.min((cv.width - 20) / fp.w, (cv.height - 20) / fp.h, 40);
        c.translate(cv.width / 2, cv.height / 2); c.scale(sc, sc);
        c.strokeStyle = "#f5f5f5"; c.lineWidth = 0.12; c.lineJoin = "round";
        for (const l of fp.silk) { c.beginPath(); l.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke(); }
        fp.pads.forEach((pd, i) => {
            c.fillStyle = pd.smd ? "#d9877a" : "#c8a84b";
            if (pd.shape === "round") { c.beginPath(); c.arc(pd.x, pd.y, Math.min(pd.w, pd.h) / 2, 0, 7); c.fill(); } else c.fillRect(pd.x - pd.w / 2, pd.y - pd.h / 2, pd.w, pd.h);
            if (pd.drill) { c.fillStyle = "#10151c"; c.beginPath(); c.arc(pd.x, pd.y, pd.drill / 2, 0, 7); c.fill(); }
            c.fillStyle = "#000"; c.font = "0.7px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(pd.n), pd.x, pd.y);
        });
    }

    fpAction(a) {
        const ed = this.root.querySelector("#pcbFpEd"), text = ed.querySelector("#fpText");
        if (a === "close") return this.closeFootprints();
        if (a === "new") { text.value = PcbView.TEMPLATES.smd2; ed.querySelector("#fpList").value = ""; return this.fpPreview(); }
        if (a === "import") return ed.querySelector("#fpFile").click();
        if (a === "libfolder") return ed.querySelector("#fpLibFolder").click();
        if (a === "libfiles") return ed.querySelector("#fpLibFiles").click();
        if (a === "libdelete") { const n = ed.querySelector("#fpLib").value; if (n) { FootprintLibrary.remove(n); this.fpLibList(); } return; }
        if (a === "delete") {
            const name = ed.querySelector("#fpList").value;
            if (!name) return this.fpError("Pick a footprint in the list to delete.");
            this.snapshot();
            delete this.pcb.footprints[name];
            for (const part of this.pcb.parts) if (part.pkg === `user:${name}`) Pcb.setPackage(part, undefined, this.pcb.footprints);
            this.fpList(); this.say(`Deleted ${name}; parts that used it are back on their default footprint.`);
            this.changed(); return;
        }
        let def;
        try { def = Pcb.parseFootprint(text.value); } catch (e) { return this.fpError(e.message); }
        if (a === "save" || a === "use") {
            this.snapshot();
            this.pcb.footprints = this.pcb.footprints || {};
            this.pcb.footprints[def.name] = def;
            for (const part of this.pcb.parts) if (part.pkg === `user:${def.name}`) Pcb.setPackage(part, part.pkg, this.pcb.footprints);
            if (a === "use") {
                if (this.sel && this.sel.kind === "part") { Pcb.setPackage(this.sel.ref, `user:${def.name}`, this.pcb.footprints); this.say(`${this.sel.ref.ref} now uses ${def.name}; route it again.`); }
                else { this.fpError("Select a part on the board first."); }
            } else this.say(`Saved footprint ${def.name} in the design.`);
            this.fpList(def.name); this.fpError(""); this.changed();
        }
    }

    // the Footprint list follows the selected part
    packageField() {
        const el = this.root.querySelector("#pcbPkg"), part = this.sel && this.sel.kind === "part" ? this.sel.ref : null;
        const key = part ? `${part.ref}|${part.kind}|${part.pkg || ""}|${Object.keys(this.pcb.footprints || {}).join()}` : "";
        this.zoneNetField();
        if (el.dataset.key === key) return;
        el.dataset.key = key;
        const list = part ? Pcb.packages(part.kind, this.pcb.footprints) : [];
        el.innerHTML = list.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
        el.disabled = list.length < 2;
        if (part && list.length) el.value = part.pkg && list.some(x => x[0] === part.pkg) ? part.pkg : list[0][0];
    }

    // ---------------------------------------------------------------- drawing
    draw() {
        if (!this.isOpen) return;
        this.resize();
        this.packageField();
        const c = this.ctx, v = this.view, p = this.pcb;
        const dark = true;                       // the board is always drawn on a dark canvas, as in most PCB tools
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = dark ? "#10151c" : "#e8ece8";
        c.fillRect(0, 0, this.cv.width, this.cv.height);
        c.setTransform(v.s, 0, 0, v.s, v.ox, v.oy);
        const lw = (px) => px / v.s;
        // board
        c.fillStyle = dark ? "#16352a" : "#2d6a4f";
        c.fillRect(0, 0, p.outline.w, p.outline.h);
        c.strokeStyle = "#d8c85a"; c.lineWidth = lw(1.5); c.strokeRect(0, 0, p.outline.w, p.outline.h);
        // 5 mm grid dots
        if (v.s > 5) { c.fillStyle = "rgba(255,255,255,0.12)"; for (let x = 5; x < p.outline.w; x += 5) for (let y = 5; y < p.outline.h; y += 5) c.fillRect(x - lw(1), y - lw(1), lw(2), lw(2)); }
        const colour = { F: "#d9534f", B: "#4a90d9" };
        const drawTrack = (t, alpha, col) => {
            c.globalAlpha = alpha; c.strokeStyle = col || colour[t.layer]; c.lineWidth = t.w; c.lineCap = "round"; c.lineJoin = "round";
            c.beginPath(); t.pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
        };
        const other = this.layer === "F" ? "B" : "F";
        // copper pours: filled copper, then the outline of the selected pour
        for (const lay of [other, this.layer]) for (const fz of this.fills) {
            if (fz.zone.layer !== lay) continue;
            c.globalAlpha = lay === this.layer ? 0.5 : 0.2; c.fillStyle = colour[lay];
            for (const [x1, y1, x2, y2] of fz.rects) c.fillRect(x1, y1, x2 - x1, y2 - y1);
        }
        c.globalAlpha = 1;
        for (const z of p.zones || []) {
            const on = this.sel && this.sel.ref === z;
            c.strokeStyle = on ? "#ffe066" : colour[z.layer]; c.globalAlpha = on ? 1 : 0.5; c.lineWidth = lw(on ? 2 : 1); c.setLineDash([lw(6), lw(4)]);
            c.beginPath(); z.pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.closePath(); c.stroke(); c.setLineDash([]);
        }
        c.globalAlpha = 1;
        if (this.zdraft && this.zdraft.pts.length) {
            c.strokeStyle = "#ffffff"; c.lineWidth = lw(1.5);
            c.beginPath(); this.zdraft.pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.lineTo(Math.round(this.mouse.x * 2) / 2, Math.round(this.mouse.y * 2) / 2); c.stroke();
        }
        for (const t of p.tracks) if (t.layer === other) drawTrack(t, 0.4);
        for (const t of p.tracks) if (t.layer === this.layer) drawTrack(t, 0.95);
        if (this.sel && this.sel.kind === "track") drawTrack(this.sel.ref, 0.9, "#ffe066");
        c.globalAlpha = 1;
        // part outlines and pads
        for (const q of p.parts) {
            const swap = (Math.round(q.rot / 90) % 2) !== 0, w = swap ? q.fp.h : q.fp.w, h = swap ? q.fp.w : q.fp.h;
            c.strokeStyle = this.sel && this.sel.ref === q ? "#ffe066" : "rgba(235,235,235,0.7)"; c.lineWidth = lw(1);
            c.strokeRect(q.x - w / 2, q.y - h / 2, w, h);
        }
        // silkscreen (white on the front, grey-blue on the back)
        c.lineCap = "round"; c.lineJoin = "round"; c.lineWidth = 0.15;
        for (const side of ["B", "F"]) {
            c.strokeStyle = side === "F" ? "rgba(245,245,245,0.9)" : "rgba(150,190,230,0.45)";
            c.globalAlpha = side === this.layer ? 1 : 0.5;
            for (const line of Pcb.silk(p, side)) { c.beginPath(); line.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke(); }
        }
        c.globalAlpha = 1;
        for (const pd of Pcb.pads(p)) {
            const onActive = pd.layers.includes(this.layer);
            c.globalAlpha = onActive ? 1 : 0.35;
            c.fillStyle = pd.smd ? (pd.layers[0] === "F" ? "#d9877a" : "#7aa8d9") : "#c8a84b";
            if (pd.shape === "round") { c.beginPath(); c.arc(pd.x, pd.y, Math.min(pd.w, pd.h) / 2, 0, 7); c.fill(); }
            else c.fillRect(pd.x - pd.w / 2, pd.y - pd.h / 2, pd.w, pd.h);
            if (pd.drill) { c.fillStyle = "#10151c"; c.beginPath(); c.arc(pd.x, pd.y, pd.drill / 2, 0, 7); c.fill(); }
            c.globalAlpha = 1;
            if (v.s > 10 && pd.net) { c.fillStyle = "#fff"; c.font = `${Math.max(0.8, 8 / v.s)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "alphabetic"; c.fillText(pd.net, pd.x, pd.y - pd.h / 2 - 0.2); }
        }
        for (const via of p.vias) {
            c.fillStyle = this.sel && this.sel.ref === via ? "#ffe066" : "#9aa4b0"; c.beginPath(); c.arc(via.x, via.y, via.d / 2, 0, 7); c.fill();
            c.fillStyle = "#10151c"; c.beginPath(); c.arc(via.x, via.y, via.drill / 2, 0, 7); c.fill();
        }
        // ratsnest
        c.strokeStyle = "#f2e35c"; c.lineWidth = lw(1); c.setLineDash([lw(5), lw(4)]);
        for (const l of Pcb.ratsnest(p)) { c.beginPath(); c.moveTo(l.a.x, l.a.y); c.lineTo(l.b.x, l.b.y); c.stroke(); }
        c.setLineDash([]);
        // the track being routed
        if (this.draft) {
            const last = this.draft.pts[this.draft.pts.length - 1];
            let s = this.snap(this.mouse.x, this.mouse.y, false); s = this.constrain(last, s, false);
            const pv = Math.hypot(s.x - last[0], s.y - last[1]) > 1e-6 ? this.shovePreview(last, s) : null;
            if (pv && pv.ok && pv.changes) for (const ch of pv.changes) { c.setLineDash([lw(5), lw(3)]); drawTrack({ layer: this.draft.layer, w: ch.track.w, pts: ch.pts }, 0.9, "#ffe066"); c.setLineDash([]); }
            const tail = pv && pv.ok && this.mode === "walk" && pv.pts.length ? pv.pts : [[s.x, s.y]];
            drawTrack({ layer: this.draft.layer, w: p.rules.track, pts: [...this.draft.pts, ...tail] }, 0.8, pv && !pv.ok ? "#ff3b3b" : "#ffffff");
            if (pv && !pv.ok && this.statusEl.dataset.blocked !== pv.reason) { this.statusEl.dataset.blocked = pv.reason; this.statusEl.textContent = `Blocked: ${pv.reason}`; this.statusEl.classList.add("warn"); }
            else if (pv && pv.ok) { delete this.statusEl.dataset.blocked; }
        }
        // rule issues
        c.strokeStyle = "#ff3b3b"; c.lineWidth = lw(2);
        for (const i of this.issues) if (i.type !== "unrouted") { c.beginPath(); c.arc(i.x, i.y, 1.2, 0, 7); c.stroke(); }
        c.setTransform(1, 0, 0, 1, 0, 0);
        this.statusEl.dataset.pos = `${this.mouse.x.toFixed(2)}, ${this.mouse.y.toFixed(2)} mm`;
    }
}

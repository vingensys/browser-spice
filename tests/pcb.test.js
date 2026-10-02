// PCB kernel: footprints and nets from schematic elements, ratsnest, autorouter, DRC, Gerber / Excellon / ZIP.
//   node tests/pcb.test.js
const fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");
const src = fs.readFileSync(path.join(__dirname, "..", "js/pcb/pcb.js"), "utf8");
const { Pcb } = new Function(src + "\nreturn { Pcb };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const els = [
    { name: "V1", kind: "V", nodes: ["1", "0"] }, { name: "R1", kind: "R", nodes: ["1", "2"] }, { name: "R2", kind: "R", nodes: ["2", "3"] },
    { name: "Q1", kind: "Q", nodes: ["3", "2", "0"] }, { name: "C1", kind: "C", nodes: ["2", "0"] }, { name: "D1", kind: "D", nodes: ["1", "3"] },
    { name: "R3", kind: "R", nodes: ["3", "0"] }
];
const pcb = Pcb.blank(60, 40);
const s = Pcb.sync(pcb, els);
check("every element becomes a part with a pad per pin", s.added === 7 && pcb.parts.every(p => p.nets.length === p.fp.pads.length) && pcb.parts.find(p => p.ref === "Q1").fp.name === "TO-92");
check("pads carry the net of their pin", pcb.parts.find(p => p.ref === "R2").nets.join() === "2,3");
Pcb.autoPlace(pcb);
const all = Pcb.pads(pcb);
let overlap = 0;
for (let i = 0; i < pcb.parts.length; i++) for (let j = i + 1; j < pcb.parts.length; j++) { const a = pcb.parts[i], b = pcb.parts[j]; if (Math.abs(a.x - b.x) < (a.fp.w + b.fp.w) / 2 && Math.abs(a.y - b.y) < (a.fp.h + b.fp.h) / 2) overlap++; }
check("auto-place leaves no two courtyards overlapping and fits the board", overlap === 0 && all.every(p => p.x > 0 && p.y > 0 && p.x < pcb.outline.w && p.y < pcb.outline.h), [overlap, pcb.outline]);
const rats = Pcb.ratsnest(pcb);
// nets: 1 (V1,R1,D1)=3 pads -> 2 lines; 0 (V1,Q1,C1,R3)=4 -> 3; 2 (R1,R2,Q1,C1)=4 -> 3; 3 (R2,Q1,D1,R3)=4 -> 3
check("the ratsnest is a spanning tree per net (11 airwires)", rats.length === 11, rats.length);
const t0 = Date.now();
const rr = Pcb.autoRoute(pcb);
console.log(`       autoroute: ${rr.routed}/${rr.total} in ${Date.now() - t0} ms, ${pcb.tracks.length} tracks, ${pcb.vias.length} vias, board ${pcb.outline.w}x${pcb.outline.h}`);
check("the autorouter completes every connection", rr.failed === 0 && rr.routed === 11, rr);
const issues = Pcb.drc(pcb);
check("and the result passes the design-rule check (no shorts, clearance, edge or unrouted)", issues.length === 0, JSON.stringify(issues.slice(0, 5)));
check("nothing is left in the ratsnest", Pcb.ratsnest(pcb).length === 0);
// DRC catches a deliberate fault: a track of net 1 laid across the pads of another net
const bad = JSON.parse(JSON.stringify(pcb));
const p2 = bad.parts.find(p => p.ref === "R3"), pa = Pcb.pads(bad).filter(p => p.part.ref === "R3");
bad.tracks.push({ id: 999, layer: "F", w: 0.3, pts: [[pa[0].x, pa[0].y], [pa[1].x, pa[1].y]] });
const bi = Pcb.drc(bad);
check("a track bridging two pads of different nets is reported as a short", bi.some(i => i.type === "short"), bi.slice(0, 3));
const bad2 = Pcb.blank(30, 20);
bad2.parts.push({ ref: "A", kind: "R", fp: Pcb.footprint("R", 2), x: 10, y: 10, rot: 0, nets: ["a", "b"] });
bad2.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[10 - 5.08, 10], [10 - 5.08, 14]] });   // starts on pad a
bad2.parts.push({ ref: "B", kind: "R", fp: Pcb.footprint("R", 2), x: 10, y: 15, rot: 0, nets: ["c", "d"] });
const gi = Pcb.drc(bad2);
check("copper of different nets closer than the clearance is reported", gi.some(i => i.type === "clearance" || i.type === "short"), gi);
const edge = Pcb.blank(30, 20); edge.parts.push({ ref: "A", kind: "R", fp: Pcb.footprint("R", 2), x: 3, y: 10, rot: 0, nets: ["a", "b"] });
check("pads outside the board edge margin are reported", Pcb.drc(edge).some(i => i.type === "edge"));
const rot = Pcb.blank(30, 20); rot.parts.push({ ref: "A", kind: "R", fp: Pcb.footprint("R", 2), x: 10, y: 10, rot: 90, nets: ["a", "b"] });
const rp = Pcb.pads(rot);
check("rotating a part by 90° turns its pad row vertical", Math.abs(rp[0].x - 10) < 1e-9 && Math.abs(Math.abs(rp[0].y - rp[1].y) - 10.16) < 1e-9);
// re-sync keeps the placement and routing of parts that stay, drops those that vanish
const before = pcb.tracks.length, x1 = pcb.parts.find(p => p.ref === "R1").x;
const s2 = Pcb.sync(pcb, els.filter(e => e.name !== "R3").concat([{ name: "R9", kind: "R", nodes: ["1", "3"] }]));
check("re-sync keeps placed parts, adds new ones and removes deleted ones", s2.added === 1 && s2.removed === 1 && pcb.parts.find(p => p.ref === "R1").x === x1 && pcb.tracks.length === before);
// output files
const files = Pcb.files(pcb, "t");
const fcu = files[0][1];
check("Gerber has the RS-274X header, apertures, flashes and draws", /%FSLAX46Y46\*%/.test(fcu) && /%ADD1\d[CR],/.test(fcu) && /D03\*/.test(fcu) && /D01\*/.test(fcu) && /M02\*/.test(fcu));
check("the outline layer is a closed rectangle", (files[2][1].match(/D01\*/g) || []).length === 4);
check("Excellon lists a tool per drill size and every hole", /^T\d+C\d\.\d+/m.test(files[3][1]) && (files[3][1].match(/^X/gm) || []).length === Pcb.pads(pcb).length + pcb.vias.length);
const zip = Pcb.zip(files), tmp = path.join(os.tmpdir(), `pcbtest-${process.pid}.zip`);
fs.writeFileSync(tmp, zip);
let zt = ""; try { zt = cp.execSync(`unzip -t ${tmp} 2>&1`).toString(); } catch (e) { zt = (e.stdout || "").toString() + e.message; }
check("the ZIP is valid (unzip -t) and holds the four files", /No errors detected/.test(zt) && /t-F_Cu\.gtl/.test(zt) && /t\.drl/.test(zt), zt.slice(0, 200));
fs.unlinkSync(tmp);
// a denser board: four 14-pin chips and eight resistors on random nets; whatever the router finishes must be DRC-clean
for (const seed of [5, 9]) {
    let sd = seed; const rnd = () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, pick = () => String(1 + Math.floor(rnd() * 14));
    const big = [];
    for (let i = 0; i < 4; i++) big.push({ name: "U" + i, kind: "DIGITAL", ic: "7400", nodes: Array.from({ length: 12 }, pick) });
    for (let i = 0; i < 8; i++) big.push({ name: "R" + i, kind: "R", nodes: [pick(), pick()] });
    const b = Pcb.blank(80, 60); Pcb.sync(b, big); Pcb.autoPlace(b);
    const r = Pcb.autoRoute(b), iss = Pcb.drc(b).filter(i => i.type !== "unrouted");
    check(`dense board (seed ${seed}): ${r.routed}/${r.total} routed, ${b.vias.length} vias, no DRC violations in what was routed`, r.routed >= r.total - 2 && iss.length === 0, JSON.stringify(iss.slice(0, 3)));
}
// ---- surface-mount footprints, back-side parts, silkscreen, mask and paste
{
    const e = (name, kind, nodes, pkg) => ({ name, kind, nodes, pkg });
    const els2 = [e("V1", "V", ["1", "0"]), e("R1", "R", ["1", "2"]), e("R2", "R", ["2", "0"]), e("C1", "C", ["2", "0"]), e("Q1", "Q", ["2", "3", "0"]), e("D1", "D", ["3", "1"]), e("U1", "DIGITAL", ["1", "2", "3", "4", "0", "1", "2", "3"], "")];
    els2[6].ic = "7400";
    const sm = Pcb.blank(60, 40);
    Pcb.sync(sm, els2);
    for (const [ref, pkg] of [["R1", "0805"], ["R2", "0603"], ["C1", "1206"], ["Q1", "sot23"], ["D1", "sod123"], ["U1", "soic"]]) Pcb.setPackage(sm.parts.find(p => p.ref === ref), pkg);
    const part = (r) => sm.parts.find(p => p.ref === r);
    check("SMD footprints have no drill and sit on the top layer only", Pcb.pads(sm).filter(p => p.part.ref === "R1").every(p => p.smd && !p.drill && p.layers.length === 1 && p.layers[0] === "F"));
    check("a SOT-23 transistor takes B E C from the schematic's B C E", part("Q1").nets.join() === "2,0,3", part("Q1").nets);
    const to92 = Pcb.blank(); Pcb.sync(to92, [e("Q9", "Q", ["10", "11", "12"])]);
    check("a TO-92 transistor takes the package order E B C", to92.parts[0].nets.join() === "12,10,11", to92.parts[0].nets);
    check("a SOIC has two rows of 1.27 mm pitch SMD pads", part("U1").fp.name === "SOIC-8" && part("U1").fp.pads.length === 8 && Math.abs(part("U1").fp.pads[1].y - part("U1").fp.pads[0].y - 1.27) < 1e-9);
    check("packages are listed per kind", Pcb.packages("R").length === 4 && Pcb.packages("Q").length === 2 && Pcb.packages("V").length === 0);
    check("an unknown package falls back to the default", (() => { const q = Pcb.blank(); Pcb.sync(q, [e("R5", "R", ["1", "2"])]); Pcb.setPackage(q.parts[0], "nonsense"); return q.parts[0].fp.name === "Axial_10.16mm" && q.parts[0].pkg === undefined; })());
    Pcb.autoPlace(sm, { fit: true });
    const rs = Pcb.autoRoute(sm), is2 = Pcb.drc(sm);
    check(`a board of SMD and through-hole parts routes (${rs.routed}/${rs.total}) and passes the rule check`, rs.failed === 0 && is2.length === 0, JSON.stringify(is2.slice(0, 3)));
    // a track on the back cannot touch a top-side SMD pad without a via
    const lone = Pcb.blank(30, 20); Pcb.sync(lone, [e("R1", "R", ["a", "b"]), e("R2", "R", ["a", "c"])]);
    Pcb.setPackage(lone.parts[0], "0805"); Pcb.setPackage(lone.parts[1], "0805");
    lone.parts[0].x = 8; lone.parts[0].y = 10; lone.parts[1].x = 20; lone.parts[1].y = 10;
    const pa = Pcb.pads(lone), a1 = pa[0], a2 = pa[2];
    lone.tracks.push({ id: 1, layer: "B", w: 0.3, pts: [[a1.x, a1.y], [a2.x, a2.y]] });
    check("a back-layer track does not join top-side SMD pads", Pcb.ratsnest(lone).length === 1);
    lone.tracks[0].layer = "F";
    check("the same track on the top layer does", Pcb.ratsnest(lone).length === 0);
    lone.parts[1].flip = true;
    check("flipping a part puts its SMD pads on the back layer", Pcb.pads(lone)[2].layers.join() === "B" && Math.abs(Pcb.pads(lone)[2].x - 21) < 1e-9 && Math.abs(a2.x - 19) < 1e-9);
    Pcb.sync(lone, [e("R1", "R", ["a", "b"]), e("R2", "R", ["a", "c"])]);
    check("a flip survives re-sync", lone.parts[1].flip === true);
    const th2 = Pcb.blank(); Pcb.sync(th2, [e("R1", "R", ["a", "b"])]); th2.parts[0].flip = true; Pcb.setPackage(th2.parts[0], undefined);
    check("through-hole parts cannot be flipped", th2.parts[0].flip === false);
    // output
    const fl = Pcb.blank(60, 40); Pcb.sync(fl, [e("R1", "R", ["a", "b"]), e("C2", "C", ["a", "b"])]); Pcb.setPackage(fl.parts[0], "0805"); Pcb.setPackage(fl.parts[1], "0603");
    fl.parts[0].x = 15; fl.parts[0].y = 15; fl.parts[1].x = 35; fl.parts[1].y = 15; fl.parts[1].flip = true;
    const names = Pcb.files(fl, "z").map(f => f[0]);
    check("the file set has silkscreen, mask and paste for the top", ["z-F_Silkscreen.gto", "z-B_Silkscreen.gbo", "z-F_Mask.gts", "z-B_Mask.gbs", "z-F_Paste.gtp"].every(n => names.includes(n)), names);
    const fcu = Pcb.gerber(fl, "F"), bcu = Pcb.gerber(fl, "B");
    check("the top copper has R1's two pads and the back copper C2's", (fcu.match(/D03\*/g) || []).length === 2 && (bcu.match(/D03\*/g) || []).length === 2);
    const sf = Pcb.gerber(fl, "SilkF"), sb = Pcb.gerber(fl, "SilkB");
    check("the top silkscreen draws R1 (outline, pin 1 mark, reference) and not C2", /D01\*/.test(sf) && Pcb.silk(fl, "F").length > 3 && Pcb.silk(fl, "B").length > 3 && /D01\*/.test(sb));
    const mf = Pcb.gerber(fl, "MaskF");
    check("the solder mask openings are 0.1 mm larger than the pads", /%ADD10R,1\.1000X1\.5000\*%/.test(mf), mf.split("\n").filter(l => /ADD/.test(l)));
    check("paste has the SMD pads at their exact size", /%ADD10R,1\.0000X1\.4000\*%/.test(Pcb.gerber(fl, "PasteF")));
    // text: a back-side reference is mirrored
    const tf = Pcb.text("R1", 10, 10, 1, false), tb = Pcb.text("R1", 10, 10, 1, true);
    check("silk text is mirrored for the back side", tf.length === tb.length && Math.abs(tf[0][0][0] - 10) < 2 && tf[0][0][0] < 10 && tb[0][0][0] > 10 - 2 && Math.abs((tf[0][0][0] - 10) + (tb[0][0][0] - 10)) < 1e-9);
    const z = Pcb.zip(Pcb.files(fl, "z")), tmp2 = path.join(os.tmpdir(), `pcbtest2-${process.pid}.zip`);
    fs.writeFileSync(tmp2, z);
    let zt2 = ""; try { zt2 = cp.execSync(`unzip -t ${tmp2} 2>&1`).toString(); } catch (er) { zt2 = (er.stdout || "").toString(); }
    check("the nine-file ZIP is valid", /No errors detected/.test(zt2) && /z-F_Paste\.gtp/.test(zt2), zt2.slice(0, 120));
    fs.unlinkSync(tmp2);
}
// ---- user-defined footprints
{
    const text = "# a 3-pin through-hole part\nfootprint MY_TO\npad 1 -2 0 1.6 1.6 rect drill 0.9\npad 2 0 0 1.6 1.6 drill 0.9\npad 3 2 0 1.6 1.6 drill 0.9\nline -3 -1.5 3 -1.5 3 1.5 -3 1.5 -3 -1.5\ncircle 0 3 0.5\nmap 2 1 0\n";
    const def = Pcb.parseFootprint(text);
    check("a footprint text is parsed into pads, silk and a pin map", def.name === "MY_TO" && def.pads.length === 3 && def.pads[0].shape === "rect" && !def.pads[0].smd && def.silk.length === 2 && def.pinMap.join() === "2,1,0");
    check("and written back the same way", Pcb.parseFootprint(Pcb.footprintText(def)).pads.map(p => [p.x, p.y, p.w, p.drill].join()).join("|") === def.pads.map(p => [p.x, p.y, p.w, p.drill].join()).join("|"));
    const smdText = Pcb.parseFootprint("footprint MY_SMD\npad 1 -1 0 1 1.2\npad 2 1 0 1 1.2\n");
    check("a pad without a drill is surface-mount", smdText.pads.every(p => p.smd) && Pcb.userFootprint(smdText).smd);
    for (const [bad, re] of [["pad 1 0 0 1 1", /first line/], ["footprint X\npad 1 0 0", /pad needs/], ["footprint X\npad 1 0 0 1 1 drill 0.95", /copper ring/], ["footprint X\nfoo", /unknown word/], ["footprint X", /at least one pad/], ["footprint X\npad 1 0 0 1 1\nmap 0 1", /map lists/], ["footprint a b/c\npad 1 0 0 1 1", /name may use/]])
        check(`a bad footprint is refused: ${bad.split("\n").pop().slice(0, 28)}`, (() => { try { Pcb.parseFootprint(bad); return false; } catch (e) { return re.test(e.message); } })(), bad);
    const pb = Pcb.blank(40, 30); pb.footprints.MY_TO = def;
    Pcb.sync(pb, [{ name: "Q1", kind: "Q", nodes: ["10", "11", "12"] }]);
    check("user footprints are offered for every kind", Pcb.packages("Q", pb.footprints).some(x => x[0] === "user:MY_TO") && Pcb.packages("V", pb.footprints).length === 1);
    Pcb.setPackage(pb.parts[0], "user:MY_TO", pb.footprints);
    check("a part using it gets the user's pads and pin order", pb.parts[0].fp.name === "MY_TO" && pb.parts[0].nets.join() === "12,11,10" && pb.parts[0].pkg === "user:MY_TO", pb.parts[0].nets);
    Pcb.sync(pb, [{ name: "Q1", kind: "Q", nodes: ["10", "11", "12"] }]);
    check("it survives a re-sync", pb.parts[0].fp.name === "MY_TO");
    delete pb.footprints.MY_TO; Pcb.sync(pb, [{ name: "Q1", kind: "Q", nodes: ["10", "11", "12"] }]);
    check("deleting it falls back to the default footprint", pb.parts[0].fp.name === "TO-92" && pb.parts[0].pkg === undefined);
    const few = Pcb.blank(40, 30); few.footprints.TWO = Pcb.parseFootprint("footprint TWO\npad 1 -1 0 1.6 1.6 drill 0.9\npad 2 1 0 1.6 1.6 drill 0.9\n");
    Pcb.sync(few, [{ name: "Q2", kind: "Q", nodes: ["1", "2", "3"] }]); Pcb.setPackage(few.parts[0], "user:TWO", few.footprints); few.parts[0].x = 20; few.parts[0].y = 15;
    check("the rule check notes a footprint with fewer pads than the part has pins", Pcb.drc(few).some(i => i.type === "pins"));
    const mod = `(footprint "Resistor_SMD:R_0805" (layer "F.Cu")
      (fp_line (start -0.5 -1) (end 0.5 -1) (layer "F.SilkS") (width 0.12))
      (fp_line (start -0.5 -1) (end 0.5 -1) (layer "F.Fab") (width 0.1))
      (fp_circle (center 0 0) (end 0.5 0) (layer "F.SilkS"))
      (pad "2" smd roundrect (at 1 0 90) (size 1.0 1.45) (layers "F.Cu" "F.Paste" "F.Mask"))
      (pad "1" smd roundrect (at -1 0) (size 1.0 1.45) (layers "F.Cu" "F.Paste" "F.Mask"))
      (pad "3" thru_hole circle (at 0 3) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask")))`;
    // the KiCad reader lives in kicad-import.js
    const kcode = fs.readFileSync(path.join(__dirname, "..", "js/ui/kicad-import.js"), "utf8");
    const { KicadImporter: KI } = new Function(kcode + "\nreturn { KicadImporter };")();
    const P2 = new Function("KicadImporter", src + "\nreturn { Pcb };")(KI).Pcb;
    const kf = P2.importKicadFootprint(mod);
    check("a KiCad .kicad_mod imports: name, pads sorted by number, SMD vs through-hole, silk layer only", kf.name === "R_0805" && kf.pads.map(p => p.n).join() === "1,2,3" && kf.pads[0].smd && !kf.pads[2].smd && kf.pads[2].drill === 1 && kf.silk.length === 2, JSON.stringify(kf.pads.map(p => [p.n, p.w, p.h, p.smd])));
    check("a pad rotated 90° swaps its size", kf.pads[1].w === 1.45 && kf.pads[1].h === 1.0);
    check("a non-footprint file is refused", (() => { try { P2.importKicadFootprint("(kicad_sch)"); return false; } catch (e) { return /not a KiCad footprint/.test(e.message); } })());
}
// ---- copper pours
{
    const pc = Pcb.blank(40, 30);
    Pcb.sync(pc, [{ name: "R1", kind: "R", nodes: ["1", "0"] }, { name: "R2", kind: "R", nodes: ["2", "0"] }, { name: "R3", kind: "R", nodes: ["1", "2"] }]);
    pc.parts[0].x = 10; pc.parts[0].y = 8; pc.parts[1].x = 10; pc.parts[1].y = 22; pc.parts[2].x = 30; pc.parts[2].y = 15; pc.parts.forEach(p => { p.placed = true; });
    pc.zones.push({ id: 1, layer: "B", net: "0", pts: [[0.5, 0.5], [39.5, 0.5], [39.5, 29.5], [0.5, 29.5]], thermal: true });
    const ratsBefore = Pcb.ratsnest(pc).map(l => l.net).sort().join();
    check("a pour joins the pads of its net inside it: net 0 no longer needs a track", !ratsBefore.includes("0") && ratsBefore === "1,2", ratsBefore);
    const t0 = Date.now(), fills = Pcb.fillZones(pc), ms = Date.now() - t0;
    const f = fills[0], area = f.rects.reduce((a, r) => a + (r[2] - r[0]) * (r[3] - r[1]), 0);
    console.log(`       pour: ${f.rects.length} rectangles, ${area.toFixed(0)} mm2 in ${ms} ms`);
    check("the fill covers most of the board and connects both ground pads", area > 700 && f.connected.length === 2 && f.islands.length === 0, [area, f.connected.length, f.islands.length]);
    const inFill = (x, y) => f.rects.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
    const pads = Pcb.pads(pc), foreign = pads.find(p => p.net === "1" && p.part.ref === "R1");
    check("no fill inside the 0.2 mm clearance of a pad of another net, fill resumes beyond it", !inFill(foreign.x + 0.9 + 0.1, foreign.y) && !inFill(foreign.x, foreign.y + 0.9 + 0.1) && inFill(foreign.x + 0.9 + 0.45, foreign.y + 3), foreign);
    const own = pads.find(p => p.net === "0" && p.part.ref === "R1");
    check("a pad of the pour's own net gets thermal relief: ring open except four spokes", !inFill(own.x + 1.0, own.y + 0.7) && inFill(own.x + 1.1, own.y) && inFill(own.x, own.y + 1.1) && inFill(own.x + 2.5, own.y), [inFill(own.x + 1.0, own.y + 0.7), inFill(own.x + 1.1, own.y)]);
    // a track of another net on the same layer is cleared
    pc.tracks.push({ id: 50, layer: "B", w: 0.3, pts: [[20, 3], [20, 27]] });
    const f2 = Pcb.fillZones(pc)[0], in2 = (x, y) => f2.rects.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
    check("a track of another net is cleared by 0.2 mm: nothing on it or within 0.2 of its edge, fill beyond", !in2(20, 15) && !in2(20.3, 15) && !in2(19.7, 15) && in2(20.6, 15) && in2(19.4, 15), [in2(20, 15), in2(20.3, 15), in2(20.6, 15)]);
    check("with the track in the way the fill is cached per board state and recomputed on change", Pcb.fillZones(pc)[0] === f2 && Pcb.fillZones(pc)[0] !== f);
    // a floating track right across the board splits the pour; the ground pad on the far side is cut off
    const wall = Pcb.blank(40, 30);
    Pcb.sync(wall, [{ name: "R1", kind: "R", nodes: ["0", "1"] }, { name: "R2", kind: "R", nodes: ["0", "2"] }]);
    wall.parts[0].x = 10; wall.parts[0].y = 8; wall.parts[1].x = 10; wall.parts[1].y = 24; wall.parts.forEach(p => { p.placed = true; });
    wall.zones.push({ id: 1, layer: "B", net: "0", pts: [[0.5, 0.5], [39.5, 0.5], [39.5, 29.5], [0.5, 29.5]], thermal: false });
    wall.tracks.push({ id: 8, layer: "B", w: 0.5, pts: [[0, 16], [40, 16]] });
    const wi = Pcb.drc(wall).filter(i => i.type === "zone");
    check("a pour split by other copper reports exactly one cut-off pad", wi.length === 1 && /cut off/.test(wi[0].msg), JSON.stringify(wi));
    wall.tracks = [];
    check("and without the wall nothing is reported", Pcb.drc(wall).filter(i => i.type === "zone").length === 0);
    const gb = Pcb.gerber(pc, "B");
    check("the back copper file carries the pour as G36/G37 regions", (gb.match(/G36\*/g) || []).length === (gb.match(/G37\*/g) || []).length && (gb.match(/G36\*/g) || []).length > 0);
    check("a zone on another net with no pad is reported", (() => { const z = Pcb.blank(20, 20); z.parts.length = 0; Pcb.sync(z, [{ name: "R1", kind: "R", nodes: ["a", "b"] }]); z.parts[0].x = 10; z.parts[0].y = 10; z.zones.push({ id: 3, layer: "F", net: "zzz", pts: [[1, 1], [19, 1], [19, 19], [1, 19]] }); return Pcb.drc(z).some(i => i.type === "zone" && /no pad/.test(i.msg)); })());
}
// ---- routing with pours present
{
    const els3 = [{ name: "V1", kind: "V", nodes: ["1", "0"] }, { name: "R1", kind: "R", nodes: ["1", "2"] }, { name: "R2", kind: "R", nodes: ["2", "0"] }, { name: "C1", kind: "C", nodes: ["2", "0"] }, { name: "R3", kind: "R", nodes: ["1", "0"] }];
    const g = Pcb.blank(50, 40); Pcb.sync(g, els3); Pcb.autoPlace(g, { fit: true });
    g.zones.push({ id: 90, layer: "B", net: "0", thermal: true, pts: [[0.5, 0.5], [g.outline.w - 0.5, 0.5], [g.outline.w - 0.5, g.outline.h - 0.5], [0.5, g.outline.h - 0.5]] });
    const before = Pcb.ratsnest(g).length;
    const rr3 = Pcb.autoRoute(g), iss3 = Pcb.drc(g);
    check(`with a ground pour only the signal nets are routed (${before} airwires before, ${rr3.routed} routed) and the board is clean`, rr3.failed === 0 && iss3.length === 0 && Pcb.ratsnest(g).every(() => false), JSON.stringify(iss3.slice(0, 3)));
    const fz = Pcb.fillZones(g)[0];
    check("the pour clears the new tracks and still reaches every ground pad", fz.islands.length === 0 && fz.connected.length === 4, [fz.connected.length, fz.islands.length]);
}
// ---- push-and-shove
{
    const board = (items) => {
        const b = Pcb.blank(60, 40);
        b.parts = items.map(([ref, net, x, y]) => { const part = { ref, kind: "X", nodes: [net], x, y, rot: 0, placed: true }; Pcb.setPackage(part, undefined, b.footprints); return part; });
        return b;
    };
    const minDist = (A, B) => { let m = Infinity; for (let i = 0; i + 1 < A.length; i++) for (let j = 0; j + 1 < B.length; j++) m = Math.min(m, Pcb.segSegDist(A[i], A[i + 1], B[j], B[j + 1])); return m; };
    // net 2 runs along y = 20 between two pads; net 1 wants to run just below it at y = 20.2
    const b = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["C", "1", 10, 25], ["D", "1", 30, 25]]);
    b.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 20], [40, 20]] });
    const draft = [[10, 25], [10, 20.2], [30, 20.2]];
    const r = Pcb.shove(b, "F", draft, 0.3, "1");
    check("a track laid hard against another is accepted and the other is pushed away", r.ok && r.changes.length === 1, r.reason);
    const moved = r.changes[0] && r.changes[0].pts;
    const D = 0.3 + b.rules.clearance;
    check("the pushed track keeps the clearance to the new one", moved && minDist(moved, [[10, 20.2], [30, 20.2]]) >= D - 0.01, moved && minDist(moved, [[10, 20.2], [30, 20.2]]));
    check("its ends stay on their pads (it pivots about them)", moved && moved[0][0] === 5 && moved[0][1] === 20 && moved[moved.length - 1][0] === 40 && moved[moved.length - 1][1] === 20);
    check("it grew vertices where it bends and bulges away from the new track", moved.length > 2 && Math.min(...moved.map(q => q[1])) < 19.7 && moved.length <= 8, moved);
    Pcb.applyShove(b, r);
    b.tracks.push({ id: 2, layer: "F", w: 0.3, pts: draft });
    const iss = Pcb.drc(b, { zones: false }).filter(i => ["clearance", "short", "edge"].includes(i.type));
    check("after applying, the rule check finds no clearance problem", iss.length === 0, JSON.stringify(iss.slice(0, 2)));
    // same net is not pushed
    const b2 = board([["A", "1", 5, 20], ["B", "1", 40, 20], ["C", "1", 10, 25], ["D", "1", 30, 25]]);
    b2.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 20], [40, 20]] });
    check("tracks of the same net are left alone", Pcb.shove(b2, "F", [[10, 25], [10, 20.2], [30, 20.2]], 0.3, "1").changes.length === 0);
    // crossing cannot be shoved
    const b3 = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["C", "1", 20, 30]]);
    b3.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 20], [40, 20]] });
    const rc = Pcb.shove(b3, "F", [[20, 30], [20, 10]], 0.3, "1");
    check("a new track crossing an existing one is refused with a reason", !rc.ok && /cross/.test(rc.reason), rc.reason);
    // a fixed obstacle in the way: another net's pad where the pushed track would have to go
    const b4 = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["C", "1", 10, 25], ["D", "3", 22, 19.2]]);
    b4.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 20], [40, 20]] });
    const rp = Pcb.shove(b4, "F", [[10, 25], [10, 20.2], [30, 20.2]], 0.3, "1");
    check("pushing a track into a pad of a third net is refused", !rp.ok, rp);
    // cascade: net 2 pushes net 3 which sits beside it
    const b5 = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["E", "3", 5, 16], ["F", "3", 40, 16], ["C", "1", 10, 25]]);
    b5.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 20], [40, 20]] }, { id: 2, layer: "F", w: 0.3, pts: [[5, 16], [8, 19.4], [37, 19.4], [40, 16]] });
    const rk = Pcb.shove(b5, "F", [[10, 25], [10, 20.2], [30, 20.2]], 0.3, "1");
    check("a pushed track pushes its neighbour in turn", rk.ok && rk.changes.length === 2, rk.reason);
    if (rk.ok) { Pcb.applyShove(b5, rk); b5.tracks.push({ id: 3, layer: "F", w: 0.3, pts: [[10, 25], [10, 20.2], [30, 20.2]] }); const i5 = Pcb.drc(b5, { zones: false }).filter(i => ["clearance", "short", "edge"].includes(i.type)); check("and the whole stack ends up clean", i5.length === 0, JSON.stringify(i5.slice(0, 2))); }
    // tracks on the other layer are not touched
    const b6 = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["C", "1", 10, 25]]);
    b6.tracks.push({ id: 1, layer: "B", w: 0.3, pts: [[5, 20], [40, 20]] });
    check("tracks on the other layer are ignored", Pcb.shove(b6, "F", [[10, 25], [10, 20.2], [30, 20.2]], 0.3, "1").changes.length === 0);
    // a one-segment draft just starting is fine
    check("a single point (nothing laid yet) changes nothing", Pcb.shove(b6, "F", [[10, 25]], 0.3, "1").ok);
    // a track pushed toward the board edge is refused
    const b7 = board([["A", "2", 5, 0.8], ["B", "2", 40, 0.8], ["C", "1", 10, 6]]);
    b7.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 0.8], [40, 0.8]] });
    check("pushing a track into the board edge margin is refused", !Pcb.shove(b7, "F", [[10, 6], [10, 0.9], [30, 0.9]], 0.3, "1").ok);
}
// ---- push-and-shove with vias
{
    const board = (items) => {
        const b = Pcb.blank(60, 40);
        b.parts = items.map(([ref, net, x, y]) => { const part = { ref, kind: "X", nodes: [net], x, y, rot: 0, placed: true }; Pcb.setPackage(part, undefined, b.footprints); return part; });
        return b;
    };
    const mk = () => {
        const b = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["C", "1", 12, 30]]);
        b.vias.push({ id: 5, x: 22, y: 20, d: 0.8, drill: 0.4 });
        b.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 20], [22, 20]] }, { id: 2, layer: "B", w: 0.3, pts: [[22, 20], [40, 20]] });
        return b;
    };
    const clean = (b) => Pcb.drc(b, { zones: false }).filter(i => ["clearance", "short", "edge", "unrouted"].includes(i.type));
    const b = mk();
    check("the starting board is clean and routed", clean(b).length === 0, JSON.stringify(clean(b)));
    // net 1 goes along y = 20.5 on the front, 0.5 from the via centre (the via needs 0.77)
    const draft = [[12, 30], [12, 20.5], [32, 20.5]];
    const r = Pcb.shove(b, "F", draft, 0.3, "1");
    check("a track laid against a via pushes the via aside", r.ok && r.vias.length === 1 && r.vias[0].via === b.vias[0], r.reason);
    const v = r.vias[0];
    check("the via ends up clear of the new track (0.77 mm centre to track)", v && Math.abs(v.y - 20.5) >= 0.77 - 0.01 && v.y < 20, v && v.y);
    check("both tracks that end on the via follow it, on both layers", r.changes.length >= 2 && r.changes.every(c => { const e = [c.pts[0], c.pts[c.pts.length - 1]]; return e.some(q => Math.abs(q[0] - v.x) < 1e-9 && Math.abs(q[1] - v.y) < 1e-9); }), r.changes.map(c => c.pts));
    check("their other ends stay on the pads", r.changes.every(c => c.pts.some(q => (q[0] === 5 || q[0] === 40) && q[1] === 20)));
    Pcb.applyShove(b, r);
    b.tracks.push({ id: 9, layer: "F", w: 0.3, pts: draft });
    const after = clean(b).filter(i => i.type !== "unrouted");
    check("after applying, no clearance or short and the net stays connected (no airwire for net 2)", after.length === 0 && Pcb.ratsnest(b).every(l => l.net !== "2"), JSON.stringify(after.slice(0, 2)));
    // a via on a pad cannot move
    const b2 = board([["A", "2", 5, 20], ["C", "1", 12, 30]]);
    b2.vias.push({ id: 5, x: 5, y: 20, d: 0.8, drill: 0.4 });
    const r2 = Pcb.shove(b2, "F", [[12, 30], [12, 20.9], [3, 20.9]], 0.3, "1");
    check("a via sitting on a pad is fixed, so the move is refused", !r2.ok, r2);
    // a track passing under a via (touching it mid-track) pins it
    const b3 = mk(); b3.tracks.push({ id: 3, layer: "B", w: 0.3, pts: [[18, 20.2], [26, 20.2]] });
    check("a via with a track running past it is not pushed (that track would be cut)", !Pcb.shove(b3, "F", draft, 0.3, "1").ok || Pcb.shove(b3, "F", draft, 0.3, "1").vias.length === 0);
    // the same-net via is left alone
    const b4 = mk(); const r4 = Pcb.shove(b4, "F", [[12, 30], [12, 20.5], [32, 20.5]], 0.3, "2");
    check("a via of the track's own net is not moved", r4.vias.length === 0);
    // dropping a via pushes tracks on both layers
    const b5 = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["C", "1", 12, 30]]);
    b5.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 20], [40, 20]] }, { id: 2, layer: "B", w: 0.3, pts: [[5, 21], [40, 21]] });
    // the second track is net 3 on its own pads
    b5.parts.push(...[["E", "3", 5, 21], ["F", "3", 40, 21]].map(([ref, net, x, y]) => { const part = { ref, kind: "X", nodes: [net], x, y, rot: 0, placed: true }; Pcb.setPackage(part, undefined, b5.footprints); return part; }));
    b5.tracks[1].pts = [[5, 21], [40, 21]];
    const newVia = { x: 22, y: 20.6, d: 0.8, drill: 0.4 };
    const rv = Pcb.shoveVia(b5, "F", [[12, 30], [12, 20.6], [22, 20.6]], 0.3, "1", newVia);
    check("dropping a via pushes the tracks it lands on, on both layers (or says why not)", rv.ok ? rv.changes.length >= 1 : /pad|fixed|violate|cross/.test(rv.reason), rv.reason || rv.changes.length);
    // cascade: a pushed via pushes the next via
    const b6 = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["E", "3", 5, 26], ["F", "3", 40, 26], ["C", "1", 12, 36]]);
    b6.vias.push({ id: 5, x: 22, y: 20, d: 0.8, drill: 0.4 }, { id: 6, x: 22, y: 21.2, d: 0.8, drill: 0.4 });
    b6.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[5, 20], [22, 20]] }, { id: 2, layer: "B", w: 0.3, pts: [[22, 20], [40, 20]] }, { id: 3, layer: "F", w: 0.3, pts: [[5, 26], [14, 26], [22, 21.2]] }, { id: 4, layer: "B", w: 0.3, pts: [[22, 21.2], [30, 26], [40, 26]] });
    const r6 = Pcb.shove(b6, "F", [[10, 19.5], [32, 19.5]], 0.3, "1");
    check("a pushed via pushes its neighbouring via in turn (or the move is refused for a stated reason)", r6.ok ? r6.vias.length === 2 : /fixed|violate|cross|crowded|cannot/.test(r6.reason), r6.reason || r6.vias.length);
    if (r6.ok) { Pcb.applyShove(b6, r6); b6.tracks.push({ id: 9, layer: "F", w: 0.3, pts: [[10, 19.5], [32, 19.5]] }); const i6 = clean(b6).filter(i => i.type !== "unrouted"); check("and that cascade ends clean", i6.length === 0, JSON.stringify(i6.slice(0, 2))); }
}
// ---- dragging a track vertex with shove
{
    const board = (items) => { const b = Pcb.blank(60, 40); b.parts = items.map(([ref, net, x, y]) => { const part = { ref, kind: "X", nodes: [net], x, y, rot: 0, placed: true }; Pcb.setPackage(part, undefined, b.footprints); return part; }); return b; };
    const b = board([["A", "2", 5, 20], ["B", "2", 40, 20], ["C", "1", 5, 28], ["D", "1", 40, 28]]);
    const mine = { id: 1, layer: "F", w: 0.3, pts: [[5, 28], [15, 28], [30, 28], [40, 28]] }, other = { id: 2, layer: "F", w: 0.3, pts: [[5, 20], [40, 20]] };
    b.tracks.push(mine, other);
    const r = Pcb.shoveDrag(b, mine, 1, [15, 20.4], {});
    check("dragging a vertex of one track against another pushes the other aside", r.ok && r.changes.length === 1 && r.changes[0].track === other, r.reason);
    check("the dragged track ends at the requested place", r.drag && r.drag.pts[1][0] === 15 && r.drag.pts[1][1] === 20.4);
    Pcb.applyShove(b, r);
    check("after applying, the rule check is clean", Pcb.drc(b, { zones: false }).filter(i => ["clearance", "short", "edge"].includes(i.type)).length === 0, JSON.stringify(Pcb.drc(b, { zones: false }).slice(0, 2)));
    const rb = Pcb.shoveDrag(b, mine, 0, [5, 25], {});
    check("a track end on a pad cannot be dragged", !rb.ok && /pad/.test(rb.reason));
    const rc = Pcb.shoveDrag(board([["A", "2", 5, 20], ["B", "2", 40, 20], ["C", "1", 5, 28], ["D", "1", 40, 28]]).tracks.length ? b : b, mine, 1, [15, 8], {});
    check("dragging across another track is refused", !rc.ok, rc.reason);
    check("a drag onto the same spot changes nothing", Pcb.shoveDrag(b, other, 1, other.pts[1], {}).ok);
}
// ---- walk-around
{
    const board = (items) => { const b = Pcb.blank(60, 40); b.parts = items.map(([ref, net, x, y]) => { const part = { ref, kind: "X", nodes: [net], x, y, rot: 0, placed: true }; Pcb.setPackage(part, undefined, b.footprints); return part; }); return b; };
    const hard = (b) => Pcb.drc(b, { zones: false }).filter(i => ["clearance", "short", "edge"].includes(i.type));
    const b = board([["P", "2", 20, 15], ["Q", "2", 20, 25], ["A", "1", 10, 20], ["B", "1", 30, 20]]);
    b.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[20, 15], [20, 25]] });
    const r = Pcb.walkaround(b, "F", [[10, 20], [30, 20]], 0.3, "1");
    check("a wall of another net in the way is walked around (the path goes past its end)", r.ok && r.pts.length >= 3 && r.pts[r.pts.length - 1][0] === 30 && r.pts[r.pts.length - 1][1] === 20, r.reason);
    b.tracks.push({ id: 2, layer: "F", w: 0.3, pts: [[10, 20], ...r.pts] });
    check("the detour keeps the clearance (rule check clean) and uses 0°/45°/90° only", hard(b).length === 0 && b.tracks[1].pts.slice(0, -1).every((q, i) => { const dx = b.tracks[1].pts[i + 1][0] - q[0], dy = b.tracks[1].pts[i + 1][1] - q[1]; return Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6; }), JSON.stringify(hard(b).slice(0, 2)));
    const free = Pcb.walkaround(board([["A", "1", 10, 20], ["B", "1", 30, 20]]), "F", [[10, 20], [30, 20]], 0.3, "1");
    check("with nothing in the way the straight line comes back", free.ok && free.pts.length === 1 && free.pts[0][0] === 30);
    const bs = board([["P", "1", 20, 15], ["Q", "1", 20, 25], ["A", "1", 10, 20], ["B", "1", 30, 20]]); bs.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[20, 15], [20, 25]] });
    check("copper of the same net is not walked around", Pcb.walkaround(bs, "F", [[10, 20], [30, 20]], 0.3, "1").pts.length === 1);
    const bw = board([["A", "1", 10, 20], ["B", "1", 30, 20]]); bw.tracks.push({ id: 1, layer: "F", w: 0.3, pts: [[20, 0], [20, 40]] }, { id: 2, layer: "F", w: 0.3, pts: [[21, 0], [21, 40]] });
    bw.parts.push(...[["W1", "2", 20, 0.5], ["W2", "2", 20, 39.5]].map(([ref, net, x, y]) => { const part = { ref, kind: "X", nodes: [net], x, y, rot: 0, placed: true }; Pcb.setPackage(part, undefined, bw.footprints); return part; }));
    const rw = Pcb.walkaround(bw, "F", [[10, 20], [30, 20]], 0.3, "1");
    check("a wall across the whole board has no way around: refused with a reason", !rw.ok && /no way around|violate/.test(rw.reason), rw.reason);
    const bo = board([["P", "2", 20, 15], ["A", "1", 10, 20], ["B", "1", 30, 20]]); bo.tracks.push({ id: 1, layer: "B", w: 0.3, pts: [[20, 10], [20, 30]] });
    check("copper on the other layer is ignored", Pcb.walkaround(bo, "F", [[10, 20], [30, 20]], 0.3, "1").pts.length === 1);
    const bp = board([["A", "1", 10, 20], ["B", "1", 30, 20], ["X", "3", 20, 20]]);
    const rp = Pcb.walkaround(bp, "F", [[10, 20], [30, 20]], 0.3, "1");
    check("a pad of another net is walked around too", rp.ok && rp.pts.length >= 3, rp.reason);
    const bv = board([["A", "1", 10, 20], ["B", "1", 30, 20]]); bv.vias.push({ id: 7, x: 20, y: 20, d: 0.8, drill: 0.4 });
    const rv = Pcb.walkaround(bv, "F", [[10, 20], [30, 20]], 0.3, "1");
    check("so is a via (on any layer)", rv.ok && rv.pts.length >= 3, rv.reason);
    const t0 = Date.now(); Pcb.walkaround(b, "F", [[3, 3], [57, 37]], 0.3, "1"); check(`a board-wide search is quick (${Date.now() - t0} ms)`, Date.now() - t0 < 1500);
}
// ---- findings from reading the Gerbers back with an independent reader
{
    const board = (items) => { const b = Pcb.blank(60, 40); b.parts = items.map(([ref, net, x, y, kind]) => { const part = { ref, kind: kind || "X", nodes: net, x, y, rot: 0, placed: true }; Pcb.setPackage(part, undefined, b.footprints); return part; }); return b; };
    // the pour keeps the full clearance (the grid fill used to come within 0.18 mm of a 0.2 mm rule)
    const b = board([["A", ["1"], 10, 10], ["B", ["2"], 30, 10], ["G", ["0"], 20, 25]]);
    b.tracks.push({ id: 1, layer: "B", w: 0.3, pts: [[10, 10], [27.3, 17.7], [30, 10]] });
    b.zones.push({ id: 5, layer: "B", net: "0", pts: [[0.5, 0.5], [59.5, 0.5], [59.5, 39.5], [0.5, 39.5]], thermal: true });
    const fz = Pcb.fillZones(b)[0];
    const rectSeg = (r, a, c) => { const inR = (p) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; if (inR(a) || inR(c)) return 0; const k = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]; let m = Infinity; for (let i = 0; i < 4; i++) m = Math.min(m, Pcb.segSegDist(a, c, k[i], k[(i + 1) % 4])); return m; };
    let gap = Infinity;
    for (const r of fz.rects) for (let i = 0; i + 1 < b.tracks[0].pts.length; i++) gap = Math.min(gap, rectSeg(r, b.tracks[0].pts[i], b.tracks[0].pts[i + 1]) - 0.15);
    check(`the pour's gap to another net's track is at least the clearance (${gap.toFixed(3)} mm)`, gap >= 0.2 - 1e-6, gap);
    let padGap = Infinity;
    for (const p of Pcb.pads(b).filter(q => q.net !== "0")) for (const r of fz.rects) {
        const dx = Math.max(0, Math.abs(p.x - (r[0] + r[2]) / 2) - (r[2] - r[0]) / 2), dy = Math.max(0, Math.abs(p.y - (r[1] + r[3]) / 2) - (r[3] - r[1]) / 2);
        padGap = Math.min(padGap, p.shape === "round" ? Math.hypot(dx, dy) - Math.min(p.w, p.h) / 2 : Math.hypot(Math.max(0, dx - p.w / 2), Math.max(0, dy - p.h / 2)));
    }
    check(`and to the pads of other nets (${padGap.toFixed(3)} mm)`, padGap >= 0.2 - 1e-6, padGap);
    // the pour also stays the edge margin away from the board edge
    const edgeGap = Math.min(...fz.rects.map(r => Math.min(r[0], r[1], 60 - r[2], 40 - r[3])));
    check(`and the edge margin (${edgeGap.toFixed(3)} mm, rule 0.3)`, edgeGap >= 0.3 - 1e-6, edgeGap);
    // a TO-220's courtyard covers its silkscreen body, and silk running off the board is reported
    const m = Pcb.footprint("M", 3, undefined, "to220");
    check("a TO-220's courtyard covers its silkscreen body", m.h >= 2 * 6.9, m.h);
    const edge = Pcb.blank(60, 40); edge.parts = [{ ref: "Q1", kind: "M", nodes: ["1", "2", "3"], x: 30, y: 4, rot: 0, placed: true }]; Pcb.setPackage(edge.parts[0], "to220", edge.footprints);
    const issues = Pcb.drc(edge, { zones: false });
    check("silk off the edge of the board is reported (as a note, it does not block export)", issues.some(i => i.type === "silk"), issues.map(i => i.type));
    const ok = Pcb.blank(60, 40); ok.parts = [{ ref: "Q1", kind: "M", nodes: ["1", "2", "3"], x: 30, y: 20, rot: 0, placed: true }]; Pcb.setPackage(ok.parts[0], "to220", ok.footprints);
    check("and not when the part is inside", !Pcb.drc(ok, { zones: false }).some(i => i.type === "silk"));
    // auto-place keeps every part's silkscreen inside the board it grows
    const pl = Pcb.blank(30, 20); Pcb.sync(pl, [{ name: "M1", kind: "M", nodes: ["1", "2", "3"] }, { name: "R1", kind: "R", nodes: ["1", "2"] }, { name: "C1", kind: "C", nodes: ["2", "3"] }]); Pcb.autoPlace(pl, { fit: true });
    check("auto-place fits the board around the silkscreen too", !Pcb.drc(pl, { zones: false }).some(i => i.type === "silk"), JSON.stringify(Pcb.drc(pl, { zones: false }).filter(i => i.type === "silk")));
}
// ---- manufacturing (fab) rules
{
    const base = () => { const b = Pcb.blank(40, 30); b.parts = [{ ref: "R1", kind: "R", nodes: ["1", "2"], x: 12, y: 15, rot: 0, placed: true }]; Pcb.setPackage(b.parts[0], undefined, b.footprints); return b; };
    const fab = (b) => Pcb.drc(b, { zones: false }).filter(i => i.type === "fab");
    const b = base();
    check("with no fab preset nothing is reported", fab(b).length === 0);
    b.rules.fab = "generic";
    check("the default board passes the generic fab rules", fab(b).length === 0, JSON.stringify(fab(b)));
    b.tracks.push({ id: 1, layer: "F", w: 0.1, pts: [[5, 5], [30, 5]] });
    check("a 0.1 mm track is below the generic 0.15 mm minimum", fab(b).some(i => /track 1 is 0.1/.test(i.msg)));
    b.rules.fab = "tight";
    check("but fine for the tight preset", !fab(b).some(i => /track 1/.test(i.msg)));
    const t = base(); t.rules.fab = "generic";
    t.footprints.TINY = { name: "TINY", silk: [], pinMap: null, pads: [{ n: "1", x: -2, y: 0, w: 1.0, h: 1.0, drill: 0.85, shape: "round", smd: false }, { n: "2", x: 2, y: 0, w: 1.6, h: 1.6, drill: 0.2, shape: "round", smd: false }] };
    Pcb.setPackage(t.parts[0], "user:TINY", t.footprints);
    const ti = fab(t).map(i => i.msg);
    check("a thin annular ring is reported (pad 1.0, hole 0.85 -> 0.075 mm)", ti.some(m => /R1\.1: the annular ring is 0\.075/.test(m)), ti);
    check("a hole below the minimum drill is reported", ti.some(m => /R1\.2: the 0\.2 mm hole is below/.test(m)), ti);
    const h = base(); h.rules.fab = "generic"; h.vias.push({ id: 1, x: 5, y: 5, d: 0.8, drill: 0.4 }, { id: 2, x: 5.55, y: 5, d: 0.8, drill: 0.4 });
    check("holes closer than the minimum edge to edge are reported", fab(h).some(i => /via 1 and via 2: the holes are 0\.15/.test(i.msg)), fab(h).map(i => i.msg));
    const v = base(); v.rules.fab = "generic"; v.vias.push({ id: 1, x: 5, y: 5, d: 0.5, drill: 0.4 });
    check("a via whose ring is 0.05 mm is reported", fab(v).some(i => /via 1: the annular ring is 0\.05/.test(i.msg)));
    const m = Pcb.blank(40, 30); m.rules.fab = "generic";
    m.parts = [{ ref: "R1", kind: "R", nodes: ["1", "2"], x: 10, y: 10, rot: 0, placed: true }, { ref: "R2", kind: "R", nodes: ["3", "4"], x: 12.55, y: 10, rot: 0, placed: true }];
    for (const p of m.parts) Pcb.setPackage(p, "0603", m.footprints);
    // 0603 pads are 0.8 wide at +-0.8: R2 shifted by 0.55 puts pad 1 of R2 (9.75+... ) near pad 2 of R1: find the smallest gap and check the web message
    const web = fab(m).filter(i => /solder-mask web/.test(i.msg));
    check("pad openings with less than the minimum solder-mask web between them are reported", web.length >= 1, fab(m).map(i => i.msg));
    check("the issues name the preset", fab(m).every(i => /^\[Generic 2-layer prototype\]/.test(i.msg)));
    const sz = Pcb.blank(8, 8); sz.rules.fab = "generic";
    check("a board below the minimum size is reported", fab(sz).some(i => /below the fab minimum 10 x 10/.test(i.msg)));
    const si = base(); si.rules.fab = "generic";
    si.parts[0].fp.silk = [[[-6, 0], [6, 0]]];
    check("silkscreen running over a pad is a cosmetic note, not a blocking issue", Pcb.drc(si, { zones: false }).some(i => i.type === "silk" && /over pads/.test(i.msg)) && !fab(si).length);
}
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);

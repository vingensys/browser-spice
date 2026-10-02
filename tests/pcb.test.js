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
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);

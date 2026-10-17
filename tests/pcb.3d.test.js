// The 3D board picture:  node tests/pcb.3d.test.js
const fs = require("fs"), path = require("path");
const src = ["js/pcb/pcb.js", "js/pcb/view3d.js"].map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n");
const { Pcb, Pcb3D } = new Function(src + "\nreturn { Pcb, Pcb3D };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const b = Pcb.blank(60, 40);
Pcb.sync(b, [{ name: "R1", kind: "R", nodes: ["1", "2"] }, { name: "C1", kind: "C", nodes: ["2", "0"] }, { name: "Q1", kind: "Q", nodes: ["1", "2", "0"] }]);
Pcb.autoPlace(b);
b.tracks = [{ id: 1, layer: "F", w: 0.3, pts: [[10, 10], [30, 10], [30, 20]] }, { id: 2, layer: "B", w: 0.3, pts: [[5, 5], [5, 30]] }];
b.vias = [{ id: 3, x: 30, y: 20, d: 0.8, drill: 0.4 }];
const sc = Pcb3D.scene(b);
check("the scene has a box per part, a quad per track segment, pads and vias", sc.boxes.length === 3 && sc.tracks.length === 3 && sc.vias.length === 1 && sc.pads.length >= 7, [sc.boxes.length, sc.tracks.length, sc.pads.length]);
check("part heights follow the package (SMD low, radial capacitor tall)", Pcb3D.height({ kind: "R", fp: { name: "0805", smd: true } }) < 1 && Pcb3D.height({ kind: "C", fp: { name: "radial", smd: false } }) >= 8 && Pcb3D.height({ kind: "X", fp: { name: "DIP-8", smd: false } }) > 4);
const cv = { width: 800, height: 600, getContext: () => ({}) };
const v = new Pcb3D(cv); v.setScene(sc);

// the top view maps board x to screen x and board y downward, with the board centred
v.preset("top");
const cam = v.camera(), c = v.project(30, 20, Pcb3D.T / 2, cam), r = v.project(40, 20, Pcb3D.T / 2, cam), d = v.project(30, 30, Pcb3D.T / 2, cam);
check("the board centre is the canvas centre", Math.abs(c.x - 400) < 1e-6 && Math.abs(c.y - 300) < 1e-6, c);
check("top view: board x runs right and board y runs down the screen", r.x > c.x + 1 && Math.abs(r.y - c.y) < 1e-6 && d.y > c.y + 1 && Math.abs(d.x - c.x) < 1e-6, [r, d]);
const topFaces = v.faces();
check("seen from above: the slab top, front copper and part tops are drawn, back copper is not", topFaces.some(f => f.group === 2) && topFaces.some(f => f.group === 3) && topFaces.some(f => f.group === 4) && !topFaces.some(f => f.group === 1), topFaces.map(f => f.group).join(""));
const order = topFaces.map(f => f.group);
check("and painted from the back parts / board to the front parts", order.every((g, i) => i === 0 || g >= order[i - 1]));
v.preset("bottom");
const botFaces = v.faces();
check("seen from below: the back copper is drawn, the front copper is hidden by the board", botFaces.some(f => f.group === 1) && !botFaces.some(f => f.group === 3));
const o2 = botFaces.map(f => f.group);
check("and the painting order is reversed", o2.every((g, i) => i === 0 || g <= o2[i - 1]));
v.preset("iso");
const iso = v.faces();
const sideWalls = iso.filter(f => f.group === 4 && f.pts.length === 4 && f.stroke).length;
check("at an angle each box shows its top and one to three side walls, never a back wall", sideWalls >= 3 && sideWalls <= 9, sideWalls);
// far-to-near inside a group
const g4 = iso.filter(f => f.group === 4).map(f => f.depth);
check("faces within a group are painted far to near", g4.every((x, i) => i === 0 || x <= g4[i - 1] + 1e-9));
// hiding parts
v.show.parts = false;
check("the Parts switch removes the boxes", !v.faces().some(f => f.group === 4 || f.group === 0));
v.show.parts = true; v.show.copper = false; v.show.silk = false;
check("the Copper switch removes tracks and pads", !v.faces().some(f => f.group === 3 || f.group === 1));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

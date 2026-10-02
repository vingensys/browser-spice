// A second, independent reader (tracespace, JavaScript): the files parse without errors, every layer is recognised and
// plots, the outline closes into a board shape of the right size, and the drill file has every hole.
//   node tracespace-check.mjs <dir with gb-* files and board.json>      (run.sh installs @tracespace/core into its work directory)
import * as core from "@tracespace/core";
import fs from "node:fs";
const dir = process.argv[2], board = JSON.parse(fs.readFileSync(dir + "/board.json", "utf8"));
let pass = 0, fail = 0; const row = (ok, s, d = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + s + (ok ? "" : "\n        -> " + d)); };
const files = fs.readdirSync(dir).filter(f => /^gb/.test(f) && !/zip|svg|json/.test(f)).map(f => dir + "/" + f);
const r = await core.read(files);
const types = Object.fromEntries(r.layers.map(l => [l.filename, `${l.type}/${l.side}`]));
row(r.layers.length === 9 && r.layers.every(l => l.type && l.type !== "unknown"), `tracespace recognises all ${r.layers.length} layers (${Object.values(types).join(", ")})`, JSON.stringify(types));
let problems = 0;
for (const tree of Object.values(r.parseTreesById)) problems += (JSON.stringify(tree).match(/"type":"(error|unknown)"/g) || []).length;
row(problems === 0, `the parser finds no errors in any file (${problems})`, problems);
const plotted = core.plot(r), W = board.outline.w, H = board.outline.h;
row(Object.keys(plotted.plotTreesById).length === 9, "every layer plots", Object.keys(plotted.plotTreesById).length);
const shape = plotted.boardShape && plotted.boardShape.regions && plotted.boardShape.regions[0];
const xs = shape ? shape.segments.flatMap(s => [s.start[0], s.end[0]]) : [], ys = shape ? shape.segments.flatMap(s => [s.start[1], s.end[1]]) : [];
row(shape && Math.abs(Math.max(...xs) - Math.min(...xs) - W) < 1e-6 && Math.abs(Math.max(...ys) - Math.min(...ys) - H) < 1e-6 && shape.segments.length === 4, `the outline closes into a ${W} x ${H} mm board shape`, JSON.stringify(shape && shape.segments.length));
const drill = r.layers.find(l => l.type === "drill"), dt = plotted.plotTreesById[drill.id];
const holes = board.parts.flatMap(p => p.fp.pads.filter(q => q.drill)).length + board.vias.length;
row(dt.children.length === holes, `the drill file plots ${dt.children.length} holes (the board has ${holes})`);
const copper = r.layers.filter(l => l.type === "copper").map(l => plotted.plotTreesById[l.id]);
row(copper.every(t => t.size && t.size[0] >= 0 && t.size[2] <= W + 0.01 && t.size[3] <= H + 0.01), "all copper stays inside the board", JSON.stringify(copper.map(t => t.size)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

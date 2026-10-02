// MCP server: node tests/mcp.test.js  (talks JSON-RPC to mcp/server.mjs over stdio)
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const server = spawn("node", [path.join(__dirname, "..", "mcp", "server.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", nextId = 1;
const waiting = new Map();
server.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } }
});
const rpc = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); const text = r.result.content[0].text; return r.result.isError ? { error: text } : JSON.parse(text); };

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const near = (a, b, tol, w = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${w} expected ${b} +/- ${tol}, got ${a}`); };

const RC = "rc\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n.end";
const LP = "lp\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 159.155n\n.ac dec 20 10 100k\n.end";

(async () => {
    console.log("MCP server");
    await test("initialize announces tools and the protocol version", async () => {
        const r = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
        if (r.result.protocolVersion !== "2024-11-05" || !r.result.capabilities.tools || r.result.serverInfo.name !== "browser-spice") throw new Error(JSON.stringify(r));
    });
    await test("tools/list describes every tool with a schema", async () => {
        const r = await rpc("tools/list", {});
        const names = r.result.tools.map(t => t.name).sort().join();
        if (!names.includes("simulate") || !names.includes("pcb_create")) throw new Error(names);
        if (!r.result.tools.every(t => t.description.length > 20 && t.inputSchema.type === "object")) throw new Error("schemas");
    });
    await test("operating point of a divider", async () => {
        const r = await call("simulate", { netlist: "d\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 3k\n.op\n.end" });
        near(r.nodeVoltages.out, 7.5, 1e-9); near(Math.abs(r.branchCurrents.R1), 2.5e-3, 1e-12);
    });
    await test("transient of an RC: waveform summary and a .meas measurement (time constant 1 ms)", async () => {
        const r = await call("simulate", { netlist: RC, signals: ["v(out)"], maxPoints: 50, measures: [".meas tran t63 when v(out)=3.1606 rise=1", ".meas tran vend find v(out) at=5m"] });
        if (r.signals["v(out)"].t.length !== 50) throw new Error("points");
        near(r.signals["v(out)"].final, 5 * (1 - Math.exp(-5)), 0.02);
        near(r.measures[0].value, 1e-3, 3e-5, "63 % time"); near(r.measures[1].value, 5 * (1 - Math.exp(-5)), 0.02);
    });
    await test("AC of an RC low-pass: -3 dB at 1 kHz, 45 degrees of lag there", async () => {
        const r = await call("simulate", { netlist: LP, signals: ["vdb(out)"], measures: [".meas ac f3 when vdb(out)=-3.0103 fall=1", ".meas ac p1k find vp(out) at=1k"] });
        near(r.signals["vdb(out)"].bandwidth_3db_hz, 1000, 20); near(r.measures[0].value, 1000, 5); near(r.measures[1].value, -45, 0.5);
    });
    await test("DC sweep, noise and transfer function", async () => {
        const dc = await call("simulate", { netlist: "d\nV1 in 0 DC 0\nR1 in out 1k\nR2 out 0 1k\n.dc V1 0 4 1\n.end", signals: ["v(out)"] });
        if (dc.signals["v(out)"].join() !== "0,0.5,1,1.5,2") throw new Error(dc.signals["v(out)"].join());
        const nz = await call("simulate", { netlist: "n\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.op\n.end", analysis: "noise", noise: { output: "out", input: "V1", fStart: 10, fStop: 1000, pointsPerDecade: 2 } });
        near(nz.output_noise_v_per_rthz[0], Math.sqrt(4 * 1.380649e-23 * 300.15 * 500), 1e-12);
        const tf = await call("simulate", { netlist: "t\nV1 in 0 DC 1 AC 1\nR1 in out 1k\nR2 out 0 3k\n.op\n.end", analysis: "tf", tf: { output: "out", input: "V1" } });
        near(tf.gain, 0.75, 1e-6); near(tf.input_resistance_ohm, 4000, 1); near(tf.output_resistance_ohm, 750, 1);
    });
    await test("a parametric sweep returns one measurement per value", async () => {
        const r = await call("sweep", { netlist: "rc\n.param rv=1k\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out {rv}\nC1 out 0 1u\n.tran 10u 5m\n.end", param: "rv", values: [500, 1000, 2000], measures: [".meas tran vend find v(out) at=2m"] });
        const v = r.results.map(x => x.measures[0].value);
        near(v[0], 5 * (1 - Math.exp(-4)), 0.02); near(v[1], 5 * (1 - Math.exp(-2)), 0.02); near(v[2], 5 * (1 - Math.exp(-1)), 0.02);
    });
    await test("Monte Carlo is repeatable for a seed and gives a plausible spread", async () => {
        const args = { netlist: RC, measure: ".meas tran t50 when v(out)=2.5 rise=1", runs: 60, seed: 3, tolerance_percent: { R: 5, C: 5 } };
        const a = await call("monte_carlo", args), b = await call("monte_carlo", args);
        if (a.mean !== b.mean || a.runs !== 60) throw new Error("repeatability");
        near(a.mean, Math.log(2) * 1e-3, 3e-5); if (!(a.std_dev > 1e-6 && a.std_dev < 6e-5)) throw new Error("std " + a.std_dev);
        if (a.histogram.counts.reduce((x, y) => x + y, 0) !== 60) throw new Error("histogram");
    });
    await test("check_deck reports structure and convergence problems", async () => {
        const ok = await call("check_deck", { netlist: LP });
        if (!ok.ok || ok.elements.Resistor !== 1 || !ok.analyses.includes("ac")) throw new Error(JSON.stringify(ok));
        const bad = await call("check_deck", { netlist: "x\nV1 a 0 1\nV2 a 0 2\nR1 a 0 1k\n.end" });
        if (bad.ok || !/singular|loop/.test(bad.operatingPointError)) throw new Error(JSON.stringify(bad));
    });
    await test("errors come back as tool errors, not crashes", async () => {
        const e1 = await call("simulate", { netlist: "" }); if (!/netlist/.test(e1.error)) throw new Error(JSON.stringify(e1));
        const e2 = await call("simulate", { netlist: RC, signals: ["v(nope)"] }); if (!/no signal/.test(e2.error)) throw new Error(JSON.stringify(e2));
        const e3 = await call("sweep", { netlist: RC, param: "x", values: [1, 2], measures: [".meas tran a max v(out)"] }); if (!/\.param/.test(e3.error)) throw new Error(JSON.stringify(e3));
        const r = await rpc("tools/call", { name: "nothing", arguments: {} }); if (!r.error) throw new Error("unknown tool");
        const r2 = await rpc("bogus/method", {}); if (!r2.error || r2.error.code !== -32601) throw new Error("unknown method");
    });
    await test("list_models lists the built-in parts", async () => {
        const m = await call("list_models", {});
        if (!m.BJT_NPN.includes("2N2222") || !m.OPAMP.length) throw new Error(Object.keys(m).join());
    });
    if (!spawnSync("ngspice", ["-v"]).error) {
        await test("compare_with_ngspice agrees on an amplifier", async () => {
            const fs = require("fs");
            const deck = fs.readFileSync(path.join(__dirname, "decks", "ce_amp.cir"), "utf8");
            const r = await call("compare_with_ngspice", { netlist: deck });
            if (r.operatingPoint.worst_deviation_percent_of_full_scale > 0.5 || r.transient.worst_rms_deviation_percent_of_range > 4) throw new Error(JSON.stringify(r));
        });
    }
    await test("DC sweep returns source currents as well as node voltages", async () => {
        const r = await call("simulate", { netlist: "d\nV1 a 0 0\nR1 a b 100\nR2 b 0 100\n.dc V1 0 4 1\n.end", analysis: "dc", signals: ["v(b)", "i(v1)"] });
        near(r.signals["v(b)"][4], 2, 1e-9); near(r.signals["i(v1)"][4], -0.02, 1e-9);
    });
    await test("operating-point measures: .meas op find v(x) / i(source), also in the deck", async () => {
        const r = await call("simulate", { netlist: "op\nV1 a 0 6\nR1 a b 1k\nR2 b 0 2k\n.op\n.meas op vb find v(b)\n.meas op iin i(v1)\n.end", analysis: "op" });
        near(r.measures.find(m => m.name === "vb").value, 4, 1e-6); near(r.measures.find(m => m.name === "iin").value, -0.002, 1e-9);
    });
    await test("Monte Carlo and sweep work on operating-point measures", async () => {
        const deck = "mc\n.param rv=10k\nV1 in 0 DC 10\nR1 in out {rv}\nR2 out 0 10k\n.op\n.end";
        const m = await call("monte_carlo", { netlist: deck, measure: ".meas op vout find v(out)", runs: 100, seed: 3, tolerance_percent: { R: 1 }, limits: { min: 4.9, max: 5.1 } });
        near(m.mean, 5, 0.01); if (!(m.std_dev > 0.005 && m.std_dev < 0.03) || m.yield_percent !== 100) throw new Error(JSON.stringify(m));
        const sw = await call("sweep", { netlist: deck, param: "rv", values: [5000, 10000, 20000], analysis: "op", measures: [".meas op vout find v(out)"] });
        near(sw.results[0].measures[0].value, 20 / 3, 1e-4); near(sw.results[2].measures[0].value, 10 / 3, 1e-4);
    });
    await test("part names from the built-in library work in a deck without .model cards (1N4148, 2N2222, 2N7000), any case", async () => {
        const d = await call("simulate", { netlist: "d\nV1 a 0 5\nR1 a b 1k\nD1 b 0 1n4148\n.op\n.end", analysis: "op" });
        if (d.warnings.length) throw new Error("diode: " + d.warnings.join());
        const lib = await call("simulate", { netlist: "q\nVCC vcc 0 12\nR1 vcc b 47k\nR2 b 0 10k\nRC vcc c 2.2k\nRE e 0 470\nQ1 c b e 2N2222\n.op\n.end", analysis: "op" });
        const def = await call("simulate", { netlist: "q\nVCC vcc 0 12\nR1 vcc b 47k\nR2 b 0 10k\nRC vcc c 2.2k\nRE e 0 470\nQ1 c b e MYQ\n.model MYQ NPN(IS=1e-16 BF=100)\n.op\n.end", analysis: "op" });
        if (lib.warnings.length) throw new Error("bjt: " + lib.warnings.join());
        if (Math.abs(lib.nodeVoltages.c - def.nodeVoltages.c) < 0.05) throw new Error("the 2N2222 model was not used");
        const m = await call("simulate", { netlist: "m\nVD d 0 10\nVG g 0 5\nR1 d x 100\nM1 x g 0 0 2N7000\n.op\n.end", analysis: "op" });
        if (m.warnings.length || !(m.nodeVoltages.x < 9.9)) throw new Error("mosfet: " + JSON.stringify(m));
    });
    await test("a model that exists nowhere is still reported", async () => {
        const r = await call("simulate", { netlist: "d\nV1 a 0 5\nR1 a b 1k\nD1 b 0 NOSUCH\n.op\n.end", analysis: "op" });
        if (!r.warnings.some(w => /nosuch/i.test(w))) throw new Error(JSON.stringify(r.warnings));
    });
    if (!spawnSync("ngspice", ["-v"]).error) {
        await test("library parts reach ngspice as cards (BJT, MOSFET with gate capacitances and body diode): bias and averages agree", async () => {
            const bjt = await call("compare_with_ngspice", { netlist: "q\nVCC vcc 0 12\nR1 vcc b 47k\nR2 b 0 10k\nRC vcc c 2.2k\nRE e 0 470\nQ1 c b e 2N2222\n.op\n.end" });
            if (bjt.operatingPoint.worst_deviation_percent_of_full_scale > 0.05) throw new Error(JSON.stringify(bjt));
            const boost = await call("compare_with_ngspice", { netlist: "b\nVIN in 0 DC 5\nL1 in sw 100u\nM1 sw g 0 0 IRF540\nVG g 0 PULSE(0 10 0 20n 20n 5u 10u)\nD1 sw out 1N5819\nC1 out 0 100u\nRL out 0 50\n.tran 100n 2m\n.end" });
            if (boost.operatingPoint.worst_deviation_percent_of_full_scale > 0.05 || boost.transient.worst_mean_deviation_percent_of_range > 1) throw new Error(JSON.stringify(boost).slice(0, 400));
        });
    }
    // ---------------------------------------------------------------- PCB tools
    const AMP = "amp\nVCC vcc 0 DC 12\nVIN in 0 SIN(0 0.01 1k)\nCIN in b 10u\nR1 vcc b 47k\nR2 b 0 10k\nRC vcc c 2.2k\nRE e 0 470\nCE e 0 100u\nQ1 c b e 2N2222\nCOUT c out 10u\nRL out 0 10k\n.end";
    let board;
    await test("tools/list now also offers the seven PCB tools", async () => {
        const r = await rpc("tools/list", {});
        const names = r.result.tools.map(t => t.name);
        for (const n of ["pcb_create", "pcb_edit", "pcb_route", "pcb_check", "pcb_describe", "pcb_render", "pcb_export"]) if (!names.includes(n)) throw new Error("missing " + n);
    });
    await test("pcb_create turns a deck into placed footprints with nets (transistor in package order E B C)", async () => {
        board = await call("pcb_create", { netlist: AMP, packages: { R1: "0805", R2: "0805", RC: "0805" } });
        if (board.parts !== 11 || board.unrouted_connections < 10) throw new Error(JSON.stringify(board).slice(0, 300));
        const q = board.parts_list.find(p => p.ref === "Q1"), r1 = board.parts_list.find(p => p.ref === "R1");
        if (q.footprint !== "TO-92" || q.nets.join() !== "e,b,c") throw new Error("Q1 " + JSON.stringify(q));
        if (r1.footprint !== "0805") throw new Error("R1 " + JSON.stringify(r1));
        if (board.parts_list.find(p => p.ref === "R2").nets.join() !== "b,GND") throw new Error("ground should be shown as GND");
    });
    await test("pcb_route completes every connection and pcb_check is clean", async () => {
        const r = await call("pcb_route", { board_id: board.board_id });
        if (r.failed !== 0 || r.still_unrouted.length) throw new Error(JSON.stringify(r));
        const k = await call("pcb_check", { board_id: board.board_id });
        if (!k.clean) throw new Error(JSON.stringify(k).slice(0, 400));
    });
    await test("pcb_describe returns parts with pad nets, nets with pads, and tracks", async () => {
        const d = await call("pcb_describe", { board_id: board.board_id, include: ["parts", "nets", "tracks", "pours"] });
        if (!d.nets.GND || !d.nets.GND.includes("RE.2") || d.unrouted.length || !d.track_list.length || d.parts_list[0].pads.length < 2) throw new Error(JSON.stringify(d).slice(0, 300));
    });
    await test("pcb_edit is all-or-nothing: a failing action undoes the whole call, with the reason", async () => {
        const before = (await call("pcb_describe", { board_id: board.board_id, include: [] })).tracks;
        const r = await call("pcb_edit", { board_id: board.board_id, actions: [{ op: "clear_routing" }, { op: "move", ref: "NOPE", x: 1, y: 1 }] });
        if (!r.error === undefined && r.failed_at !== 1) throw new Error(JSON.stringify(r));
        if (r.failed_at !== 1 || !/no part NOPE/.test(r.error) || !r.results[0].rolled_back) throw new Error(JSON.stringify(r));
        if ((await call("pcb_describe", { board_id: board.board_id, include: [] })).tracks !== before) throw new Error("the routing was lost");
    });
    await test("pcb_edit: move a part, flip an SMD part, change a package and a rule; the rule check then sees the open connections", async () => {
        const r = await call("pcb_edit", { board_id: board.board_id, actions: [{ op: "move", ref: "RL", x: 40, y: 12, rot: 90 }, { op: "flip", ref: "R1" }, { op: "package", ref: "RE", package: "1206" }, { op: "rules", clearance: 0.25 }] });
        if (r.applied !== 4 || r.board.rules_mm.clearance !== 0.25) throw new Error(JSON.stringify(r));
        const k = await call("pcb_check", { board_id: board.board_id });
        if (k.clean || !k.counts.unrouted) throw new Error("moving parts should leave connections to route: " + JSON.stringify(k.counts));
        const bad = await call("pcb_edit", { board_id: board.board_id, actions: [{ op: "flip", ref: "Q1" }] });
        if (!/through-hole/.test(bad.error)) throw new Error(JSON.stringify(bad));
        await call("pcb_edit", { board_id: board.board_id, actions: [{ op: "rules", clearance: 0.2 }, { op: "auto_place" }] });
        const rr = await call("pcb_route", { board_id: board.board_id });
        if (rr.failed) throw new Error(JSON.stringify(rr));
    });
    await test("pcb_edit track: 'shove' pushes another net's track aside, leaving the rules clean", async () => {
        const b = await call("pcb_create", { netlist: "t\nV1 a 0 1\nV2 c 0 1\nR1 a b 1k\nR2 c d 1k\n.end", width: 40, height: 30, auto_place: false });
        const id = b.board_id;
        await call("pcb_edit", { board_id: id, actions: [{ op: "move", ref: "V1", x: 5, y: 8 }, { op: "move", ref: "V2", x: 10, y: 22 }, { op: "move", ref: "R1", x: 20, y: 6 }, { op: "move", ref: "R2", x: 20, y: 24 }] });
        const d0 = await call("pcb_describe", { board_id: id, include: ["parts"] });
        const pad = (ref, n) => d0.parts_list.find(p => p.ref === ref).pads[n - 1];
        const a1 = pad("V1", 1), a2 = pad("R1", 1), c1 = pad("V2", 1), c2 = pad("R2", 1);
        await call("pcb_edit", { board_id: id, actions: [{ op: "track", layer: "F", points: [[a1.x, a1.y], [a1.x, 14], [a2.x, 14], [a2.x, a2.y]], mode: "off" }] });
        const r = await call("pcb_edit", { board_id: id, actions: [{ op: "track", layer: "F", points: [[c1.x, c1.y], [c1.x, 14.4], [c2.x, 14.4], [c2.x, c2.y]], mode: "shove" }] });
        if (r.error || !(r.results[0].pushed_tracks > 0)) throw new Error(JSON.stringify(r).slice(0, 400));
        const k = await call("pcb_check", { board_id: id });
        const bad = Object.keys(k.counts).filter(t => ["clearance", "short", "edge"].includes(t));
        if (bad.length) throw new Error(JSON.stringify(k.issues).slice(0, 300));
    });
    await test("pcb_edit track: 'walk' goes round a pad in the way (0/45/90 degrees), 'off' lets it through and the check says so", async () => {
        const mk = async () => {
            const b = await call("pcb_create", { netlist: "t\nV2 c 0 1\nR1 x y 1k\nR2 c d 1k\n.end", width: 40, height: 30, auto_place: false });
            await call("pcb_edit", { board_id: b.board_id, actions: [{ op: "move", ref: "V2", x: 10, y: 22 }, { op: "move", ref: "R1", x: 17, y: 24.3 }, { op: "move", ref: "R2", x: 20, y: 24 }] });
            const d = await call("pcb_describe", { board_id: b.board_id, include: ["parts"] });
            return [b.board_id, d.parts_list.find(p => p.ref === "V2").pads[0], d.parts_list.find(p => p.ref === "R2").pads[0]];
        };
        const [id, from, to] = await mk();
        const r = await call("pcb_edit", { board_id: id, actions: [{ op: "track", layer: "F", points: [[from.x, from.y], [to.x, to.y]], mode: "walk" }] });
        if (r.error || r.results[0].points < 3) throw new Error(JSON.stringify(r).slice(0, 400));
        const k = await call("pcb_check", { board_id: id });
        if (Object.keys(k.counts).some(t => ["clearance", "short", "edge"].includes(t))) throw new Error(JSON.stringify(k.issues).slice(0, 300));
        const [id2, f2, t2] = await mk();
        await call("pcb_edit", { board_id: id2, actions: [{ op: "track", layer: "F", points: [[f2.x, f2.y], [t2.x, t2.y]], mode: "off" }] });
        const k2 = await call("pcb_check", { board_id: id2 });
        if (!(k2.counts.short || k2.counts.clearance)) throw new Error("a track straight through a pad should be reported: " + JSON.stringify(k2.counts));
    });
    await test("pcb_edit pour: a ground pour fills, joins the ground pads and reports what it cuts off", async () => {
        const id = (await call("pcb_create", { netlist: AMP })).board_id;
        const r = await call("pcb_edit", { board_id: id, actions: [{ op: "pour", layer: "B", net: "0" }] });
        const z = r.results[0];
        if (!z.ok || z.copper_mm2 < 300 || z.pads_connected < 3 || z.pads_cut_off.length) throw new Error(JSON.stringify(r));
        await call("pcb_route", { board_id: id });
        const k = await call("pcb_check", { board_id: id });
        if (!k.clean) throw new Error(JSON.stringify(k).slice(0, 300));
        const bad = await call("pcb_edit", { board_id: id, actions: [{ op: "pour", layer: "F", net: "nosuch" }] });
        if (!/no pad/.test(bad.error)) throw new Error(JSON.stringify(bad));
    });
    await test("pcb_edit define_footprint: a user footprint is used by a part, with a clear error for a bad definition", async () => {
        const id = (await call("pcb_create", { netlist: "f\nV1 a 0 1\nR1 a b 1k\nR2 b 0 1k\n.end" })).board_id;
        const r = await call("pcb_edit", { board_id: id, actions: [{ op: "define_footprint", definition: "footprint WIDE\npad 1 -3 0 1.2 1.2\npad 2 3 0 1.2 1.2\nline -2 -1 2 -1 2 1 -2 1 -2 -1\n" }, { op: "package", ref: "R1", package: "user:WIDE" }] });
        if (r.applied !== 2 || r.results[1].footprint !== "WIDE") throw new Error(JSON.stringify(r));
        const bad = await call("pcb_edit", { board_id: id, actions: [{ op: "define_footprint", definition: "footprint X\npad 1 0" }] });
        if (!/pad needs/.test(bad.error)) throw new Error(JSON.stringify(bad));
    });
    await test("pcb_create reads a KiCad schematic too", async () => {
        const kicad = require("fs").readFileSync(path.join(__dirname, "kicad", "divider.kicad_sch"), "utf8");
        const k = await call("pcb_create", { kicad });
        if (k.parts !== 3 || !k.parts_list.some(p => p.nets.includes("mid"))) throw new Error(JSON.stringify(k).slice(0, 300));
    });
    await test("pcb_render gives an SVG (and can write it to a file)", async () => {
        const r = await call("pcb_render", { board_id: board.board_id });
        if (!/^<svg/.test(r.svg) || !/<polyline/.test(r.svg) || !/<circle/.test(r.svg)) throw new Error(r.svg.slice(0, 200));
        const f = path.join(require("os").tmpdir(), `mcp-board-${process.pid}.svg`);
        const w = await call("pcb_render", { board_id: board.board_id, layer: "B", file: f });
        if (!require("fs").existsSync(f) || w.svg) throw new Error(JSON.stringify(w)); require("fs").unlinkSync(f);
    });
    await test("pcb_export writes Gerber / Excellon files and a valid ZIP; a board with violations is refused unless forced", async () => {
        const dir = path.join(require("os").tmpdir(), `mcp-gerber-${process.pid}`);
        const r = await call("pcb_export", { board_id: board.board_id, name: "amp", directory: dir });
        const names = r.files.map(f => f.name);
        for (const n of ["amp-F_Cu.gtl", "amp-B_Cu.gbl", "amp-Edge_Cuts.gm1", "amp.drl", "amp-F_Silkscreen.gto", "amp-F_Mask.gts"]) if (!names.includes(n)) throw new Error("missing " + n);
        if (!r.clean || !/G04/.test(require("fs").readFileSync(path.join(dir, "amp-F_Cu.gtl"), "utf8"))) throw new Error(JSON.stringify(r));
        const z = spawnSync("unzip", ["-t", path.join(dir, "amp-gerber.zip")], { encoding: "utf8" });
        if (!z.error && !/No errors detected/.test(z.stdout)) throw new Error(z.stdout);
        require("fs").rmSync(dir, { recursive: true });
        const id = (await call("pcb_create", { netlist: AMP })).board_id;
        await call("pcb_edit", { board_id: id, actions: [{ op: "move", ref: "R1", x: 10, y: 10 }, { op: "move", ref: "R2", x: 10, y: 10.5 }] });
        const refused = await call("pcb_export", { board_id: id });
        if (!/rule violation/.test(refused.error)) throw new Error(JSON.stringify(refused).slice(0, 200));
        const forced = await call("pcb_export", { board_id: id, force: true, zip_base64: true });
        if (forced.clean || !forced.zip_base64) throw new Error("force should export anyway");
    });
    await test("an unknown board id says what boards exist", async () => {
        const r = await call("pcb_check", { board_id: "zzz" });
        if (!/no board "zzz"/.test(r.error)) throw new Error(JSON.stringify(r));
    });
    if (!spawnSync("ngspice", ["-v"]).error) {
        await test("compare_with_ngspice recognises an undetermined floating level (both solutions valid) and flags a real disagreement", async () => {
            // a node held only by two back-to-back diodes: its level is whatever each solver lands on
            const flo = await call("compare_with_ngspice", { netlist: "f\nV1 a 0 10\nD1 m a DM\nD2 0 m DM\nC1 m 0 1n\n.model DM D(IS=1e-14)\n.op\n.end" });
            const op = flo.operatingPoint;
            if (op.worst_deviation_percent_of_full_scale > 0.5 && op.ngspice_levels_solve_the_builtin_equations !== true) throw new Error(JSON.stringify(op));
            const ok = await call("compare_with_ngspice", { netlist: "d\nV1 a 0 5\nR1 a b 1k\nR2 b 0 1k\n.op\n.end" });
            if (ok.operatingPoint.worst_deviation_percent_of_full_scale > 0.01 || "ngspice_levels_solve_the_builtin_equations" in ok.operatingPoint) throw new Error("no flag expected when the two agree: " + JSON.stringify(ok.operatingPoint));
        });
    }
    await test("fab rules: pcb_edit rules fab turns on the manufacturer limits, pcb_check lists what a fab would reject, export refuses until fixed", async () => {
        const id = (await call("pcb_create", { netlist: AMP, track_width: 0.1 })).board_id;
        await call("pcb_route", { board_id: id });
        const plain = await call("pcb_check", { board_id: id });
        const r = await call("pcb_edit", { board_id: id, actions: [{ op: "rules", fab: "generic" }] });
        if (r.results[0].fab !== "generic") throw new Error(JSON.stringify(r));
        const k = await call("pcb_check", { board_id: id });
        if (!k.counts.fab || !/Generic 2-layer prototype.*0\.1 mm wide/.test(JSON.stringify(k.issues.fab))) throw new Error(JSON.stringify([plain.counts, k.counts, k.issues.fab && k.issues.fab[0]]));
        const refused = await call("pcb_export", { board_id: id });
        if (!/rule violation/.test(refused.error || "")) throw new Error(JSON.stringify(refused).slice(0, 200));
        const bad = await call("pcb_edit", { board_id: id, actions: [{ op: "rules", fab: "nonsense" }] });
        if (!/unknown fab preset/.test(bad.error)) throw new Error(JSON.stringify(bad));
        await call("pcb_edit", { board_id: id, actions: [{ op: "rules", fab: "none" }] });
        if ((await call("pcb_check", { board_id: id })).counts.fab) throw new Error("fab off should list nothing");
    });
    await test("pcb_edit move with shove pushes copper out of the part's way and refuses what cannot work", async () => {
        const b = await call("pcb_create", { netlist: "t\nV1 a 0 1\nR1 0 b 1k\nR2 c d 1k\nV2 e 0 1\n.end", width: 50, height: 40, auto_place: false, packages: { R2: "0805" } });
        const id = b.board_id;
        await call("pcb_edit", { board_id: id, actions: [{ op: "move", ref: "V1", x: 5, y: 20 }, { op: "move", ref: "R1", x: 40, y: 20 }, { op: "move", ref: "R2", x: 20, y: 32 }, { op: "move", ref: "V2", x: 5, y: 5 }] });
        const d0 = await call("pcb_describe", { board_id: id, include: ["parts"] });
        const a1 = d0.parts_list.find(p => p.ref === "V1").pads[1], b1 = d0.parts_list.find(p => p.ref === "R1").pads[0];
        await call("pcb_edit", { board_id: id, actions: [{ op: "track", layer: "F", points: [[a1.x, a1.y], [b1.x, b1.y]], mode: "off" }] });
        const r = await call("pcb_edit", { board_id: id, actions: [{ op: "move", ref: "R2", x: 20, y: 20.8, shove: true }] });
        if (r.error || !(r.results[0].pushed.tracks > 0)) throw new Error(JSON.stringify(r).slice(0, 300));
        const k = await call("pcb_check", { board_id: id });
        if (Object.keys(k.counts).some(t => ["clearance", "short", "edge"].includes(t))) throw new Error(JSON.stringify(k.issues).slice(0, 300));
        const bad = await call("pcb_edit", { board_id: id, actions: [{ op: "move", ref: "R2", x: 35, y: 20, shove: true }] });
        if (!bad.error || !/cannot move R2/.test(bad.error)) throw new Error("moving onto R1's pad should be refused: " + JSON.stringify(bad).slice(0, 300));
        const after = await call("pcb_describe", { board_id: id, include: ["parts"] });
        if (after.parts_list.find(p => p.ref === "R2").x !== 20) throw new Error("a refused move must leave the part where it was");
    });
    server.stdin.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();

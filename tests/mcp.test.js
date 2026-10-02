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
        if (names !== "check_deck,compare_with_ngspice,list_models,monte_carlo,simulate,sweep") throw new Error(names);
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
    server.stdin.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();

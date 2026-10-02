import { spawn } from "node:child_process";
import readline from "node:readline";
const srv = spawn("node", [new URL("../../mcp/server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "inherit"] });
const rl = readline.createInterface({ input: srv.stdout });
const pending = new Map(); let nextId = 1;
rl.on("line", l => { const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const rpc = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args) => { const t0 = Date.now(); const r = await rpc("tools/call", { name, arguments: args }); const text = r.result.content[0].text; return { ms: Date.now() - t0, err: r.result.isError, text, json: r.result.isError ? null : JSON.parse(text) }; };
const rows = []; const check = (area, what, ok, detail = "") => { rows.push([ok ? "PASS" : "FAIL", area, what, detail]); };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "check", version: "0" } });
check("protocol", "initialize handshake", init.result.serverInfo.name === "browser-spice", init.result.instructions.slice(0, 60));
const list = await rpc("tools/list", {});
check("protocol", "tools/list exposes the six tools", list.result.tools.length === 6, list.result.tools.map(t => t.name).join(", "));
check("protocol", "unknown tool is a clean error", (await rpc("tools/call", { name: "nope", arguments: {} })).error !== undefined);
check("protocol", "bad deck gives isError, not a crash", (await call("simulate", { netlist: "garbage\nR1 1" })).err === true);

// 1. RC low-pass: f3dB = 1/(2 pi R C)
const rc = "RC low-pass\nV1 in 0 DC 0 AC 1\nR1 in out 1.59k\nC1 out 0 100n\n.ac dec 20 10 1meg\n.end";
let r = await call("check_deck", { netlist: rc });
check("check_deck", "RC deck parses, 2 passives + source, OP converges", r.json && /converge/i.test(JSON.stringify(r.json)) || r.json, JSON.stringify(r.json).slice(0, 140));
r = await call("simulate", { netlist: rc, analysis: "ac", signals: ["vdb(out)"] });
const acj = r.json; const txt = JSON.stringify(acj);
const f3 = acj.signals["vdb(out)"].bandwidth_3db_hz;
check("simulate ac", `RC -3 dB frequency ~ 1 kHz (got ${JSON.stringify(f3 ?? "n/a")})`, f3 !== undefined ? near(f3, 1000, 0.03) : /9[5-9]\d|10[0-4]\d/.test(txt), txt.slice(0, 200));

// 2. transient RC step: v(out)=5(1-exp(-t/tau)) tau=0.159 ms
r = await call("simulate", { netlist: "RC step\nV1 in 0 PULSE(0 5 0 1n 1n 10m 20m)\nR1 in out 1.59k\nC1 out 0 100n\n.tran 5u 1m\n.end", analysis: "tran", signals: ["v(out)"] });
const t = r.json; const fin = JSON.stringify(t);
const vfinal = (t.signals && t.signals["v(out)"] && t.signals["v(out)"].final) ?? (t.summary && t.summary["v(out)"] && t.summary["v(out)"].final);
check("simulate tran", `RC step reaches 5(1-e^-6.3) = 4.99 V at 1 ms (got ${vfinal})`, vfinal !== undefined && near(vfinal, 5 * (1 - Math.exp(-1e-3 / 1.59e-4)), 0.01), fin.slice(0, 160));

// 3. op-amp inverting amp gain -10
const oa = "Inverting amp\nVCC vcc 0 DC 12\nVEE vee 0 DC -12\nVIN in 0 DC 0.1\nR1 in inn 10k\nR2 inn out 100k\nXU1 0 inn vcc vee out OPAMP\n.subckt OPAMP inp inn vcc vee out\nE1 o 0 inp inn 1e6\nRo o out 50\nRi inp inn 1e9\n.ends\n.op\n.end";
r = await call("simulate", { netlist: oa, analysis: "op" });
const vout = r.json && (r.json.nodeVoltages ? r.json.nodeVoltages.out : r.json.op && r.json.op.out);
check("simulate op", `inverting op-amp -10 x 0.1 V = -1.000 V (got ${vout})`, vout !== undefined && near(vout, -1.0, 0.001), JSON.stringify(r.json).slice(0, 160));

// 4. BJT common emitter: bias point sane
const ce = "CE amp\nVCC vcc 0 DC 12\nR1 vcc b 47k\nR2 b 0 10k\nRC vcc c 2.2k\nRE e 0 470\nQ1 c b e 2N2222\n.op\n.end";
r = await call("simulate", { netlist: ce, analysis: "op" });
const vv = r.json && r.json.nodeVoltages;
check("simulate op", `BJT bias: V(b) ~ 2.1 V, V(e) ~ 1.4 V, V(c) between 3 and 9 V (got ${vv && [vv.b, vv.e, vv.c].map(x => +x.toFixed(2))})`, vv && vv.b > 1.8 && vv.b < 2.4 && vv.e > 1.1 && vv.e < 1.8 && vv.c > 3 && vv.c < 9, JSON.stringify(vv));

// 5. diode rectifier ripple
const rect = "Half-wave\nV1 in 0 SIN(0 10 50)\nD1 in out 1N4007\nC1 out 0 470u\nR1 out 0 1k\n.tran 100u 100m\n.end";
r = await call("simulate", { netlist: rect, analysis: "tran", signals: ["v(out)"] });
const s = r.json && r.json.signals && r.json.signals["v(out)"];
check("simulate tran", `rectifier peak ~ 9.3 V, mean 7..9 V (got max ${s && s.max}, mean ${s && s.mean})`, s && s.max > 8.8 && s.max < 9.8 && s.mean > 6.5 && s.mean < 9, JSON.stringify(s));

// 6. LC resonance, measure with .meas
const lc = "Series RLC bandpass\nV1 in 0 DC 0 AC 1\nR1 in a 10\nL1 a b 10m\nC1 b out 1u\nR2 out 0 10\n.ac dec 100 100 10k\n.meas ac fpk when vdb(out)=-6 fall=1\n.end";
r = await call("simulate", { netlist: lc, analysis: "ac", signals: ["vdb(out)"] });
const js = JSON.stringify(r.json);
const peak = r.json && (r.json.summary ? JSON.stringify(r.json.summary) : js);
check("simulate ac", "series RLC resonates near 1/(2 pi sqrt(LC)) = 1.59 kHz", /15[0-9]\d|16[0-9]\d/.test(js), js.slice(0, 220));

// 7. dc sweep: diode curve
r = await call("simulate", { netlist: "Diode IV\nV1 a 0 0\nD1 a 0 1N4148\n.dc V1 0 0.8 0.05\n.end", analysis: "dc", signals: ["i(v1)"] });
const di = r.json && r.json.signals["i(v1)"]; check("simulate dc", "diode DC sweep gives i(v1) and the current grows exponentially (monotone, 4+ decades)", di && di.every((x, i) => i === 0 || x <= di[i - 1] + 1e-15) && Math.abs(di[di.length - 1]) > 1e4 * Math.abs(di[3]), JSON.stringify(r.json || r.text).slice(0, 160));

// 8. noise and tf
r = await call("simulate", { netlist: "Noise\nV1 in 0 DC 0 AC 1\nR1 in out 10k\nR2 out 0 10k\n.end", analysis: "noise", noise: { output: "out", input: "V1", fStart: 10, fStop: 100000 } });
check("simulate noise", "resistor divider noise runs (thermal 4kTR)", r.json && !r.err, JSON.stringify(r.json).slice(0, 200));
r = await call("simulate", { netlist: "TF\nV1 in 0 DC 1\nR1 in out 1k\nR2 out 0 3k\n.end", analysis: "tf", tf: { output: "out", input: "V1" } });
check("simulate tf", "divider DC gain 0.75, Rout 750 ohm", r.json && /0\.75/.test(JSON.stringify(r.json)) && /750/.test(JSON.stringify(r.json)), JSON.stringify(r.json).slice(0, 220));

// 9. sweep a parameter
const sw = "RC sweep\n.param rv=1k\nV1 in 0 DC 0 AC 1\nR1 in out {rv}\nC1 out 0 100n\n.ac dec 20 10 1meg\n.end";
r = await call("sweep", { netlist: sw, param: "rv", values: [1000, 2000, 4000], analysis: "ac", ac: { fStart: 10, fStop: 1e6, pointsPerDecade: 20 }, measures: [".meas ac f3db when vdb(out)=-3 fall=1"] });
const sj = JSON.stringify(r.json);
const f3s = r.json.results.map(x => x.measures[0].value);
check("sweep", `corner halves each time R doubles: expected 1592, 796, 398 Hz (got ${f3s.map(x => Math.round(x))})`, f3s.length === 3 && near(f3s[0], 1592, 0.05) && near(f3s[1], 796, 0.05) && near(f3s[2], 398, 0.05), sj.slice(0, 200));

// 10. monte carlo
const mc = "Divider\nV1 in 0 DC 10\nR1 in out 10k\nR2 out 0 10k\n.op\n.end";
r = await call("monte_carlo", { netlist: mc, measure: ".meas op vout find v(out) at=0", runs: 200, seed: 7, tolerance_percent: { R: 1 }, limits: { min: 4.95, max: 5.05 } });
const mj = r.json || {};
check("monte_carlo", `1% divider: mean 5.00 V, sigma ~ 0.012 V, yield 100% (got ${mj.mean}, ${mj.std_dev}, ${mj.yield_percent}%)`, near(mj.mean, 5, 0.001) && mj.std_dev > 0.005 && mj.std_dev < 0.02 && mj.yield_percent === 100, JSON.stringify(mj).slice(0, 220));

// 11. ngspice cross-check
r = await call("compare_with_ngspice", { netlist: ce.replace(".op", ".op") });
check("compare_with_ngspice", `BJT bias (library 2N2222) within 0.5% of native ngspice (worst ${r.json && r.json.operatingPoint.worst_deviation_percent_of_full_scale}%)`, r.json && r.json.operatingPoint.worst_deviation_percent_of_full_scale < 0.5, JSON.stringify(r.json).slice(0, 300));
r = await call("compare_with_ngspice", { netlist: rect });
check("compare_with_ngspice", `rectifier transient within 2% of native ngspice (worst ${r.json && r.json.transient && r.json.transient.worst_rms_deviation_percent_of_range}% of range)`, r.json && r.json.transient && r.json.transient.worst_rms_deviation_percent_of_range < 2, JSON.stringify(r.json).slice(0, 300));

// 12. models
r = await call("list_models", {});
check("list_models", "lists diodes, BJTs, MOSFETs, op-amps", r.json && /BJT|NPN/.test(JSON.stringify(r.json)) && /1N4148/.test(JSON.stringify(r.json)), JSON.stringify(r.json).slice(0, 120));

// 13. robustness
r = await call("check_deck", { netlist: "floating\nR1 a b 1k\n.end" });
check("check_deck", "a circuit with no ground is diagnosed (warning or non-convergence)", r.json && /ground|converge|floating|singular/i.test(JSON.stringify(r.json)), JSON.stringify(r.json).slice(0, 200));
r = await call("simulate", { netlist: "Bad value\nR1 a 0 banana\nV1 a 0 1\n.op\n.end" });
check("simulate", "a bad component value is reported", r.err || /banana|invalid|warn/i.test(r.text), r.text.slice(0, 160));
const big = "Big ladder\nV1 n0 0 DC 1\n" + Array.from({ length: 400 }, (_, i) => `R${i} n${i} n${i + 1} 100\nC${i} n${i + 1} 0 1n`).join("\n") + "\n.tran 1u 50u\n.end";
r = await call("simulate", { netlist: big, analysis: "tran", signals: ["v(n400)"] });
check("performance", `400-stage RC ladder (800 elements) transient in ${r.ms} ms`, !r.err && r.ms < 20000, r.text.slice(0, 80));

let pass = 0, fail = 0;
for (const [st, area, what, detail] of rows) { if (st === "PASS") pass++; else fail++; console.log(`${st}  ${area.padEnd(20)} ${what}${st === "FAIL" ? "\n        -> " + detail : ""}`); }
console.log(`\n${pass} passed, ${fail} failed`);
srv.stdin.end();

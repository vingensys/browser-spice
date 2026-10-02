import { spawn } from "node:child_process";
import readline from "node:readline";
const srv = spawn("node", [new URL("../../mcp/server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "inherit"] });
const rl = readline.createInterface({ input: srv.stdout });
const pending = new Map(); let nextId = 1;
rl.on("line", l => { const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const rpc = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args) => { const t0 = Date.now(); const r = await rpc("tools/call", { name, arguments: args }); const text = r.result.content[0].text; return { ms: Date.now() - t0, err: r.result.isError, text, json: r.result.isError ? null : JSON.parse(text) }; };
const rows = []; const check = (area, what, ok, detail = "") => rows.push([ok ? "PASS" : "FAIL", area, what, detail]);
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1e-12, Math.abs(b));
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "c", version: "0" } });
let r;
// thermal noise of 5 kOhm: sqrt(4kTR)
r = await call("simulate", { netlist: "Noise\nV1 in 0 DC 0 AC 1\nR1 in out 10k\nR2 out 0 10k\n.end", analysis: "noise", noise: { output: "out", input: "V1", fStart: 10, fStop: 100000 } });
const n0 = r.json && r.json.output_noise_v_per_rthz[3], want = Math.sqrt(4 * 1.380649e-23 * 300.15 * 5000);
check("noise", `10k||10k thermal noise = ${(want * 1e9).toFixed(2)} nV/rtHz (got ${(n0 * 1e9).toFixed(2)})`, near(n0, want, 0.02), JSON.stringify(r.json).slice(0, 200));
// boost converter: D=0.5, Vin 5 -> ~10 V (library IRF540 + 1N5819 from the built-in models, no .model cards)
const boost = "Boost\nVIN in 0 DC 5\nL1 in sw 100u\nM1 sw g 0 0 IRF540\nVG g 0 PULSE(0 10 0 20n 20n 5u 10u)\nD1 sw out 1N5819\nC1 out 0 100u\nRL out 0 50\n.tran 100n 3m\n.meas tran vavg avg v(out) from=2m to=3m\n.end";
r = await call("simulate", { netlist: boost, analysis: "tran", signals: ["v(out)"], maxPoints: 20 });
const mv = r.json && r.json.measures && r.json.measures[0] && r.json.measures[0].value;
check("boost converter", `5 V -> boost at D=0.5 gives ~9-10 V average (got ${mv}), library parts resolved (${r.json && r.json.warnings.length} warnings)`, mv > 8.5 && mv < 10.2 && r.json.warnings.length === 0, JSON.stringify(r.json).slice(0, 200));
r = await call("compare_with_ngspice", { netlist: boost });
check("boost converter", `time-averages agree with native ngspice within 1% (worst mean dev ${r.json && r.json.transient && r.json.transient.worst_mean_deviation_percent_of_range}%; edge-timing rms ${r.json && r.json.transient.worst_rms_deviation_percent_of_range}%)`, r.json && r.json.transient && r.json.transient.worst_mean_deviation_percent_of_range < 1, JSON.stringify(r.json).slice(0, 300));
// sweep duty: pulse width as a param
const dsw = boost.replace("PULSE(0 10 0 20n 20n 5u 10u)", "PULSE(0 10 0 20n 20n {pw} 10u)").replace("VIN in 0 DC 5", ".param pw=5u\nVIN in 0 DC 5");
r = await call("sweep", { netlist: dsw, param: "pw", values: [3e-6, 5e-6, 6e-6], analysis: "tran", tran: { tStop: 3e-3, tStep: 1e-7 }, measures: [".meas tran vavg avg v(out) from=2m to=3m"] });
const vs = r.json && r.json.results.map(x => x.measures[0].value);
const ideal = [3, 5, 6].map(pw => 5 / (1 - pw / 10));
check("duty sweep", `boost gain rises with duty (within -15%/+12% of the ideal 1/(1-D) at 3 ms, still settling): ideal ${ideal.map(x => x.toFixed(1))}, got ${vs && vs.map(x => x.toFixed(1))}`, vs && vs[0] < vs[1] && vs[1] < vs[2] && vs.every((x, i) => x > ideal[i] * 0.85 && x < ideal[i] * 1.12), JSON.stringify(vs));
// switched capacitor / behavioral source / subckt / param expression
r = await call("simulate", { netlist: "Behavioural\nV1 in 0 DC 3\nB1 out 0 V = v(in)*v(in) + 1\nR1 out 0 1k\n.op\n.end", analysis: "op" });
check("behavioural", "B source: 3^2 + 1 = 10 V", r.json && near(r.json.nodeVoltages.out, 10, 1e-6), JSON.stringify(r.json).slice(0, 160));
r = await call("simulate", { netlist: "Param expr\n.param rt={2*1k} k=3\nV1 in 0 DC 6\nR1 in out {rt}\nR2 out 0 {rt/k*2}\n.op\n.end", analysis: "op" });
check("params", "{expressions} in values: 2k and 1.333k divider: 6*(1.333/3.333)=2.4 V", r.json && near(r.json.nodeVoltages.out, 2.4, 1e-4), JSON.stringify(r.json).slice(0, 160));
r = await call("simulate", { netlist: "Subckt\n.subckt half a b out\nR1 a out 1k\nR2 out b 1k\n.ends\nV1 in 0 DC 8\nX1 in 0 mid half\n.op\n.end", analysis: "op" });
check("subckt", "X instance of a .subckt: 8 V halved to 4 V", r.json && near(r.json.nodeVoltages.mid, 4, 1e-6), JSON.stringify(r.json).slice(0, 160));
// temperature
const tn = (t) => `Diode temp\nV1 a 0 DC 5\nR1 a d 4.3k\nD1 d 0 1N4148\n.temp ${t}\n.op\n.end`;
const v27 = (await call("simulate", { netlist: tn(27), analysis: "op" })).json.nodeVoltages.d, v85 = (await call("simulate", { netlist: tn(85), analysis: "op" })).json.nodeVoltages.d;
check("temperature", `diode drop falls ~2 mV/K: 27C ${v27.toFixed(3)} V -> 85C ${v85.toFixed(3)} V (expect -90..-150 mV)`, v27 - v85 > 0.08 && v27 - v85 < 0.16, "");
// op-amp slew/gain-bandwidth: non-inverting x10 with the 741-like macro: f3dB ~ GBW/10 = 100 kHz via library op amp? use .subckt single pole
const gbw = "GBW\nV1 in 0 DC 0 AC 1\nE1 o 0 in fb 1e5\nRp o a 1k\nCp a 0 1.59u\nE2 b 0 a 0 1\nRo b out 1\nR1 out fb 9k\nR2 fb 0 1k\n.ac dec 20 10 10meg\n.end";
r = await call("simulate", { netlist: gbw, analysis: "ac", signals: ["vdb(out)"] });
const s = r.json && r.json.signals["vdb(out)"];
check("feedback amp", `closed loop gain 20 dB (got ${s && s.gain_db[0]}), -3 dB near GBW/10 = 1 MHz*? (got ${s && s.bandwidth_3db_hz} Hz)`, s && near(s.gain_db[0], 20, 0.01) && s.bandwidth_3db_hz > 5e4 && s.bandwidth_3db_hz < 5e6, JSON.stringify(s).slice(0, 120));
// error handling
for (const [what, args, re] of [["unknown node in .meas", { netlist: "x\nV1 a 0 1\nR1 a 0 1k\n.op\n.end", analysis: "op", measures: [".meas op q find v(zzz)"] }, /zzz|unknown/i], ["tran without step", { netlist: "x\nV1 a 0 1\nR1 a 0 1k\n.end", analysis: "tran" }, /tStop|tStep|needs/i], ["ac on a nonlinear DC-unsolvable deck", { netlist: "x\nI1 0 a 1\nI2 a 0 2\n.end", analysis: "op" }, /./]])
  { const rr = await call("simulate", args); check("errors", `${what} is reported usefully`, rr.err ? re.test(rr.text) : (rr.json && /warn|error|singular|converge/i.test(JSON.stringify(rr.json))), rr.text.slice(0, 120)); }
let pass = 0, fail = 0;
for (const [st, area, what, detail] of rows) { st === "PASS" ? pass++ : fail++; console.log(`${st}  ${area.padEnd(18)} ${what}${st === "FAIL" ? "\n        -> " + detail : ""}`); }
console.log(`\n${pass} passed, ${fail} failed`);
srv.stdin.end();

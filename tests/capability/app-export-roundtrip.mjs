// Decks exported by the web app (File > Export) run through the MCP server and native ngspice.
import { spawn } from "node:child_process";
import readline from "node:readline";
const srv = spawn("node", [new URL("../../mcp/server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "inherit"] });
const rl = readline.createInterface({ input: srv.stdout });
const pending = new Map(); let nextId = 1;
rl.on("line", l => { const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const rpc = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); const text = r.result.content[0].text; return { err: r.result.isError, text, json: r.result.isError ? null : JSON.parse(text) }; };
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "c", version: "0" } });
const H = "* Browser SPICE export\n";
const D = {
 "ce-amp": [H + "V1 1 0 DC 12\nV2 2 0 SIN(0 0.005 1000 0 0 0) AC 0.005\nC1 2 3 0.00001\nR1 1 3 47000\nR2 3 0 10000\nR3 1 4 2200\nQ1 4 3 5 2N3904\nR4 5 0 470\nC2 5 0 0.0001\n.model 2N3904 NPN(IS=6.734e-15 BF=416.4 BR=0.7371 NF=1 NR=1 VAF=74.03 CJE=4.493e-12 VJE=0.75 MJE=0.2593 CJC=3.638e-12 VJC=0.75 MJC=0.3085 TF=3.012e-10 TR=2.395e-7)\n", ".tran 10u 5m", { "4": 5.6521, "5": 1.35925, "3": 2.05078 }],
 "inverting-opamp": [H + "V1 1 0 SIN(0 0.5 1000 0 0 0) AC 0.5\nR1 1 2 1000\nR2 2 3 10000\nXU1 0 2 3 XU1_VP XU1_VN OPAMP_LM741\nR3 3 0 10000\nVXU1P XU1_VP 0 DC 15\nVXU1N XU1_VN 0 DC -15\n.subckt OPAMP_LM741 inp inn out vcc vee\nRin inp inn 2000000\nGm 0 a inp inn 1m\nRp a 0 200000000\nCp a 0 1.59155e-10\nBout b 0 V=min(max(V(a),V(vee)+1.5),V(vcc)-1.5)\nRo b out 75\n.ends OPAMP_LM741\n", ".tran 10u 3m", {}],
 "jfet-amp": [H + "V1 1 0 DC 15\nR1 1 2 10000\nJQ1 2 3 4 J201\nR2 4 0 1000\nC1 4 0 0.0001\nV2 5 0 SIN(0 0.05 1000 0 0 0) AC 0.05\nC2 5 3 0.000001\nR3 3 0 1000000\n.model J201 NJF(VTO=-0.93 BETA=0.00107 LAMBDA=0.00675 RD=10 RS=12 IS=1.72e-15 CGS=1e-12 CGD=1e-12 PB=0.8)\n", ".tran 10u 4m", { "2": 11.36618, "4": 0.36338 }],
 "boost": [H + "V1 1 0 DC 5\nL1 1 2 0.0001\nMQ1 2 3 0 0 IRF540 W=0.000001 L=0.000001\nCMQ1_GS 3 0 1.6e-9\nCMQ1_GD 3 2 1e-10\nDMQ1_BD 0 2 BD_MQ1\nD1 2 4 1N5819\nC1 4 0 0.0001\nR1 4 0 50\nV2 3 0 PULSE(0 10 0 2e-8 2e-8 0.00001 0.00002)\n.model BD_MQ1 D(IS=1e-11 N=1.2 RS=0.01)\n.model IRF540 NMOS(LEVEL=1 VTO=3.5 KP=3.5 LAMBDA=0.005 RD=0.008 RS=0.004)\n.model 1N5819 D(IS=0.0000317 N=1.373 RS=0.0432 BV=40 IBV=0.001 CJO=1.1e-10 VJ=0.34 M=0.38)\n", ".tran 100n 2m", { "4": 4.71191 }],
 "half-wave": [H + "V1 1 0 SIN(0 10 50 0 0 0) AC 10\nD1 1 2 1N4007\nR1 2 0 1000\nC1 2 0 0.0001\n.model 1N4007 D(IS=7.69e-11 N=1.45 RS=0.0342 BV=1000 IBV=0.000005 CJO=3.98e-11 VJ=0.7 M=0.333 TT=0.00000432)\n", ".tran 50u 60m", {}],
 "psu": [H + "V1 1 0 SIN(0 36 50 0 0 0) AC 36\nRTR1_P 1 TR1_p 0.5\nRTR1_S 2 TR1_s 0.5\nLTR1_P TR1_p 0 5\nLTR1_S TR1_s 3 1.25\nKTR1 LTR1_P LTR1_S 0.999\nDBR1_D1 2 4 1N4007\nDBR1_D2 3 4 1N4007\nDBR1_D3 0 2 1N4007\nDBR1_D4 0 3 1N4007\nC1 4 0 0.001\nBU1_T U1_o 0 V=V(0)+0.5*(5+(V(4)-V(0)-2)-sqrt((5-(V(4)-V(0)-2))*(5-(V(4)-V(0)-2))+0.0025))\nRU1_O U1_o 5 0.05\nBU1_I 4 0 I=(V(U1_o)-V(5))/0.05+0.005\nR1 5 0 100\n.model 1N4007 D(IS=7.69e-11 N=1.45 RS=0.0342 BV=1000 IBV=0.000005 CJO=3.98e-11 VJ=0.7 M=0.333 TT=0.00000432)\n", ".tran 50u 80m", {}],
 "scr-lamp": [H + "V1 1 0 SIN(0 24 50 0 0 0) AC 24\nRLP1 1 2 14.4\nXSCR1 2 0 3 SCR_C106D\nV2 4 0 PULSE(0 4 0.003 0.000001 0.000001 0.0005 0.02)\nR1 4 3 100\n.subckt SCR_C106D a k g\nRg g k 100\nVs a a1 0\nCx x 0 1n\nBx 0 x I = 1m*(0.5*(1+tanh((v(a1,k)-1)/(0.05)))*0.5*(1+tanh((v(g,k)/100-0.0002)/(0.00002)))*(1-min(max(v(x),0),1))-0.5*(1+tanh((0.003-i(Vs))/(0.0003)))*min(max(v(x),0),1))\nBak a1 k I = min(max(v(x),0),1)*max(v(a1,k)-1,0)/0.08+(1-min(max(v(x),0),1))*1e-9*v(a1,k)\n.ends SCR_C106D\n", ".tran 20u 60m", {}],
};
let pass = 0, fail = 0; const row = (ok, s) => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + s); };
for (const [id, [body, tran, expectOp]] of Object.entries(D)) {
  const deck = body + `.op\n${tran}\n.end`;
  const c = await call("check_deck", { netlist: deck });
  row(c.json && c.json.ok, `${id}: exported deck is accepted by the MCP engine (${c.json ? Object.entries(c.json.elements).map(([k, v]) => v + " " + k).join(", ") : c.text.slice(0, 80)}; ${c.json && c.json.warnings.length} warnings)`);
  if (Object.keys(expectOp).length) {
    const s = await call("simulate", { netlist: deck, analysis: "op" });
    const worst = Math.max(...Object.entries(expectOp).map(([n, v]) => Math.abs((s.json.nodeVoltages[n] ?? 1e9) - v)));
    row(worst < 5e-3, `${id}: MCP operating point equals the one the web app showed (worst node difference ${worst.toExponential(1)} V)`);
  }
  const n = await call("compare_with_ngspice", { netlist: deck, ngspice_method: id === "psu" ? "gear" : "trap" });   // the supply needs ngspice's damped integration (see AUDIT: its trapezoidal rule rings on the floating secondary)
  if (n.err) { row(false, `${id}: ngspice comparison failed: ${n.text.slice(0, 120)}`); continue; }
  const t = n.json.transient;
  const floating = id === "psu";   // floating secondary nodes: any level within the current tolerance is a DC solution, so only the waveforms are compared
  row((floating || n.json.operatingPoint.worst_deviation_percent_of_full_scale < 0.5) && t && t.worst_mean_deviation_percent_of_range < 1.5 && (!floating || t.worst_rms_deviation_percent_of_range < 2), `${id}: native ngspice agrees${floating ? " on the waveforms with Gear integration, rms below 2% (the floating-node OP is not compared)" : ""} (OP ${n.json.operatingPoint.worst_deviation_percent_of_full_scale}% of full scale; transient mean ${t && t.worst_mean_deviation_percent_of_range}%, rms ${t && t.worst_rms_deviation_percent_of_range}% of range at ${t && t.at_node})`);
}
console.log(`\n${pass} passed, ${fail} failed`);
srv.stdin.end();

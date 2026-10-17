// ROM / RAM chips: the image parser, the chip state machines, and the chips inside the engine (bidirectional bus included).
//   node tests/memory.test.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const files = ["js/utils/complex.js", "js/utils/units.js", "js/sim/linalg.js", "js/sim/devices.js", "js/sim/logic-ics.js", "js/sim/expression.js", "js/sim/devices-extra.js", "js/sim/models.js", "js/sim/models-parts.js", "js/sim/engine.js"];
const { SimCircuit, SimEngine, VoltageSource, Waveform, DigitalIC, LOGIC_ICS, LogicIC } =
    new Function(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + "\nreturn { SimCircuit, SimEngine, VoltageSource, Waveform, DigitalIC, LOGIC_ICS, LogicIC };")();
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const byte = (out, n = 8, pre = "D") => { let v = 0; for (let i = 0; i < n; i++) { if (out[pre + i] === "Z") return "Z"; v |= out[pre + i] << i; } return v; };

// ---- the image parser
{
    const p = (t, n = 16, b = 8) => Array.from(LogicIC.parseMemory(t, n, b));
    check("hex bytes, spaces / commas / newlines, 0x and $ prefixes", p("00 01,0x02\n$03 ff").slice(0, 5).join() === "0,1,2,3,255");
    check("'addr:' at the start of a line sets the address", p("4: aa bb\n0: 11").slice(0, 7).join() === "17,0,0,0,170,187,0");
    check("comments are ignored", p("; header\n01 02 # tail?\n03", 4).join() === "1,2,3,0");
    check("Intel HEX (data and EOF records, extended addresses)", p(":04000000AABBCCDD00\n:00000001FF", 8).slice(0, 5).join() === "170,187,204,221,0");
    check("an image longer than the chip is cut off", p("01 02 03 04 05", 3).join() === "1,2,3");
    check("empty text is all zeros", p("").every(x => x === 0) && p(null).length === 16);
    check("4-bit words are masked", p("ff 1f", 2, 4).join() === "15,15");
}

// ---- ROM (27C16): contents, enables
{
    const rd = (a, ce = 0, oe = 0) => { const v = { CE_N: ce, OE_N: oe }; for (let i = 0; i < 11; i++) v["A" + i] = (a >> i) & 1; return v; };
    const img = "11 22 33 44\n10: A5 5A";
    const o = LogicIC.run("27C16", [rd(0), rd(3), rd(0x10), rd(0x11), rd(5), rd(0, 1), rd(0, 0, 1)], img);
    check("a ROM reads the word at the address", [0, 1, 2, 3].map(i => byte(o[i])).join() === [0x11, 0x44, 0xA5, 0x5A].join(), JSON.stringify(o.slice(0, 4).map(x => byte(x))));
    check("an unwritten address reads 0", byte(o[4]) === 0);
    check("the outputs float when CE or OE is inactive", byte(o[5]) === "Z" && byte(o[6]) === "Z");
    const v15 = { CE_N: 0, OE_N: 0 }; for (let i = 0; i < 15; i++) v15["A" + i] = 1;
    const big = LogicIC.run("27C256", [v15], "7FFF: 9C");
    check("27C256 addresses 32K (A14 reaches the last word)", byte(big[0]) === 0x9C, byte(big[0]));
    check("PROM 74188 (32 x 8) reads and floats when G is inactive", byte(LogicIC.run("74188", [{ A0: 1, A1: 0, A2: 0, A3: 0, A4: 0, G_N: 0 }], "00 77")[0]) === 0x77 && byte(LogicIC.run("74188", [{ G_N: 1 }])[0]) === "Z");
}

// ---- RAM (6116) as a chip
{
    const cyc = (a, d, cs, oe, we) => { const v = { CS_N: cs, OE_N: oe, WE_N: we }; for (let i = 0; i < 11; i++) v["A" + i] = (a >> i) & 1; for (let i = 0; i < 8; i++) v["D" + i] = (d >> i) & 1; return v; };
    const o = LogicIC.run("6116", [
        cyc(5, 0xA5, 0, 1, 1),          // idle, bus driven by someone
        cyc(5, 0xA5, 0, 1, 0),          // WE low: writing (the bus is not driven by the chip)
        cyc(5, 0xA5, 0, 1, 1),          // WE rises: the write completes
        cyc(5, 0, 0, 0, 1),             // read it back
        cyc(6, 0, 0, 0, 1),             // another address
        cyc(5, 0, 1, 0, 1),             // deselected
        cyc(5, 0x3C, 0, 1, 0),          // write again ...
        cyc(5, 0x3C, 1, 1, 0),          // ... ended by CS rising, with WE low
        cyc(5, 0, 0, 0, 1)
    ]);
    check("a RAM does not drive the bus while writing or while OE is inactive", byte(o[1]) === "Z" && byte(o[0]) === "Z");
    check("the word written at WE's rising edge reads back", byte(o[3]) === 0xA5, byte(o[3]));
    check("other addresses are untouched (0), a deselected chip floats", byte(o[4]) === 0 && byte(o[5]) === "Z");
    check("a write can also end with CS rising while WE is low", byte(o[8]) === 0x3C, byte(o[8]));
    const init = LogicIC.run("6116", [cyc(1, 0, 0, 0, 1), cyc(2, 0, 0, 0, 1)], "11 22 33");
    check("a RAM starts with its initial contents", byte(init[0]) === 0x22 && byte(init[1]) === 0x33);
    // the state is shared when nothing is written (large memories must not be copied every step)
    const spec = LOGIC_ICS["6116"], st0 = spec.init(), v = cyc(1, 0, 0, 0, 1);
    check("a step that writes nothing returns the very same state object", spec.step(st0, v, v, null).st === st0);
    const w = spec.step(st0, cyc(3, 9, 0, 1, 1), cyc(3, 9, 0, 1, 0), null);
    check("a write returns a new state and leaves the old one alone", w.st !== st0 && w.st.w[3] === 9 && Object.keys(st0.w).length === 0);
}

// ---- 7489 (16 x 4, complemented outputs)
{
    const c = (a, di, me, we) => ({ A0: a & 1, A1: (a >> 1) & 1, A2: (a >> 2) & 1, A3: (a >> 3) & 1, DI1: di & 1, DI2: (di >> 1) & 1, DI3: (di >> 2) & 1, DI4: (di >> 3) & 1, ME_N: me, WE_N: we });
    const o = LogicIC.run("7489", [c(2, 0b0101, 0, 0), c(2, 0b1111, 0, 1), c(3, 0, 0, 1), c(2, 0, 1, 1)]);
    const val = (x) => [1, 2, 3, 4].reduce((s, i) => s | (x["DO" + i] << (i - 1)), 0);
    check("7489: writing shows the complement of the inputs", val(o[0]) === 0b1010, val(o[0]));
    check("7489: reading shows the complement of the stored word", val(o[1]) === 0b1010, val(o[1]));
    check("7489: an empty word reads as all ones; ME high gives all ones", val(o[2]) === 15 && val(o[3]) === 15);
}

// ---- inside the engine: a ROM on a counter-driven address, and a RAM sharing a bus with a driver
const dc = (v) => ({ wave: Waveform.dc(v) });
const pwl = (pts) => ({ wave: Waveform.pwl(pts) });
const lvl = (r, node, t) => { const i = r.timePoints.findIndex(x => x >= t); return r.nodeHistories[node][i] > 2.5 ? 1 : 0; };
const busAt = (r, nodes, t) => { let v = 0; nodes.forEach((n, i) => { v |= lvl(r, n, t) << i; }); return v; };
{
    const pins = LogicIC.pins(LOGIC_ICS["27C16"]), c = new SimCircuit();
    c.add(new DigitalIC("U1", pins.map(p => `p_${p}`), LOGIC_ICS["27C16"], { vcc: 5, mem: "DE AD BE EF" }));
    c.add(new VoltageSource("VA0", ["p_A0", "0"], pwl([[0, 0], [1e-6, 0], [1.001e-6, 5], [4e-6, 5]])));
    c.add(new VoltageSource("VA1", ["p_A1", "0"], pwl([[0, 0], [2e-6, 0], [2.001e-6, 5], [4e-6, 5]])));
    const r = new SimEngine(c).transient({ tStop: 4e-6, tStep: 20e-9, uic: true });
    const bus = Array.from({ length: 8 }, (_, i) => `p_D${i}`);
    check("a ROM in the engine: address 0 gives DE, then 1 gives AD, then 3 gives EF", busAt(r, bus, 0.5e-6) === 0xDE && busAt(r, bus, 1.5e-6) === 0xAD && busAt(r, bus, 3e-6) === 0xEF, [0.5e-6, 1.5e-6, 3e-6].map(t => busAt(r, bus, t).toString(16)));
}
{
    // RAM + a 74244 that drives its data bus while WE is low (G = WE_N), data 0xA5, address 3 then 4 then 3 again
    const ram = LOGIC_ICS["6116"], drv = LOGIC_ICS["74244"], c = new SimCircuit();
    const rp = LogicIC.pins(ram), dp = LogicIC.pins(drv);
    const bus = (i) => `bus${i}`;
    c.add(new DigitalIC("U1", rp.map(p => (/^D\d$/.test(p) ? bus(p.slice(1)) : `r_${p}`)), ram, { vcc: 5, mem: "" }));
    c.add(new DigitalIC("U2", dp.map(p => (/^Y\d$/.test(p) ? bus(Number(p.slice(1)) - 1) : `d_${p}`)), drv, { vcc: 5 }));
    const bits = [1, 0, 1, 0, 0, 1, 0, 1];                                // 0xA5, least significant bit first
    bits.forEach((b, i) => c.add(new VoltageSource(`VD${i}`, [`d_A${i + 1}`, "0"], dc(b * 5))));
    const we = pwl([[0, 5], [10e-6, 5], [10.001e-6, 0], [30e-6, 0], [30.001e-6, 5], [100e-6, 5]]);
    c.add(new VoltageSource("VWE", ["r_WE_N", "0"], we));
    c.add(new VoltageSource("VG1", ["d_G1_N", "0"], we)); c.add(new VoltageSource("VG2", ["d_G2_N", "0"], we));
    // address 3 until 40 us, 4 until 70 us, then 3 again
    const aw = (i) => { const a = (n) => ((n >> i) & 1) * 5; return pwl([[0, a(3)], [40e-6, a(3)], [40.001e-6, a(4)], [70e-6, a(4)], [70.001e-6, a(3)], [200e-6, a(3)]]); };
    for (let i = 0; i < 11; i++) c.add(new VoltageSource(`VAD${i}`, [`r_A${i}`, "0"], i < 3 ? aw(i) : dc(0)));
    const r = new SimEngine(c).transient({ tStop: 100e-6, tStep: 50e-9, uic: true });
    const nodes = Array.from({ length: 8 }, (_, i) => bus(i));
    check("the driver puts 0xA5 on the bus while WE is low", busAt(r, nodes, 20e-6) === 0xA5, busAt(r, nodes, 20e-6).toString(16));
    check("after WE rises the RAM drives the same word back (written at address 3)", busAt(r, nodes, 35e-6) === 0xA5, busAt(r, nodes, 35e-6).toString(16));
    check("another address reads 0 (nothing was written there)", busAt(r, nodes, 55e-6) === 0, busAt(r, nodes, 55e-6).toString(16));
    check("back at address 3 the word is still there", busAt(r, nodes, 90e-6) === 0xA5, busAt(r, nodes, 90e-6).toString(16));
    const el = c.elements.find(e => e.name === "U1");
    check("memoryImage() has the written word", el.memoryImage()[3] === 0xA5 && el.memoryImage()[4] === 0 && el.memoryImage().length === 2048);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

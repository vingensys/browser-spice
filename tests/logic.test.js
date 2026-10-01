// Logic IC models: node tests/logic.test.js
const fs = require("fs"), path = require("path");
const { LOGIC_ICS, LogicIC } = new Function(fs.readFileSync(path.join(__dirname, "..", "js/sim/logic-ics.js"), "utf8") + "\nreturn { LOGIC_ICS, LogicIC };")();

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const eq = (a, b, what = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const bits = (o, names) => names.reduce((a, n, i) => a | (o[n] << i), 0);
// a clock pulse: low then high (rising edge on the second vector), optionally with other inputs
const clk = (pin, extra = {}) => [{ ...extra, [pin]: 0 }, { ...extra, [pin]: 1 }];
const nclk = (pin, extra = {}) => [{ ...extra, [pin]: 1 }, { ...extra, [pin]: 0 }];   // falling edge

console.log("logic ICs");
test("every chip lists its pins and initialises", () => {
    for (const [k, s] of Object.entries(LOGIC_ICS)) {
        const pins = LogicIC.pins(s);
        if (new Set(pins).size !== pins.length) throw new Error(`${k} has duplicate pins`);
        const outs = LogicIC.run(k, [{}])[0];
        for (const n of s.right) if (!(n in outs)) throw new Error(`${k} does not drive ${n}`);
    }
    if (Object.keys(LOGIC_ICS).length < 28) throw new Error("expected the full library, got " + Object.keys(LOGIC_ICS).length);
});

test("7474: toggles as a divider, preset and clear win", () => {
    const seqv = [];
    for (let i = 0; i < 4; i++) seqv.push(...clk("1CLK", { "1D": 0 }));           // D low: Q follows D, stays 0
    let outs = LogicIC.run("7474", seqv);
    eq(outs[outs.length - 1]["1Q"], 0);
    outs = LogicIC.run("7474", [{ "1D": 1, "1CLK": 0 }, { "1D": 1, "1CLK": 1 }, { "1D": 0, "1CLK": 0 }, { "1D": 0, "1CLK": 1 }]);
    eq(outs.map(o => o["1Q"]), [0, 1, 1, 0], "Q follows D on the rising edge only");
    outs = LogicIC.run("7474", [{ "1PRE_N": 0 }, { "1PRE_N": 1 }, { "1CLR_N": 0 }]);
    eq(outs.map(o => o["1Q"]), [1, 1, 0], "preset / clear");
    eq(LogicIC.run("7474", [{ "1PRE_N": 0, "1CLR_N": 0 }])[0]["1QN"], 1, "both active: Q and QN high");
});

test("74112: JK falling-edge truth table", () => {
    const run = (j, k) => LogicIC.run("74112", [{ "1J": j, "1K": k, "1CLK_N": 1 }, { "1J": j, "1K": k, "1CLK_N": 0 }])[1]["1Q"];
    eq([run(0, 0), run(1, 0), run(0, 1), run(1, 1)], [0, 1, 0, 1]);
    const t = LogicIC.run("74112", [...nclk("1CLK_N", { "1J": 1, "1K": 1 }), ...nclk("1CLK_N", { "1J": 1, "1K": 1 })]);
    eq(t.map(o => o["1Q"]), [0, 1, 1, 0], "J = K = 1 toggles on each falling edge");
});

test("7493 and 7490: ripple counters count and reset", () => {
    let v = []; for (let i = 0; i < 11; i++) { v.push(...nclk("CKA_N")); }
    // chain: QA drives CKB -- emulate by feeding CKB falling edges when QA falls
    const spec = LOGIC_ICS["7493"];
    let st = spec.init(), p = { CKA_N: 1, CKB_N: 1, R01: 0, R02: 0 }, last;
    const tick = (a, b) => { const vv = { CKA_N: a, CKB_N: b, R01: 0, R02: 0 }; const r = spec.step(st, vv, p); st = r.st; p = vv; return r.out; };
    for (let i = 0; i < 11; i++) { tick(1, 1); const o = tick(0, 1); last = o; /* QA falls when it goes 1 -> 0 */ if (!o.QA) { tick(0, 1); tick(0, 0); } }
    eq(bits(last, ["QA", "QB", "QC", "QD"]) & 1, 1, "QA after an odd number of pulses");
    const rst = LogicIC.run("7493", [...nclk("CKA_N"), { R01: 1, R02: 1 }]);
    eq(bits(rst[rst.length - 1], ["QA", "QB", "QC", "QD"]), 0, "reset");
    // 7490 as BCD: QA -> CKB
    const bcd = LOGIC_ICS["7490"];
    let s = bcd.init(), q = { CKA_N: 1, CKB_N: 1, R01: 0, R02: 0, R91: 0, R92: 0 }, seen = [];
    const step = (v) => { const r = bcd.step(s, v, q); s = r.st; q = v; return r.out; };
    for (let i = 0; i < 12; i++) {
        let o = step({ ...q, CKA_N: 1 }); const before = bits(o, ["QA", "QB", "QC", "QD"]);
        o = step({ ...q, CKA_N: 0 });
        if (before & 1) { step({ ...q, CKB_N: 1 }); o = step({ ...q, CKB_N: 0 }); }   // QA fell: clock the ÷5
        seen.push(bits(o, ["QA", "QB", "QC", "QD"]));
    }
    eq(seen.slice(0, 11), [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1], "BCD sequence wraps at 10");
    const nine = bcd.step(bcd.init(), { R91: 1, R92: 1, R01: 0, R02: 0, CKA_N: 1, CKB_N: 1 }, {});
    eq(bits(nine.out, ["QA", "QB", "QC", "QD"]), 9, "set to nine");
});

test("74161 counts 0..15, loads, enables, clears; 74160 wraps at 10; 74163 clears synchronously", () => {
    const step161 = (key, vecs) => LogicIC.run(key, vecs);
    const pulses = (n, extra = {}) => { const o = []; for (let i = 0; i < n; i++) o.push(...clk("CLK", extra)); return o; };
    let o = step161("74161", pulses(5));
    eq(bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), 5, "five pulses");
    o = step161("74161", pulses(15));
    eq([bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), o[o.length - 1].RCO], [15, 1], "RCO at 15");
    o = step161("74161", pulses(16));
    eq(bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), 0, "wraps");
    o = step161("74161", [...pulses(3), { A: 0, B: 1, C: 1, D: 0, LOAD_N: 0, CLK: 0 }, { A: 0, B: 1, C: 1, D: 0, LOAD_N: 0, CLK: 1 }]);
    eq(bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), 6, "synchronous load");
    o = step161("74161", [...pulses(3), { CLR_N: 0 }]);
    eq(bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), 0, "async clear acts without a clock");
    o = step161("74163", [...pulses(3), { CLR_N: 0, CLK: 0 }]);
    eq(bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), 3, "74163 waits for the clock to clear");
    o = step161("74163", [...pulses(3), { CLR_N: 0, CLK: 0 }, { CLR_N: 0, CLK: 1 }]);
    eq(bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), 0, "... then clears");
    o = step161("74161", pulses(4, { ENP: 0 }));
    eq(bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), 0, "ENP low holds the count");
    o = step161("74160", pulses(10));
    eq(bits(o[o.length - 1], ["QA", "QB", "QC", "QD"]), 0, "decade counter wraps after 9");
    o = step161("74160", pulses(9));
    eq(o[o.length - 1].RCO, 1, "decade RCO at 9");
});

test("74193 counts up and down with borrow / carry", () => {
    const up = LogicIC.run("74193", [...clk("UP"), ...clk("UP"), ...clk("UP")]);
    eq(bits(up[up.length - 1], ["QA", "QB", "QC", "QD"]), 3);
    const dn = LogicIC.run("74193", [...clk("DOWN")]);
    eq(bits(dn[dn.length - 1], ["QA", "QB", "QC", "QD"]), 15, "0 - 1 wraps to 15");
    const clr = LogicIC.run("74193", [...clk("UP"), { CLR: 1 }]);
    eq(bits(clr[clr.length - 1], ["QA", "QB", "QC", "QD"]), 0);
    const ld = LogicIC.run("74193", [{ LOAD_N: 0, A: 1, B: 0, C: 1, D: 1 }]);
    eq(bits(ld[0], ["QA", "QB", "QC", "QD"]), 13, "asynchronous load");
});

test("4017 walks a one through Q0..Q9; 4040 and 74393 divide", () => {
    const o = LogicIC.run("4017", [...clk("CLK"), ...clk("CLK"), ...clk("CLK")]);
    const hot = (r) => Object.keys(r).filter(k => /^Q\d$/.test(k) && r[k]).join();
    eq(hot(o[o.length - 1]), "Q3");
    const w = []; for (let i = 0; i < 10; i++) w.push(...clk("CLK"));
    eq(hot(LogicIC.run("4017", w).pop()), "Q0", "wraps to Q0 after ten");
    eq(LogicIC.run("4017", [...clk("CLK"), { INH: 1, CLK: 0 }, { INH: 1, CLK: 1 }]).pop().Q1, 1, "inhibit blocks the clock");
    const d = []; for (let i = 0; i < 8; i++) d.push(...nclk("CLK_N"));
    eq(bits(LogicIC.run("4040", d).pop(), ["Q1", "Q2", "Q3", "Q4"]), 8, "4040: 8 clocks = binary 8");
    const e = []; for (let i = 0; i < 5; i++) e.push(...nclk("1CLK_N"));
    eq(bits(LogicIC.run("74393", e).pop(), ["1QA", "1QB", "1QC", "1QD"]), 5);
});

test("74164, 74165, 74194 and 74595 shift registers", () => {
    // 74164: shift in 1,0,1,1
    const feed = (bitsIn) => bitsIn.flatMap(b => clk("CLK", { A: b, B: 1 }));
    let o = LogicIC.run("74164", feed([1, 0, 1, 1])).pop();
    eq(["A", "B", "C", "D"].map(c => o["Q" + c]), [1, 1, 0, 1], "QA is the newest bit");
    eq(LogicIC.run("74164", [...feed([1, 1]), { CLR_N: 0 }]).pop().QA, 0, "clear");
    // 74165: load 1010_0110 then shift out MSB-last (QH = H first)
    const load = { A: 1, B: 0, C: 1, D: 0, E: 0, F: 1, G: 1, H: 0, SH_LD_N: 0 };
    const sh = [load, { ...load, SH_LD_N: 1 }];
    for (let i = 0; i < 8; i++) sh.push(...clk("CLK", { SH_LD_N: 1, SER: 0 }));
    const outs = LogicIC.run("74165", sh).map(r => r.QH);
    eq([outs[1], outs[4], outs[6], outs[8], outs[10]], [0, 1, 1, 0, 0], "H, G, F, E, D come out in turn");
    // 74194 modes
    const m = (s1, s0, extra) => LogicIC.run("74194", [{ S1: s1, S0: s0, CLK: 0, ...extra }, { S1: s1, S0: s0, CLK: 1, ...extra }]).pop();
    eq(["A", "B", "C", "D"].map(c => m(1, 1, { A: 1, B: 0, C: 1, D: 1 })["Q" + c]), [1, 0, 1, 1], "load");
    eq(["A", "B", "C", "D"].map(c => m(0, 1, { SR: 1 })["Q" + c]), [1, 0, 0, 0], "shift right takes SR into QA");
    eq(["A", "B", "C", "D"].map(c => m(1, 0, { SL: 1 })["Q" + c]), [0, 0, 0, 1], "shift left takes SL into QD");
    eq(["A", "B", "C", "D"].map(c => m(0, 0, {})["Q" + c]), [0, 0, 0, 0], "hold");
    // 74595: shift 1,0,1 then latch
    const v = [];
    for (const b of [1, 0, 1]) v.push(...clk("SRCLK", { SER: b }));
    const before = LogicIC.run("74595", v).pop();
    eq(before.QA, 0, "outputs stay at the old latch until RCLK");
    const after = LogicIC.run("74595", [...v, ...clk("RCLK")]).pop();
    eq(["A", "B", "C"].map(c => after["Q" + c]), [1, 0, 1], "latched");
    eq(LogicIC.run("74595", [...v, ...clk("RCLK"), { OE_N: 1 }]).pop().QA, "Z", "outputs float when OE_N is high");
});

test("74138, 74139, 74148, 74151, 74153, 74157 select and decode", () => {
    for (let k = 0; k < 8; k++) {
        const o = LogicIC.run("74138", [{ A: k & 1, B: (k >> 1) & 1, C: (k >> 2) & 1 }])[0];
        eq(Object.keys(o).filter(n => !o[n]).join(), `Y${k}_N`, `decoder ${k}`);
    }
    eq(Object.values(LogicIC.run("74138", [{ G1: 0 }])[0]).every(x => x === 1), true, "disabled");
    eq(LogicIC.run("74139", [{ "1A": 1, "1B": 1 }])[0]["1Y3_N"], 0);
    const enc = LogicIC.run("74148", [{ I3_N: 0, I5_N: 0 }])[0];
    eq([enc.A0_N, enc.A1_N, enc.A2_N, enc.GS_N], [0, 1, 0, 0], "highest asserted input (5) wins, outputs inverted");
    eq(LogicIC.run("74148", [{}])[0].EO_N, 0, "no input asserted: EO low");
    eq(LogicIC.run("74151", [{ D5: 1, A: 1, B: 0, C: 1 }])[0].Y, 1, "multiplexer picks D5");
    eq(LogicIC.run("74151", [{ D5: 1, A: 1, B: 0, C: 1, G_N: 1 }])[0].Y, 0, "strobe");
    eq(LogicIC.run("74153", [{ A: 0, B: 1, "1C2": 1, "2C2": 0 }])[0], { "1Y": 1, "2Y": 0 });
    eq(LogicIC.run("74157", [{ S: 1, "1A": 0, "1B": 1, "2A": 1, "2B": 0 }])[0], { "1Y": 1, "2Y": 0, "3Y": 0, "4Y": 0 });
});

test("7447 and 4511 drive the right segments", () => {
    const seg = (o) => "abcdefg".split("").filter(s => o[s] === 0).join("");      // active low: 0 = lit
    const dig = (n, extra = {}) => ({ A: n & 1, B: (n >> 1) & 1, C: (n >> 2) & 1, D: (n >> 3) & 1, ...extra });
    eq(seg(LogicIC.run("7447", [dig(0)])[0]), "abcdef");
    eq(seg(LogicIC.run("7447", [dig(1)])[0]), "bc");
    eq(seg(LogicIC.run("7447", [dig(8)])[0]), "abcdefg");
    eq(seg(LogicIC.run("7447", [dig(7)])[0]), "abc");
    eq(seg(LogicIC.run("7447", [dig(4, { LT_N: 0 })])[0]), "abcdefg", "lamp test");
    eq(seg(LogicIC.run("7447", [dig(5, { BI_N: 0 })])[0]), "", "blanking");
    eq(seg(LogicIC.run("7447", [dig(0, { RBI_N: 0 })])[0]), "", "ripple blanking of a leading zero");
    const on = (o) => "abcdefg".split("").filter(s => o[s] === 1).join("");
    eq(on(LogicIC.run("4511", [dig(3)])[0]), "abcdg");
    eq(on(LogicIC.run("4511", [dig(12)])[0]), "", "above 9 is blank");
    eq(on(LogicIC.run("4511", [dig(2), dig(9, { LE: 1 })]).pop()), "abdeg", "the latch holds the digit it saw");
});

test("7483 adds, 7485 compares, 74244 and 74373/74374 buffer, gate packages", () => {
    for (const [a, b, c] of [[3, 4, 0], [9, 9, 1], [15, 15, 1], [0, 0, 0], [7, 8, 0]]) {
        const o = LogicIC.run("7483", [{ A1: a & 1, A2: (a >> 1) & 1, A3: (a >> 2) & 1, A4: (a >> 3) & 1, B1: b & 1, B2: (b >> 1) & 1, B3: (b >> 2) & 1, B4: (b >> 3) & 1, C0: c }])[0];
        eq(bits(o, ["S1", "S2", "S3", "S4"]) + 16 * o.C4, a + b + c, `${a}+${b}+${c}`);
    }
    const cmp = (a, b) => LogicIC.run("7485", [{ A0: a & 1, A1: (a >> 1) & 1, A2: (a >> 2) & 1, A3: (a >> 3) & 1, B0: b & 1, B1: (b >> 1) & 1, B2: (b >> 2) & 1, B3: (b >> 3) & 1 }])[0];
    eq([cmp(9, 3).OA_GTB, cmp(2, 8).OA_LTB, cmp(5, 5).OA_EQB, cmp(5, 5).OA_GTB], [1, 1, 1, 0]);
    eq(LogicIC.run("74244", [{ A1: 1, A5: 1, G1_N: 1 }])[0].Y1, "Z");
    eq(LogicIC.run("74244", [{ A1: 1, A5: 1, G1_N: 0, G2_N: 0 }])[0].Y5, 1);
    eq(LogicIC.run("74374", [...clk("CLK", { D3: 1 })]).pop().Q3, 1);
    eq(LogicIC.run("74373", [{ LE: 1, D2: 1 }, { LE: 0, D2: 0 }]).pop().Q2, 1, "latched value is held");
    eq(LogicIC.run("74273", [...clk("CLK", { D1: 1 }), { CLR_N: 0 }]).pop().Q1, 0);
    eq(LogicIC.run("74175", [...clk("CLK", { "2D": 1 })]).pop()["2QN"], 0);
    const g = (key, a, b) => LogicIC.run(key, [{ "1A": a, "1B": b }])[0]["1Y"];
    eq([g("7400", 1, 1), g("7402", 0, 0), g("7408", 1, 0), g("7432", 0, 1), g("7486", 1, 1)], [0, 1, 0, 1, 0]);
    eq(LogicIC.run("7404", [{ "3A": 0 }])[0]["3Y"], 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

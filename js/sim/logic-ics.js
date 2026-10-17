// Behavioural models of common 74xx / 4000-series logic ICs.
//
// Each entry is a pure state machine over logic levels (0 / 1), independent of the analog solver:
//   left / right   pin names on each side of the symbol (inputs / outputs); the node order is left then right
//   pullup         extra inputs that read high when left open (names ending _N do too, as TTL inputs float high)
//   pulldown       _N inputs that read LOW when left open: enables / output-enables, so an unwired chip works
//   clocks         inputs drawn with a clock wedge
//   init()         the power-up state (counters at 0, registers cleared)
//   step(st, v, p) -> { st, out }: v = input levels now, p = input levels at the previous accepted step (for edges);
//                  out[pin] is 0, 1 or "Z" (tri-state). st must be JSON-serialisable and is never modified.
// The analog engine's DigitalIC element samples the pins, calls step() and drives the outputs.

const LOGIC_ICS = {};

(() => {
    const rise = (v, p, n) => !p[n] && !!v[n];
    const fall = (v, p, n) => !!p[n] && !v[n];
    const nib = (v, names) => names.reduce((a, n, i) => a | ((v[n] ? 1 : 0) << i), 0);
    const put = (o, names, val) => { names.forEach((n, i) => { o[n] = (val >> i) & 1; }); };
    const seq = (prefix, n, from = 1) => Array.from({ length: n }, (_, i) => `${prefix}${i + from}`);
    const add = (key, def) => { LOGIC_ICS[key] = Object.assign({ pullup: [], pulldown: [], clocks: [] }, def); };

    // ---------------------------------------------------------------- flip-flops and latches

    add("7474", {
        title: "7474", desc: "Dual D flip-flop with preset and clear (rising edge)", category: "Flip-Flops & Latches",
        left: [1, 2].flatMap(u => [`${u}D`, `${u}CLK`, `${u}PRE_N`, `${u}CLR_N`]),
        right: [1, 2].flatMap(u => [`${u}Q`, `${u}QN`]),
        clocks: ["1CLK", "2CLK"],
        init: () => ({ q: [0, 0] }),
        step(st, v, p) {
            const q = st.q.slice(), out = {};
            [1, 2].forEach((u, i) => {
                const pre = !v[`${u}PRE_N`], clr = !v[`${u}CLR_N`];
                if (pre) q[i] = 1; else if (clr) q[i] = 0; else if (rise(v, p, `${u}CLK`)) q[i] = v[`${u}D`] ? 1 : 0;
                out[`${u}Q`] = q[i];
                out[`${u}QN`] = pre && clr ? 1 : 1 - q[i];
            });
            return { st: { q }, out };
        }
    });

    add("74112", {
        title: "74112", desc: "Dual JK flip-flop with preset and clear (falling edge)", category: "Flip-Flops & Latches",
        left: [1, 2].flatMap(u => [`${u}J`, `${u}K`, `${u}CLK_N`, `${u}PRE_N`, `${u}CLR_N`]),
        right: [1, 2].flatMap(u => [`${u}Q`, `${u}QN`]),
        clocks: ["1CLK_N", "2CLK_N"],
        init: () => ({ q: [0, 0] }),
        step(st, v, p) {
            const q = st.q.slice(), out = {};
            [1, 2].forEach((u, i) => {
                const pre = !v[`${u}PRE_N`], clr = !v[`${u}CLR_N`];
                if (pre) q[i] = 1; else if (clr) q[i] = 0;
                else if (fall(v, p, `${u}CLK_N`)) {
                    const j = !!v[`${u}J`], k = !!v[`${u}K`];
                    if (j && k) q[i] = 1 - q[i]; else if (j) q[i] = 1; else if (k) q[i] = 0;
                }
                out[`${u}Q`] = q[i];
                out[`${u}QN`] = pre && clr ? 1 : 1 - q[i];
            });
            return { st: { q }, out };
        }
    });

    const quadD = (key, n, desc) => add(key, {
        title: key, desc, category: "Flip-Flops & Latches",
        left: [...seq("", n).map(i => `${i}D`), "CLK", "CLR_N"],
        right: seq("", n).flatMap(i => [`${i}Q`, `${i}QN`]),
        clocks: ["CLK"],
        init: () => ({ q: Array(n).fill(0) }),
        step(st, v, p) {
            let q = st.q.slice();
            if (!v.CLR_N) q = Array(n).fill(0);
            else if (rise(v, p, "CLK")) q = seq("", n).map(i => (v[`${i}D`] ? 1 : 0));
            const out = {};
            q.forEach((b, i) => { out[`${i + 1}Q`] = b; out[`${i + 1}QN`] = 1 - b; });
            return { st: { q }, out };
        }
    });
    quadD("74175", 4, "Quad D flip-flop with common clear");

    add("74273", {
        title: "74273", desc: "Octal D flip-flop with clear", category: "Flip-Flops & Latches",
        left: [...seq("D", 8), "CLK", "CLR_N"], right: seq("Q", 8), clocks: ["CLK"],
        init: () => ({ q: Array(8).fill(0) }),
        step(st, v, p) {
            let q = st.q.slice();
            if (!v.CLR_N) q = Array(8).fill(0);
            else if (rise(v, p, "CLK")) q = seq("D", 8).map(n => (v[n] ? 1 : 0));
            const out = {}; q.forEach((b, i) => { out[`Q${i + 1}`] = b; });
            return { st: { q }, out };
        }
    });

    add("74374", {
        title: "74374", desc: "Octal D flip-flop, three-state outputs", category: "Flip-Flops & Latches",
        left: [...seq("D", 8), "CLK", "OE_N"], right: seq("Q", 8), clocks: ["CLK"], pulldown: ["OE_N"],
        init: () => ({ q: Array(8).fill(0) }),
        step(st, v, p) {
            const q = rise(v, p, "CLK") ? seq("D", 8).map(n => (v[n] ? 1 : 0)) : st.q.slice();
            const out = {}; q.forEach((b, i) => { out[`Q${i + 1}`] = v.OE_N ? "Z" : b; });
            return { st: { q }, out };
        }
    });

    add("74373", {
        title: "74373", desc: "Octal transparent latch, three-state outputs", category: "Flip-Flops & Latches",
        left: [...seq("D", 8), "LE", "OE_N"], right: seq("Q", 8), pulldown: ["OE_N"],
        init: () => ({ q: Array(8).fill(0) }),
        step(st, v) {
            const q = v.LE ? seq("D", 8).map(n => (v[n] ? 1 : 0)) : st.q.slice();
            const out = {}; q.forEach((b, i) => { out[`Q${i + 1}`] = v.OE_N ? "Z" : b; });
            return { st: { q }, out };
        }
    });

    // ---------------------------------------------------------------- counters

    add("7493", {
        title: "7493", desc: "4-bit binary ripple counter (÷2 and ÷8 sections)", category: "Counters",
        left: ["CKA_N", "CKB_N", "R01", "R02"], right: ["QA", "QB", "QC", "QD"], clocks: ["CKA_N", "CKB_N"],
        init: () => ({ a: 0, b: 0 }),
        step(st, v, p) {
            let { a, b } = st;
            if (v.R01 && v.R02) { a = 0; b = 0; }
            else {
                if (fall(v, p, "CKA_N")) a ^= 1;
                if (fall(v, p, "CKB_N")) b = (b + 1) & 7;
            }
            const out = { QA: a }; put(out, ["QB", "QC", "QD"], b);
            return { st: { a, b }, out };
        }
    });

    add("7490", {
        title: "7490", desc: "Decade counter (÷2 and ÷5 sections; tie QA to CKB for BCD)", category: "Counters",
        left: ["CKA_N", "CKB_N", "R01", "R02", "R91", "R92"], right: ["QA", "QB", "QC", "QD"], clocks: ["CKA_N", "CKB_N"],
        init: () => ({ a: 0, b: 0 }),
        step(st, v, p) {
            let { a, b } = st;
            if (v.R91 && v.R92) { a = 1; b = 4; }                    // set to 9
            else if (v.R01 && v.R02) { a = 0; b = 0; }
            else {
                if (fall(v, p, "CKA_N")) a ^= 1;
                if (fall(v, p, "CKB_N")) b = (b + 1) % 5;
            }
            const out = { QA: a }; put(out, ["QB", "QC", "QD"], b);
            return { st: { a, b }, out };
        }
    });

    // synchronous 4-bit counters: 161 / 163 binary, 160 / 162 decade; 161 / 160 clear asynchronously, 163 / 162 synchronously
    const sync4 = (key, mod, asyncClear, desc) => add(key, {
        title: key, desc, category: "Counters",
        left: ["A", "B", "C", "D", "CLK", "CLR_N", "LOAD_N", "ENP", "ENT"], right: ["QA", "QB", "QC", "QD", "RCO"],
        clocks: ["CLK"], pullup: ["ENP", "ENT"],
        init: () => ({ c: 0 }),
        step(st, v, p) {
            let c = st.c;
            if (asyncClear && !v.CLR_N) c = 0;
            else if (rise(v, p, "CLK")) {
                if (!v.CLR_N) c = 0;
                else if (!v.LOAD_N) c = nib(v, ["A", "B", "C", "D"]);
                else if (v.ENP && v.ENT) c = c >= mod - 1 ? 0 : c + 1;
            }
            const out = {}; put(out, ["QA", "QB", "QC", "QD"], c);
            out.RCO = v.ENT && c === mod - 1 ? 1 : 0;
            return { st: { c }, out };
        }
    });
    sync4("74161", 16, true, "4-bit synchronous binary counter, asynchronous clear");
    sync4("74163", 16, false, "4-bit synchronous binary counter, synchronous clear");
    sync4("74160", 10, true, "Synchronous decade counter, asynchronous clear");
    sync4("74162", 10, false, "Synchronous decade counter, synchronous clear");

    add("74193", {
        title: "74193", desc: "4-bit up/down counter with separate clocks, clear and load", category: "Counters",
        left: ["UP", "DOWN", "CLR", "LOAD_N", "A", "B", "C", "D"], right: ["QA", "QB", "QC", "QD", "CO_N", "BO_N"],
        clocks: ["UP", "DOWN"], pullup: ["UP", "DOWN"],
        init: () => ({ c: 0 }),
        step(st, v, p) {
            let c = st.c;
            if (v.CLR) c = 0;
            else if (!v.LOAD_N) c = nib(v, ["A", "B", "C", "D"]);
            else if (rise(v, p, "UP") && v.DOWN) c = (c + 1) & 15;
            else if (rise(v, p, "DOWN") && v.UP) c = (c + 15) & 15;
            const out = {}; put(out, ["QA", "QB", "QC", "QD"], c);
            out.CO_N = c === 15 && !v.UP ? 0 : 1;
            out.BO_N = c === 0 && !v.DOWN ? 0 : 1;
            return { st: { c }, out };
        }
    });

    add("74393", {
        title: "74393", desc: "Dual 4-bit binary ripple counter", category: "Counters",
        left: [1, 2].flatMap(u => [`${u}CLK_N`, `${u}CLR`]), right: [1, 2].flatMap(u => ["A", "B", "C", "D"].map(b => `${u}Q${b}`)),
        clocks: ["1CLK_N", "2CLK_N"],
        init: () => ({ c: [0, 0] }),
        step(st, v, p) {
            const c = st.c.slice(), out = {};
            [1, 2].forEach((u, i) => {
                if (v[`${u}CLR`]) c[i] = 0; else if (fall(v, p, `${u}CLK_N`)) c[i] = (c[i] + 1) & 15;
                put(out, ["A", "B", "C", "D"].map(b => `${u}Q${b}`), c[i]);
            });
            return { st: { c }, out };
        }
    });

    add("4017", {
        title: "4017", desc: "CMOS decade counter with 10 decoded outputs", category: "Counters",
        left: ["CLK", "INH", "RST"], right: [...seq("Q", 10, 0), "CO"], clocks: ["CLK"],
        init: () => ({ c: 0 }),
        step(st, v, p) {
            let c = st.c;
            if (v.RST) c = 0; else if (rise(v, p, "CLK") && !v.INH) c = (c + 1) % 10;
            const out = {}; for (let i = 0; i < 10; i++) out[`Q${i}`] = c === i ? 1 : 0;
            out.CO = c < 5 ? 1 : 0;
            return { st: { c }, out };
        }
    });

    add("4040", {
        title: "4040", desc: "CMOS 12-stage binary ripple counter", category: "Counters",
        left: ["CLK_N", "RST"], right: seq("Q", 12), clocks: ["CLK_N"],
        init: () => ({ c: 0 }),
        step(st, v, p) {
            let c = st.c;
            if (v.RST) c = 0; else if (fall(v, p, "CLK_N")) c = (c + 1) & 4095;
            const out = {}; put(out, seq("Q", 12), c);
            return { st: { c }, out };
        }
    });

    // ---------------------------------------------------------------- shift registers

    add("74164", {
        title: "74164", desc: "8-bit serial-in, parallel-out shift register", category: "Shift Registers",
        left: ["A", "B", "CLK", "CLR_N"], right: seq("Q", 8).map((_, i) => "Q" + "ABCDEFGH"[i]), clocks: ["CLK"],
        init: () => ({ r: Array(8).fill(0) }),
        step(st, v, p) {
            let r = st.r.slice();
            if (!v.CLR_N) r = Array(8).fill(0);
            else if (rise(v, p, "CLK")) r = [v.A && v.B ? 1 : 0, ...r.slice(0, 7)];
            const out = {}; r.forEach((b, i) => { out["Q" + "ABCDEFGH"[i]] = b; });
            return { st: { r }, out };
        }
    });

    add("74165", {
        title: "74165", desc: "8-bit parallel-load, serial-out shift register", category: "Shift Registers",
        left: [..."ABCDEFGH".split(""), "SER", "CLK", "CLK_INH", "SH_LD_N"], right: ["QH", "QH_N"], clocks: ["CLK"],
        init: () => ({ r: Array(8).fill(0) }),
        step(st, v, p) {
            let r = st.r.slice();
            if (!v.SH_LD_N) r = "ABCDEFGH".split("").map(n => (v[n] ? 1 : 0));          // asynchronous parallel load
            else if (rise(v, p, "CLK") && !v.CLK_INH) r = [v.SER ? 1 : 0, ...r.slice(0, 7)];
            return { st: { r }, out: { QH: r[7], QH_N: 1 - r[7] } };
        }
    });

    add("74194", {
        title: "74194", desc: "4-bit bidirectional universal shift register", category: "Shift Registers",
        left: ["S0", "S1", "SR", "SL", "A", "B", "C", "D", "CLK", "CLR_N"], right: ["QA", "QB", "QC", "QD"], clocks: ["CLK"],
        init: () => ({ r: [0, 0, 0, 0] }),
        step(st, v, p) {
            let r = st.r.slice();
            if (!v.CLR_N) r = [0, 0, 0, 0];
            else if (rise(v, p, "CLK")) {
                const mode = (v.S1 ? 2 : 0) | (v.S0 ? 1 : 0);
                if (mode === 1) r = [v.SR ? 1 : 0, r[0], r[1], r[2]];                      // shift right: QA -> QB -> QC -> QD
                else if (mode === 2) r = [r[1], r[2], r[3], v.SL ? 1 : 0];                 // shift left
                else if (mode === 3) r = ["A", "B", "C", "D"].map(n => (v[n] ? 1 : 0));    // parallel load
            }
            const out = {}; r.forEach((b, i) => { out["Q" + "ABCD"[i]] = b; });
            return { st: { r }, out };
        }
    });

    add("74595", {
        title: "74595", desc: "8-bit shift register with output latch, three-state outputs", category: "Shift Registers",
        left: ["SER", "SRCLK", "RCLK", "SRCLR_N", "OE_N"], right: [..."ABCDEFGH".split("").map(c => "Q" + c), "QHS"], clocks: ["SRCLK", "RCLK"], pulldown: ["OE_N"],
        init: () => ({ sr: Array(8).fill(0), lat: Array(8).fill(0) }),
        step(st, v, p) {
            let sr = st.sr.slice(), lat = st.lat.slice();
            if (rise(v, p, "RCLK")) lat = sr.slice();                                       // the storage clock sees the register as it was
            if (!v.SRCLR_N) sr = Array(8).fill(0);
            else if (rise(v, p, "SRCLK")) sr = [v.SER ? 1 : 0, ...sr.slice(0, 7)];
            const out = {}; lat.forEach((b, i) => { out["Q" + "ABCDEFGH"[i]] = v.OE_N ? "Z" : b; });
            out.QHS = sr[7];
            return { st: { sr, lat }, out };
        }
    });

    // ---------------------------------------------------------------- decoders, encoders, multiplexers

    add("74138", {
        title: "74138", desc: "3-to-8 line decoder (active-low outputs)", category: "Decoders & Multiplexers",
        left: ["A", "B", "C", "G1", "G2A_N", "G2B_N"], right: seq("Y", 8, 0).map(n => n + "_N"), pullup: ["G1"], pulldown: ["G2A_N", "G2B_N"],
        init: () => null,
        step(st, v) {
            const en = v.G1 && !v.G2A_N && !v.G2B_N, k = nib(v, ["A", "B", "C"]);
            const out = {}; for (let i = 0; i < 8; i++) out[`Y${i}_N`] = en && i === k ? 0 : 1;
            return { st: null, out };
        }
    });

    add("74139", {
        title: "74139", desc: "Dual 2-to-4 line decoder (active-low outputs)", category: "Decoders & Multiplexers",
        left: [1, 2].flatMap(u => [`${u}A`, `${u}B`, `${u}G_N`]), right: [1, 2].flatMap(u => seq(`${u}Y`, 4, 0).map(n => n + "_N")), pulldown: ["1G_N", "2G_N"],
        init: () => null,
        step(st, v) {
            const out = {};
            [1, 2].forEach(u => { const k = nib(v, [`${u}A`, `${u}B`]); for (let i = 0; i < 4; i++) out[`${u}Y${i}_N`] = !v[`${u}G_N`] && i === k ? 0 : 1; });
            return { st: null, out };
        }
    });

    add("74148", {
        title: "74148", desc: "8-to-3 priority encoder (active-low)", category: "Decoders & Multiplexers",
        left: [...seq("I", 8, 0).map(n => n + "_N"), "EI_N"], right: ["A0_N", "A1_N", "A2_N", "GS_N", "EO_N"], pulldown: ["EI_N"],
        init: () => null,
        step(st, v) {
            const out = { A0_N: 1, A1_N: 1, A2_N: 1, GS_N: 1, EO_N: 1 };
            if (!v.EI_N) {
                let k = -1;
                for (let i = 7; i >= 0; i--) if (!v[`I${i}_N`]) { k = i; break; }
                if (k < 0) out.EO_N = 0;
                else { out.A0_N = 1 - (k & 1); out.A1_N = 1 - ((k >> 1) & 1); out.A2_N = 1 - ((k >> 2) & 1); out.GS_N = 0; }
            }
            return { st: null, out };
        }
    });

    add("74151", {
        title: "74151", desc: "8-to-1 multiplexer", category: "Decoders & Multiplexers",
        left: [...seq("D", 8, 0), "A", "B", "C", "G_N"], right: ["Y", "W"], pulldown: ["G_N"],
        init: () => null,
        step(st, v) {
            const y = v.G_N ? 0 : (v[`D${nib(v, ["A", "B", "C"])}`] ? 1 : 0);
            return { st: null, out: { Y: y, W: 1 - y } };
        }
    });

    add("74153", {
        title: "74153", desc: "Dual 4-to-1 multiplexer", category: "Decoders & Multiplexers",
        left: ["A", "B", ...[1, 2].flatMap(u => [`${u}G_N`, ...seq(`${u}C`, 4, 0)])], right: ["1Y", "2Y"], pulldown: ["1G_N", "2G_N"],
        init: () => null,
        step(st, v) {
            const k = nib(v, ["A", "B"]), out = {};
            [1, 2].forEach(u => { out[`${u}Y`] = v[`${u}G_N`] ? 0 : (v[`${u}C${k}`] ? 1 : 0); });
            return { st: null, out };
        }
    });

    add("74157", {
        title: "74157", desc: "Quad 2-to-1 multiplexer", category: "Decoders & Multiplexers",
        left: ["S", "G_N", ...[1, 2, 3, 4].flatMap(i => [`${i}A`, `${i}B`])], right: seq("", 4).map(i => `${i}Y`), pulldown: ["G_N"],
        init: () => null,
        step(st, v) {
            const out = {};
            [1, 2, 3, 4].forEach(i => { out[`${i}Y`] = v.G_N ? 0 : (v[`${i}${v.S ? "B" : "A"}`] ? 1 : 0); });
            return { st: null, out };
        }
    });

    // ---------------------------------------------------------------- display drivers

    // segments a..g lit for 0..15 (7447 shows fragments above 9)
    const SEG = [
        "abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "cdefg", "abc", "abcdefg", "abcfg",
        "deg", "cdg", "bfg", "adg", "defg", ""
    ];
    const segOut = (pattern, activeLow) => {
        const out = {};
        for (const s of "abcdefg") out[s] = (pattern.includes(s) ? 1 : 0) ^ (activeLow ? 1 : 0);
        return out;
    };

    add("7447", {
        title: "7447", desc: "BCD to 7-segment decoder / driver (active-low outputs, for common-anode displays)", category: "Display Drivers",
        left: ["A", "B", "C", "D", "LT_N", "RBI_N", "BI_N"], right: [..."abcdefg".split("")],
        init: () => null,
        step(st, v) {
            const n = nib(v, ["A", "B", "C", "D"]);
            let pat = SEG[n];
            if (!v.LT_N) pat = "abcdefg";
            if (n === 0 && !v.RBI_N && v.LT_N) pat = "";
            if (!v.BI_N) pat = "";
            return { st: null, out: segOut(pat, true) };
        }
    });

    add("4511", {
        title: "4511", desc: "BCD to 7-segment latch / decoder / driver (active-high outputs, for common-cathode displays)", category: "Display Drivers",
        left: ["A", "B", "C", "D", "LE", "BL_N", "LT_N"], right: [..."abcdefg".split("")],
        init: () => ({ n: 0 }),
        step(st, v) {
            const n = v.LE ? st.n : nib(v, ["A", "B", "C", "D"]);
            let pat = n <= 9 ? SEG[n] : "";
            if (!v.BL_N) pat = "";
            if (!v.LT_N) pat = "abcdefg";
            return { st: { n }, out: segOut(pat, false) };
        }
    });

    // ---------------------------------------------------------------- arithmetic and buffers

    add("7483", {
        title: "7483", desc: "4-bit binary full adder", category: "Arithmetic",
        left: [...seq("A", 4), ...seq("B", 4), "C0"], right: [...seq("S", 4), "C4"],
        init: () => null,
        step(st, v) {
            const sum = nib(v, seq("A", 4)) + nib(v, seq("B", 4)) + (v.C0 ? 1 : 0);
            const out = {}; put(out, seq("S", 4), sum); out.C4 = (sum >> 4) & 1;
            return { st: null, out };
        }
    });

    add("7485", {
        title: "7485", desc: "4-bit magnitude comparator (cascadable)", category: "Arithmetic",
        left: [...seq("A", 4, 0), ...seq("B", 4, 0), "IA_LTB", "IA_EQB", "IA_GTB"], right: ["OA_LTB", "OA_EQB", "OA_GTB"], pullup: ["IA_EQB"],
        init: () => null,
        step(st, v) {
            const a = nib(v, seq("A", 4, 0)), b = nib(v, seq("B", 4, 0));
            if (a > b) return { st: null, out: { OA_LTB: 0, OA_EQB: 0, OA_GTB: 1 } };
            if (a < b) return { st: null, out: { OA_LTB: 1, OA_EQB: 0, OA_GTB: 0 } };
            return { st: null, out: { OA_LTB: v.IA_LTB ? 1 : 0, OA_EQB: v.IA_EQB ? 1 : 0, OA_GTB: v.IA_GTB ? 1 : 0 } };
        }
    });

    add("74244", {
        title: "74244", desc: "Octal buffer / line driver, three-state outputs", category: "Arithmetic",
        left: [...seq("A", 8), "G1_N", "G2_N"], right: seq("Y", 8), pulldown: ["G1_N", "G2_N"],
        init: () => null,
        step(st, v) {
            const out = {};
            for (let i = 1; i <= 8; i++) out[`Y${i}`] = (i <= 4 ? v.G1_N : v.G2_N) ? "Z" : (v[`A${i}`] ? 1 : 0);
            return { st: null, out };
        }
    });

    // ---------------------------------------------------------------- memories
    // A memory's words belong to the instance (inst.words, from LogicIC.parseMemory); a RAM keeps only the words written
    // since power-up in its state ({ w: { address: word } }), so a step that writes nothing returns the very same state object.
    const addrOf = (v, abits) => { let a = 0; for (let i = 0; i < abits; i++) if (v[`A${i}`]) a |= 1 << i; return a; };
    const wordOf = (v, names) => names.reduce((a, n, i) => a | ((v[n] ? 1 : 0) << i), 0);
    const baseWord = (inst, a) => (inst && inst.words && inst.words[a]) || 0;
    const dbus = (n) => Array.from({ length: n }, (_, i) => `D${i}`);

    // EPROM / ROM: 27C16 (2K x 8), 27C64 (8K x 8), 27C256 (32K x 8). Outputs float unless CE and OE are both active.
    const rom = (key, abits, desc) => add(key, {
        title: key, desc, category: "Memory", memory: { size: 1 << abits, bits: 8, kind: "rom" },
        left: [...Array.from({ length: abits }, (_, i) => `A${i}`), "CE_N", "OE_N"], right: dbus(8), pulldown: ["CE_N", "OE_N"],
        init: () => null,
        step(st, v, p, inst) {
            const out = {}, on = !v.CE_N && !v.OE_N, w = on ? baseWord(inst, addrOf(v, abits)) : 0;
            dbus(8).forEach((n, i) => { out[n] = on ? (w >> i) & 1 : "Z"; });
            return { st: null, out };
        }
    });
    rom("27C16", 11, "2K x 8 EPROM (set its contents in the properties)");
    rom("27C64", 13, "8K x 8 EPROM (set its contents in the properties)");
    rom("27C256", 15, "32K x 8 EPROM (set its contents in the properties)");

    // 32 x 8 PROM (74188 style): address A0-A4, output enable G_N
    add("74188", {
        title: "74188", desc: "32 x 8 PROM (set its contents in the properties); outputs float while G is inactive", category: "Memory", memory: { size: 32, bits: 8, kind: "rom" },
        left: [...Array.from({ length: 5 }, (_, i) => `A${i}`), "G_N"], right: dbus(8), pulldown: ["G_N"],
        init: () => null,
        step(st, v, p, inst) {
            const out = {}, on = !v.G_N, w = on ? baseWord(inst, addrOf(v, 5)) : 0;
            dbus(8).forEach((n, i) => { out[n] = on ? (w >> i) & 1 : "Z"; });
            return { st: null, out };
        }
    });

    // static RAM: 6116 (2K x 8), 6264 (8K x 8), 62256 (32K x 8). D0-D7 is one bidirectional bus. A write completes when WE rises
    // while the chip is selected (or when CS rises with WE low), using the address and data that were on the pins just before;
    // the bus is driven only in a read cycle (CS and OE active, WE high). Contents start as the instance's initial contents.
    const ram = (key, abits, desc) => add(key, {
        title: key, desc, category: "Memory", memory: { size: 1 << abits, bits: 8, kind: "ram" },
        left: [...Array.from({ length: abits }, (_, i) => `A${i}`), "CS_N", "OE_N", "WE_N"], right: dbus(8), bidir: dbus(8), pulldown: ["CS_N", "OE_N"],
        init: () => ({ w: {} }),
        step(st, v, p, inst) {
            let w = st.w;
            if ((rise(v, p, "WE_N") && !p.CS_N) || (rise(v, p, "CS_N") && !p.WE_N)) {
                const a = addrOf(p, abits), d = wordOf(p, dbus(8));
                if (!(a in w ? w[a] === d : baseWord(inst, a) === d)) w = Object.assign({}, w, { [a]: d });
            }
            const out = {}, on = !v.CS_N && !v.OE_N && !!v.WE_N, a = addrOf(v, abits), word = a in w ? w[a] : baseWord(inst, a);
            dbus(8).forEach((n, i) => { out[n] = on ? (word >> i) & 1 : "Z"; });
            return { st: w === st.w ? st : { w }, out };
        }
    });
    ram("6116", 11, "2K x 8 static RAM, bidirectional data bus");
    ram("6264", 13, "8K x 8 static RAM, bidirectional data bus");
    ram("62256", 15, "32K x 8 static RAM, bidirectional data bus");

    // 7489: 16 x 4 RAM with complemented outputs. While ME is low and WE low the word is written (follows the data inputs) and the
    // outputs show the complement of the inputs; with WE high they show the complement of the addressed word; with ME high they are high.
    add("7489", {
        title: "7489", desc: "16 x 4 RAM, outputs are the complement of the stored word", category: "Memory", memory: { size: 16, bits: 4, kind: "ram" },
        left: ["A0", "A1", "A2", "A3", "DI1", "DI2", "DI3", "DI4", "ME_N", "WE_N"], right: ["DO1", "DO2", "DO3", "DO4"], pulldown: ["ME_N"],
        init: () => ({ w: {} }),
        step(st, v, p, inst) {
            const a = addrOf(v, 4), di = wordOf(v, ["DI1", "DI2", "DI3", "DI4"]);
            let w = st.w;
            const writing = !v.ME_N && !v.WE_N;
            if (writing && (a in w ? w[a] : baseWord(inst, a)) !== di) w = Object.assign({}, w, { [a]: di });
            const word = writing ? di : (a in w ? w[a] : baseWord(inst, a));
            const out = {};
            ["DO1", "DO2", "DO3", "DO4"].forEach((n, i) => { out[n] = v.ME_N ? 1 : 1 - ((word >> i) & 1); });
            return { st: w === st.w ? st : { w }, out };
        }
    });

    // ---------------------------------------------------------------- gate packages

    const gates = (key, desc, count, fn, label) => add(key, {
        title: key, desc, category: "Gate Packages",
        left: seq("", count).flatMap(i => (label === 1 ? [`${i}A`] : [`${i}A`, `${i}B`])),
        right: seq("", count).map(i => `${i}Y`),
        init: () => null,
        step(st, v) {
            const out = {};
            for (let i = 1; i <= count; i++) out[`${i}Y`] = fn(v[`${i}A`] ? 1 : 0, v[`${i}B`] ? 1 : 0) ? 1 : 0;
            return { st: null, out };
        }
    });
    gates("7400", "Quad 2-input NAND", 4, (a, b) => !(a & b));
    gates("7402", "Quad 2-input NOR", 4, (a, b) => !(a | b));
    gates("7404", "Hex inverter", 6, (a) => !a, 1);
    gates("7408", "Quad 2-input AND", 4, (a, b) => a & b);
    gates("7432", "Quad 2-input OR", 4, (a, b) => a | b);
    gates("7486", "Quad 2-input XOR", 4, (a, b) => a ^ b);
})();

// Pins of a chip in node order, and whether an input floats high
const LogicIC = {
    pins(spec) { return [...spec.left, ...spec.right]; },
    // runs of pins that count up (D0 D1 D2 ..., A1 A2 A3 A4) on one side: they can be shown as one bus pin
    vectors(spec) {
        const out = [];
        for (const side of ["left", "right"]) {
            let run = null;
            const flush = () => { if (run && run.pins.length >= 3) out.push({ base: run.base.toUpperCase(), side, pins: run.pins, lo: run.lo, hi: run.hi, name: `${run.base.toUpperCase()}[${run.lo}..${run.hi}]` }); run = null; };
            for (const n of spec[side]) {
                const m = /^([A-Za-z]+)(\d+)$/.exec(n);
                if (m && run && run.base === m[1] && Number(m[2]) === run.hi + 1 && m[2].length === run.len) { run.pins.push(n); run.hi++; }
                else { flush(); if (m) run = { base: m[1], pins: [n], lo: Number(m[2]), hi: Number(m[2]), len: m[2].length }; }
            }
            flush();
        }
        return out;
    },
    // A memory image from text: Intel HEX, or hex bytes separated by spaces / commas / newlines ("0x" and "$" prefixes, "addr:" at the
    // start of a line and ";" or "#" comments are allowed). Returns a Uint8Array (or Uint16Array for 9..16 bit words) of `size` words.
    parseMemory(text, size, bits = 8) {
        const words = (bits > 8 ? new Uint16Array(size) : new Uint8Array(size)), max = (1 << bits) - 1;
        const src = String(text || "").replace(/\r/g, "");
        if (!src.trim()) return words;
        const lines = src.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith(";") && !l.startsWith("#"));
        if (lines.some(l => l.startsWith(":")) && lines.every(l => l.startsWith(":"))) {          // Intel HEX
            let base = 0;
            for (const l of lines) {
                const n = parseInt(l.slice(1, 3), 16), addr = parseInt(l.slice(3, 7), 16), type = parseInt(l.slice(7, 9), 16);
                if (type === 0) for (let i = 0; i < n; i++) { const a = base + addr + i; if (a < size) words[a] = parseInt(l.slice(9 + 2 * i, 11 + 2 * i), 16) & max; }
                else if (type === 2) base = parseInt(l.slice(9, 13), 16) * 16;
                else if (type === 4) base = parseInt(l.slice(9, 13), 16) * 65536;
                else if (type === 1) break;
            }
            return words;
        }
        let at = 0;
        for (let l of lines) {
            const m = /^([0-9a-fA-F]+)\s*:(.*)$/.exec(l);
            if (m) { at = parseInt(m[1], 16); l = m[2]; }
            for (const t of l.split(/[\s,]+/)) {
                if (!t) continue;
                const v = parseInt(t.replace(/^0x|^\$/i, ""), 16);
                if (Number.isFinite(v)) { if (at < size) words[at] = v & max; at++; }
            }
        }
        return words;
    },
    pullsUp(spec, name) { return !spec.pulldown.includes(name) && (/_N$/.test(name) || spec.pullup.includes(name)); },
    // run a chip through a list of input vectors (a test / documentation helper); returns the output after each
    run(key, vectors, mem = "") {
        const spec = LOGIC_ICS[key];
        const inst = spec.memory ? { words: LogicIC.parseMemory(mem, spec.memory.size, spec.memory.bits) } : null;
        let st = spec.init(), prev = {}, outs = [];
        const defaults = {};
        for (const n of spec.left) defaults[n] = LogicIC.pullsUp(spec, n) ? 1 : 0;
        prev = Object.assign({}, defaults);
        for (const vec of vectors) {
            const v = Object.assign({}, defaults, vec);
            const r = spec.step(st, v, prev, inst);
            st = r.st; prev = v; outs.push(r.out);
        }
        return outs;
    }
};

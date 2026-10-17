// SPICE export of the clocked logic ICs (counters, shift registers, registers, latches, three-state buffers).
//
// Each state bit is a master-slave cell built from behavioural sources, the same construction as the flip-flop
// macromodel (NetlistExtractor.flipFlopSubckt): while its clock is low the master follows the bit's next-state
// expression, while the clock is high the slave copies the master, and a weak keeper holds each node at 0 or 1. All the bits of a
// group share one clock, so the group updates together, exactly like the chip's pure state machine in logic-ics.js.
// Asynchronous clear / load / set go straight into the slave. Outputs are driven through ro (or, for three-state pins,
// through ro under an enable, as a current source so a disabled pin floats). The next-state expressions are written
// per chip family below; tests/logic.ngspice.test.js checks every chip against the built-in engine through ngspice.
//
// LogicExport.sequential(key, ctx) returns the body lines of the subcircuit, or null for a chip it does not cover.
//   ctx: { spec, pn (pin name -> node name), vcc, ro, f (number formatter) }

class LogicExport {
    // The bit cell's constants: node capacitance, drive and asynchronous conductances (S), and an optional keeper.
    // C / GDRV = 100 ns is how long a bit takes to follow its master / slave, so clock pulses (high and low) should be wider than about
    // 0.3 us; that slowness is deliberate: while the clock crosses the dead zone both halves are briefly open, and a transfer
    // much faster than the overlap lets a bit race through. There is no keeper by default: a keeper makes each node bistable,
    // and ngspice's first (large) step from "uic" can then land a node in the wrong state. The charge stays put (gmin leaks it
    // with a time constant of C / gmin = 100 s).
    static CAP = "100p";
    static GDRV = "1m";
    static GKEEP = "0";
    static GASYNC = "10m";

    static sequential(key, ctx) {
        const { spec, pn, vcc, ro, f } = ctx;
        const th = f(vcc / 2);
        const out = [];
        const clocks = new Map();

        // ---- boolean helpers: every value is a number in [0, 1] ---------------------------------------------------
        const inn = (pin) => `(0.5*(1+tanh((v(${pn[pin]})-${th})/${f(0.01 * vcc)})))`;     // an input pin as ~0 / ~1 (a steep tanh: a hard step stalls ngspice's timestep when an edge lands on the threshold)
        const A = (...x) => (x.length === 1 ? x[0] : `(${x.join("*")})`);
        const N = (x) => `(1-${x})`;
        const O = (...x) => `(1-${x.map(N).join("*")})`;
        const X = (a, b) => `(${a}+${b}-2*${a}*${b})`;
        const Q = (id) => `v(q_${id})`;                                      // a state bit (clean 0 / 1 node)
        const smooth = (pin) => `0.5*(1+tanh((v(${pn[pin]})-${th})/${f(0.05 * vcc)}))`;
        const sw = (x, at, w) => `0.5*(1+tanh((${x}-${at})/${w}))`;

        // a clock group: node ck_<n> in 0..1, high when the active edge has happened (rising: the pin, falling: its inverse)
        const clock = (pin, rising, expr = null) => {
            const name = `${rising ? "r" : "f"}_${pn[pin] || pin}`;
            if (!clocks.has(name)) {
                clocks.set(name, true);
                out.push(`Bck_${name} ck_${name} 0 V = ${expr || (rising ? smooth(pin) : `1-(${smooth(pin)})`)}`);
            }
            return `ck_${name}`;
        };
        const low = (ck) => `(1-${sw(`v(${ck})`, 0.45, 0.01)})`;
        const high = (ck) => sw(`v(${ck})`, 0.55, 0.01);
        const hq = (id) => sw(`v(s_${id})`, 0.5, 0.05), hm = (id) => sw(`v(m_${id})`, 0.5, 0.05);

        // the optional keeper term: pulls a node toward the logic level its own value says
        const keep = (level, node) => (Number(LogicExport.GKEEP) > 0 ? `+${LogicExport.GKEEP}*(${level}-v(${node}))` : "");

        // the asynchronous set / reset terms of a node (nothing when the chip has none)
        const asyn = (node, set, rst) => {
            const g = LogicExport.GASYNC;
            let t = "";
            if (set !== "0") t += `+${g}*(${set})*(1-v(${node}))${rst !== "0" ? `*(1-(${rst}))` : ""}`;
            if (rst !== "0") t += `-${g}*(${rst})*v(${node})`;
            return t;
        };

        // one master-slave state bit
        const cell = (id, ck, next, { set = "0", rst = "0" } = {}) => {
            out.push(
                `Cm_${id} m_${id} 0 ${LogicExport.CAP} IC=0`, `Cs_${id} s_${id} 0 ${LogicExport.CAP} IC=0`,
                // the asynchronous inputs act on the master too: otherwise a clear released while the clock is active would let the
                // slave copy a master that kept counting underneath it
                `Bm_${id} 0 m_${id} I = ${LogicExport.GDRV}*${low(ck)}*(${next}-v(m_${id}))${keep(hm(id), `m_${id}`)}${asyn(`m_${id}`, set, rst)}`,
                `Bs_${id} 0 s_${id} I = ${LogicExport.GDRV}*${high(ck)}*(v(m_${id})-v(s_${id}))${keep(hq(id), `s_${id}`)}${asyn(`s_${id}`, set, rst)}`,
                `Bq_${id} q_${id} 0 V = ${hq(id)}`
            );
        };
        // a level-sensitive latch bit: follows data while enabled
        const latch = (id, en, data) => out.push(
            `Cs_${id} s_${id} 0 ${LogicExport.CAP} IC=0`,
            `Bs_${id} 0 s_${id} I = ${LogicExport.GDRV}*${en}*(${data}-v(s_${id}))${keep(hq(id), `s_${id}`)}`,
            `Bq_${id} q_${id} 0 V = ${hq(id)}`);

        // ---- outputs ---------------------------------------------------------------------------------------------
        const drive = (pin, expr, enable = null) => {
            if (enable === null) out.push(`Bo_${pn[pin]} o_${pn[pin]} 0 V = ${f(vcc)}*(${expr})`, `Ro_${pn[pin]} o_${pn[pin]} ${pn[pin]} ${f(ro)}`);
            else out.push(`Bo_${pn[pin]} 0 ${pn[pin]} I = ${enable}*(${f(vcc)}*(${expr})-v(${pn[pin]}))/${f(ro)}`);
        };
        const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
        const eq = (bits, value) => A(...bits.map((b, i) => ((value >> i) & 1 ? Q(b) : N(Q(b)))));

        // binary counter bits: toggle when every lower bit is 1 (and the enable holds)
        const increment = (bits, i, en = "1") => X(Q(bits[i]), A(en, ...bits.slice(0, i).map(Q)));

        const R = spec.right, L = spec.left;
        const letters = "ABCDEFGH";

        switch (key) {
            // ---------------------------------------------------------------- counters
            case "7493": {
                const ca = clock("CKA_N", false), cb = clock("CKB_N", false), r0 = A(inn("R01"), inn("R02"));
                cell("a", ca, N(Q("a")), { rst: r0 });
                const b = ids("b", 3);
                b.forEach((id, i) => cell(id, cb, increment(b, i), { rst: r0 }));
                drive("QA", Q("a")); b.forEach((id, i) => drive("Q" + "BCD"[i], Q(id)));
                break;
            }
            case "7490": {
                const ca = clock("CKA_N", false), cb = clock("CKB_N", false);
                const r0 = A(inn("R01"), inn("R02")), s9 = A(inn("R91"), inn("R92"));
                cell("a", ca, N(Q("a")), { set: s9, rst: A(r0, N(s9)) });
                // ÷5: 0 1 2 3 4 0, binary in b0 b1 b2; "set to 9" puts it at 4
                cell("b0", cb, A(N(Q("b0")), N(Q("b2"))), { rst: O(s9, r0) });
                cell("b1", cb, X(Q("b1"), Q("b0")), { rst: O(s9, r0) });
                cell("b2", cb, A(Q("b1"), Q("b0")), { set: s9, rst: A(r0, N(s9)) });
                drive("QA", Q("a")); drive("QB", Q("b0")); drive("QC", Q("b1")); drive("QD", Q("b2"));
                break;
            }
            case "74161": case "74163": case "74160": case "74162": {
                const mod = key === "74160" || key === "74162" ? 10 : 16, asyncClear = key === "74161" || key === "74160";
                const ck = clock("CLK", true), c = ids("c", 4);
                const clr = N(inn("CLR_N")), ld = N(inn("LOAD_N")), en = A(inn("ENP"), inn("ENT"));
                const wrap = mod === 10 ? A(Q(c[3]), O(Q(c[0]), Q(c[1]), Q(c[2]))) : "0";       // 9 or more: back to 0
                c.forEach((id, i) => {
                    const run = `(${en}*${N(wrap)}*${increment(c, i)}+${N(en)}*${Q(id)})`;
                    cell(id, ck, `(${N(clr)}*(${ld}*${inn(letters[i])}+${N(ld)}*${run}))`, { rst: asyncClear ? clr : "0" });
                });
                c.forEach((id, i) => drive("Q" + letters[i], Q(id)));
                drive("RCO", A(inn("ENT"), eq(c, mod - 1)));
                break;
            }
            case "74193": {
                // one clock for the chip: both count inputs high. The master watches which input is low, so it knows whether the
                // coming edge is an up or a down count (both low: neither edge can complete it, the chip holds)
                const up = smooth("UP"), dn = smooth("DOWN");
                const ck = clock("UP", true, `(${up})*(${dn})`);
                const c = ids("c", 4), clr = inn("CLR"), ld = N(inn("LOAD_N"));
                const upCount = A(N(inn("UP")), inn("DOWN")), downCount = A(inn("UP"), N(inn("DOWN")));
                c.forEach((id, i) => {
                    const lower = c.slice(0, i);
                    const upT = X(Q(id), A(...lower.map(Q))), dnT = X(Q(id), A(...lower.map(b => N(Q(b)))));
                    const next = `(${upCount}*${i ? upT : N(Q(id))}+${downCount}*${i ? dnT : N(Q(id))}+${N(O(upCount, downCount))}*${Q(id)})`;
                    cell(id, ck, next, { set: A(ld, inn(letters[i])), rst: O(clr, A(ld, N(inn(letters[i])))) });
                });
                c.forEach((id, i) => drive("Q" + letters[i], Q(id)));
                drive("CO_N", N(A(eq(c, 15), N(inn("UP")))));
                drive("BO_N", N(A(eq(c, 0), N(inn("DOWN")))));
                break;
            }
            case "74393": {
                [1, 2].forEach(u => {
                    const ck = clock(`${u}CLK_N`, false), c = ids(`u${u}c`, 4);
                    c.forEach((id, i) => cell(id, ck, increment(c, i), { rst: inn(`${u}CLR`) }));
                    c.forEach((id, i) => drive(`${u}Q${letters[i]}`, Q(id)));
                });
                break;
            }
            case "4017": {
                const ck = clock("CLK", true), c = ids("c", 4), en = N(inn("INH"));
                const wrap = A(Q(c[3]), O(Q(c[0]), Q(c[1]), Q(c[2])));
                c.forEach((id, i) => cell(id, ck, `(${en}*${N(wrap)}*${increment(c, i)}+${N(en)}*${Q(id)})`, { rst: inn("RST") }));
                for (let k = 0; k < 10; k++) drive(`Q${k}`, eq(c, k));
                drive("CO", N(O(Q(c[3]), A(Q(c[2]), O(Q(c[1]), Q(c[0]))))));      // high while the count is 0-4
                break;
            }
            case "4040": {
                const ck = clock("CLK_N", false), c = ids("c", 12);
                c.forEach((id, i) => cell(id, ck, increment(c, i), { rst: inn("RST") }));
                c.forEach((id, i) => drive(`Q${i + 1}`, Q(id)));
                break;
            }

            // ---------------------------------------------------------------- shift registers
            case "74164": {
                const ck = clock("CLK", true), r = ids("r", 8), clr = N(inn("CLR_N"));
                r.forEach((id, i) => cell(id, ck, i ? Q(r[i - 1]) : A(inn("A"), inn("B")), { rst: clr }));
                r.forEach((id, i) => drive("Q" + letters[i], Q(id)));
                break;
            }
            case "74165": {
                const ck = clock("CLK", true), r = ids("r", 8), ld = N(inn("SH_LD_N")), inh = inn("CLK_INH");
                r.forEach((id, i) => {
                    const shifted = i ? Q(r[i - 1]) : inn("SER");
                    cell(id, ck, `(${inh}*${Q(id)}+${N(inh)}*${shifted})`, { set: A(ld, inn(letters[i])), rst: A(ld, N(inn(letters[i]))) });
                });
                drive("QH", Q(r[7])); drive("QH_N", N(Q(r[7])));
                break;
            }
            case "74194": {
                const ck = clock("CLK", true), r = ids("r", 4), clr = N(inn("CLR_N"));
                const s0 = inn("S0"), s1 = inn("S1");
                const hold = A(N(s1), N(s0)), shr = A(N(s1), s0), shl = A(s1, N(s0)), load = A(s1, s0);
                r.forEach((id, i) => {
                    const right = i ? Q(r[i - 1]) : inn("SR"), left = i < 3 ? Q(r[i + 1]) : inn("SL");
                    cell(id, ck, `(${hold}*${Q(id)}+${shr}*${right}+${shl}*${left}+${load}*${inn(letters[i])})`, { rst: clr });
                });
                r.forEach((id, i) => drive("Q" + letters[i], Q(id)));
                break;
            }
            case "74595": {
                const cs = clock("SRCLK", true), cl = clock("RCLK", true), sr = ids("s", 8), lt = ids("t", 8);
                sr.forEach((id, i) => cell(id, cs, i ? Q(sr[i - 1]) : inn("SER"), { rst: N(inn("SRCLR_N")) }));
                lt.forEach((id, i) => cell(id, cl, Q(sr[i])));
                const oe = N(inn("OE_N"));
                lt.forEach((id, i) => drive("Q" + letters[i], Q(id), oe));
                drive("QHS", Q(sr[7]));
                break;
            }

            // ---------------------------------------------------------------- registers and latches
            case "74273": case "74374": case "74175": {
                const ck = clock("CLK", true), n = key === "74175" ? 4 : 8, q = ids("q", n);
                const clr = key === "74374" ? "0" : N(inn("CLR_N"));
                q.forEach((id, i) => cell(id, ck, key === "74175" ? inn(`${i + 1}D`) : inn(`D${i + 1}`), { rst: clr }));
                if (key === "74175") q.forEach((id, i) => { drive(`${i + 1}Q`, Q(id)); drive(`${i + 1}QN`, N(Q(id))); });
                else {
                    const oe = key === "74374" ? N(inn("OE_N")) : null;
                    q.forEach((id, i) => drive(`Q${i + 1}`, Q(id), oe));
                }
                break;
            }
            case "74373": {
                const q = ids("q", 8), le = inn("LE"), oe = N(inn("OE_N"));
                q.forEach((id, i) => latch(id, le, inn(`D${i + 1}`)));
                q.forEach((id, i) => drive(`Q${i + 1}`, Q(id), oe));
                break;
            }
            case "74244": {
                for (let i = 1; i <= 8; i++) drive(`Y${i}`, inn(`A${i}`), N(inn(i <= 4 ? "G1_N" : "G2_N")));
                break;
            }
            default:
                return null;
        }
        // every output the chip has must have been driven (guards against a spec that grew a pin)
        for (const pin of R) if (!out.some(l => l.startsWith(`Bo_${pn[pin]} `))) return null;
        return out;
    }
}

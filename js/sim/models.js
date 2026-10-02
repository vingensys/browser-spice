// Part model library. Parameter sets follow standard SPICE models so the same
// numbers appear in exported .cir files.
//
// kind -> name -> { desc, spice (the .model line body), params (engine params) }

const SIM_MODELS = {
    D: {
        "1N4148": { desc: "Small-signal switching diode", params: { is: 2.52e-9, n: 1.752, rs: 0.568, bv: 100, ibv: 100e-6, cjo: 4e-12, vj: 0.5, m: 0.4, tt: 20e-9 } },
        "1N4007": { desc: "1 A rectifier, 1000 V", params: { is: 76.9e-12, n: 1.45, rs: 0.0342, bv: 1000, ibv: 5e-6, cjo: 39.8e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
        "1N5819": { desc: "1 A Schottky, 40 V", params: { is: 31.7e-6, n: 1.373, rs: 0.0432, bv: 40, ibv: 1e-3, cjo: 110e-12, vj: 0.34, m: 0.38, tt: 0 } },
        "IDEAL": { desc: "Ideal diode (tiny drop)", params: { is: 1e-12, n: 0.1, rs: 0 } }
    },
    LED: {
        "RED": { desc: "Red LED, Vf ~1.8 V", params: { is: 7.7e-18, n: 2, rs: 3, bv: 5, ibv: 10e-6, cjo: 30e-12, vj: 0.8, m: 0.4 } },
        "YELLOW": { desc: "Yellow LED, Vf ~2.0 V", params: { is: 2.0e-19, n: 2, rs: 3, bv: 5, ibv: 10e-6, cjo: 30e-12, vj: 0.8, m: 0.4 } },
        "GREEN": { desc: "Green LED, Vf ~2.1 V", params: { is: 2.3e-20, n: 2, rs: 3, bv: 5, ibv: 10e-6, cjo: 30e-12, vj: 0.8, m: 0.4 } },
        "BLUE": { desc: "Blue/white LED, Vf ~3.0 V", params: { is: 6.6e-28, n: 2, rs: 4, bv: 5, ibv: 10e-6, cjo: 30e-12, vj: 0.8, m: 0.4 } }
    },
    DZ: {
        "3V3": { desc: "3.3 V zener (1N4728A)", params: { is: 1e-14, n: 1, rs: 10, bv: 3.3, ibv: 76e-3, nbv: 1 } },
        "5V1": { desc: "5.1 V zener (1N4733A)", params: { is: 1e-14, n: 1, rs: 7, bv: 5.1, ibv: 49e-3, nbv: 1 } },
        "9V1": { desc: "9.1 V zener (1N4739A)", params: { is: 1e-14, n: 1, rs: 5, bv: 9.1, ibv: 28e-3, nbv: 1 } },
        "12V": { desc: "12 V zener (1N4742A)", params: { is: 1e-14, n: 1, rs: 9, bv: 12, ibv: 21e-3, nbv: 1 } }
    },
    BJT_NPN: {
        "2N2222": { desc: "General purpose NPN, 800 mA", params: { is: 14.34e-15, bf: 255.9, br: 6.092, nf: 1, nr: 1, vaf: 74.03, cje: 22.01e-12, vje: 0.75, mje: 0.377, cjc: 7.306e-12, vjc: 0.75, mjc: 0.3416, tf: 411.1e-12, tr: 46.91e-9 } },
        "2N3904": { desc: "General purpose NPN, 200 mA", params: { is: 6.734e-15, bf: 416.4, br: 0.7371, nf: 1, nr: 1, vaf: 74.03, cje: 4.493e-12, vje: 0.75, mje: 0.2593, cjc: 3.638e-12, vjc: 0.75, mjc: 0.3085, tf: 301.2e-12, tr: 239.5e-9 } },
        "BC547": { desc: "Small-signal NPN, 100 mA", params: { is: 7.0e-15, bf: 400, br: 10, nf: 1, nr: 1, vaf: 80, cje: 11e-12, cjc: 4.5e-12, tf: 400e-12, tr: 50e-9 } },
        "TIP31": { desc: "Power NPN, 3 A", params: { is: 1e-13, bf: 100, br: 5, nf: 1, nr: 1, vaf: 100 } }
    },
    BJT_PNP: {
        "2N3906": { desc: "General purpose PNP, 200 mA", params: { is: 1.41e-15, bf: 180.7, br: 4.977, nf: 1, nr: 1, vaf: 18.7, cje: 4.491e-12, vje: 0.75, mje: 0.2593, cjc: 3.638e-12, vjc: 0.75, mjc: 0.3085, tf: 225e-12, tr: 85e-9 } },
        "BC557": { desc: "Small-signal PNP, 100 mA", params: { is: 1.0e-14, bf: 300, br: 5, nf: 1, nr: 1, vaf: 50 } },
        "TIP32": { desc: "Power PNP, 3 A", params: { is: 1e-13, bf: 100, br: 5, nf: 1, nr: 1, vaf: 100 } }
    },
    NMOS: {
        "2N7000": { desc: "Small N-MOSFET, 60 V / 200 mA", params: { vto: 2.0, beta: 0.025, lambda: 0.01, cgs: 18e-12, cgd: 3e-12, bodyDiode: { is: 1e-12, n: 1.2, rs: 0.5 } } },
        "IRF540": { desc: "Power N-MOSFET, 100 V / 28 A", params: { vto: 3.5, beta: 3.5, lambda: 0.005, rd: 0.008, rs: 0.004, cgs: 1.6e-9, cgd: 100e-12, bodyDiode: { is: 1e-11, n: 1.2, rs: 0.01 } } },
        "BS170": { desc: "Small N-MOSFET, 60 V / 500 mA", params: { vto: 2.0, beta: 0.04, lambda: 0.01, cgs: 24e-12, cgd: 4e-12, bodyDiode: { is: 1e-12, n: 1.2, rs: 0.5 } } }
    },
    PMOS: {
        "BS250": { desc: "Small P-MOSFET, 45 V / 180 mA", params: { vto: 2.0, beta: 0.015, lambda: 0.01, cgs: 40e-12, cgd: 5e-12, bodyDiode: { is: 1e-12, n: 1.2, rs: 1 } } },
        "IRF9540": { desc: "Power P-MOSFET, 100 V / 19 A", params: { vto: 3.5, beta: 2.0, lambda: 0.005, cgs: 1.4e-9, cgd: 120e-12, bodyDiode: { is: 1e-11, n: 1.2, rs: 0.02 } } }
    },
    OPAMP: {
        "LM741": { desc: "Classic bipolar op-amp, 1 MHz GBW", params: { gain: 2e5, gbw: 1e6, ro: 75, drop: 1.5, rin: 2e6 } },
        "TL072": { desc: "JFET-input op-amp, 3 MHz GBW", params: { gain: 2e5, gbw: 3e6, ro: 50, drop: 1.5, rin: 1e12 } },
        "LM358": { desc: "Dual op-amp, single supply capable", params: { gain: 1e5, gbw: 1e6, ro: 50, drop: 1.5, rin: 2e6 } },
        "IDEAL": { desc: "Ideal op-amp (huge gain / bandwidth)", params: { gain: 1e6, gbw: 1e9, ro: 1, drop: 0, rin: 1e12 } }
    }
};

const SIM_DEFAULT_MODEL = {
    D: "1N4148", LED: "RED", DZ: "5V1",
    BJT_NPN: "2N2222", BJT_PNP: "2N3906",
    NMOS: "2N7000", PMOS: "BS250", OPAMP: "LM741"
};

function simModel(kind, name) {
    const set = SIM_MODELS[kind];
    if (!set) return null;
    return set[name] || set[SIM_DEFAULT_MODEL[kind]];
}

// Render model parameters as a standard SPICE ".model" card (for .cir export / interop)
function simModelCardFromParams(kind, name, p) {
    if (!p) return null;
    const f = (v) => (typeof v === "number" ? Number(v.toPrecision(6)).toString() : v);

    if (kind === "D" || kind === "LED" || kind === "DZ") {
        const parts = [`IS=${f(p.is)}`, `N=${f(p.n)}`];
        if (p.rs) parts.push(`RS=${f(p.rs)}`);
        if (isFinite(p.bv)) parts.push(`BV=${f(p.bv)}`, `IBV=${f(p.ibv)}`);
        if (p.cjo) parts.push(`CJO=${f(p.cjo)}`, `VJ=${f(p.vj)}`, `M=${f(p.m)}`);
        if (p.tt) parts.push(`TT=${f(p.tt)}`);
        if (p.kf) parts.push(`KF=${f(p.kf)}`, `AF=${f(p.af === undefined ? 1 : p.af)}`);
        return `.model ${name} D(${parts.join(" ")})`;
    }
    if (kind === "BJT_NPN" || kind === "BJT_PNP") {
        const t = kind === "BJT_NPN" ? "NPN" : "PNP";
        const parts = [`IS=${f(p.is)}`, `BF=${f(p.bf)}`, `BR=${f(p.br)}`, `NF=${f(p.nf)}`, `NR=${f(p.nr)}`, `VAF=${f(p.vaf)}`];
        if (p.var) parts.push(`VAR=${f(p.var)}`);
        if (p.ikf) parts.push(`IKF=${f(p.ikf)}`);
        if (p.ikr) parts.push(`IKR=${f(p.ikr)}`);
        if (p.ise) parts.push(`ISE=${f(p.ise)}`, `NE=${f(p.ne === undefined ? 1.5 : p.ne)}`);
        if (p.isc) parts.push(`ISC=${f(p.isc)}`, `NC=${f(p.nc === undefined ? 2 : p.nc)}`);
        if (p.rb) parts.push(`RB=${f(p.rb)}`);
        if (p.rc) parts.push(`RC=${f(p.rc)}`);
        if (p.re) parts.push(`RE=${f(p.re)}`);
        if (p.cje) parts.push(`CJE=${f(p.cje)}`, `VJE=${f(p.vje || 0.75)}`, `MJE=${f(p.mje || 0.33)}`);
        if (p.cjc) parts.push(`CJC=${f(p.cjc)}`, `VJC=${f(p.vjc || 0.75)}`, `MJC=${f(p.mjc || 0.33)}`);
        if (p.tf) parts.push(`TF=${f(p.tf)}`);
        if (p.tr) parts.push(`TR=${f(p.tr)}`);
        if (p.kf) parts.push(`KF=${f(p.kf)}`, `AF=${f(p.af === undefined ? 1 : p.af)}`);
        return `.model ${name} ${t}(${parts.join(" ")})`;
    }
    if (kind === "NMOS" || kind === "PMOS") {
        const t = kind === "NMOS" ? "NMOS" : "PMOS";
        // Level 1: KP * W/L = beta, so use W=L=1u and KP=beta
        const w = p.w || 1e-6, l = p.l || 1e-6;
        const opt = (k, v) => (v ? ` ${k}=${f(v)}` : "");
        const extra = `${opt("RD", p.rd)}${opt("RS", p.rs)}${opt("GAMMA", p.gamma)}${p.phi && p.phi !== 0.6 ? ` PHI=${f(p.phi)}` : ""}${p.isb !== undefined ? ` IS=${f(p.isb)}` : ""}${opt("PB", p.pb && p.pb !== 0.8 ? p.pb : 0)}${opt("CBD", p.cbd)}${opt("CBS", p.cbs)}${opt("CJ", p.cj)}${opt("CJSW", p.cjsw)}${opt("MJ", p.mj && p.mj !== 0.5 ? p.mj : 0)}${opt("MJSW", p.mjsw && p.mjsw !== 0.33 ? p.mjsw : 0)}${opt("CGSO", p.cgso)}${opt("CGDO", p.cgdo)}${opt("CGBO", p.cgbo)}${opt("TOX", p.tox)}`;
        return `.model ${name} ${t}(LEVEL=1 VTO=${f(kind === "NMOS" ? p.vto : -p.vto)} KP=${f((p.beta * l) / w)} LAMBDA=${f(p.lambda)}${extra})`;
    }
    if (kind === "JFET_N" || kind === "JFET_P") {
        const parts = [`VTO=${f(p.vto)}`, `BETA=${f(p.beta)}`, `LAMBDA=${f(p.lambda || 0)}`];
        if (p.rd) parts.push(`RD=${f(p.rd)}`);
        if (p.rs) parts.push(`RS=${f(p.rs)}`);
        if (p.is) parts.push(`IS=${f(p.is)}`);
        if (p.cgs) parts.push(`CGS=${f(p.cgs)}`);
        if (p.cgd) parts.push(`CGD=${f(p.cgd)}`);
        if (p.pb && p.pb !== 1) parts.push(`PB=${f(p.pb)}`);
        return `.model ${name} ${kind === "JFET_N" ? "NJF" : "PJF"}(${parts.join(" ")})`;
    }
    return null;
}

function simModelCard(kind, name) {
    const m = simModel(kind, name);
    return m ? simModelCardFromParams(kind, name, m.params) : null;
}

// Extended part-model library. Load AFTER js/sim/models.js: it extends the global
// SIM_MODELS in place using the same { desc, params } schema.
//
// Only numeric parameter facts are used. Sources (public vendor SPICE model files and
// datasheets; numbers re-typed into the engine's parameter schema):
//   [DI]  Diodes Inc public SPICE library (rectifier / switching / MOSFET files)
//   [NXP] NXP (Philips) public SPICE models (diodes, BJTs, JFETs)
//   [FSC] Fairchild / onsemi models and datasheets (BJT, 2N7002, FQP30N06L, FQP27P06)
//   [IR]  International Rectifier MODPEX level-1 power MOSFET models (W=L=100u so KP == beta)
//   [LS]  Linear Systems / InterFET / Vishay JFET models (LTspice standard.jft numbers)
//   [TI]  TI / Microchip op-amp datasheets (open-loop gain, GBW, Zo, input resistance, swing)
//   [KiCad-Spice-Library] was used as the public mirror of the vendor files above.
//
// Engine conventions (see js/sim/devices.js):
//   BJT  : is bf br nf nr vaf cje vje mje cjc vjc mjc tf tr (no ikf/rb/rc/re/ise in the engine,
//          so bf is the sourced forward beta and is constant with current).
//   MOS  : vto = positive threshold magnitude (N and P), beta = KP*W/L in A/V^2,
//          level-1 square law, cgs/cgd constant, optional bodyDiode.
//   Zener: bv is the knee voltage and ibv the test current; rs the datasheet dynamic
//          impedance. bv is set so the engine reproduces Vz at Izt (bv + rs*Izt = Vz).
//   JFET : (new kinds JFET_N / JFET_P) vto = pinch-off voltage in N-equivalent coordinates,
//          negative for BOTH kinds; beta in A/V^2, lambda, rd, rs, cgs, cgd, pb, is.
//          Idss = beta * vto^2.
//   OPAMP: gain (V/V open loop), gbw, ro, drop (output headroom from each rail), rin.
//          "est" in a comment = the datasheet does not list that number; class-typical value.

Object.assign(SIM_MODELS.D, {
    // [DI] 1 A rectifiers; same die, BV / Cj differ per grade
    "1N4001": { desc: "1 A rectifier, 50 V", params: { is: 76.9e-12, n: 1.45, rs: 42e-3, bv: 50, ibv: 5e-6, cjo: 39.8e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N4002": { desc: "1 A rectifier, 100 V", params: { is: 76.9e-12, n: 1.45, rs: 42e-3, bv: 100, ibv: 5e-6, cjo: 39.8e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N4003": { desc: "1 A rectifier, 200 V", params: { is: 76.9e-12, n: 1.45, rs: 42e-3, bv: 200, ibv: 5e-6, cjo: 39.8e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N4004": { desc: "1 A rectifier, 400 V", params: { is: 76.9e-12, n: 1.45, rs: 42e-3, bv: 400, ibv: 5e-6, cjo: 39.8e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N4005": { desc: "1 A rectifier, 600 V", params: { is: 76.9e-12, n: 1.45, rs: 42e-3, bv: 600, ibv: 5e-6, cjo: 26.5e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N4006": { desc: "1 A rectifier, 800 V", params: { is: 76.9e-12, n: 1.45, rs: 42e-3, bv: 800, ibv: 5e-6, cjo: 26.5e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    // [DI] 3 A rectifiers
    "1N5400": { desc: "3 A rectifier, 50 V", params: { is: 63e-9, n: 1.7, rs: 14.1e-3, bv: 50, ibv: 10e-6, cjo: 53e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N5401": { desc: "3 A rectifier, 100 V", params: { is: 63e-9, n: 1.7, rs: 14.1e-3, bv: 100, ibv: 10e-6, cjo: 53e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N5402": { desc: "3 A rectifier, 200 V", params: { is: 63e-9, n: 1.7, rs: 14.1e-3, bv: 200, ibv: 10e-6, cjo: 53e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N5404": { desc: "3 A rectifier, 400 V", params: { is: 63e-9, n: 1.7, rs: 14.1e-3, bv: 400, ibv: 10e-6, cjo: 53e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N5406": { desc: "3 A rectifier, 600 V", params: { is: 63e-9, n: 1.7, rs: 14.1e-3, bv: 600, ibv: 10e-6, cjo: 53e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N5407": { desc: "3 A rectifier, 800 V", params: { is: 63e-9, n: 1.7, rs: 14.1e-3, bv: 800, ibv: 10e-6, cjo: 53e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    "1N5408": { desc: "3 A rectifier, 1000 V", params: { is: 63e-9, n: 1.7, rs: 14.1e-3, bv: 1000, ibv: 10e-6, cjo: 53e-12, vj: 0.7, m: 0.333, tt: 4.32e-6 } },
    // [KiCad-Spice-Library / onsemi] 1N5817/18 differ from the existing 1N5819 only in Cj and VRRM
    "1N5817": { desc: "1 A Schottky, 20 V", params: { is: 31.7e-6, n: 1.373, rs: 0.051, bv: 20, ibv: 1e-3, cjo: 190e-12, vj: 0.34, m: 0.3, tt: 0, eg: 0.69, xti: 2 } },
    "1N5818": { desc: "1 A Schottky, 30 V", params: { is: 31.7e-6, n: 1.373, rs: 0.051, bv: 30, ibv: 1e-3, cjo: 160e-12, vj: 0.34, m: 0.38, tt: 0, eg: 0.69, xti: 2 } },
    // [KiCad-Spice-Library / onsemi] small signal
    "1N914": { desc: "Small-signal switching diode, 75 V", params: { is: 2.52e-9, n: 1.752, rs: 0.568, bv: 100, ibv: 100e-6, cjo: 4e-12, vj: 0.5, m: 0.4, tt: 20e-9 } },
    // [DI] 1N4448W / BAS16W die
    "1N4448": { desc: "Small-signal switching diode, 100 V", params: { is: 68.6e-9, n: 2.34, rs: 0.377, bv: 100, ibv: 2.5e-6, cjo: 1.72e-12, vj: 0.7, m: 0.333, tt: 5.76e-9 } },
    "BAS16": { desc: "SOT-23 switching diode, 75 V", params: { is: 68.6e-9, n: 2.34, rs: 0.377, bv: 75, ibv: 1e-6, cjo: 1.72e-12, vj: 0.7, m: 0.333, tt: 5.76e-9 } },
    // [NXP] BAT54 SPICE model
    "BAT54": { desc: "Small-signal Schottky, 30 V", params: { is: 2.117e-7, n: 1.016, rs: 2.637, bv: 36, ibv: 1.196e-6, cjo: 11.14e-12, vj: 0.2013, m: 0.3868, tt: 0, eg: 0.69, xti: 2 } },
    // [KiCad-Spice-Library] fast / ultrafast recovery
    "UF4007": { desc: "Ultrafast rectifier, 1 A / 1000 V", params: { is: 3.28772e-6, n: 3.97671, rs: 0.149734, bv: 1000, ibv: 0.2e-3, cjo: 29.2655e-12, vj: 0.851862, m: 0.334552, tt: 184.973e-9 } },
    "MUR1560": { desc: "Ultrafast rectifier, 15 A / 600 V", params: { is: 95.51e-12, n: 1, rs: 46.69e-3, bv: 600, ibv: 10e-6, cjo: 525.4e-12, vj: 0.75, m: 0.414, tt: 148e-9, xti: 6 } }
});

// LED: Vf at 20 mA. IR/white from public vendor LED models; orange fitted to the typical
// datasheet Vf of ~2.0 V at 20 mA (AlGaInP, same n=2 / rs=3 form as the existing RED/YELLOW).
Object.assign(SIM_MODELS.LED, {
    "ORANGE": { desc: "Orange LED, Vf ~2.0 V", params: { is: 2.0e-19, n: 2, rs: 3, bv: 5, ibv: 10e-6, cjo: 30e-12, vj: 0.8, m: 0.4 } },
    "WHITE": { desc: "White LED, Vf ~3.2 V", params: { is: 0.27e-9, n: 6.79, rs: 5.65, bv: 5, ibv: 10e-6, cjo: 42e-12, vj: 0.8, m: 0.4 } },
    "IR": { desc: "IR LED (940 nm), Vf ~1.3 V", params: { is: 36.4e-21, n: 1.262, rs: 0.778, bv: 5, ibv: 10e-6, cjo: 100e-12, vj: 0.8, m: 0.4 } }
});

// Zeners: datasheet Vz @ Izt and Zzt (1N47xxA 1 W series, 1N5223B 500 mW for 2V7).
// bv = Vz - rs*Izt so the series resistance does not push Vz above the datasheet value.
Object.assign(SIM_MODELS.DZ, {
    "2V7": { desc: "2.7 V zener (1N5223B)", params: { is: 1e-14, n: 1, rs: 30, bv: 2.1, ibv: 20e-3, nbv: 1 } },
    "3V9": { desc: "3.9 V zener (1N4730A)", params: { is: 1e-14, n: 1, rs: 9, bv: 3.9 - 9 * 64e-3, ibv: 64e-3, nbv: 1 } },
    "4V7": { desc: "4.7 V zener (1N4732A)", params: { is: 1e-14, n: 1, rs: 8, bv: 4.7 - 8 * 53e-3, ibv: 53e-3, nbv: 1 } },
    "6V2": { desc: "6.2 V zener (1N4735A)", params: { is: 1e-14, n: 1, rs: 2, bv: 6.2 - 2 * 41e-3, ibv: 41e-3, nbv: 1 } },
    "6V8": { desc: "6.8 V zener (1N4736A)", params: { is: 1e-14, n: 1, rs: 3.5, bv: 6.8 - 3.5 * 37e-3, ibv: 37e-3, nbv: 1 } },
    "7V5": { desc: "7.5 V zener (1N4737A)", params: { is: 1e-14, n: 1, rs: 4, bv: 7.5 - 4 * 34e-3, ibv: 34e-3, nbv: 1 } },
    "8V2": { desc: "8.2 V zener (1N4738A)", params: { is: 1e-14, n: 1, rs: 4.5, bv: 8.2 - 4.5 * 31e-3, ibv: 31e-3, nbv: 1 } },
    "10V": { desc: "10 V zener (1N4740A)", params: { is: 1e-14, n: 1, rs: 7, bv: 10 - 7 * 25e-3, ibv: 25e-3, nbv: 1 } },
    "15V": { desc: "15 V zener (1N4744A)", params: { is: 1e-14, n: 1, rs: 14, bv: 15 - 14 * 17e-3, ibv: 17e-3, nbv: 1 } },
    "18V": { desc: "18 V zener (1N4746A)", params: { is: 1e-14, n: 1, rs: 20, bv: 18 - 20 * 14e-3, ibv: 14e-3, nbv: 1 } },
    "24V": { desc: "24 V zener (1N4749A)", params: { is: 1e-14, n: 1, rs: 25, bv: 24 - 25 * 10.5e-3, ibv: 10.5e-3, nbv: 1 } },
    "27V": { desc: "27 V zener (1N4750A)", params: { is: 1e-14, n: 1, rs: 35, bv: 27 - 35 * 9.5e-3, ibv: 9.5e-3, nbv: 1 } }
});

Object.assign(SIM_MODELS.BJT_NPN, {
    // [FSC] Fairchild 2N2222A / PN2222(A) / 2N2219A (NXP copy of the same numbers)
    "2N2222A": { desc: "General purpose NPN, 800 mA, 40 V", params: { is: 14.34e-15, bf: 255.9, br: 6.092, nf: 1, nr: 1, vaf: 74.03, cje: 22.01e-12, vje: 0.75, mje: 0.377, cjc: 7.306e-12, vjc: 0.75, mjc: 0.3416, tf: 411.1e-12, tr: 46.91e-9 } },
    "PN2222": { desc: "General purpose NPN, 1 A, 40 V (TO-92)", params: { is: 14.34e-15, bf: 255.9, br: 6.092, nf: 1, nr: 1, vaf: 74.03, cje: 22.01e-12, vje: 0.75, mje: 0.377, cjc: 7.306e-12, vjc: 0.75, mjc: 0.3416, tf: 411.1e-12, tr: 46.91e-9 } },
    "PN2222A": { desc: "General purpose NPN, 1 A, 40 V (TO-92)", params: { is: 14.34e-15, bf: 255.9, br: 6.092, nf: 1, nr: 1, vaf: 74.03, cje: 22.01e-12, vje: 0.75, mje: 0.377, cjc: 7.306e-12, vjc: 0.75, mjc: 0.3416, tf: 411.1e-12, tr: 46.91e-9 } },
    "2N2219A": { desc: "General purpose NPN, 800 mA, 40 V (TO-39)", params: { is: 14.34e-15, bf: 255.9, br: 6.092, nf: 1, nr: 1, vaf: 74.03, cje: 22.01e-12, vje: 0.75, mje: 0.377, cjc: 7.306e-12, vjc: 0.75, mjc: 0.3416, tf: 411.1e-12, tr: 46.91e-9 } },
    // [NXP/Philips] BC337-25, BC546B, BC548B, BC549C
    "BC337": { desc: "NPN, 800 mA, 45 V (BC337-25)", params: { is: 41.3e-15, bf: 292.4, br: 23.68, nf: 0.9822, nr: 0.982, vaf: 145.7, cje: 37.99e-12, vje: 0.6752, mje: 0.3488, cjc: 13.55e-12, vjc: 0.3523, mjc: 0.3831, tf: 540e-12, tr: 30e-9 } },
    "BC546": { desc: "Small-signal NPN, 100 mA, 65 V (BC546B)", params: { is: 23.9e-15, bf: 294.3, br: 7.946, nf: 1.008, nr: 1.004, vaf: 63.2, cje: 13.58e-12, vje: 0.65, mje: 0.3279, cjc: 3.728e-12, vjc: 0.3997, mjc: 0.2955, tf: 439.1e-12, tr: 0 } },
    "BC548": { desc: "Small-signal NPN, 100 mA, 30 V (BC548B)", params: { is: 7.049e-15, bf: 374.6, br: 1, nf: 1, nr: 1, vaf: 62.79, cje: 11.5e-12, vje: 0.5, mje: 0.6715, cjc: 5.25e-12, vjc: 0.5697, mjc: 0.3147, tf: 410.2e-12, tr: 10e-9 } },
    "BC549": { desc: "Low-noise NPN, 100 mA, 30 V (BC549C)", params: { is: 7.049e-15, bf: 493.2, br: 2.886, nf: 1, nr: 1, vaf: 23.89, cje: 11.5e-12, vje: 0.5, mje: 0.6558, cjc: 5.5e-12, vjc: 0.4924, mjc: 0.3132, tf: 420.3e-12, tr: 10e-9 } },
    // [FSC] 2N5551, 2N5088
    "2N5551": { desc: "High-voltage NPN, 600 mA, 160 V", params: { is: 2.511e-15, bf: 242.6, br: 3.197, nf: 1, nr: 1, vaf: 100, cje: 18.79e-12, vje: 0.65, mje: 0.3416, cjc: 4.883e-12, vjc: 0.65, mjc: 0.3047, tf: 560e-12, tr: 1.202e-9 } },
    "2N5088": { desc: "Low-noise high-gain NPN, 50 mA, 30 V", params: { is: 5.911e-15, bf: 1122, br: 1.271, nf: 1, nr: 1, vaf: 62.37, cje: 4.973e-12, vje: 0.65, mje: 0.4146, cjc: 4.017e-12, vjc: 0.65, mjc: 0.3174, tf: 821.7e-12, tr: 4.673e-9 } },
    // [DI] MMBT4401 junction/transit numbers; bf set to the datasheet mid hFE (100..300) at 150 mA
    "2N4401": { desc: "General purpose NPN, 600 mA, 40 V", params: { is: 60.9e-15, bf: 200, br: 4, nf: 1, nr: 1, vaf: 114, cje: 36.2e-12, vje: 1.1, mje: 0.5, cjc: 15.4e-12, vjc: 0.3, mjc: 0.3, tf: 717e-12, tr: 121e-9 } },
    // [FSC] BD139
    "BD139": { desc: "Medium-power NPN, 1.5 A, 80 V", params: { is: 239.85e-15, bf: 244.9, br: 78.11, nf: 1, nr: 1.007, vaf: 98.5, cje: 292.7e-12, vje: 0.67412, mje: 0.33, cjc: 48.83e-12, vjc: 0.5258, mjc: 0.3928, tf: 0, tr: 0 } },
    // [KiCad-Spice-Library standard.bjt] TIP41 junction numbers (is/bf/vaf/caps/tf/tr)
    "TIP41": { desc: "Power NPN, 6 A, 40-100 V", params: { is: 457.5e-15, bf: 156.7, br: 7.639, nf: 1, nr: 1, vaf: 50, cje: 433e-12, vje: 0.75, mje: 0.5, cjc: 278.7e-12, vjc: 0.75, mjc: 0.385, tf: 37.34e-9, tr: 1.412e-6 } },
    // [STMicro 2N3055 model] bf/br/caps/tf/tr; is refit (source is=2.37e-8 relied on series Rb the engine lacks)
    "2N3055": { desc: "Power NPN, 15 A, 60 V", params: { is: 1e-13, bf: 73, br: 2.66, nf: 1, nr: 1, vaf: 100, cje: 415e-12, vje: 0.75, mje: 0.5, cjc: 1000e-12, vjc: 0.75, mjc: 0.33, tf: 99.52e-9, tr: 570.3e-9 } }
});

Object.assign(SIM_MODELS.BJT_PNP, {
    // [FSC] PN2907A (= 2N2907A silicon), 2N4403, 2N5401
    "2N2907A": { desc: "General purpose PNP, 600 mA, 60 V", params: { is: 650.6e-18, bf: 231.7, br: 3.563, nf: 1, nr: 1, vaf: 115.7, cje: 19.82e-12, vje: 0.75, mje: 0.3357, cjc: 14.76e-12, vjc: 0.75, mjc: 0.5383, tf: 603.7e-12, tr: 111.3e-9 } },
    "2N4403": { desc: "General purpose PNP, 600 mA, 40 V", params: { is: 650.6e-18, bf: 216.2, br: 3.578, nf: 1, nr: 1, vaf: 115.7, cje: 19.82e-12, vje: 0.75, mje: 0.3357, cjc: 14.76e-12, vjc: 0.75, mjc: 0.5383, tf: 603.7e-12, tr: 111.6e-9 } },
    "2N5401": { desc: "High-voltage PNP, 600 mA, 150 V", params: { is: 21.48e-15, bf: 132.1, br: 3.661, nf: 1, nr: 1, vaf: 100, cje: 73.39e-12, vje: 0.75, mje: 0.3777, cjc: 17.63e-12, vjc: 0.75, mjc: 0.5312, tf: 641.9e-12, tr: 1.476e-9 } },
    // [NXP/Philips] BC327-25, BC556B, BC558B
    "BC327": { desc: "PNP, 800 mA, 45 V (BC327-25)", params: { is: 108e-15, bf: 385.7, br: 20.57, nf: 0.99, nr: 0.9849, vaf: 31.29, cje: 51.14e-12, vje: 0.8911, mje: 0.4417, cjc: 26.56e-12, vjc: 0.62, mjc: 0.4836, tf: 735.9e-12, tr: 50e-9 } },
    "BC556": { desc: "Small-signal PNP, 100 mA, 65 V (BC556B)", params: { is: 38.3e-15, bf: 344.4, br: 14.84, nf: 1.008, nr: 1.005, vaf: 21.11, cje: 12.3e-12, vje: 0.6106, mje: 0.378, cjc: 10.8e-12, vjc: 0.1022, mjc: 0.3563, tf: 560e-12, tr: 0 } },
    "BC558": { desc: "Small-signal PNP, 100 mA, 30 V (BC558B)", params: { is: 1.02e-15, bf: 306.5, br: 6.48, nf: 1, nr: 1, vaf: 52.31, cje: 30e-12, vje: 0.5, mje: 0.3333, cjc: 9.81e-12, vjc: 0.4865, mjc: 0.332, tf: 611.6e-12, tr: 10e-9 } },
    // [FSC] BD140
    "BD140": { desc: "Medium-power PNP, 1.5 A, 80 V", params: { is: 295.37e-15, bf: 201.4, br: 23.765, nf: 1, nr: 1.021, vaf: 137, cje: 219.82e-12, vje: 0.7211, mje: 0.3685, cjc: 68.291e-12, vjc: 0.5499, mjc: 0.3668, tf: 0, tr: 0 } },
    // [KiCad-Spice-Library standard.bjt] TIP42
    "TIP42": { desc: "Power PNP, 6 A, 40-100 V", params: { is: 66.19e-15, bf: 137.6, br: 5.88, nf: 1, nr: 1, vaf: 100, cje: 390.1e-12, vje: 0.75, mje: 0.4343, cjc: 870.4e-12, vjc: 0.75, mjc: 0.6481, tf: 23.21e-9, tr: 235.4e-9 } }
});

// Power MOSFETs: [IR] MODPEX level-1 models (VTO, KP, RD, RS, LAMBDA taken directly; W=L=100u so KP == beta).
// cgs = CGSO*W; cgd = gate-drain junction capacitance evaluated at Vds = 25 V (the datasheet Crss condition);
// bodyDiode from the model's drain-source diode (cjo/vj/m include Cds).
Object.assign(SIM_MODELS.NMOS, {
    "IRF510": { desc: "Power N-MOSFET, 100 V / 5.6 A", params: { vto: 3.82703, beta: 2.48457, lambda: 0, rd: 0.0673242, rs: 0.276929, cgs: 172e-12, cgd: 14.3e-12, bodyDiode: { is: 6.52734e-11, n: 1.2565, rs: 0.0458243, bv: 100, ibv: 250e-6, cjo: 298.6e-12, vj: 0.774158, m: 0.422859 } } },
    "IRF520": { desc: "Power N-MOSFET, 100 V / 9.2 A", params: { vto: 3.61397, beta: 3.9143, lambda: 0.00572642, rd: 0.01473, rs: 0.171045, cgs: 328e-12, cgd: 33.4e-12, bodyDiode: { is: 7.10668e-11, n: 1.21428, rs: 0.0302634, bv: 100, ibv: 250e-6, cjo: 502e-12, vj: 0.565258, m: 0.378444 } } },
    "IRF530": { desc: "Power N-MOSFET, 100 V / 14 A", params: { vto: 3.87932, beta: 7.05019, lambda: 0.00393789, rd: 0.0001, rs: 0.073836, cgs: 611e-12, cgd: 72.5e-12, bodyDiode: { is: 9.70956e-10, n: 1.31938, rs: 0.0137423, bv: 100, ibv: 250e-6, cjo: 1.03e-9, vj: 1.46661, m: 0.501224 } } },
    "IRF630": { desc: "Power N-MOSFET, 200 V / 9 A", params: { vto: 3.90614, beta: 2.70091, lambda: 0, rd: 0.169992, rs: 0.0001, cgs: 726e-12, cgd: 79.9e-12, bodyDiode: { is: 2.59955e-15, n: 0.818263, rs: 0.0232241, bv: 200, ibv: 250e-6, cjo: 636e-12, vj: 5, m: 0.772431 } } },
    "IRFZ44N": { desc: "Power N-MOSFET, 55 V / 49 A", params: { vto: 3.56214, beta: 39.3974, lambda: 0, rd: 0.0001, rs: 0.0133305, cgs: 1.25e-9, cgd: 154e-12, bodyDiode: { is: 9.64635e-13, n: 1.01377, rs: 0.00967689, bv: 55, ibv: 250e-6, cjo: 1.39e-9, vj: 0.5, m: 0.42532 } } },
    "IRF3205": { desc: "Power N-MOSFET, 55 V / 110 A", params: { vto: 3.73234, beta: 95.6501, lambda: 0, rd: 0.0001, rs: 0.00550387, cgs: 3.64e-9, cgd: 429e-12, bodyDiode: { is: 3.83979e-8, n: 1.48671, rs: 0.00445428, bv: 55, ibv: 250e-6, cjo: 3.68e-9, vj: 1.02405, m: 0.469188 } } },
    "IRLZ44N": { desc: "Logic-level N-MOSFET, 55 V / 47 A", params: { vto: 2.08819, beta: 67.9211, lambda: 0.0038193, rd: 0.00179971, rs: 0.014066, cgs: 1.59e-9, cgd: 129e-12, bodyDiode: { is: 4.4574e-9, n: 1.40246, rs: 0.007275, bv: 55, ibv: 250e-6, cjo: 892e-12, vj: 4.94724, m: 0.75496 } } },
    "IRL540": { desc: "Logic-level N-MOSFET, 100 V / 28 A", params: { vto: 1.78693, beta: 35.8549, lambda: 0, rd: 0.0288856, rs: 0.0162895, cgs: 2.12e-9, cgd: 129e-12, bodyDiode: { is: 1.51986e-9, n: 1.30121, rs: 0.0106058, bv: 100, ibv: 250e-6, cjo: 1.68e-9, vj: 1.94254, m: 0.516253 } } },
    // [FSC] FQP30N06L datasheet fit: Vth 1.0..2.5 V, Rds(on) 27 mohm typ / 35 max @10 V/16 A and <=45 mohm @5 V, Ciss 800 pF, Crss 50 pF;
    // body diode from the onsemi FQP30N06L model
    "FQP30N06L": { desc: "Logic-level N-MOSFET, 60 V / 32 A", params: { vto: 1.5, beta: 8.0, lambda: 0.005, rd: 0.003, rs: 0.007, cgs: 750e-12, cgd: 50e-12, bodyDiode: { is: 6e-10, n: 1.3, rs: 4.4e-3, bv: 60, ibv: 250e-6, cjo: 890e-12, vj: 0.7, m: 0.4261 } } },
    // [FSC] 2N7002 (Fairchild VDMOS: Vto 1.6, Kp 0.17, Rs 0.75, Cgs 50 pF, Cgd min 12 pF)
    "2N7002": { desc: "Small N-MOSFET, 60 V / 115 mA (SOT-23)", params: { vto: 1.6, beta: 0.17, lambda: 0, rd: 0, rs: 0.75, cgs: 50e-12, cgd: 12e-12, bodyDiode: { is: 4e-14, n: 1, rs: 0.14 } } },
    // [DI] BSS138W: level-1 KP=50m @ L=W=100u, Rd=Rs=0.224, CGSO*W / CGDO*W
    "BSS138": { desc: "Logic-level small N-MOSFET, 50 V / 220 mA", params: { vto: 1.2, beta: 0.05, lambda: 83.2e-6, rd: 0.224, rs: 0.224, cgs: 9.6e-12, cgd: 8e-12, bodyDiode: { is: 100e-15, n: 1, rs: 0.5 } } }
});

Object.assign(SIM_MODELS.PMOS, {
    // [IR] IRF9530: VTO/KP/RD/RS from the IR model, cgs from the IRF9530S model (755 pF); cgd from IR junction at 25 V
    "IRF9530": { desc: "Power P-MOSFET, 100 V / 12 A", params: { vto: 3.29858, beta: 5.81678, lambda: 0.00943157, rd: 0.107379, rs: 0.0732334, cgs: 755e-12, cgd: 65.1e-12, bodyDiode: { is: 1e-17, n: 1.5, rs: 0.150832, bv: 100, ibv: 250e-6, cjo: 220e-12, vj: 0.8, m: 0.8 } } },
    "IRF4905": { desc: "Power P-MOSFET, 55 V / 74 A", params: { vto: 3.53713, beta: 23.3701, lambda: 0.00549383, rd: 0.0001, rs: 0.0101265, cgs: 2.84e-9, cgd: 643e-12, bodyDiode: { is: 1.29014e-8, n: 1.46717, rs: 0.00297795, bv: 55, ibv: 250e-6, cjo: 3.57e-9, vj: 1.17553, m: 0.500933 } } },
    // [FSC] FQP27P06 model: VTO 3.10, KP 10.23 with THETA 0.0576 folded in at Vgs=10 V (beta = 10.23 / (1 + 0.0576*6.9)),
    // Rd+Ra 36 mohm, Rs 2 mohm, Cgs 990 pF, Cgd(25 V) from the 1560 pF / 0.24 V / 0.42 junction, body diode and Dds from the model
    "FQP27P06": { desc: "Power P-MOSFET, 60 V / 27 A", params: { vto: 3.1, beta: 7.3, lambda: 0.004, rd: 0.036, rs: 0.002, cgs: 990e-12, cgd: 222e-12, bodyDiode: { is: 3e-13, n: 1, rs: 0.036, bv: 60, ibv: 250e-6, cjo: 1.38e-9, vj: 0.76, m: 0.44, tt: 105e-9 } } },
    // [DI] BSS84W: Rd=Rs=0.84, CGSO*W / CGDO*W; beta refit from the model KP=25m to the datasheet Rds(on) <= 10 ohm @ Vgs=-5 V / 0.1 A
    "BSS84": { desc: "Small P-MOSFET, 50 V / 130 mA", params: { vto: 1.6, beta: 0.036, lambda: 108e-6, rd: 0.84, rs: 0.84, cgs: 14.4e-12, cgd: 12e-12, bodyDiode: { is: 65e-15, n: 1, rs: 1 } } }
});

// JFETs. New kinds: no engine device yet, parameters follow the SPICE JFET model (level 1 / Shichman-Hodges).
// vto is the pinch-off voltage in N-equivalent coordinates (negative for both polarities).
SIM_MODELS.JFET_N = {
    "J201": { desc: "N-JFET, Idss 0.2-1 mA, low noise [LS]", params: { vto: -0.93, beta: 1.07e-3, lambda: 6.75e-3, rd: 10, rs: 12, cgs: 1e-12, cgd: 1e-12, pb: 0.8, is: 1.72e-15 } },
    "2N5457": { desc: "N-JFET, Idss 1-5 mA", params: { vto: -1.372, beta: 1.125e-3, lambda: 2.3e-3, rd: 1, rs: 1, cgs: 4.627e-12, cgd: 4e-12, pb: 0.5, is: 181.3e-15 } },
    "2N5458": { desc: "N-JFET, Idss 2-9 mA", params: { vto: -2.882, beta: 488.9e-6, lambda: 3.167e-3, rd: 1, rs: 1, cgs: 4.627e-12, cgd: 4e-12, pb: 0.5, is: 181.3e-15 } },
    "2N3819": { desc: "N-JFET, Idss 2-20 mA, RF [Vishay]", params: { vto: -3, beta: 1.3e-3, lambda: 2.3e-3, rd: 1, rs: 1, cgs: 2.4e-12, cgd: 1.6e-12, pb: 1, is: 33.6e-15 } },
    "J310": { desc: "N-JFET, Idss 24-60 mA, VHF [LS]", params: { vto: -3.409, beta: 3.384e-3, lambda: 17e-3, rd: 1, rs: 1, cgs: 6.2e-12, cgd: 6.2e-12, pb: 1, is: 193.9e-15 } },
    "BF245A": { desc: "N-JFET, Idss 2-6.5 mA [NXP]", params: { vto: -1.7372, beta: 1.16621e-3, lambda: 0.0177211, rd: 9.01678, rs: 9.01678, cgs: 2.2e-12, cgd: 2.2e-12, pb: 0.780988, is: 291.797e-18 } },
    "BF245B": { desc: "N-JFET, Idss 6-15 mA [NXP]", params: { vto: -2.3085, beta: 1.09045e-3, lambda: 0.0231754, rd: 7.77648, rs: 7.77648, cgs: 2e-12, cgd: 2.2e-12, pb: 0.991494, is: 259.121e-18 } },
    "2N4416": { desc: "N-JFET, Idss 5-15 mA, VHF [LS]", params: { vto: -3.07, beta: 0.989e-3, lambda: 5.5e-3, rd: 1, rs: 1, cgs: 2.414e-12, cgd: 1.6e-12, pb: 1, is: 33.57e-15 } }
};
SIM_MODELS.JFET_P = {
    "2N5460": { desc: "P-JFET, Idss 1-5 mA", params: { vto: -1.75, beta: 1.107e-3, lambda: 20e-3, rd: 1, rs: 1, cgs: 2.92e-12, cgd: 2.34e-12, pb: 1, is: 222.4e-15 } },
    "2N5461": { desc: "P-JFET, Idss 2-9 mA", params: { vto: -1.883, beta: 1.699e-3, lambda: 23e-3, rd: 1, rs: 1, cgs: 2.92e-12, cgd: 2.34e-12, pb: 1, is: 222.4e-15 } },
    "J175": { desc: "P-JFET, Idss 7-60 mA, switch [LS]", params: { vto: -3.762, beta: 1.031e-3, lambda: 28e-3, rd: 1, rs: 1, cgs: 9e-12, cgd: 6.5e-12, pb: 1, is: 461.5e-15 } }
};

if (typeof SIM_DEFAULT_MODEL !== "undefined") {
    SIM_DEFAULT_MODEL.JFET_N = "2N5457";
    SIM_DEFAULT_MODEL.JFET_P = "2N5460";
}

// Op-amps from datasheet typicals at +/-15 V (rail-to-rail parts at their stated supply).
// gain: open-loop V/V; gbw: Hz; ro: ohm; drop: headroom to each rail (V); rin: differential ohm.
Object.assign(SIM_MODELS.OPAMP, {
    "LM324": { desc: "Quad op-amp, single supply, 1.2 MHz [TI]", params: { gain: 1e5, gbw: 1.2e6, ro: 300, drop: 1.5, rin: 2e6 } },       // gain 100 V/mV, GBW 1.2 MHz, Ro 300 ohm (TI); rin est
    "TL071": { desc: "JFET-input op-amp, 3 MHz [TI]", params: { gain: 2e5, gbw: 3e6, ro: 125, drop: 1.5, rin: 1e12 } },                  // 200 V/mV, 3 MHz, Zo 125 ohm, 1e12 ohm (TI)
    "TL074": { desc: "Quad JFET-input op-amp, 3 MHz [TI]", params: { gain: 2e5, gbw: 3e6, ro: 125, drop: 1.5, rin: 1e12 } },
    "TL082": { desc: "Dual JFET-input op-amp, 3 MHz [TI]", params: { gain: 2e5, gbw: 3e6, ro: 125, drop: 1.5, rin: 1e12 } },
    "NE5532": { desc: "Low-noise audio op-amp, 12 MHz [TI]", params: { gain: 1e5, gbw: 12e6, ro: 50, drop: 1.5, rin: 3e5 } },                // 100 V/mV, 12 MHz, ri 300 kohm (TI); ro, drop est
    "OP07": { desc: "Precision bipolar op-amp, 0.6 MHz [TI]", params: { gain: 4e5, gbw: 0.6e6, ro: 60, drop: 2, rin: 33e6 } },            // 400 V/mV, 0.6 MHz, ri 33 Mohm (TI); ro, drop est
    "LF356": { desc: "JFET-input op-amp, 5 MHz [TI]", params: { gain: 2e5, gbw: 5e6, ro: 50, drop: 2, rin: 1e12 } },                      // 106 dB, 5 MHz, 1e12 ohm (TI); ro, drop est
    "LF411": { desc: "JFET-input op-amp, 4.5 MHz [TI]", params: { gain: 2e5, gbw: 4.5e6, ro: 50, drop: 1.5, rin: 1e12 } },                // 200 V/mV, 4.5 MHz, 1e12 ohm (TI); ro est
    "LM318": { desc: "Fast bipolar op-amp, 15 MHz [TI]", params: { gain: 2e5, gbw: 15e6, ro: 75, drop: 2, rin: 3e6 } },                   // 200 V/mV, 15 MHz, ri 3 Mohm, VOM +/-13 (TI); ro est
    "MCP6002": { desc: "Dual RRIO op-amp, 1 MHz [Microchip]", params: { gain: 4e5, gbw: 1e6, ro: 150, drop: 0.025, rin: 1e13 } },        // 112 dB, 1 MHz, swing 25 mV, 1e13 ohm; ro est
    "LMV321": { desc: "Low-voltage RRO op-amp, 1 MHz [TI]", params: { gain: 1e5, gbw: 1e6, ro: 150, drop: 0.06, rin: 2e6 } },            // 100 V/mV, 1 MHz, swing 10/60 mV (TI); ro, rin est
    "TLV2371": { desc: "RRIO op-amp, 3 MHz [TI]", params: { gain: 3.16e5, gbw: 3e6, ro: 150, drop: 0.1, rin: 1e12 } },                    // 110 dB @5 V, 3 MHz, 1000 Gohm (TI); ro est
    "OPA2134": { desc: "Audio JFET op-amp, 8 MHz [TI]", params: { gain: 1e6, gbw: 8e6, ro: 50, drop: 1, rin: 1e13 } }                       // 120 dB, 8 MHz, 1e13 ohm, swing within 1 V (TI); ro est
});

// Alternate part numbers -> model name already in SIM_MODELS
const PART_ALIASES = {
    "UA741": "LM741", "LM741C": "LM741", "UA741C": "LM741",
    "MMBT2222A": "2N2222A", "MMBT3904": "2N3904", "MMBT3906": "2N3906", "MMBT4401": "2N4401", "MMBT2907A": "2N2907A",
    "BC547B": "BC547", "BC337-25": "BC337", "BC327-25": "BC327", "BC546B": "BC546", "BC548B": "BC548", "BC549C": "BC549",
    "BAT54W": "BAT54", "1N4448W": "1N4448", "BAS16W": "BAS16", "1N4148W": "1N4148",
    "1N4728A": "3V3", "1N4730A": "3V9", "1N4732A": "4V7", "1N4733A": "5V1", "1N4735A": "6V2", "1N4736A": "6V8",
    "1N4737A": "7V5", "1N4738A": "8V2", "1N4739A": "9V1", "1N4740A": "10V", "1N4742A": "12V", "1N4744A": "15V",
    "1N4746A": "18V", "1N4749A": "24V", "1N4750A": "27V",
    "IRF540N": "IRF540", "BSS138W": "BSS138", "BSS84W": "BSS84"
};

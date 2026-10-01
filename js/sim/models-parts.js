// Library entries for the parts added on top of models.js: voltage regulators, thyristors,
// relays and the JFET .model card writer. Values are typical datasheet figures
// (regulators: output voltage, dropout, quiescent current, current limit; thyristors:
// gate trigger and holding current, on-state drop; relays: coil resistance and pull-in /
// drop-out current at the nominal voltage).

SIM_MODELS.REG = {
    "7805": { desc: "+5 V, 1.5 A fixed regulator (LM7805)", params: { vout: 5, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "7806": { desc: "+6 V, 1.5 A fixed regulator", params: { vout: 6, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "7808": { desc: "+8 V, 1.5 A fixed regulator", params: { vout: 8, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "7809": { desc: "+9 V, 1.5 A fixed regulator", params: { vout: 9, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "7812": { desc: "+12 V, 1.5 A fixed regulator (LM7812)", params: { vout: 12, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "7815": { desc: "+15 V, 1.5 A fixed regulator", params: { vout: 15, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "7824": { desc: "+24 V, 1.5 A fixed regulator", params: { vout: 24, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "78L05": { desc: "+5 V, 100 mA fixed regulator", params: { vout: 5, dropout: 1.7, iq: 3e-3, ro: 0.2, ilim: 0.15 } },
    "7905": { desc: "-5 V, 1.5 A fixed negative regulator", params: { vout: -5, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "7912": { desc: "-12 V, 1.5 A fixed negative regulator", params: { vout: -12, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "7915": { desc: "-15 V, 1.5 A fixed negative regulator", params: { vout: -15, dropout: 2, iq: 5e-3, ro: 0.05, ilim: 1.5 } },
    "LM317": { desc: "Adjustable +1.25 V to +37 V regulator, 1.5 A (the GND pin is ADJ)", params: { vout: 1.25, dropout: 2.5, iq: 50e-6, ro: 0.05, ilim: 1.5 } },
    "LM337": { desc: "Adjustable -1.25 V to -37 V regulator, 1.5 A (the GND pin is ADJ)", params: { vout: -1.25, dropout: 2.5, iq: 65e-6, ro: 0.05, ilim: 1.5 } },
    "LM1117-3.3": { desc: "3.3 V, 800 mA low-dropout regulator", params: { vout: 3.3, dropout: 1.2, iq: 5e-3, ro: 0.05, ilim: 0.8 } },
    "LM1117-5": { desc: "5 V, 800 mA low-dropout regulator", params: { vout: 5, dropout: 1.2, iq: 5e-3, ro: 0.05, ilim: 0.8 } },
    "LM2940-5": { desc: "5 V, 1 A low-dropout regulator", params: { vout: 5, dropout: 0.5, iq: 10e-3, ro: 0.05, ilim: 1.0 } },
    "LP2950-3.3": { desc: "3.3 V, 100 mA micropower low-dropout regulator", params: { vout: 3.3, dropout: 0.4, iq: 75e-6, ro: 0.2, ilim: 0.15 } }
};

SIM_MODELS.SCR = {
    "2N5060": { desc: "0.8 A / 30 V sensitive-gate SCR", params: { igt: 200e-6, ih: 5e-3, vf: 1.0, ron: 0.3 } },
    "C106D": { desc: "4 A / 400 V SCR", params: { igt: 200e-6, ih: 3e-3, vf: 1.0, ron: 0.08 } },
    "TYN612": { desc: "12 A / 600 V SCR", params: { igt: 15e-3, ih: 30e-3, vf: 1.0, ron: 0.03 } },
    "2N6509": { desc: "25 A / 800 V SCR", params: { igt: 30e-3, ih: 40e-3, vf: 1.0, ron: 0.02 } }
};

SIM_MODELS.TRIAC = {
    "MAC97A6": { desc: "0.6 A / 400 V sensitive-gate TRIAC", params: { igt: 5e-3, ih: 5e-3, vf: 1.1, ron: 0.5 } },
    "BT136": { desc: "4 A / 600 V TRIAC", params: { igt: 25e-3, ih: 15e-3, vf: 1.2, ron: 0.1 } },
    "BT139": { desc: "16 A / 600 V TRIAC", params: { igt: 25e-3, ih: 20e-3, vf: 1.2, ron: 0.03 } },
    "TIC226D": { desc: "8 A / 400 V TRIAC", params: { igt: 20e-3, ih: 20e-3, vf: 1.2, ron: 0.05 } }
};

SIM_MODELS.RELAY = {
    "5V": { desc: "5 V SPST-NO relay, 70 ohm coil", params: { rcoil: 70, lcoil: 20e-3, pull: 53e-3, drop: 7e-3, ron: 0.05 } },
    "12V": { desc: "12 V SPST-NO relay, 400 ohm coil", params: { rcoil: 400, lcoil: 0.1, pull: 22e-3, drop: 3e-3, ron: 0.05 } },
    "24V": { desc: "24 V SPST-NO relay, 1.6 kohm coil", params: { rcoil: 1600, lcoil: 0.4, pull: 11e-3, drop: 1.5e-3, ron: 0.05 } }
};

// JFETs: library parts are added by models-extra.js; these generic ones are always there
SIM_MODELS.JFET_N = Object.assign({ "NJF": { desc: "Generic N-channel JFET (Vp -2 V, Idss 5 mA)", params: { vto: -2, beta: 1.25e-3, lambda: 2e-3, is: 1e-14, cgs: 5e-12, cgd: 2e-12 } } }, SIM_MODELS.JFET_N || {});
SIM_MODELS.JFET_P = Object.assign({ "PJF": { desc: "Generic P-channel JFET (Vp 2 V, Idss 5 mA)", params: { vto: -2, beta: 1.25e-3, lambda: 2e-3, is: 1e-14, cgs: 5e-12, cgd: 2e-12 } } }, SIM_MODELS.JFET_P || {});

// optocouplers: typical current-transfer ratio (collector current / LED current)
SIM_MODELS.OPTO = {
    "4N25": { desc: "Phototransistor optocoupler, typical CTR 50 %", params: { ctr: 0.5, vsat: 0.3 } },
    "4N35": { desc: "Phototransistor optocoupler, typical CTR 100 %", params: { ctr: 1.0, vsat: 0.3 } },
    "PC817": { desc: "Phototransistor optocoupler, typical CTR 130 %", params: { ctr: 1.3, vsat: 0.2 } },
    "TLP521": { desc: "Phototransistor optocoupler, typical CTR 100 %", params: { ctr: 1.0, vsat: 0.3 } },
    "CNY17-3": { desc: "Phototransistor optocoupler, CTR 100-200 %", params: { ctr: 1.5, vsat: 0.3 } }
};

Object.assign(SIM_DEFAULT_MODEL, { OPTO: "PC817", REG: "7805", SCR: "C106D", TRIAC: "BT136", RELAY: "12V" });
Object.assign(SIM_DEFAULT_MODEL, { JFET_N: SIM_MODELS.JFET_N.J201 ? "J201" : "NJF", JFET_P: SIM_MODELS.JFET_P["2N5460"] ? "2N5460" : "PJF" });

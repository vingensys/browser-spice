// Round trip: SPICE deck -> schematic (SchematicImporter) -> netlist -> simulation must
// give the same answer as simulating the deck directly. Run in the app:
//   (0, eval)(await (await fetch('tests/roundtrip.js')).text()); await roundtripTests();

window.roundtripTests = async function () {
    const decks = ["ce_amp", "cs_amp", "diode_clipper", "bridge_rect", "cmos_inv", "darlington", "zener_reg", "npn_switch", "rlc_ring", "diff_pair", "ic_rlc", "controlled", "pwl_current", "mixed_sources", "jfet_amp", "jfet_p", "transformer", "transformer_rect", "exp_sffm"];
    const results = [];

    for (const id of decks) {
        try {
            const text = await (await fetch(`tests/decks/${id}.cir`, { cache: "reload" })).text();

            // direct simulation of the deck
            const deck = SpiceParser.parse(text);
            const direct = SpiceParser.build(deck).circuit;
            const dEng = new SimEngine(direct);

            // through the schematic
            const r = SchematicImporter.import(editor, text);
            const blocked = editor.wires.filter(w => w.blocked).length;
            const info = NetlistExtractor.extract(editor);
            const sEng = new SimEngine(info.circuit);

            const tran = deck.analyses.find(a => a.type === "tran");
            let worst = 0;
            if (tran) {
                const a = dEng.transient({ tStop: tran.tStop, tStep: tran.tStep, uic: tran.uic, nodeIC: deck.ic });
                const b = sEng.transient({ tStop: tran.tStop, tStep: tran.tStep, uic: tran.uic, nodeIC: info.nodeIC });
                // compare the probes that exist in both: element currents are name-matched
                const names = Object.keys(a.currentHistories).filter(n => b.currentHistories[n]);
                for (const n of names) {
                    const ya = a.currentHistories[n], yb = b.currentHistories[n];
                    const range = Math.max(...ya.map(Math.abs)) || 1;
                    ya.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - yb[i]) / range); });
                }
                if (!names.length) throw new Error("no common element currents to compare");
            } else {
                const a = dEng.operatingPoint(), b = sEng.operatingPoint();
                for (const n of Object.keys(a.currents)) {
                    if (b.currents[n] === undefined) continue;
                    const scale = Math.max(Math.abs(a.currents[n]), 1e-9);
                    worst = Math.max(worst, Math.abs(a.currents[n] - b.currents[n]) / scale);
                }
            }
            const ok = blocked === 0 && worst < 1e-3;
            results.push({ id, pass: ok, parts: r.count, wires: editor.wires.length, blocked, worst: +worst.toExponential(2), notes: r.warnings.length });
        } catch (e) {
            results.push({ id, pass: false, error: e.message });
        }
    }
    const failed = results.filter(r => !r.pass);
    return { total: results.length, failed: failed.length, failures: failed, results };
};

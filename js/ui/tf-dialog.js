// Graph > Transfer Function (.tf): small-signal DC gain from a source to a probed node, with the input and output
// resistances, at the operating point.

const TfDialog = {
    esc: (s) => PropertiesPanel.esc(String(s)),

    open(editor, runner) {
        const probes = editor.probes.filter(p => p.type === "V");
        const sources = editor.components.filter(c => c.type === "V" || c.type === "I");
        if (!probes.length) { runner.toast("Add a voltage probe at the output node first.", "info"); return; }
        if (!sources.length) { runner.toast("The transfer function needs a voltage or current source as its input.", "info"); return; }
        const wrap = document.createElement("div");
        wrap.className = "tf";
        wrap.innerHTML = `<div class="form-grid">
            <label>Output</label><select id="tfOut">${probes.map((p, i) => `<option value="${i}">${TfDialog.esc(p.label)}</option>`).join("")}</select>
            <label>Input source</label><select id="tfIn">${sources.map(c => `<option>${TfDialog.esc(c.name)}</option>`).join("")}</select></div>
            <div class="tf-result prop-note">Press Calculate.</div>`;
        const show = (html) => { wrap.querySelector(".tf-result").innerHTML = html; };
        Dialog.open({
            title: "Transfer Function (small-signal DC)", content: wrap, width: "520px",
            buttons: [{
                label: "Calculate", primary: true, onClick: () => {
                    runner.guard(async () => {
                        const info = runner.prepare();
                        const prb = probes[Number(wrap.querySelector("#tfOut").value)];
                        const node = info.getPointNodeName(prb.x, prb.y) || "0";
                        const name = wrap.querySelector("#tfIn").value;
                        const r = await runner.solve(info, "tf", { out: [node], input: name }, "Transfer function");
                        const fmt = (v, u) => (v === Infinity ? "∞ (draws no current)" : Units.formatSI(v, u));
                        const unit = sources.find(c => c.name === name).type === "I" ? "V/A" : "V/V";
                        TfDialog.last = { ...r, output: prb.label };
                        show(`<table class="results-table"><tbody>
                            <tr><td>Gain, ${TfDialog.esc(prb.label)} / ${TfDialog.esc(name)}</td><td class="val">${Number(r.gain.toPrecision(6))} ${unit}</td></tr>
                            <tr><td>Input resistance seen by ${TfDialog.esc(name)}</td><td class="val">${fmt(r.rin, "Ω")}</td></tr>
                            <tr><td>Output resistance at ${TfDialog.esc(prb.label)}</td><td class="val">${fmt(r.rout, "Ω")}</td></tr></tbody></table>`);
                    }).catch(() => {});
                    return false;
                }
            }, { label: "Close" }]
        });
    }
};

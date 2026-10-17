// Debug > Pause Conditions: "pause the simulation when this probe goes above / below a value", so the moment can be
// inspected (scope, graph, cursors) instead of watched going by. Conditions are saved with the design.

class PauseDialog {
    static open(editor, live) {
        const esc = PropertiesPanel.esc;
        const probes = editor.allProbes().filter(p => !p._sub);
        const wrap = document.createElement("div");
        wrap.style.minWidth = "460px";
        let rows = (editor.pauseConditions || []).map(c => ({ ...c }));
        const unit = (id) => { const p = probes.find(k => k.id === id); return p && p.type === "I" ? "A" : "V"; };
        const render = () => {
            if (!probes.length) { wrap.innerHTML = `<div class="prop-note">There are no probes yet. Place a voltage or current probe (Tool menu), then come back here.</div>`; return; }
            wrap.innerHTML = `<div class="prop-note" style="margin-bottom:8px">The simulation pauses the first time a condition turns true. Press Play to carry on.</div>
                <table style="width:100%;border-collapse:collapse">${rows.map((c, i) => `<tr>
                    <td><input type="checkbox" data-i="${i}" data-f="on" ${c.on === false ? "" : "checked"} title="Enabled"></td>
                    <td><select data-i="${i}" data-f="probe">${probes.map(p => `<option value="${p.id}" ${p.id === c.probe ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></td>
                    <td><select data-i="${i}" data-f="op"><option value="above" ${c.op !== "below" ? "selected" : ""}>goes above</option><option value="below" ${c.op === "below" ? "selected" : ""}>goes below</option></select></td>
                    <td><input type="text" data-i="${i}" data-f="value" value="${esc(Units.formatSI(c.value, unit(c.probe)).replace(/\s/g, ""))}" size="9"></td>
                    <td><button class="pane-btn" data-del="${i}" title="Remove this condition">✕</button></td></tr>`).join("") || `<tr><td class="prop-note">No conditions.</td></tr>`}</table>
                <button class="pane-btn" data-add style="margin-top:8px">Add condition</button>`;
        };
        render();
        wrap.addEventListener("change", (e) => {
            const t = e.target, i = Number(t.dataset.i);
            if (!t.dataset.f) return;
            const r = rows[i];
            if (t.dataset.f === "on") r.on = t.checked;
            else if (t.dataset.f === "probe") { r.probe = Number(t.value); render(); }
            else if (t.dataset.f === "op") r.op = t.value;
            else if (t.dataset.f === "value") { const v = Units.parseSI(t.value); if (Number.isFinite(v)) r.value = v; render(); }
        });
        wrap.addEventListener("click", (e) => {
            const t = e.target.closest("button");
            if (!t) return;
            if (t.dataset.add !== undefined) { rows.push({ probe: probes[0].id, op: "above", value: 1, on: true }); render(); }
            else if (t.dataset.del !== undefined) { rows.splice(Number(t.dataset.del), 1); render(); }
        });
        Dialog.open({
            title: "Pause Conditions", content: wrap,
            buttons: [
                { label: "OK", primary: true, onClick: () => {
                    editor.pauseConditions = rows.filter(c => probes.some(p => p.id === c.probe) && Number.isFinite(c.value));
                    if (live.info) live.buildConditions();
                } },
                { label: "Cancel" }
            ]
        });
    }
}

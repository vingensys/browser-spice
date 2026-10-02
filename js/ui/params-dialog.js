// Design > Parameters…: the named values that part values can use as {name} or {expression}.

const ParamsDialog = {
    open(editor, runner) {
        const esc = PropertiesPanel.esc;
        const wrap = document.createElement("div");
        wrap.className = "params-dlg";
        let rows = editor.params.map(p => ({ ...p }));
        const render = () => {
            const { values, errors } = DesignParams.resolve(rows);
            wrap.innerHTML = `<table class="results-table"><thead><tr><th>Name</th><th>Value or expression</th><th>Resolves to</th><th></th></tr></thead><tbody>${
                rows.map((r, i) => {
                    const key = Object.keys(errors).find(n => n === r.name) || null;
                    const shown = errors[r.name] ? `<span class="err">${esc(errors[r.name])}</span>` : (String(r.name).toLowerCase() in values ? esc(Units.formatSI(values[String(r.name).toLowerCase()], "")) : "");
                    return `<tr><td><input data-k="name" data-i="${i}" value="${esc(r.name)}" style="width:110px" placeholder="rbias"></td><td><input data-k="value" data-i="${i}" value="${esc(r.value)}" style="width:220px" placeholder="47k or gain*1k"></td><td>${shown}</td><td><button data-del="${i}" title="Delete">✕</button></td></tr>`;
                }).join("")}</tbody></table>
                <div class="prop-note">${rows.length ? "" : "No parameters yet. "}Use a parameter in a part value as <b>{name}</b> or inside an expression, <b>{name*2}</b>. Parameters can use each other. Sweeps (Design > Parametric Sweep) can vary a parameter.</div>`;
            wrap.querySelectorAll("input").forEach(el => {
                el.onchange = () => { rows[Number(el.dataset.i)][el.dataset.k] = el.value; render(); };
            });
            wrap.querySelectorAll("[data-del]").forEach(b => { b.onclick = () => { rows.splice(Number(b.dataset.del), 1); render(); }; });
        };
        render();
        Dialog.open({
            title: "Design Parameters", content: wrap, width: "640px",
            buttons: [
                { label: "Add", onClick: () => { rows.push({ name: `p${rows.length + 1}`, value: "1" }); render(); return false; } },
                { label: "OK", primary: true, onClick: () => {
                    const clean = rows.filter(r => String(r.name).trim() !== "").map(r => ({ name: String(r.name).trim(), value: String(r.value).trim() }));
                    if (JSON.stringify(clean) !== JSON.stringify(editor.params)) { editor.saveState(); editor.params = clean; editor.notify(); }
                    const { errors } = DesignParams.resolve(clean);
                    if (Object.keys(errors).length) runner.toast(`Parameter ${Object.keys(errors)[0]}: ${Object.values(errors)[0]}`, "warn");
                } },
                { label: "Cancel" }
            ]
        });
    }
};

// Electrical rule check results: a list you can click through. A click closes the dialog and shows the place
// (selecting the part, wire or probe); "Mark on sheet" leaves a ! at every issue until the next edit or Esc.

const ErcDialog = {
    last: null,        // { issues, index } for "Next issue"

    open(editor, result, { onRerun } = {}) {
        const issues = result.issues;
        ErcDialog.last = { issues, index: -1 };
        const errs = issues.filter(i => i.level === "err").length, warns = issues.length - errs;
        const esc = PropertiesPanel.esc;

        const wrap = document.createElement("div");
        wrap.className = "erc";
        const head = issues.length
            ? `<div class="erc-head">${errs ? `<b class="err">${errs} error${errs > 1 ? "s" : ""}</b>` : ""} ${warns ? `<b class="warn">${warns} warning${warns > 1 ? "s" : ""}</b>` : ""}
               <span class="dim">Click an item to go to it.</span></div>`
            : `<div class="erc-head"><b class="ok">✓ No problems found.</b></div>`;
        const rows = issues.map((i, n) => `<div class="erc-row ${i.level}" data-i="${n}"><span class="erc-icon">${i.level === "err" ? "✖" : "⚠"}</span>
            <span class="erc-text">${esc(i.text)}</span><span class="erc-rule" title="${esc(ErcChecker.RULES[i.rule] || "")}">${esc(i.rule)}</span></div>`).join("");
        wrap.innerHTML = head + `<div class="erc-list">${rows}</div>`;

        wrap.querySelectorAll(".erc-row").forEach(row => {
            row.onclick = () => {
                const n = Number(row.dataset.i);
                ErcDialog.last.index = n;
                Dialog.close("go");
                editor.setErcMarks(issues);
                editor.revealRefs(issues[n].refs);
                if (window.status && window.status.hint) window.status.hint(`ERC ${n + 1} of ${issues.length}: ${issues[n].text}`);
            };
        });

        Dialog.open({
            title: "Electrical Rule Check",
            content: wrap,
            width: "680px",
            buttons: [
                { label: "Mark on Sheet", onClick: () => { editor.setErcMarks(issues); return true; } },
                { label: "Run Again", onClick: () => { Dialog.close("again"); if (onRerun) onRerun(); return false; } },
                { label: "Close", primary: true }
            ]
        });
        // "Mark on Sheet" keeps the dialog open so the count can be compared; the marks show behind it after closing
        const mark = [...document.querySelectorAll(".dialog .btn")].find(b => b.textContent === "Mark on Sheet");
        if (mark) mark.onclick = () => { editor.setErcMarks(issues); mark.textContent = "Marked ✓"; };
    },

    // step through the last result's issues, one at a time
    next(editor) {
        const l = ErcDialog.last;
        if (!l || !l.issues.length) return false;
        l.index = (l.index + 1) % l.issues.length;
        const i = l.issues[l.index];
        editor.setErcMarks(l.issues);
        editor.revealRefs(i.refs);
        if (window.status && window.status.hint) window.status.hint(`ERC ${l.index + 1} of ${l.issues.length}: ${i.text}`);
        return true;
    }
};

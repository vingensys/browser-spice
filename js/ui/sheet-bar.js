// The sheet tabs under the schematic: switch, add, rename, duplicate and delete sheets of a design.

class SheetBar {
    constructor(root, editor, runner) {
        this.root = root; this.editor = editor; this.runner = runner;
        editor.onSheetChange = () => this.render();
        this.render();
    }

    esc(s) { return PropertiesPanel.esc(String(s)); }

    render() {
        const ed = this.editor;
        this.root.innerHTML = `${ed.sheets.map((s, i) => `<button class="sheet-tab${i === ed.sheetIndex ? " active" : ""}" data-i="${i}" title="${i === 0 ? "Root sheet (the design is simulated from here). " : ""}Double-click to rename, right-click for more">${this.esc(s.name)}</button>`).join("")}<button class="sheet-add" title="Add a sheet">+</button>${ed.sheetStack.length ? `<button class="sheet-up" title="Back to the sheet you came from">↑ Parent</button>` : ""}`;
        this.root.querySelectorAll(".sheet-tab").forEach(b => {
            const i = Number(b.dataset.i);
            b.onclick = () => { if (window.live) window.live.stop(); ed.sheetStack = []; ed.switchSheet(i); };
            b.ondblclick = () => this.rename(i);
            b.oncontextmenu = (e) => { e.preventDefault(); this.menu(e, i); };
        });
        this.root.querySelector(".sheet-add").onclick = () => this.add();
        const up = this.root.querySelector(".sheet-up");
        if (up) up.onclick = () => ed.sheetUp();
    }

    ask(title, label, value) {
        return new Promise((resolve) => {
            const wrap = document.createElement("div");
            wrap.innerHTML = `<div class="form-grid"><label>${this.esc(label)}</label><input type="text" id="sheetNameInput" value="${this.esc(value)}"></div>`;
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            Dialog.open({
                title, content: wrap, width: "380px", onClose: () => finish(null),
                buttons: [{ label: "OK", primary: true, onClick: () => { finish(wrap.querySelector("input").value.trim() || null); } }, { label: "Cancel" }]
            });
            setTimeout(() => { const i = wrap.querySelector("input"); if (i) { i.focus(); i.select(); } }, 0);
        });
    }

    async add() { const name = await this.ask("Add Sheet", "Name", `Sheet ${this.editor.sheets.length + 1}`); if (name) { const s = this.editor.addSheet(name); this.editor.switchSheet(this.editor.sheets.indexOf(s)); } }
    async rename(i) { const name = await this.ask("Rename Sheet", "Name", this.editor.sheets[i].name); if (name) this.editor.renameSheet(i, name); }
    duplicate(i) { this.editor.duplicateSheet(i); }
    remove(i) {
        try { this.editor.deleteSheet(i); } catch (e) { this.runner.toast(e.message, "warn"); }
    }

    menu(e, i) {
        const items = [["Rename…", () => this.rename(i)], ["Duplicate", () => this.duplicate(i)], ["Delete", () => this.remove(i)]];
        const m = document.getElementById("contextMenu");
        m.innerHTML = items.map(([l], k) => `<div class="cm-item" data-k="${k}">${this.esc(l)}</div>`).join("");
        m.style.display = "block"; m.style.left = `${e.clientX}px`; m.style.top = `${Math.max(0, e.clientY - 90)}px`;
        m.querySelectorAll(".cm-item").forEach(el => { el.onclick = () => { m.style.display = "none"; items[Number(el.dataset.k)][1](); }; });
    }
}

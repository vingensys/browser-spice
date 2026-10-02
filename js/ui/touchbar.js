// A small floating toolbar for touch screens, where there is no keyboard for Esc, R, Delete or Ctrl+Z.
// Shown automatically on coarse-pointer devices; View > Touch Toolbar toggles it anywhere.

class TouchBar {
    static BUTTONS = [
        ["tool.select", "↖", "Select"], ["tool.wire", "⌇", "Wire"], ["tool.bus", "≡", "Bus"], ["edit.rotate", "⟳", "Rotate"], ["edit.mirrorx", "⇋", "Mirror"],
        ["edit.delete", "🗑", "Delete"], ["edit.undo", "↶", "Undo"], ["edit.redo", "↷", "Redo"], ["view.fit", "⛶", "Fit"], ["sim.play", "▶", "Play"], ["sim.stop", "■", "Stop"]
    ];

    constructor(host) {
        this.root = document.createElement("div");
        this.root.id = "touchbar";
        this.root.innerHTML = TouchBar.BUTTONS.map(([id, glyph, label]) => `<button data-cmd="${id}" title="${label}" aria-label="${label}">${glyph}</button>`).join("");
        this.root.querySelectorAll("button").forEach(b => { b.onclick = () => Commands.run(b.dataset.cmd); });
        host.appendChild(this.root);
        this.set(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
        Commands.onRefresh(() => this.refresh());
    }

    // the sheet area the toolbar covers (so Fit leaves it clear)
    get inset() { return this.on ? this.root.offsetHeight + 16 : 0; }

    set(on) { this.on = !!on; this.root.style.display = this.on ? "flex" : "none"; if (this.editor) this.editor.bottomInset = this.inset; }
    toggle() { this.set(!this.on); }

    refresh() {
        if (!this.on) return;
        this.root.querySelectorAll("button").forEach(b => {
            b.classList.toggle("disabled", Commands.enabled(b.dataset.cmd) === false);
            b.classList.toggle("active", Commands.checked(b.dataset.cmd));
        });
    }
}

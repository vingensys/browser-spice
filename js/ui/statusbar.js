// Bottom bar: simulation transport (play / step / pause / stop), message count, hints
// and the cursor position in thou (0.1 in = one grid cell), as in ISIS.

class StatusBar {
    constructor(root, editor) {
        this.root = root;
        root.innerHTML = `
            <div class="sim-controls">
                <button class="tb-btn play" data-cmd="sim.play" title="Play (F12)">${Icons.svg("play")}</button>
                <button class="tb-btn" data-cmd="sim.step" title="Step (F10)">${Icons.svg("step")}</button>
                <button class="tb-btn" data-cmd="sim.pause" title="Pause (Pause)">${Icons.svg("pause")}</button>
                <button class="tb-btn stop" data-cmd="sim.stop" title="Stop (Shift+F12)">${Icons.svg("stop")}</button>
            </div>
            <div class="sim-state" id="simstate">READY</div>
            <div id="msgbtn" title="Show messages">No Messages</div>
            <div id="statusText"></div>
            <div id="docstate" title=""></div>
            <div id="coords">+0.0 +0.0 th</div>
            <div id="build" title="Build of the code you are running. If this is not the latest commit, reload with Ctrl+Shift+R."></div>`;
        root.querySelector("#build").textContent = window.APP_VERSION || "dev";

        root.querySelectorAll("[data-cmd]").forEach(b => { b.onclick = () => Commands.run(b.dataset.cmd); });
        root.querySelector("#msgbtn").onclick = () => MessagesDialog.open();
        AppLog.onChange(() => this.messages());
        Commands.onRefresh(() => this.refresh());

        editor.onPointer = (pos) => {
            const th = (v) => (v * 5).toFixed(1);
            root.querySelector("#coords").textContent = `${pos.x >= 0 ? "+" : ""}${th(pos.x)} ${-pos.y >= 0 ? "+" : ""}${th(-pos.y)} th`;
        };
    }

    // "Saved" / "Unsaved" plus when the browser copy was last written
    setDocument(doc) {
        const el = this.root.querySelector("#docstate");
        if (!el) return;
        const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const empty = doc.isEmpty();
        el.textContent = empty ? "" : (doc.dirty ? "Unsaved" : "Saved") + (doc.lastAutoAt && doc.dirty ? ` · autosaved ${t(doc.lastAutoAt)}` : "");
        el.title = empty ? "" : `${doc.name || "Untitled"}: ${doc.dirty ? "changes are not saved to a file" : "matches the saved file"}${doc.autosaveFailed ? ". Autosave is unavailable." : (doc.lastAutoAt ? `. Browser copy written ${t(doc.lastAutoAt)}.` : "")}`;
        el.className = doc.autosaveFailed ? "warn" : (doc.dirty && !empty ? "dirty" : "");
    }

    refresh() {
        this.root.querySelectorAll("[data-cmd]").forEach(b => b.classList.toggle("disabled", Commands.enabled(b.dataset.cmd) === false));
    }

    setSimState(state, t) {
        const el = this.root.querySelector("#simstate");
        el.textContent = state === "stopped" ? "READY" : `${state === "running" ? "RUNNING" : "PAUSED"}: ${Units.formatSI(t, "s")}`;
        el.classList.toggle("running", state === "running");
    }

    messages() {
        const el = this.root.querySelector("#msgbtn");
        const e = AppLog.count("err"), w = AppLog.count("warn");
        el.textContent = e ? `${e} Error${e > 1 ? "s" : ""}` : (w ? `${w} Warning${w > 1 ? "s" : ""}` : (AppLog.entries.length ? `${AppLog.entries.length} Message${AppLog.entries.length > 1 ? "s" : ""}` : "No Messages"));
        el.className = e ? "err" : (w ? "warn" : "");
        el.id = "msgbtn";
    }

    hint(text) { this.root.querySelector("#statusText").textContent = text; }
}

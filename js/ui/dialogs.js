// Modal dialogs and the message log.

const AppLog = {
    entries: [],
    listeners: [],

    add(level, text) {
        AppLog.entries.push({ time: new Date(), level, text });
        if (AppLog.entries.length > 500) AppLog.entries.shift();
        AppLog.listeners.forEach(fn => fn());
    },

    clear() { AppLog.entries = []; AppLog.listeners.forEach(fn => fn()); },
    onChange(fn) { AppLog.listeners.push(fn); },
    count(level) { return AppLog.entries.filter(e => e.level === level).length; }
};

const Dialog = {
    layer: null,
    current: null,

    init() {
        Dialog.layer = document.getElementById("dialog-layer");
        Dialog.layer.addEventListener("mousedown", (e) => {
            if (e.target === Dialog.layer && Dialog.current && Dialog.current.dismissable !== false) Dialog.close("cancel");
        });
        document.addEventListener("keydown", (e) => {
            if (!Dialog.current) return;
            if (e.key === "Escape") { e.preventDefault(); Dialog.close("cancel"); }
            if (e.key === "Tab") {            // keep keyboard focus inside the dialog
                const items = [...Dialog.current.box.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(el => !el.disabled && el.offsetParent !== null);
                if (items.length) {
                    const first = items[0], last = items[items.length - 1];
                    if (!Dialog.current.box.contains(document.activeElement)) { first.focus(); e.preventDefault(); }
                    else if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
                    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
                }
            }
            if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "SELECT") {
                const primary = Dialog.current.buttons.find(b => b.primary);
                if (primary) { e.preventDefault(); Dialog.press(primary); }
            }
        }, true);
    },

    // content: an element (moved into the dialog and back on close) or an HTML string
    open({ title, content, buttons = [{ label: "OK", primary: true }], onClose, width, dismissable = true }) {
        if (Dialog.current) Dialog.close("replaced");

        const box = document.createElement("div");
        box.className = "dialog";
        if (width) box.style.width = width;
        box.innerHTML = `<div class="dialog-title"><span></span><button title="Close">✕</button></div>
            <div class="dialog-body"></div><div class="dialog-foot"></div>`;
        box.querySelector(".dialog-title span").textContent = title;
        box.querySelector(".dialog-title span").id = "dialog-title-text";
        box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "dialog-title-text");
        box.querySelector(".dialog-title button").setAttribute("aria-label", "Close");
        box.querySelector(".dialog-title button").onclick = () => Dialog.close("cancel");
        Dialog.returnFocus = document.activeElement;

        const body = box.querySelector(".dialog-body");
        let home = null;
        if (typeof content === "string") body.innerHTML = content;
        else { home = { parent: content.parentNode, next: content.nextSibling }; body.appendChild(content); content.classList.remove("hidden"); }

        const foot = box.querySelector(".dialog-foot");
        buttons.forEach(b => {
            const el = document.createElement("button");
            el.className = "btn" + (b.primary ? " primary" : "");
            el.textContent = b.label;
            el.onclick = () => Dialog.press(b);
            foot.appendChild(el);
        });
        if (!buttons.length) foot.remove();

        Dialog.layer.innerHTML = "";
        Dialog.layer.appendChild(box);
        Dialog.layer.classList.add("open");
        Dialog.current = { box, content, home, buttons, onClose, dismissable };

        const first = box.querySelector("input[type=text], select, textarea");
        if (first) setTimeout(() => first.focus(), 0);
        return Dialog.current;
    },

    press(button) {
        const keep = button.onClick ? button.onClick() === false : false;
        if (!keep) Dialog.close(button.label);
    },

    close(reason = "ok") {
        const cur = Dialog.current;
        if (!cur) return;
        Dialog.current = null;
        Dialog.layer.classList.remove("open");
        if (cur.home && cur.home.parent) cur.home.parent.insertBefore(cur.content, cur.home.next);
        Dialog.layer.innerHTML = "";
        const back = Dialog.returnFocus; Dialog.returnFocus = null;
        if (back && back.focus && document.contains(back) && reason !== "replaced") { try { back.focus(); } catch (e) { /* element gone */ } }
        if (cur.onClose) cur.onClose(reason);
    },

    // small helper: a titled message with OK
    alert(title, html) {
        Dialog.open({ title, content: `<div style="max-width:520px;line-height:1.5">${html}</div>`, buttons: [{ label: "OK", primary: true }] });
    }
};

// ---------------------------------------------------------------- Edit Component

const EditDialog = {
    open(editor, props) {
        if (!editor.selected) return;
        const before = editor.snapshot();
        const historyLength = editor.historyStack.length;
        const comp = editor.selected;

        const body = document.createElement("div");
        body.style.width = "340px";
        props.attach(body);
        props.render();

        Dialog.open({
            title: `Edit Component: ${comp.name}`,
            content: body,
            buttons: [
                { label: "OK", primary: true },
                {
                    label: "Cancel",
                    onClick: () => {
                        // throw away every change made in the dialog
                        editor.historyStack.length = historyLength;
                        editor.restore(before);
                    }
                }
            ],
            onClose: () => { props.attach(document.getElementById("propertiesContent")); }
        });
    }
};

// ------------------------------------------------------------- Messages & others

const MessagesDialog = {
    open() {
        const rows = AppLog.entries.slice().reverse().map(e =>
            `<div class="${e.level}">[${e.time.toLocaleTimeString()}] ${PropertiesPanel.esc(e.text)}</div>`).join("");
        Dialog.open({
            title: "Messages",
            content: `<div class="msg-list" style="width:560px">${rows || "No messages."}</div>`,
            buttons: [{ label: "Clear", onClick: () => { AppLog.clear(); MessagesDialog.open(); return false; } }, { label: "Close", primary: true }]
        });
    }
};

const ShortcutsDialog = {
    open() {
        const rows = [
            ["Place a part", "Pick in the device list, click to drop (R rotates, right-click stops)"],
            ["Wire", "Click or drag from a pin; click a pin or wire to finish; Esc cancels"],
            ["Select / move", "Click, Shift-click, drag a box; drag parts to move them"],
            ["Edit a part", "Double-click it, or Ctrl+E"], ["Probes", "Click a probe to select, drag it to move it to another pin or wire, double-click to rename, Del to remove"], ["Right-click", "Menu for the part, wire, probe, selection or empty sheet under the pointer"],
            ["Rotate / mirror", "R / X (left-right) / Y (top-bottom)"], ["Delete", "Del"], ["Undo / Redo", "Ctrl+Z / Ctrl+Y"],
            ["Copy / Cut / Paste", "Ctrl+C / Ctrl+X / Ctrl+V"], ["Select all", "Ctrl+A"],
            ["Zoom", "Mouse wheel, + / −, or F6 / F7"], ["Pan sideways", "Shift + wheel"], ["Fit to sheet contents", "F or F8"], ["Pan", "Space-drag or middle-drag"],
            ["Tidy wires", "T"], ["Pick devices", "P"],
            ["Run / Pause / Stop simulation", "F12 / Pause / Shift+F12"], ["Step", "F10"],
            ["Run the graph analysis", "Space (with the graph window focused) or the Simulate button"]
        ].map(([a, b]) => `<tr><td style="padding:2px 14px 2px 0;font-weight:600">${a}</td><td>${b}</td></tr>`).join("");
        Dialog.open({ title: "Keyboard & Mouse", content: `<table style="border-collapse:collapse">${rows}</table>`, buttons: [{ label: "Close", primary: true }] });
    }
};

const AboutDialog = {
    open() {
        Dialog.alert("About Browser SPICE",
            `<b>Browser SPICE</b> <span style="color:var(--ui-dim)">build ${window.APP_VERSION || "dev"}</span><br>Schematic capture and SPICE simulation in the browser.<br><br>
            Built-in SPICE engine (Newton-Raphson, trapezoidal transient, sparse LU), validated against ngspice,
            plus an optional ngspice WebAssembly backend. Imports and exports standard SPICE netlists.`);
    }
};

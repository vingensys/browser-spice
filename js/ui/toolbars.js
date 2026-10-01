// Top icon toolbar (commands) and the vertical mode toolbar (tool modes).

class Toolbar {
    constructor(root, ids) {
        this.root = root;
        this.buttons = [];
        for (const id of ids) {
            if (id === "|") {
                const sep = document.createElement("div");
                sep.className = "tb-sep";
                root.appendChild(sep);
                continue;
            }
            const cmd = Commands.get(id);
            if (!cmd) continue;
            const b = document.createElement("button");
            b.className = "tb-btn" + (cmd.cls ? ` ${cmd.cls}` : "");
            b.innerHTML = Icons.svg(cmd.icon);
            b.title = `${cmd.label.replace(/…$/, "")}${cmd.keys ? ` (${cmd.keys})` : ""}`;
            b.dataset.cmd = id;
            b.onclick = () => Commands.run(id);
            root.appendChild(b);
            this.buttons.push(b);
        }
        Commands.onRefresh(() => this.refresh());
        this.refresh();
    }

    refresh() {
        for (const b of this.buttons) {
            b.classList.toggle("disabled", Commands.enabled(b.dataset.cmd) === false);
            b.classList.toggle("active", Commands.checked(b.dataset.cmd));
        }
    }
}

// Mode toolbar: each button switches the tool and what the device pane lists.
class ModeBar {
    constructor(root, modes, onPick) {
        this.root = root;
        this.buttons = new Map();
        for (const m of modes) {
            const b = document.createElement("button");
            b.className = "tb-btn";
            b.innerHTML = Icons.svg(m.icon);
            b.title = m.title;
            b.onclick = () => { this.set(m.id); onPick(m); };
            root.appendChild(b);
            this.buttons.set(m.id, b);
        }
    }

    set(id) {
        this.buttons.forEach((b, key) => b.classList.toggle("active", key === id));
    }
}

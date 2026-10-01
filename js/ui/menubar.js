// Menu bar: a spec of titles -> commands (and submenus), rendered as ISIS-style drop-downs.

class Menubar {
    constructor(root, spec) {
        this.root = root;
        this.spec = spec;
        this.openMenu = null;
        this.build();

        document.addEventListener("mousedown", (e) => { if (!root.contains(e.target)) this.close(); });
        document.addEventListener("keydown", (e) => this.onKey(e), true);
        Commands.onRefresh(() => this.refresh());
    }

    build() {
        this.root.innerHTML = "";
        for (const menu of this.spec) {
            const el = document.createElement("div");
            el.className = "menu";
            // the mnemonic letter (Alt+letter) is underlined
            const mn = menu.mnemonic || menu.title[0];
            const at = menu.title.toLowerCase().indexOf(mn.toLowerCase());
            el.dataset.mnemonic = mn.toLowerCase();
            el.innerHTML = `<div class="menu-title">${menu.title.slice(0, at)}<u>${menu.title[at]}</u>${menu.title.slice(at + 1)}</div>`;
            const panel = document.createElement("div");
            panel.className = "menu-panel";
            this.fill(panel, menu.items);
            el.appendChild(panel);

            el.querySelector(".menu-title").addEventListener("mousedown", (e) => {
                e.preventDefault();
                this.openMenu === el ? this.close() : this.open(el);
            });
            el.addEventListener("mouseenter", () => { if (this.openMenu && this.openMenu !== el) this.open(el); });
            this.root.appendChild(el);
        }
    }

    fill(panel, items) {
        for (const item of items) {
            if (item === "-") {
                const sep = document.createElement("div");
                sep.className = "menu-sep";
                panel.appendChild(sep);
                continue;
            }
            const row = document.createElement("div");
            row.className = "menu-item";

            if (typeof item === "object" && item.sub) {
                row.classList.add("has-sub");
                row.innerHTML = `<span class="check"></span><span class="label">${item.sub}</span>`;
                const sub = document.createElement("div");
                sub.className = "menu-panel";
                this.fill(sub, typeof item.items === "function" ? item.items() : item.items);
                row.appendChild(sub);
                row.addEventListener("mouseenter", () => {
                    sub.innerHTML = "";
                    this.fill(sub, typeof item.items === "function" ? item.items() : item.items);
                });
            } else {
                const cmd = typeof item === "string" ? Commands.get(item) : item;
                if (!cmd) continue;
                row.dataset.cmd = cmd.id;
                row.innerHTML = `<span class="check"></span><span class="label">${cmd.label}</span><span class="keys">${cmd.keys || ""}</span>`;
                row.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    this.close();
                    if (typeof item === "object" && item.run) item.run(); else Commands.run(cmd.id);
                });
            }
            panel.appendChild(row);
        }
    }

    open(el) {
        this.close();
        this.openMenu = el;
        el.classList.add("open");
        this.refresh();
    }

    close() {
        if (this.openMenu) this.openMenu.classList.remove("open");
        this.root.querySelectorAll(".kb, .open-sub").forEach(r => r.classList.remove("kb", "open-sub"));
        this.openMenu = null;
    }

    // ---- keyboard: Alt+letter / F10 open, arrows move, Enter runs, Esc closes ----

    // the panel the keyboard is currently inside (the open menu's, or an open submenu's)
    activePanel() {
        if (!this.openMenu) return null;
        let panel = this.openMenu.querySelector(":scope > .menu-panel");
        for (;;) {
            const sub = panel.querySelector(":scope > .menu-item.open-sub > .menu-panel");
            if (!sub) return panel;
            panel = sub;
        }
    }

    rows(panel) {
        return [...panel.querySelectorAll(":scope > .menu-item")].filter(r => !r.classList.contains("disabled"));
    }

    highlight(panel, row) {
        panel.querySelectorAll(":scope > .menu-item.kb").forEach(r => r.classList.remove("kb"));
        if (row) row.classList.add("kb");
    }

    onKey(e) {
        const menus = [...this.root.querySelectorAll(":scope > .menu")];
        const a = document.activeElement;
        const typing = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");

        if (!this.openMenu) {
            if (typing || (typeof Dialog !== "undefined" && Dialog.current)) return;
            let target = null;
            if (e.key === "F10") target = menus[0];
            else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) target = menus.find(m => m.dataset.mnemonic === e.key.toLowerCase());
            if (target) { e.preventDefault(); e.stopPropagation(); this.open(target); this.highlight(this.activePanel(), this.rows(this.activePanel())[0]); }
            return;
        }

        const stop = () => { e.preventDefault(); e.stopPropagation(); };
        const panel = this.activePanel();
        const rows = this.rows(panel);
        const cur = panel.querySelector(":scope > .menu-item.kb");
        const i = rows.indexOf(cur);
        const idx = menus.indexOf(this.openMenu);
        switch (e.key) {
            case "Escape": stop(); this.close(); break;
            case "ArrowDown": stop(); this.highlight(panel, rows[(i + 1) % rows.length]); break;
            case "ArrowUp": stop(); this.highlight(panel, rows[(i - 1 + rows.length) % rows.length]); break;
            case "Home": stop(); this.highlight(panel, rows[0]); break;
            case "End": stop(); this.highlight(panel, rows[rows.length - 1]); break;
            case "ArrowRight":
                stop();
                if (cur && cur.classList.contains("has-sub")) {
                    cur.dispatchEvent(new MouseEvent("mouseenter"));   // builds the submenu
                    cur.classList.add("open-sub");
                    const sub = cur.querySelector(":scope > .menu-panel");
                    this.highlight(sub, this.rows(sub)[0]);
                } else {
                    this.open(menus[(idx + 1) % menus.length]);
                    this.highlight(this.activePanel(), this.rows(this.activePanel())[0]);
                }
                break;
            case "ArrowLeft":
                stop();
                if (panel !== this.openMenu.querySelector(":scope > .menu-panel")) {
                    const owner = panel.parentElement;
                    owner.classList.remove("open-sub");
                    this.highlight(owner.parentElement, owner);
                } else {
                    this.open(menus[(idx - 1 + menus.length) % menus.length]);
                    this.highlight(this.activePanel(), this.rows(this.activePanel())[0]);
                }
                break;
            case "Enter": case " ":
                stop();
                if (cur) {
                    if (cur.classList.contains("has-sub")) { cur.dispatchEvent(new MouseEvent("mouseenter")); cur.classList.add("open-sub"); const sub = cur.querySelector(":scope > .menu-panel"); this.highlight(sub, this.rows(sub)[0]); }
                    else cur.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
                }
                break;
            default:
                // Alt+letter while a menu is open jumps to another menu
                if (e.altKey && e.key.length === 1) {
                    const t = menus.find(m => m.dataset.mnemonic === e.key.toLowerCase());
                    if (t) { stop(); this.open(t); this.highlight(this.activePanel(), this.rows(this.activePanel())[0]); }
                }
        }
    }

    refresh() {
        this.root.querySelectorAll(".menu-item[data-cmd]").forEach(row => {
            const id = row.dataset.cmd;
            row.classList.toggle("disabled", Commands.enabled(id) === false);
            row.querySelector(".check").textContent = Commands.checked(id) ? "✓" : "";
        });
    }
}

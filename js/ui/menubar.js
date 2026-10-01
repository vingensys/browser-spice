// Menu bar: a spec of titles -> commands (and submenus), rendered as ISIS-style drop-downs.

class Menubar {
    constructor(root, spec) {
        this.root = root;
        this.spec = spec;
        this.openMenu = null;
        this.build();

        document.addEventListener("mousedown", (e) => { if (!root.contains(e.target)) this.close(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
        Commands.onRefresh(() => this.refresh());
    }

    build() {
        this.root.innerHTML = "";
        for (const menu of this.spec) {
            const el = document.createElement("div");
            el.className = "menu";
            el.innerHTML = `<div class="menu-title">${menu.title}</div>`;
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
        this.openMenu = null;
    }

    refresh() {
        this.root.querySelectorAll(".menu-item[data-cmd]").forEach(row => {
            const id = row.dataset.cmd;
            row.classList.toggle("disabled", Commands.enabled(id) === false);
            row.querySelector(".check").textContent = Commands.checked(id) ? "✓" : "";
        });
    }
}

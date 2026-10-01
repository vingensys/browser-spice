// Left-hand device pane (ISIS "DEVICES"): the parts you picked, plus the terminal,
// generator, instrument and graph lists that the mode toolbar switches between.
// Also the Pick Devices dialog (category tree + search + preview).

class DevicePane {
    constructor(editor, els) {
        this.editor = editor;
        this.listEl = els.list;
        this.titleEl = els.title;
        this.previewCanvas = els.preview;
        this.preview = new SymbolPreview(els.preview);
        this.mode = "devices";
        this.devices = this.loadDevices();
        this.selected = null;
        this.onGraph = null;
        Theme.onChange(() => this.preview.render(this.selected));
        this.render();
    }

    // ---- persistence ------------------------------------------------------------

    loadDevices() {
        let names = null;
        try { names = JSON.parse(localStorage.getItem("browser-spice/devices") || "null"); } catch (e) { /* ignore */ }
        const DEFAULTS = ["RES", "CAP", "IND", "1N4148", "LED-RED", "2N2222", "2N3906", "LM741", "NE555"];
        // sources, ground and the instruments are listed from the start (a one-time addition for older saved lists)
        const BASICS = ["DC", "SINE", "PULSE", "SQUARE", "GROUND", "VOLTMETER", "OSCILLOSCOPE"];
        let migrated = false;
        try { migrated = localStorage.getItem("browser-spice/devices-v2") === "1"; } catch (e) { /* ignore */ }
        if (!Array.isArray(names)) names = DEFAULTS.slice();
        if (!migrated) {
            for (const n of BASICS) if (!names.includes(n)) names.push(n);
            try { localStorage.setItem("browser-spice/devices", JSON.stringify(names)); localStorage.setItem("browser-spice/devices-v2", "1"); } catch (e) { /* ignore */ }
        }
        return names;
    }

    saveDevices() {
        try { localStorage.setItem("browser-spice/devices", JSON.stringify(this.devices)); } catch (e) { /* ignore */ }
    }

    addDevice(name) {
        if (!this.devices.includes(name)) { this.devices.push(name); this.saveDevices(); }
        this.setMode("devices");
        this.select(DeviceCatalog.find(name));
        this.render();
    }

    removeSelected() {
        if (this.mode !== "devices" || !this.selected) return;
        this.devices = this.devices.filter(n => n !== this.selected.name);
        this.saveDevices();
        this.selected = null;
        this.render();
    }

    // ---- modes ---------------------------------------------------------------------

    entries() {
        switch (this.mode) {
            case "terminals": return DeviceCatalog.terminals();
            case "generators": return DeviceCatalog.generators();
            case "instruments": return DeviceCatalog.instruments();
            case "graphs": return DeviceCatalog.graphs();
            default: return this.devices.map(n => DeviceCatalog.find(n)).filter(Boolean);
        }
    }

    setMode(mode) {
        this.mode = mode;
        this.selected = null;
        this.titleEl.textContent = { devices: "DEVICES", terminals: "TERMINALS", generators: "GENERATORS", instruments: "INSTRUMENTS", graphs: "GRAPH" }[mode];
        this.render();
    }

    select(entry) {
        this.selected = entry;
        if (entry && entry.graph) {
            if (this.onGraph) this.onGraph(entry.graph);
        } else if (entry) {
            this.editor.setTool(entry.type, entry.props || null);
        }
        this.preview.render(entry);
        this.render();
    }

    render() {
        const items = this.entries();
        this.listEl.innerHTML = "";
        if (!items.length) {
            const li = document.createElement("li");
            li.className = "empty";
            li.textContent = "Press P to pick devices";
            this.listEl.appendChild(li);
        }
        for (const entry of items) {
            const li = document.createElement("li");
            li.textContent = entry.name;
            li.title = entry.desc || "";
            if (this.selected && this.selected.name === entry.name) li.classList.add("selected");
            li.onclick = () => this.select(entry);
            li.oncontextmenu = (e) => {
                e.preventDefault();
                this.select(entry);
                const items = [{ label: "Place", run: () => this.select(entry) }];
                if (this.mode === "devices") items.push({ label: "Remove from list", run: () => this.removeSelected() });
                items.push("-", { label: "Pick Devices…", key: "P", run: () => PickDialog.open(this) });
                if (window.popupMenu) window.popupMenu(e, items);
            };
            this.listEl.appendChild(li);
        }
        this.preview.render(this.selected);
    }

    // clicking the sheet in select mode drops the selection in the list
    syncTool(tool) {
        if (tool === "select" && this.mode === "devices" && this.selected) { this.selected = null; this.render(); }
    }
}

const PickDialog = {
    open(pane) {
        const wrap = document.createElement("div");
        wrap.className = "pick";
        wrap.innerHTML = `
            <div class="pick-col"><h5>Category</h5><ul class="pick-list" id="pick-cats"></ul></div>
            <div class="pick-col"><h5>Keywords</h5><input type="text" id="pick-q" placeholder="e.g. 2N, op-amp, led">
                <h5>Results</h5><ul class="pick-list" id="pick-res"></ul></div>
            <div class="pick-col"><h5>Preview</h5><div class="pick-preview"><canvas id="pick-canvas"></canvas></div>
                <div class="pick-desc" id="pick-desc"></div></div>`;

        const cats = ["(all)", ...DeviceCatalog.categories];
        let category = "(all)", chosen = null;
        const catList = wrap.querySelector("#pick-cats"), res = wrap.querySelector("#pick-res");
        const q = wrap.querySelector("#pick-q"), desc = wrap.querySelector("#pick-desc");
        const preview = new SymbolPreview(wrap.querySelector("#pick-canvas"));

        const renderResults = () => {
            res.innerHTML = "";
            for (const d of DeviceCatalog.search(q.value, category)) {
                const li = document.createElement("li");
                li.innerHTML = `${PropertiesPanel.esc(d.name)}<span class="cat">${PropertiesPanel.esc(d.category)}</span>`;
                if (chosen && chosen.name === d.name) li.classList.add("selected");
                li.onclick = () => { chosen = d; desc.textContent = d.desc; preview.render(d); renderResults(); };
                li.ondblclick = () => { Dialog.close("OK"); pane.addDevice(d.name); };
                res.appendChild(li);
            }
        };
        cats.forEach(c => {
            const li = document.createElement("li");
            li.textContent = c;
            if (c === category) li.classList.add("selected");
            li.onclick = () => {
                category = c;
                [...catList.children].forEach(x => x.classList.toggle("selected", x.textContent === c));
                renderResults();
            };
            catList.appendChild(li);
        });
        q.addEventListener("input", renderResults);
        renderResults();

        Dialog.open({
            title: "Pick Devices",
            content: wrap,
            width: "720px",
            buttons: [
                { label: "OK", primary: true, onClick: () => { if (chosen) pane.addDevice(chosen.name); } },
                { label: "Cancel" }
            ]
        });
        preview.render(null);
    }
};

// A spoken-style description of the sheet for screen readers: what is on it and what each net joins.
// View > Describe Sheet shows it in a dialog and also announces the summary through a live region.

const SheetDescriber = {
    // { summary, lines } for the open sheet (the active sheet's parts and wires)
    build(editor) {
        const comps = editor.components.filter(c => !Exporter.NOT_PARTS.includes(c.type) && !editor.isOverlay(c));
        const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
        const nets = NetlistExtractor.nets(editor);
        const byNet = new Map(), loose = [];
        for (const c of comps) {
            for (const t of editor.getTerminals(c)) {
                const id = nets.terminalNode(c, t.name);
                const wired = nets.wired.has(`${c.id}:${t.name}`);
                if (id === null || id === undefined) continue;
                const key = nets.displayName(id);
                if (!byNet.has(key)) byNet.set(key, []);
                byNet.get(key).push({ ref: c.name, pin: t.name, wired });
            }
        }
        for (const [k, pins] of byNet) if (pins.length === 1 && k !== "GND" && !pins[0].wired) { loose.push(`${pins[0].ref} pin ${pins[0].pin}`); }
        const named = [...byNet.entries()].filter(([, p]) => p.length > 1).sort((a, b) => (a[0] === "GND" ? -1 : b[0] === "GND" ? 1 : a[0].localeCompare(b[0], undefined, { numeric: true })));
        const lines = [];
        lines.push("Parts:");
        for (const c of [...comps].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))) {
            const what = Exporter.describe(c);
            lines.push(`${c.name}: ${Exporter.typeName(c)}${what ? ", " + what : ""}.`);
        }
        lines.push("", "Connections:");
        for (const [net, pins] of named) lines.push(`${net} joins ${pins.map(p => `${p.ref} pin ${p.pin}`).join(", ")}.`);
        if (loose.length) lines.push("", `Not connected to anything: ${loose.join(", ")}.`);
        const probes = editor.allProbes ? editor.allProbes() : editor.probes || [];
        if (probes.length) lines.push("", `Probes: ${probes.map(p => p.label).join(", ")}.`);
        const summary = `${plural(comps.length, "part")}, ${plural(named.length, "net")} with connections, ${plural(editor.wires.length, "wire")}${loose.length ? `, ${plural(loose.length, "unconnected pin")}` : ""}.`;
        return { summary, lines };
    },

    announce(text) {
        let el = document.getElementById("srLive");
        if (!el) {
            el = document.createElement("div");
            el.id = "srLive"; el.className = "sr-only"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
            document.body.appendChild(el);
        }
        el.textContent = ""; setTimeout(() => { el.textContent = text; }, 30);
    },

    open(editor) {
        const d = SheetDescriber.build(editor);
        const wrap = document.createElement("div");
        wrap.innerHTML = `<p class="prop-note" id="sdSummary"></p><pre class="sheet-description" tabindex="0" role="document" aria-label="Description of the sheet"></pre>`;
        wrap.querySelector("#sdSummary").textContent = d.summary;
        wrap.querySelector("pre").textContent = d.lines.join("\n");
        Dialog.open({ title: "Describe Sheet", content: wrap, width: "560px", buttons: [{ label: "Copy", onClick: () => { try { navigator.clipboard.writeText(d.summary + "\n\n" + d.lines.join("\n")); } catch (e) { /* ignore */ } return false; } }, { label: "Close", primary: true }] });
        SheetDescriber.announce(d.summary);
        return d;
    }
};

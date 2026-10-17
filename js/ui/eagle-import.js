// Imports an Eagle schematic (.sch, the XML format of Eagle 6 and later) as an editable schematic.
//
// Eagle stores the connectivity itself: every <net> lists the <pinref part pin> that belong to it, on every sheet, so (unlike KiCad) no
// geometry has to be read. The parts are mapped by their device set and pin names to R, C, L, diodes / LEDs, BJTs and MOSFETs; supply symbols
// name nets (GND is node 0, +5V / 3V3 / -12V ... get an ideal source from that net to ground). The result is a SPICE deck handed to
// SchematicImporter, like the KiCad import, so the layout comes out the same. Anything with no model is listed in the warnings.

class EagleImporter {
    static isEagle(text) { return /^\s*(<\?xml[^>]*\?>\s*)?(<!DOCTYPE[^>]*>\s*)?<eagle\b/i.test(text); }

    // "+5V" -> 5, "3V3" -> 3.3, "-12V" -> -12, "VCC" / "VDD" -> 5 (flagged), "VEE" -> -5; null for a name that is not a supply
    static supplyVolts(name) {
        const n = String(name).trim().toUpperCase();
        let m;
        if ((m = /^([+-]?)(\d+)V(\d+)$/.exec(n))) return Number(`${m[1]}${m[2]}.${m[3]}`);
        if ((m = /^([+-]?\d+(?:\.\d+)?)V?$/.exec(n))) return Number(m[1]);
        if (/^(VCC|VDD|V\+|VCC\d*|\+V|VBUS|VIN)$/.test(n)) return { guess: 5 };
        if (/^(VEE|VSS|V-|-V)$/.test(n)) return { guess: -5 };
        return null;
    }

    static toSpice(text) {
        const warnings = [];
        const doc = new DOMParser().parseFromString(text, "application/xml");
        if (doc.querySelector("parsererror")) throw new Error("This is not valid Eagle XML.");
        const sch = doc.querySelector("eagle > drawing > schematic");
        if (!sch) throw new Error("This is not an Eagle schematic (.sch): it has no <schematic>.");
        const K = KicadImporter;

        // library: deviceset prefix and the pins of its first gate's symbol
        const sets = new Map();
        for (const lib of sch.querySelectorAll("libraries > library")) {
            const symbols = new Map();
            for (const sy of lib.querySelectorAll("symbols > symbol")) symbols.set(sy.getAttribute("name"), [...sy.querySelectorAll("pin")].map(p => p.getAttribute("name")));
            for (const ds of lib.querySelectorAll("devicesets > deviceset")) {
                const gate = ds.querySelector("gates > gate");
                sets.set(`${lib.getAttribute("name")}|${ds.getAttribute("name")}`, { prefix: ds.getAttribute("prefix") || "", pins: gate ? symbols.get(gate.getAttribute("symbol")) || [] : [], lib: lib.getAttribute("name"), name: ds.getAttribute("name") });
            }
        }
        const parts = new Map();
        for (const p of sch.querySelectorAll("parts > part")) {
            const set = sets.get(`${p.getAttribute("library")}|${p.getAttribute("deviceset")}`) || { prefix: "", pins: [], lib: p.getAttribute("library"), name: p.getAttribute("deviceset") };
            parts.set(p.getAttribute("name"), { name: p.getAttribute("name"), set, value: p.getAttribute("value") || "", device: p.getAttribute("device") || "", pinNet: new Map() });
        }
        // nets: the same name on several segments / sheets is one net
        const netNames = new Set();
        for (const net of sch.querySelectorAll("sheets > sheet > nets > net")) {
            const name = net.getAttribute("name");
            netNames.add(name);
            for (const pr of net.querySelectorAll("segment > pinref")) {
                const part = parts.get(pr.getAttribute("part"));
                if (part) part.pinNet.set(pr.getAttribute("pin"), name);
            }
        }
        const node = (net) => (/^(gnd|agnd|dgnd|gnda|gndd|gnd\d*|0)$/i.test(net) ? "0" : (String(net).replace(/\+/g, "p").replace(/-/g, "m").replace(/[^A-Za-z0-9_]/g, "_") || "N0"));
        const lines = [], used = new Set(), models = new Set(), rails = new Map();
        const uniq = (prefix, ref) => { let nm = String(ref).replace(/[^A-Za-z0-9_]/g, "_"); if (!nm.toUpperCase().startsWith(prefix)) nm = prefix + nm; while (used.has(nm.toUpperCase())) nm += "_"; used.add(nm.toUpperCase()); return nm; };
        const lib = (kinds, name) => typeof SIM_MODELS !== "undefined" && kinds.some(k => SIM_MODELS[k] && Object.keys(SIM_MODELS[k]).some(x => x.toLowerCase() === String(name).toLowerCase()));
        const addModel = (name, type, kinds) => { if (models.has(name) || lib(kinds, name)) return; models.add(name); lines.push(`.model ${name} ${type}`); };
        const pin = (part, ...names) => { for (const n of names) if (part.pinNet.has(n)) return part.pinNet.get(n); return null; };
        const ordered = (part) => (part.set.pins.length ? part.set.pins : [...part.pinNet.keys()]).map(n => part.pinNet.get(n)).filter(n => n !== undefined);
        let simulated = 0;

        for (const part of parts.values()) {
            const set = part.set, pre = (set.prefix || part.name.replace(/\d+$/, "")).toUpperCase(), dsName = String(set.name).toUpperCase(), ref = part.name;
            const nets = part.pinNet;
            if (!nets.size) continue;
            // supply symbols name their net: ground, or a rail that gets an ideal source
            if (/^supply/i.test(set.lib) || /^(GND|P\+|VCC|VDD|V\+|SUPPLY)/.test(pre) && nets.size === 1) {
                const net = [...nets.values()][0], vs = EagleImporter.supplyVolts(dsName) !== null ? EagleImporter.supplyVolts(dsName) : EagleImporter.supplyVolts(net);
                if (node(net) !== "0" && vs !== null && !rails.has(net)) {
                    const v = typeof vs === "object" ? vs.guess : vs;
                    if (typeof vs === "object") warnings.push(`the supply ${dsName || net} has no voltage in the schematic: an ideal ${v} V source is assumed`);
                    rails.set(net, v);
                }
                continue;
            }
            try {
                const two = () => { const o = ordered(part); if (o.length < 2) throw new Error("expected two pins"); return [node(o[0]), node(o[1])]; };
                if (pre === "R" || /^R[-_]/.test(dsName)) { const n = two(); lines.push(`${uniq("R", ref)} ${n[0]} ${n[1]} ${K.spiceValue(part.value) || "1k"}`); simulated++; }
                else if (pre === "C" || /^C[-_]?(POL|EU|US)?/.test(dsName) && pre === "") { const n = two(); lines.push(`${uniq("C", ref)} ${n[0]} ${n[1]} ${K.spiceValue(part.value) || "1u"}`); simulated++; }
                else if (pre === "L" || pre === "COIL") { const n = two(); lines.push(`${uniq("L", ref)} ${n[0]} ${n[1]} ${K.spiceValue(part.value) || "1m"}`); simulated++; }
                else if (pre === "D" || pre === "LED" || pre === "ZD" || /^(LED|D\d|1N\d)/.test(dsName)) {
                    const a = pin(part, "A", "ANODE", "A1", "+"), c = pin(part, "C", "K", "CATHODE", "K1", "-"), o = ordered(part);
                    const na = a !== null ? a : o[0], nc = c !== null ? c : o[1];
                    const model = String(part.value && !/^[\d.]+[kKmMuUnNpP]?/.test(part.value) ? part.value : set.name).replace(/[^A-Za-z0-9_.\-]/g, "_") || "D";
                    lines.push(`${uniq("D", ref)} ${node(na)} ${node(nc)} ${model}`);
                    addModel(model, "D", ["D", "LED", "DZ"]);
                    simulated++;
                } else if (pre === "T" || pre === "Q" || pre === "TR" || pre === "IC" && (nets.has("B") && nets.has("C") && nets.has("E"))) {
                    const val = String(part.value || set.name).replace(/[^A-Za-z0-9_.\-]/g, "_");
                    if (nets.has("G") && nets.has("D") && nets.has("S")) {
                        const pch = /pmos|p[-_]?ch|irf9|fqp\d*p|bs250/i.test(dsName + val), inLib = lib(["NMOS", "PMOS"], val), m = inLib ? val : (pch ? "PMOS" : "NMOS");
                        lines.push(`${uniq("M", ref)} ${node(nets.get("D"))} ${node(nets.get("G"))} ${node(nets.get("S"))} ${node(nets.get("S"))} ${m}`);
                        addModel(m, pch ? "PMOS" : "NMOS", ["NMOS", "PMOS"]);
                        simulated++;
                    } else if (nets.has("B") && nets.has("C") && nets.has("E")) {
                        const pnp = /pnp|bc55|bc556|bc557|bc558|2n39(06|05)|2n2907|tip3[01]/i.test(dsName + val), inLib = lib(["BJT_NPN", "BJT_PNP"], val), m = inLib ? val : (pnp ? "PNP" : "NPN");
                        lines.push(`${uniq("Q", ref)} ${node(nets.get("C"))} ${node(nets.get("B"))} ${node(nets.get("E"))} ${m}`);
                        addModel(m, pnp ? "PNP" : "NPN", ["BJT_NPN", "BJT_PNP"]);
                        simulated++;
                    } else warnings.push(`${ref} (${set.name}): transistor pins are not B C E or G D S, skipped`);
                } else if (pre === "V" || pre === "BAT" || pre === "BT" || /^(BATTERY|VSOURCE|V)$/.test(dsName)) {
                    const n = two(), v = K.spiceValue(part.value);
                    lines.push(`${uniq("V", ref)} ${n[0]} ${n[1]} DC ${/^[-+]?[\d.]/.test(v) ? v : 5}`);
                    simulated++;
                } else if (!/^(J|H|TP|MH|FID|X|JP|SV|PAD|LOGO|FRAME)/.test(pre)) warnings.push(`${ref} (${set.lib}:${set.name}): no simulation model, skipped`);
            } catch (e) { warnings.push(`${ref} (${set.name}): ${e.message}, skipped`); }
        }
        if (!simulated) throw new Error("No simulatable parts (R, C, L, D, Q, M, V) were found in that Eagle file.");
        let n = 1;
        for (const [net, v] of rails) lines.push(`VSUP${n++}_${node(net)} ${node(net)} 0 DC ${v}`);
        const all = new Set(); for (const p of parts.values()) for (const net of p.pinNet.values()) all.add(node(net));
        if (!all.has("0")) warnings.push("the schematic has no GND net: add a ground symbol before simulating");
        return { deck: `* imported from Eagle\n${lines.join("\n")}\n.end\n`, warnings };
    }

    static import(editor, text) {
        const { deck, warnings } = EagleImporter.toSpice(text);
        const r = SchematicImporter.import(editor, deck);
        r.warnings = [...warnings, ...r.warnings];
        r.title = "Eagle";
        return r;
    }
}

// Design file format: versions, migrations, validation.   node tests/format.test.js
const fs = require("fs"), path = require("path");
const { DesignFormat } = new Function(fs.readFileSync(path.join(__dirname, "..", "js/ui/format.js"), "utf8") + "\nreturn { DesignFormat };")();
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
let passed = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

check("current version is 2", DesignFormat.VERSION === 2);
check("versionOf: no format field is v0", DesignFormat.versionOf(fx("design-v0.json")) === 0);
check("versionOf: browser-spice/1", DesignFormat.versionOf(fx("design-v1.json")) === 1);
check("versionOf: junk is null", [null, 5, [], {}, { components: 1 }, { format: "other/1", components: [] }].every(x => DesignFormat.versionOf(x) === null));

const v0 = fx("design-v0.json"), before = JSON.stringify(v0);
const m0 = DesignFormat.migrate(v0);
check("v0 -> current", m0.from === 0 && m0.to === 2 && m0.migrated && m0.state.format === "browser-spice/2");
check("v0 pan moves into view", m0.state.view.panX === 12 && m0.state.view.panY === -7 && m0.state.panX === undefined);
check("migration does not touch its input", JSON.stringify(v0) === before);
check("v1 gains every list", ["wires", "probes", "measures", "params", "subckts"].every(k => Array.isArray(DesignFormat.migrate(fx("design-v1.json")).state[k])));
check("v1 keeps its parts", DesignFormat.migrate(fx("design-v1.json")).state.components[0].name === "R1");
const cur = DesignFormat.migrate(fx("design-v1.json")).state;
const again = DesignFormat.migrate(cur);
check("current version is a fixed point", !again.migrated && JSON.stringify(again.state) === JSON.stringify(cur));
check("newer format is refused with a clear message", /newer Browser SPICE/.test(throws(() => DesignFormat.migrate({ format: "browser-spice/99", components: [] })) || ""));
check("a non-design is refused", /not a Browser SPICE design/.test(throws(() => DesignFormat.migrate({ hello: 1 })) || ""));

check("validate: clean file", DesignFormat.validate(cur).length === 0, DesignFormat.validate(cur));
const bad = { format: "browser-spice/2", components: [{ id: 1, type: "resistor", x: 0, y: 0 }, { id: 1, type: "resistor", x: 0 }, { id: 2 }],
    wires: [{ id: 5, start: { type: "terminal", component: 9 }, end: { type: "free" } }, { id: 6 }], probes: [], nextId: 3 };
const p = DesignFormat.validate(bad).join(" | ");
check("validate: duplicate id", /duplicate component id 1/.test(p), p);
check("validate: missing position", /no position/.test(p), p);
check("validate: missing type", /no type/.test(p), p);
check("validate: wire to missing part", /missing component 9/.test(p), p);
check("validate: wire without end", /wire 6 lacks an end/.test(p), p);
check("validate: nextId too low", /nextId 3/.test(p), p);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

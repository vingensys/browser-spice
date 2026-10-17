// Editor scaling check: builds RC-ladder designs of growing size in the real app (headless Chrome) and times the
// steps a user waits for: import + auto-layout, redraw, wire tidy, netlist extraction, operating point, a fit-to-view.
//   node tests/perf/large-design.mjs [sizes, comma separated; default 100,300,600,1000]
// Prints a table; exits 1 when a step is over its budget (budgets are generous: they catch cliffs, not noise).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sizes = (process.argv[2] || "100,300,600,1000").split(",").map(Number);
const BUDGET_MS = { import: 20000, draw: 250, tidy: 20000, extract: 1000, op: 2000 };
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(c => c && existsSync(c));
if (!chrome) { console.error("Chrome not found. Set CHROME_PATH."); process.exit(2); }
const port = await new Promise((res, rej) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch (e) { /* gone */ } });
await new Promise(r => setTimeout(r, 800));

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1280, height: 900 } });
let over = 0;
try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
    await page.waitForFunction("!!window.editor && !!window.doc", { timeout: 20000 });
    console.log("parts  wires  import   draw(avg)  tidy    extract  op       notes");
    for (const n of sizes) {
        const r = await page.evaluate(async (n) => {
            const ms = (f) => { const t = performance.now(); const v = f(); return [performance.now() - t, v]; };
            let deck = "ladder\nV1 n0 0 DC 5\n";
            for (let i = 0; i < n; i++) deck += `R${i + 1} n${i} n${i + 1} 1k\nC${i + 1} n${i + 1} 0 1n\n`;
            deck += `RL n${n} 0 10k\n.op\n.end\n`;
            editor.components = []; editor.wires = []; editor.probes = []; editor.nextId = 1; editor.resetView();
            const out = {};
            [out.import] = ms(() => SchematicImporter.import(editor, deck));
            out.parts = editor.components.length; out.wires = editor.wires.length;
            out.blocked = editor.wires.filter(w => w.blocked).length;
            const t = []; for (let i = 0; i < 10; i++) t.push(ms(() => editor.draw())[0]);
            out.draw = t.reduce((a, b) => a + b, 0) / t.length;
            [out.tidy] = ms(() => editor.tidyAllWires());
            let info; [out.extract, info] = ms(() => NetlistExtractor.extract(editor));
            [out.op] = ms(() => new SimEngine(info.circuit).operatingPoint());
            return out;
        }, n);
        const over1 = [["import", r.import], ["draw", r.draw], ["tidy", r.tidy], ["extract", r.extract], ["op", r.op]].filter(([k, v]) => v > BUDGET_MS[k]).map(([k]) => k);
        if (over1.length) over++;
        const f = (v) => `${v.toFixed(0)} ms`.padEnd(9);
        console.log(`${String(r.parts).padEnd(6)} ${String(r.wires).padEnd(6)} ${f(r.import)}${f(r.draw)}  ${f(r.tidy)}${f(r.extract)}${f(r.op)}${r.blocked ? `${r.blocked} unrouted ` : ""}${over1.length ? "OVER BUDGET: " + over1.join(",") : ""}`);
    }
} finally { await browser.close(); server.kill(); }
process.exit(over ? 1 : 0);

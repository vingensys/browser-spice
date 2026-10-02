// The web app's File > Import with several files at once: the sheets of a hierarchical KiCad design (real KiCad demo files, fetched).
//   node tests/kicad/app-import.mjs      (needs Chrome and network, like tests/touch-real.mjs)
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"].find(c => c && existsSync(c));
const base = "https://raw.githubusercontent.com/KiCad/kicad-source-mirror/master/demos/simulation/subsheets/";
const dir = mkdtempSync(path.join(os.tmpdir(), "kicad-sheets-"));
const paths = [];
try { for (const n of ["subsheet2", "mainsheet", "subsheet1"]) { const p = path.join(dir, n + ".kicad_sch"); writeFileSync(p, await (await fetch(base + n + ".kicad_sch")).text()); paths.push(p); } } catch (e) { console.log("SKIP (no network)"); process.exit(0); }
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
let pass = 0, fail = 0; const row = (ok, s, d = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + s + (ok ? "" : "\n        -> " + d)); };
try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/`); await page.waitForFunction("!!window.editor && !!window.doc");
    await page.evaluate("localStorage.clear()");
    const input = await page.$("#spiceInput");
    await input.uploadFile(...paths);
    await page.waitForFunction("editor.components.length > 5", { timeout: 15000 }).catch(() => {});
    const r = await page.evaluate(() => { const info = NetlistExtractor.extract(editor); let op = "?"; try { op = Object.keys(new SimEngine(info.circuit).operatingPoint().nodeVoltages).length; } catch (e) { op = e.message; } return { parts: editor.components.length, wires: editor.wires.length, op, toast: (document.querySelector(".toast, #toast") || {}).textContent }; });
    row(r.parts >= 14 && r.wires > 10, `selecting the three sheet files together imports the whole design (${r.parts} parts, ${r.wires} wires)`, JSON.stringify(r));
    row(typeof r.op === "number", `and it simulates (${r.op} nodes)`, JSON.stringify(r));
} finally { await browser.close(); server.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

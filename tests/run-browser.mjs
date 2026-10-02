// Runs the browser test suites (tests/*.js) in headless Chrome against the real app.
//   npm run test:browser            (needs Chrome; set CHROME_PATH if it is not on a standard path)
// Starts scripts/serve.mjs on a free port, loads the page, evaluates each suite and prints a summary.
// Exit code 1 when any check fails or a suite cannot run.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUITES = [
    ["ui", "uiTests"], ["parts", "partsTests"], ["interaction", "interactionTests"], ["examples", "exampleTests"],
    ["roundtrip", "roundtripTests"], ["graph", "graphTests"], ["erc", "ercTests"], ["scope", "scopeTests"], ["analysis", "analysisTests"],
    ["engines", "engineTests"], ["stress", null]
].filter(([name]) => existsSync(path.join(root, "tests", `${name}.js`)));

function findChrome() {
    const candidates = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];
    return candidates.find(c => c && existsSync(c));
}

const freePort = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
});

const chrome = findChrome();
if (!chrome) { console.error("Chrome not found. Install it or set CHROME_PATH."); process.exit(2); }

const port = await freePort();
const server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const stop = () => { try { server.kill(); } catch (e) { /* already gone */ } };
process.on("exit", stop);
await new Promise(r => setTimeout(r, 800));

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,900"], defaultViewport: { width: 1280, height: 900 } });
let failed = 0, total = 0;
try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(e.message));
    await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
    await page.waitForFunction("!!window.editor && !!window.doc", { timeout: 20000 });
    await page.evaluate("localStorage.clear()");

    for (const [name, fn] of SUITES) {
        const t0 = Date.now();
        const result = await Promise.race([
            page.evaluate(async (suite, runner) => {
                try {
                    (0, eval)(await (await fetch(`tests/${suite}.js`, { cache: "reload" })).text());
                    if (runner === null) { const r = await stress(12345, 100); const bad = r.initBad.length || Object.keys(r.fails).length || r.degenerate; return { total: 1, failed: bad ? 1 : 0, failures: bad ? [{ name: "random moves left a bad layout", extra: r }] : [] }; }
                    return await window[runner]();
                } catch (e) { return { total: 1, failed: 1, failures: [{ name: "suite crashed", extra: String(e && e.stack || e) }] }; }
            }, name, fn),
            new Promise(r => setTimeout(() => r({ total: 1, failed: 1, failures: [{ name: "timed out after 240 s" }] }), 240000))
        ]);
        total += result.total; failed += result.failed;
        console.log(`${result.failed ? "FAIL" : "ok  "} ${name.padEnd(12)} ${result.total - result.failed}/${result.total}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const f of result.failures || []) console.log(`       - ${f.name !== undefined ? f.name : f.id}${f.extra !== undefined ? ` ${JSON.stringify(f.extra).slice(0, 300)}` : ""}${f.error ? ` ${f.error}` : ""}${f.name === undefined && f.tran !== undefined ? ` op ${f.op}% tran ${f.tran}%` : ""}`);
    }
    // offline: a visited copy of the app keeps working without a network (service worker)
    {
        total += 1;
        let ok = false, detail = "";
        try {
            await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
            await page.waitForFunction("navigator.serviceWorker && navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true)", { timeout: 15000 });
            await page.evaluate("navigator.serviceWorker.ready.then(() => new Promise(r => setTimeout(r, 1500)))");
            const cached = await page.evaluate("caches.keys().then(async k => k.length ? (await (await caches.open(k[0])).keys()).length : 0)");
            await page.setOfflineMode(true);
            await page.reload({ waitUntil: "load" });
            await page.waitForFunction("!!window.editor && !!window.doc", { timeout: 20000 });
            ok = cached > 40;
            detail = `${cached} files cached`;
            await page.setOfflineMode(false);
        } catch (e) { detail = String(e.message || e); }
        console.log(`${ok ? "ok  " : "FAIL"} offline      ${ok ? 1 : 0}/1  (${detail})`);
        if (!ok) failed += 1;
    }
    if (pageErrors.length) { console.log("uncaught page errors:"); pageErrors.slice(0, 5).forEach(e => console.log("  " + e)); failed += 1; }
} finally {
    await browser.close();
    stop();
}
console.log(`\n${total - failed} of ${total} browser checks passed`);
process.exit(failed ? 1 : 0);

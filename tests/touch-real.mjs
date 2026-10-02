// Touch input with real (trusted) touch events: headless Chrome emulating a phone, driven through the DevTools touch API, so the
// browser itself turns them into pointer events (pointerType "touch"), as it does on a device. Not a physical screen, but not
// synthetic events either.      node tests/touch-real.mjs      (needs Chrome, like npm run test:browser)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { KnownDevices } from "puppeteer-core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(c => c && existsSync(c));
if (!chrome) { console.error("Chrome not found"); process.exit(2); }
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch (e) { /* gone */ } });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
let pass = 0, fail = 0; const row = (ok, s, d = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + s + (ok ? "" : "\n        -> " + d)); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
try {
    const page = await browser.newPage();
    await page.emulate(KnownDevices["Pixel 5"] || KnownDevices["Galaxy S8"]);
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
    await page.waitForFunction("!!window.editor && !!window.doc", { timeout: 20000 });
    await page.evaluate("localStorage.clear(); loadExampleById(editor, 'rc-ladder'); editor.resetView(); editor.draw(); 1");
    const info = await page.evaluate(() => ({ coarse: matchMedia("(pointer: coarse)").matches, touch: navigator.maxTouchPoints, w: innerWidth, bar: getComputedStyle(document.getElementById("touchbar")).display }));
    row(info.coarse && info.touch > 0, `the emulated phone has a coarse pointer and touch points (${info.w} px wide)`, JSON.stringify(info));
    row(info.bar !== "none", "the touch toolbar appears by itself on a coarse pointer", info.bar);
    await page.evaluate(() => { window.__pe = []; for (const t of ["pointerdown", "pointermove", "pointerup"]) editor.canvas.addEventListener(t, e => window.__pe.push([t, e.pointerType, e.isTrusted]), true); });
    const rect = await page.evaluate(() => { const r = editor.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const st = () => page.evaluate(() => ({ zoom: editor.zoom, panX: editor.panX, panY: editor.panY, sel: editor.selection.length, tool: editor.tool }));
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h * 0.7;

    // one finger on empty sheet pans it
    let a = await st();
    const f1 = await page.touchscreen.touchStart(cx, cy);
    await f1.move(cx - 60, cy - 40); await f1.move(cx - 90, cy - 60); await f1.end();
    await wait(100);
    let b = await st();
    const ev = await page.evaluate(() => window.__pe);
    row(ev.length > 0 && ev.every(e => e[1] === "touch" && e[2] === true), `the browser delivers trusted touch pointer events (${ev.length} seen, e.g. ${ev[0] && ev[0].join("/")})`, JSON.stringify(ev.slice(0, 4)));
    row(Math.abs((b.panX - a.panX) + 90) < 3 && Math.abs((b.panY - a.panY) + 60) < 3, `one finger dragging empty sheet pans it (${(b.panX - a.panX).toFixed(0)}, ${(b.panY - a.panY).toFixed(0)})`, JSON.stringify([a, b]));

    // two fingers pinch zoom
    a = await st();
    const g1 = await page.touchscreen.touchStart(cx - 40, cy), g2 = await page.touchscreen.touchStart(cx + 40, cy);
    for (let k = 1; k <= 6; k++) { await g1.move(cx - 40 - k * 12, cy); await g2.move(cx + 40 + k * 12, cy); }
    await g1.end(); await g2.end(); await wait(100);
    b = await st();
    row(b.zoom > a.zoom * 1.5, `two fingers moving apart zoom in (${a.zoom.toFixed(2)} -> ${b.zoom.toFixed(2)})`, JSON.stringify([a, b]));
    a = await st();
    const h1 = await page.touchscreen.touchStart(cx - 150, cy), h2 = await page.touchscreen.touchStart(cx + 150, cy);
    for (let k = 1; k <= 6; k++) { await h1.move(cx - 150 + k * 20, cy); await h2.move(cx + 150 - k * 20, cy); }
    await h1.end(); await h2.end(); await wait(100);
    b = await st();
    row(b.zoom < a.zoom * 0.7, `moving together zooms out (${a.zoom.toFixed(2)} -> ${b.zoom.toFixed(2)})`, JSON.stringify([a, b]));

    // tap a part: it is selected; tap empty: cleared; double tap: the editor asks to edit it
    await page.evaluate(() => { Commands.run("view.fit"); editor.draw(); });
    const p = await page.evaluate(() => { const c = editor.components.find(q => q.type === "C"); const r = editor.canvas.getBoundingClientRect(); return { x: r.left + editor.panX + c.x * editor.zoom, y: r.top + editor.panY + c.y * editor.zoom, id: c.id }; });
    await page.touchscreen.tap(p.x, p.y); await wait(150);
    row((await st()).sel === 1, "tapping a part selects it", JSON.stringify(await st()));
    await page.touchscreen.tap(rect.x + 20, rect.y + 20); await wait(150);
    row((await st()).sel === 0, "tapping empty sheet clears the selection", JSON.stringify(await st()));
    await page.evaluate(() => { window.__edited = 0; const o = editor.onEdit; editor.onEdit = (c) => { window.__edited++; if (o) { /* keep the dialog from opening in the test */ } }; });
    await page.touchscreen.tap(p.x, p.y); await wait(80); await page.touchscreen.tap(p.x, p.y); await wait(250);
    row((await page.evaluate(() => window.__edited)) >= 1, "a double tap on a part asks to edit it", String(await page.evaluate(() => window.__edited)));

    // long press: the context menu
    await page.evaluate(() => { const m = document.getElementById("contextMenu"); if (m) m.style.display = "none"; });
    const lp = await page.touchscreen.touchStart(p.x, p.y); await wait(800); await lp.end(); await wait(150);
    const menu = await page.evaluate(() => { const m = document.getElementById("contextMenu"); return m && m.style.display !== "none" && m.children.length; });
    row(!!menu, `a long press opens the context menu (${menu} entries)`, String(menu));

    // dragging a part with a finger moves it
    await page.evaluate(() => { const m = document.getElementById("contextMenu"); if (m) m.style.display = "none"; editor.clearSelection(); Commands.run("view.fit"); editor.draw(); });
    const p2 = await page.evaluate((id) => { const c = editor.components.find(q => q.id === id); const r = editor.canvas.getBoundingClientRect(); return { x: r.left + editor.panX + c.x * editor.zoom, y: r.top + editor.panY + c.y * editor.zoom }; }, p.id);
    const before = await page.evaluate((id) => { const c = editor.components.find(q => q.id === id); return { x: c.x, y: c.y }; }, p.id);
    const d1 = await page.touchscreen.touchStart(p2.x, p2.y);
    await d1.move(p2.x + 20, p2.y + 20); await d1.move(p2.x + 60, p2.y + 40); await d1.end(); await wait(150);
    const after = await page.evaluate((id) => { const c = editor.components.find(q => q.id === id); return { x: c.x, y: c.y }; }, p.id);
    row(Math.hypot(after.x - before.x, after.y - before.y) > 10, `dragging a part with a finger moves it (${before.x},${before.y} -> ${after.x},${after.y})`, JSON.stringify([before, after]));

    // the toolbar buttons run the commands
    const wire = await page.$('#touchbar [data-cmd="tool.wire"]');
    if (wire) { const bb = await wire.boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await wait(150); }
    row((await st()).tool === "wire", "tapping the Wire button on the touch toolbar selects the wire tool", JSON.stringify(await st()));
    // a pin is hit from 15 px away: draw a wire by tapping from one pin to another
    const pins = await page.evaluate(() => { const r1 = editor.components.find(q => q.type === "R"); const t = editor.getTerminals(r1)[0]; const pos = editor.getTerminalPosition(r1, t); const rr = editor.canvas.getBoundingClientRect(); return { x: rr.left + editor.panX + pos.x * editor.zoom, y: rr.top + editor.panY + pos.y * editor.zoom }; });
    const wiresBefore = await page.evaluate(() => editor.wires.length);
    await page.touchscreen.tap(pins.x - 12, pins.y + 5); await wait(100);
    row(await page.evaluate(() => !!editor.wiring), "a finger a few pixels off a pin still starts a wire from it (bigger touch targets)", "");
    await page.evaluate(() => editor.cancelWire && editor.cancelWire());
    row(errors.length === 0, "no page errors during the touch session", errors.join("; "));
} finally {
    await browser.close(); server.kill();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

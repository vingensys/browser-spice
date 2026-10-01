// Static dev server: like `python3 -m http.server`, but it sends no-store so the browser always gets the
// current files, and it serves /version.json (git commit, "+" when there are uncommitted changes).
//   npm run serve            (http://localhost:8137)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8137);
const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".cir": "text/plain; charset=utf-8", ".wasm": "application/wasm",
    ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8"
};

function version() {
    try {
        const rev = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
        const dirty = execSync("git status --porcelain", { cwd: root }).toString().trim() ? "+" : "";
        return `${rev}${dirty}`;
    } catch (e) { return "dev"; }
}

http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const headers = { "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache" };
    if (url.pathname === "/version.json") {
        res.writeHead(200, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: version() }));
        return;
    }
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) { res.writeHead(403, headers); res.end("forbidden"); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, headers); res.end("not found"); return; }
        res.writeHead(200, { ...headers, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(data);
    });
}).listen(port, () => console.log(`Browser SPICE on http://localhost:${port}  (build ${version()})`));

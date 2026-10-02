// Offline support: every file is fetched from the network first (so an update is never stale) and kept in a cache;
// when the network is gone the last copy is served, so a visited copy of the app keeps working on a plane.
const CACHE = "browser-spice-v1";

self.addEventListener("install", (e) => {
    e.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        const base = ["./", "index.html", "css/app.css", "js/boot.js", "js/scripts.json", "version.json", "manifest.webmanifest", "icon.svg", "js/sim/worker.js", "js/sim/ngspice-worker.js", "vendor/ngspice/eecircuit-engine.mjs"];
        let scripts = [];
        try { scripts = (await (await fetch("js/scripts.json", { cache: "no-store" })).json()).map(s => s); } catch (err) { /* offline install: the next visit fills the cache */ }
        const all = [...new Set([...base, ...scripts, "js/sim/worker.js"])];
        await Promise.all(all.map(u => cache.add(new Request(u, { cache: "reload" })).catch(() => { })));
        self.skipWaiting();
    })());
});

self.addEventListener("activate", (e) => {
    e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })());
});

self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
    e.respondWith((async () => {
        const cache = await caches.open(CACHE);
        // the loader adds ?b=<time> to every script: cache under the plain path so offline hits match
        const key = new Request(req.url.split("?")[0]);
        try {
            const res = await fetch(req);
            if (res.ok) cache.put(key, res.clone());
            return res;
        } catch (err) {
            const hit = await cache.match(key);
            if (hit) return hit;
            throw err;
        }
    })());
});

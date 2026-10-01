// Loads the application scripts in order, each with a fresh cache-busting query, so an edited
// file is never served stale by the browser (a plain static server lets browsers cache JS).
// The script list lives in js/scripts.json; version.json (served by scripts/serve.mjs) names the build.
(async () => {
    const stamp = Date.now();
    const get = async (url) => (await fetch(`${url}?b=${stamp}`, { cache: "no-store" })).json();
    window.APP_VERSION = "dev";
    try { window.APP_VERSION = (await get("version.json")).version || "dev"; } catch (e) { /* plain static server: no version file */ }

    let list;
    try { list = await get("js/scripts.json"); } catch (e) { document.body.insertAdjacentHTML("beforeend", "<pre style='padding:1em'>Could not load js/scripts.json</pre>"); return; }

    for (const src of list) {
        await new Promise((resolve, reject) => {
            const el = document.createElement("script");
            el.src = `${src}?b=${stamp}`;
            el.onload = resolve;
            el.onerror = () => reject(new Error(`failed to load ${src}`));
            document.body.appendChild(el);
        }).catch((e) => console.error(e.message));
    }
    window.dispatchEvent(new Event("app-scripts-loaded"));
})();

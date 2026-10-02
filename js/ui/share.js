// Share a design as a link: the whole design is gzip-compressed into the URL fragment (#share=...), so the
// receiver opens it in the browser with nothing to download and no server involved.

const Share = {
    PREFIX: "#share=",

    async encode(state) {
        const bytes = new TextEncoder().encode(JSON.stringify(state));
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
        const buf = new Uint8Array(await new Response(stream).arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    },

    async decode(text) {
        const b64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
        const buf = Uint8Array.from(bin, c => c.charCodeAt(0));
        const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
        return JSON.parse(await new Response(stream).text());
    },

    // the design without the view and the run settings that only matter locally
    async link(doc) {
        const state = doc.serialize();
        delete state.view;
        return `${location.origin}${location.pathname}${Share.PREFIX}${await Share.encode(state)}`;
    },

    // the fragment of the current address, if it carries a design
    fromLocation() {
        return location.hash.startsWith(Share.PREFIX) ? location.hash.slice(Share.PREFIX.length) : null;
    },

    async open(editor, runner) {
        const doc = window.doc, esc = PropertiesPanel.esc;
        let url;
        try { url = await Share.link(doc); } catch (e) { runner.toast(`Could not make a link: ${e.message}`, "error"); return; }
        const wrap = document.createElement("div");
        wrap.innerHTML = `<p>Anyone who opens this link gets a copy of the design in their browser (nothing is uploaded).</p>
            <textarea readonly rows="5" style="width:100%;font-family:monospace;font-size:11px">${esc(url)}</textarea>
            <div class="prop-note">${url.length.toLocaleString()} characters.${url.length > 8000 ? " That is long: some chat and mail programs cut links this size. Use Save Design and send the file instead." : ""}</div>`;
        Dialog.open({
            title: "Share Design as a Link", content: wrap, width: "640px",
            buttons: [{ label: "Copy", primary: true, onClick: () => { try { navigator.clipboard.writeText(url); runner.toast("Link copied.", "info"); } catch (e) { wrap.querySelector("textarea").select(); } return false; } }, { label: "Close" }]
        });
        Share.last = url;
    }
};

// Inline SVG icon set (24x24 grid, drawn with currentColor so themes recolour them).

const Icons = {
    paths: {
        new: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
        open: '<path d="M3 7h6l2 2h10v10H3z"/>',
        save: '<path d="M5 3h12l3 3v15H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/>',
        import: '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 20h16"/>',
        export: '<path d="M12 15V3m-4 4 4-4 4 4"/><path d="M4 20h16"/>',
        undo: '<path d="M8 6 3 11l5 5"/><path d="M3 11h11a5 5 0 0 1 0 10h-4"/>',
        redo: '<path d="m16 6 5 5-5 5"/><path d="M21 11H10a5 5 0 0 0 0 10h4"/>',
        cut: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 18 4M16 16 6 4"/>',
        copy: '<rect x="8" y="8" width="12" height="13"/><path d="M16 8V4H4v13h4"/>',
        paste: '<rect x="5" y="5" width="14" height="16"/><rect x="9" y="3" width="6" height="4"/>',
        delete: '<path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14"/>',
        rotate: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
        rotateccw: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>',
        mirrorx: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7 3 17h6zM15 7l6 10h-6z"/>',
        mirrory: '<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M7 9 17 9 12 3zM7 15h10l-5 6z"/>',
        zoomin: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6M7 10h6"/>',
        zoomout: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/>',
        fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        grid: '<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>',
        play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
        step: '<path d="M5 4v16l11-8z" fill="currentColor"/><path d="M19 4v16"/>',
        pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
        stop: '<rect x="6" y="6" width="12" height="12" fill="currentColor"/>',
        graph: '<path d="M3 20h18M3 20V4"/><path d="m6 15 4-6 4 4 6-8"/>',
        select: '<path d="m5 3 14 8-6 2 4 7-3 1-4-7-5 4z" fill="currentColor"/>',
        component: '<path d="M7 4v16l14-8z"/><path d="M2 8h5M2 16h5M21 12h2"/>',
        wire: '<path d="M4 19h7V8h9"/><circle cx="4" cy="19" r="1.8"/><circle cx="20" cy="8" r="1.8"/>',
        terminal: '<path d="M12 3v9M5 12h14M8 16h8M10.5 20h3"/>',
        generator: '<circle cx="12" cy="12" r="9"/><path d="M6 12c2-6 4-6 6 0s4 6 6 0"/>',
        vprobe: '<path d="M3 21l6-6"/><circle cx="11.5" cy="12.5" r="3.5"/><path d="m14 10 5-5"/><text x="14" y="21" font-size="9" fill="currentColor" stroke="none" font-weight="700">V</text>',
        iprobe: '<path d="M3 21l6-6"/><circle cx="11.5" cy="12.5" r="3.5"/><path d="m14 10 5-5"/><text x="14" y="21" font-size="9" fill="currentColor" stroke="none" font-weight="700">A</text>',
        instrument: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="m5 12 3-4 3 5 3-6 3 5"/><path d="M8 21h8"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
        tidy: '<path d="M4 20 15 9"/><path d="m15 9 1.5-4 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5z"/>',
        pick: '<path d="M6 21V3h7a5 5 0 0 1 0 10H6"/>',
        library: '<path d="M6 3v18h12M6 3h4v14"/>',
        erc: '<path d="M12 3 3 20h18z"/><path d="M12 10v5M12 17.5v.5"/>',
        theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17v.5"/>'
    },

    svg(name) {
        const p = Icons.paths[name] || "";
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    }
};

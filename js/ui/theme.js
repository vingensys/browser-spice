// Colour themes. The drawing code was written against the dark palette, so a theme is a
// map from those literal colours to its own, plus a few semantic tokens (wires, sheet...).
//
//   classic - the ISIS look: cream sheet, green wires, maroon part outlines
//   dark    - the original dark workspace

const Theme = {
    name: "classic",

    themes: {
        classic: {
            label: "Classic (ISIS)",
            tokens: {
                workspace: "#a8a8a0", sheet: "#ffffef", border: "#0000b0", grid: "#c9c9ad",
                wire: "#006400", wireSelected: "#e00000", wireBlocked: "#ff0000", preview: "#0000ff",
                junction: "#006400", dangling: "#e08000", label: "#007070", value: "#007070",
                selection: "#0000ff", selectionFill: "rgba(0, 0, 255, 0.08)", hud: "#606060",
                pinOpen: "#e00000", probeV: "#c000c0", probeI: "#0080c0", flag: "#c000c0"
            },
            map: {
                "#ffb86c": "#800000", "#8be9fd": "#800000", "#bd93f9": "#800000", "#50fa7b": "#800000",
                "#ff79c6": "#800000", "#f1fa8c": "#800000", "#e8edf5": "#000000", "#9aa4b5": "#007070",
                "#171b23": "#ffffc8", "#ff5555": "#e00000", "#6ea8fe": "#0000ff", "#ffffff": "#000000",
                "rgba(255, 184, 108, 0.1)": "rgba(128, 0, 0, 0.10)",
                "rgba(255, 121, 198, 0.12)": "rgba(192, 0, 192, 0.12)",
                "rgba(241, 250, 140, 0.08)": "rgba(128, 0, 0, 0.08)"
            },
            iecResistor: true,
            lineScale: 0.62
        },
        dark: {
            label: "Dark",
            tokens: {
                workspace: "#0d1017", sheet: "#101318", border: "#2b3140", grid: "#202633",
                wire: "#6ea8fe", wireSelected: "#50fa7b", wireBlocked: "#ff5555", preview: "#50fa7b",
                junction: "#6ea8fe", dangling: "#ffb86c", label: "#e8edf5", value: "#9aa4b5",
                selection: "#6ea8fe", selectionFill: "rgba(110, 168, 254, 0.12)", hud: "#6b7588",
                pinOpen: "#ff5555", probeV: "#ff79c6", probeI: "#bd93f9", flag: "#ff79c6"
            },
            map: {},
            iecResistor: false,
            lineScale: 1
        }
    },

    get current() { return Theme.themes[Theme.name]; },

    // colour used by the drawing code: a literal from the dark palette, remapped per theme
    map(color) {
        const m = Theme.current.map;
        return (m && m[color]) || color;
    },

    token(name) { return Theme.current.tokens[name]; },

    set(name, persist = true) {
        if (!Theme.themes[name]) return;
        Theme.name = name;
        document.documentElement.setAttribute("data-theme", name);
        if (persist) { try { localStorage.setItem("browser-spice/theme", name); } catch (e) { /* ignore */ } }
        Theme.listeners.forEach(fn => fn(name));
    },

    listeners: [],
    onChange(fn) { Theme.listeners.push(fn); },

    restore() {
        let saved = null;
        try { saved = localStorage.getItem("browser-spice/theme"); } catch (e) { /* ignore */ }
        Theme.set(Theme.themes[saved] ? saved : "classic", false);
    }
};

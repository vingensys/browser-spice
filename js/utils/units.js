class Units {
    static SI_PREFIXES = {
        'f': 1e-15,
        'p': 1e-12,
        'n': 1e-9,
        'u': 1e-6,
        'µ': 1e-6,
        'm': 1e-3,
        'k': 1e3,
        'K': 1e3,
        'M': 1e6,
        'G': 1e9,
        'T': 1e12
    };

    /**
     * Parses a string with potential SI prefix into a floating point number.
     * E.g. "4.7k", "4.7 kΩ", "10 uF", "100" -> 4700, 0.00001, 100
     */
    static parseSI(input) {
        if (typeof input === 'number') return input;
        if (!input || typeof input !== 'string') return 0;

        const str = input.trim();
        if (str === '') return 0;

        // Match number (integer or float, optional scientific notation) followed by optional spaces and SI prefix/unit
        const match = str.match(/^([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([a-zA-ZµΩ]?)/);
        if (!match) return parseFloat(str) || 0;

        const num = parseFloat(match[1]);
        const prefix = match[2];

        // SPICE spells mega as "meg" (a bare M means milli there); accept it as well
        if (/^meg/i.test(str.slice(match[1].length).trim())) return num * 1e6;

        if (prefix && Units.SI_PREFIXES[prefix] !== undefined) {
            return num * Units.SI_PREFIXES[prefix];
        }

        return num;
    }

    /**
     * Formats a floating point number into an SI prefixed string.
     * E.g. 4700, "Ω" -> "4.7 kΩ"
     */
    static formatSI(value, unit = '') {
        if (value === null || value === undefined || isNaN(value)) return `0 ${unit}`.trim();
        if (!isFinite(value)) return value > 0 ? `∞ ${unit}`.trim() : `-∞ ${unit}`.trim();
        if (value === 0) return `0 ${unit}`.trim();

        const absVal = Math.abs(value);
        const prefixes = [
            { prefix: 'T', factor: 1e12 },
            { prefix: 'G', factor: 1e9 },
            { prefix: 'M', factor: 1e6 },
            { prefix: 'k', factor: 1e3 },
            { prefix: '', factor: 1 },
            { prefix: 'm', factor: 1e-3 },
            { prefix: 'µ', factor: 1e-6 },
            { prefix: 'n', factor: 1e-9 },
            { prefix: 'p', factor: 1e-12 },
            { prefix: 'f', factor: 1e-15 }
        ];

        for (const p of prefixes) {
            if (absVal >= p.factor * 0.999) {
                const scaled = value / p.factor;
                const formatted = Number.isInteger(scaled) ? scaled.toString() : parseFloat(scaled.toFixed(4)).toString();
                return `${formatted} ${p.prefix}${unit}`.trim();
            }
        }

        return `${value.toExponential(3)} ${unit}`.trim();
    }
}

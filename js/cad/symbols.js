// Pin: [name, x, y, outwardDirX, outwardDirY]. Box: [x1, y1, x2, y2] solid body.
// Every pin sits on the 20px grid so wires always land exactly on it.
const TWO_PIN = {
    pins: [["1", -40, 0, -1, 0], ["2", 40, 0, 1, 0]],
    box: [-40, -30, 40, 30]
};
const THREE_PIN = {
    pins: [["B", -40, 0, -1, 0], ["C", 20, -40, 0, -1], ["E", 20, 40, 0, 1]],
    box: [-40, -40, 40, 40]
};
const GATE2 = {
    pins: [["A", -40, -20, -1, 0], ["B", -40, 20, -1, 0], ["Y", 40, 0, 1, 0]],
    box: [-40, -30, 40, 30]
};

const FOUR_PIN = {
    // controlled sources: control pair on the left, output pair on the right
    pins: [["C+", -40, -20, -1, 0], ["C-", -40, 20, -1, 0], ["O+", 40, -20, 1, 0], ["O-", 40, 20, 1, 0]],
    box: [-40, -40, 40, 40]
};

const SYMBOL_DEFS = {
    R: TWO_PIN, C: TWO_PIN, L: TWO_PIN, V: TWO_PIN, I: TWO_PIN, SW: TWO_PIN,
    E: FOUR_PIN, G: FOUR_PIN,
    POT: { pins: [["A", -40, 0, -1, 0], ["B", 40, 0, 1, 0], ["W", 0, -40, 0, -1]], box: [-40, -40, 40, 30] },
    D: TWO_PIN, DZ: TWO_PIN, LED: TWO_PIN,
    BJT_NPN: THREE_PIN,
    BJT_PNP: THREE_PIN,
    NMOS: { pins: [["G", -40, 0, -1, 0], ["D", 20, -40, 0, -1], ["S", 20, 40, 0, 1]], box: [-40, -40, 40, 40] },
    PMOS: { pins: [["G", -40, 0, -1, 0], ["D", 20, -40, 0, -1], ["S", 20, 40, 0, 1]], box: [-40, -40, 40, 40] },
    OPAMP: {
        pins: [["IN-", -40, -20, -1, 0], ["IN+", -40, 20, -1, 0], ["OUT", 40, 0, 1, 0]],
        box: [-40, -40, 40, 40]
    },
    IC555: {
        pins: [
            ["GND", -60, -40, -1, 0], ["TRIG", -60, -20, -1, 0], ["OUT", -60, 20, -1, 0], ["RESET", -60, 40, -1, 0],
            ["VCC", 60, -40, 1, 0], ["DISCH", 60, -20, 1, 0], ["THRES", 60, 20, 1, 0], ["CTRL", 60, 40, 1, 0]
        ],
        box: [-60, -60, 60, 60]
    },
    AND: GATE2, OR: GATE2, NAND: GATE2, NOR: GATE2, XOR: GATE2,
    NOT: { pins: [["A", -40, 0, -1, 0], ["Y", 40, 0, 1, 0]], box: [-40, -30, 40, 30] },
    GND: { pins: [["1", 0, -20, 0, -1]], box: [-20, -20, 20, 40] },
    NODEIC: { pins: [["1", 0, 20, 0, 1]], box: [-30, -20, 30, 20] }
};

class MinHeap {
    constructor() { this.keys = []; this.vals = []; }
    get size() { return this.keys.length; }
    push(key, val) {
        const k = this.keys, v = this.vals;
        let i = k.length;
        k.push(key); v.push(val);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (k[p] <= key) break;
            k[i] = k[p]; v[i] = v[p];
            i = p;
        }
        k[i] = key; v[i] = val;
    }
    pop() {
        const k = this.keys, v = this.vals;
        const top = v[0];
        const lastK = k.pop(), lastV = v.pop();
        const n = k.length;
        if (n > 0) {
            let i = 0;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= n) break;
                if (c + 1 < n && k[c + 1] < k[c]) c++;
                if (k[c] >= lastK) break;
                k[i] = k[c]; v[i] = v[c];
                i = c;
            }
            k[i] = lastK; v[i] = lastV;
        }
        return top;
    }
}


// Copy the methods of a helper class onto another class's prototype
function applyMixin(Target, Source) {
    for (const name of Object.getOwnPropertyNames(Source.prototype)) {
        if (name !== "constructor") {
            Object.defineProperty(Target.prototype, name, Object.getOwnPropertyDescriptor(Source.prototype, name));
        }
    }
}

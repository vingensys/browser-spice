// Symbol artwork for SchematicEditor. Pins are drawn generically from SYMBOL_DEFS
// (drawComponent), so each symbol function only draws its own body artwork.

class SymbolRenderer {

    // waveform glyphs for the source symbol (path in a 24 x 16 box around the origin)
    static WAVE_GLYPHS = {
        AC: (c) => { c.moveTo(-12, 0); for (let i = 0; i <= 24; i++) c.lineTo(-12 + i, -7 * Math.sin((i / 24) * 2 * Math.PI)); },
        PULSE: (c) => { c.moveTo(-12, 6); c.lineTo(-12, 6); c.lineTo(-12, -6); c.lineTo(-2, -6); c.lineTo(-2, 6); c.lineTo(8, 6); c.lineTo(8, -6); c.lineTo(12, -6); },
        SQUARE: (c) => { c.moveTo(-12, 6); c.lineTo(-12, -6); c.lineTo(-4, -6); c.lineTo(-4, 6); c.lineTo(4, 6); c.lineTo(4, -6); c.lineTo(12, -6); },
        TRIANGLE: (c) => { c.moveTo(-12, 6); c.lineTo(-6, -6); c.lineTo(0, 6); c.lineTo(6, -6); c.lineTo(12, 6); },
        SAWTOOTH: (c) => { c.moveTo(-12, 6); c.lineTo(-2, -6); c.lineTo(-2, 6); c.lineTo(8, -6); c.lineTo(8, 6); },
        EXP: (c) => { c.moveTo(-12, 6); for (let i = 0; i <= 24; i++) c.lineTo(-12 + i, 6 - 12 * (1 - Math.exp(-i / 7))); },
        SFFM: (c) => { c.moveTo(-12, 0); for (let i = 0; i <= 24; i++) c.lineTo(-12 + i, -7 * Math.sin((i / 24) * 2 * Math.PI * 3 + 2 * Math.sin((i / 24) * 2 * Math.PI))); },
        PWL: (c) => { c.moveTo(-12, 6); c.lineTo(-5, 6); c.lineTo(0, -6); c.lineTo(6, -6); c.lineTo(12, 2); }
    };

    // theme-aware colour: literals from the dark palette are remapped by the active theme
    col(color) { return Theme.map(color); }
    tok(name) { return Theme.token(name); }
    lw(n) { return n * (Theme.current.lineScale || 1); }

    drawComponent(component, ghost = null) {
        const ctx = this.ctx;

        ctx.save();
        ctx.translate(component.x, component.y);
        ctx.rotate((component.rotation * Math.PI) / 180);
        if (component.mirror) ctx.scale(-1, 1);
        if (ghost) ctx.globalAlpha = 0.55;

        // text inside a mirrored symbol must stay readable: un-mirror each fillText in place
        const plainFill = ctx.fillText;
        if (component.mirror) {
            ctx.fillText = function (t, x, y, w) {
                const m = this.getTransform();
                if (m.a * m.d - m.b * m.c >= 0) return plainFill.call(this, t, x, y, w);
                this.save(); this.translate(x, y); this.scale(-1, 1);
                plainFill.call(this, t, 0, 0, w);
                this.restore();
            };
        }

        if (!ghost && this.isSelected(component)) {
            ctx.strokeStyle = this.col("#6ea8fe");
            ctx.lineWidth = 2 / this.zoom;
            ctx.setLineDash([5, 4]);
            const [bx1, by1, bx2, by2] = this.getSymbolDef(component).box;
            ctx.strokeRect(bx1 - 6, by1 - 6, bx2 - bx1 + 12, by2 - by1 + 12);
            ctx.setLineDash([]);
        }

        switch (component.type) {
            case "R": this.drawResistor(component); break;
            case "C": this.drawCapacitor(component); break;
            case "L": this.drawInductor(component); break;
            case "V": this.drawVoltageSource(component); break;
            case "I": this.drawCurrentSource(component); break;
            case "E": this.drawControlledSource(component, false); break;
            case "G": this.drawControlledSource(component, true); break;
            case "SW": this.drawSwitch(component); break;
            case "POT": this.drawPot(component); break;
            case "D": this.drawDiode(component); break;
            case "DZ": this.drawZener(component); break;
            case "LED": this.drawLED(component); break;
            case "BJT_NPN": this.drawTransistorNPN(component); break;
            case "BJT_PNP": this.drawTransistorPNP(component); break;
            case "NMOS": this.drawMOSFETN(component); break;
            case "PMOS": this.drawMOSFETP(component); break;
            case "OPAMP": this.drawOpAmp(component); break;
            case "IC555": this.drawIC555(component); break;
            case "AND":
            case "OR":
            case "NOT":
            case "NAND":
            case "NOR":
            case "XOR":
            case "XNOR":
            case "BUF":
                this.drawLogicGate(component);
                break;
            case "GND": this.drawGround(component); break;
            case "NODEIC": this.drawNodeIC(component); break;
            case "VM": this.drawMeter(component, "V"); break;
            case "AM": this.drawMeter(component, "A"); break;
            case "SCOPE": this.drawScope(component); break;
            case "LOGAN": this.drawLogan(component); break;
            default: this.drawPart(component);
        }

        // Unconnected pins show as red rings (Proteus-style); wired pins are hidden
        ctx.strokeStyle = this.tok("pinOpen");
        ctx.lineWidth = this.lw(1.5);
        for (const terminal of this.getTerminals(component)) {
            const p = this.getTerminalPosition(component, terminal);
            if (!ghost && this.connectedPins && this.connectedPins.has(`${p.x},${p.y}`)) continue;
            ctx.beginPath();
            ctx.arc(terminal.x, terminal.y, 3.5, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (ghost && !ghost.free) {
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = this.col("#ff5555");
            const [bx1, by1, bx2, by2] = this.getSymbolDef(component).box;
            ctx.fillRect(bx1, by1, bx2 - bx1, by2 - by1);
        }

        if (component.mirror) delete ctx.fillText;
        ctx.restore();
    }

    // undo the part's rotation (and mirror) so text drawn next reads normally
    upright(component) {
        if (component.mirror) this.ctx.scale(-1, 1);
        this.ctx.rotate((-component.rotation * Math.PI) / 180);
    }

    drawResistor(component) {
        const ctx = this.ctx;
        if (Theme.current.iecResistor) {
            ctx.strokeStyle = this.col("#ffb86c");
            ctx.fillStyle = this.col("#171b23");
            ctx.lineWidth = this.lw(2);
            ctx.beginPath();
            ctx.moveTo(-40, 0); ctx.lineTo(-24, 0);
            ctx.moveTo(24, 0); ctx.lineTo(40, 0);
            ctx.stroke();
            ctx.beginPath();
            ctx.rect(-24, -9, 48, 18);
            ctx.fill();
            ctx.stroke();
            this.drawLabel(component);
            return;
        }
        ctx.strokeStyle = this.col("#ffb86c");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-28, 0);
        ctx.lineTo(-20, -10);
        ctx.lineTo(-8, 10);
        ctx.lineTo(4, -10);
        ctx.lineTo(16, 10);
        ctx.lineTo(28, -10);
        ctx.lineTo(36, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawCapacitor(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#8be9fd");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-8, 0);
        ctx.moveTo(8, 0);
        ctx.lineTo(40, 0);
        ctx.moveTo(-8, -20);
        ctx.lineTo(-8, 20);
        ctx.moveTo(8, -20);
        ctx.lineTo(8, 20);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawInductor(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#bd93f9");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-25, 0);
        ctx.arc(-15, 0, 10, Math.PI, 0);
        ctx.arc(5, 0, 10, Math.PI, 0);
        ctx.arc(25, 0, 10, Math.PI, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawVoltageSource(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#50fa7b");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-24, 0);
        ctx.moveTo(24, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();

        const shape = SymbolRenderer.WAVE_GLYPHS[component.sourceType];
        if (shape) {
            // a miniature of the waveform inside the circle, so a sine source looks like one
            ctx.lineWidth = this.lw(2);
            ctx.beginPath();
            shape(ctx);
            ctx.stroke();
            ctx.font = "bold 11px system-ui";
            ctx.fillStyle = this.col("#50fa7b");
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("+", 15, -13);
        } else {
            ctx.font = "18px system-ui";
            ctx.fillStyle = this.col("#50fa7b");
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("−", -11, 0);
            ctx.fillText("+", 11, 0);
        }

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawCurrentSource(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#50fa7b");
        ctx.lineWidth = this.lw(3);
        ctx.beginPath();
        ctx.moveTo(-40, 0); ctx.lineTo(-24, 0);
        ctx.moveTo(24, 0); ctx.lineTo(40, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();

        // arrow along the current direction (pin 1 -> pin 2)
        ctx.lineWidth = this.lw(2.5);
        ctx.beginPath();
        ctx.moveTo(-13, 0); ctx.lineTo(13, 0);
        ctx.stroke();
        ctx.fillStyle = this.col("#50fa7b");
        ctx.beginPath();
        ctx.moveTo(15, 0); ctx.lineTo(6, -6); ctx.lineTo(6, 6);
        ctx.closePath();
        ctx.fill();
        this.drawLabel(component);
    }

    // Dependent source: diamond with the control pair on the left, output on the right.
    drawControlledSource(component, current) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#f1fa8c");
        ctx.lineWidth = this.lw(3);
        ctx.beginPath();
        ctx.moveTo(-40, -20); ctx.lineTo(-22, -20);
        ctx.moveTo(-40, 20); ctx.lineTo(-22, 20);
        ctx.moveTo(40, -20); ctx.lineTo(22, -20);
        ctx.moveTo(40, 20); ctx.lineTo(22, 20);
        ctx.stroke();

        ctx.fillStyle = this.col("rgba(241, 250, 140, 0.08)");
        ctx.beginPath();
        ctx.moveTo(0, -34); ctx.lineTo(24, 0); ctx.lineTo(0, 34); ctx.lineTo(-24, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 11px system-ui";
        ctx.fillStyle = this.col("#f1fa8c");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(current ? "gm" : "A", 0, 0);
        ctx.font = "11px system-ui";
        ctx.fillText("+", -15, -20); ctx.fillText("−", -15, 20);
        ctx.fillText("+", 15, -20); ctx.fillText("−", 15, 20);
        this.drawLabel(component);
    }

    drawSwitch(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#8be9fd");
        ctx.lineWidth = this.lw(3);
        ctx.beginPath();
        ctx.moveTo(-40, 0); ctx.lineTo(-18, 0);
        ctx.moveTo(18, 0); ctx.lineTo(40, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-18, 0);
        if (component.closed) ctx.lineTo(18, 0);
        else ctx.lineTo(14, -16);
        ctx.stroke();
        ctx.fillStyle = this.col("#171b23");
        for (const x of [-18, 18]) {
            ctx.beginPath();
            ctx.arc(x, 0, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        this.drawLabel(component);
    }

    drawPot(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#ffb86c");
        ctx.lineWidth = this.lw(3);
        ctx.beginPath();
        ctx.moveTo(-40, 0); ctx.lineTo(-28, 0);
        ctx.lineTo(-20, -8); ctx.lineTo(-8, 8); ctx.lineTo(4, -8); ctx.lineTo(16, 8); ctx.lineTo(28, -8);
        ctx.lineTo(34, 0); ctx.lineTo(40, 0);
        ctx.stroke();

        // wiper arrow from the top pin onto the resistor, positioned by its setting
        const pos = Math.min(1, Math.max(0, component.position === undefined ? 0.5 : component.position));
        const wx = -28 + pos * 56;
        ctx.lineWidth = this.lw(2.5);
        ctx.beginPath();
        ctx.moveTo(0, -40); ctx.lineTo(0, -22); ctx.lineTo(wx, -22); ctx.lineTo(wx, -10);
        ctx.stroke();
        ctx.fillStyle = this.col("#ffb86c");
        ctx.beginPath();
        ctx.moveTo(wx, -6); ctx.lineTo(wx - 4, -13); ctx.lineTo(wx + 4, -13);
        ctx.closePath();
        ctx.fill();
        this.drawLabel(component);
    }

    // Initial-condition flag: forces the net's starting voltage in a "start from 0" transient.
    drawNodeIC(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#ff79c6");
        ctx.fillStyle = this.col("rgba(255, 121, 198, 0.12)");
        ctx.lineWidth = this.lw(2.5);
        ctx.beginPath();
        ctx.moveTo(0, 20); ctx.lineTo(0, 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.rect(-28, -14, 56, 22);
        ctx.fill();
        ctx.stroke();
        ctx.font = "bold 11px system-ui";
        ctx.fillStyle = this.col("#ff79c6");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`IC=${component.value || "0 V"}`, 0, -3);
    }

    // Panel meter: a circle with its letter and the live reading underneath.
    drawMeter(component, letter) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#e8edf5");
        ctx.fillStyle = this.col("#171b23");
        ctx.lineWidth = this.lw(2.5);
        ctx.beginPath();
        ctx.moveTo(-40, 0); ctx.lineTo(-22, 0);
        ctx.moveTo(22, 0); ctx.lineTo(40, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = "bold 20px system-ui";
        ctx.fillStyle = this.col("#e8edf5");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, 0, 1);
        ctx.font = "11px system-ui";
        ctx.fillText("+", -12, -14);

        ctx.save();
        this.upright(component);
        ctx.font = "bold 12px Consolas, monospace";
        ctx.fillStyle = component.live !== undefined ? this.tok("probeV") : this.tok("value");
        ctx.textAlign = "center";
        ctx.fillText(component.live !== undefined ? component.live : (letter === "V" ? "+0.00 V" : "+0.00 A"), 0, 42);
        ctx.restore();
    }

    // Oscilloscope symbol: the screen is drawn live by the simulation window.
    drawScope(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#e8edf5");
        ctx.lineWidth = this.lw(2);
        ctx.fillStyle = "#101820";
        ctx.beginPath();
        ctx.rect(-40, -58, 96, 116);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#2c5a3a";
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            ctx.beginPath(); ctx.moveTo(-34, -52 + i * 26); ctx.lineTo(50, -52 + i * 26); ctx.stroke();
        }
        const colors = ["#ffe040", "#40e0ff", "#ff6060", "#60ff60"];
        const trace = component.scopeTrace;
        [-40, -20, 20, 40].forEach((y, i) => {
            ctx.strokeStyle = this.col("#e8edf5");
            ctx.lineWidth = this.lw(2);
            ctx.beginPath(); ctx.moveTo(-80, y); ctx.lineTo(-40, y); ctx.stroke();
            ctx.font = "bold 10px system-ui";
            ctx.fillStyle = colors[i];
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText("ABCD"[i], -36, y);
            if (trace && trace[i] && trace[i].length > 1) {
                ctx.strokeStyle = colors[i];
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                trace[i].forEach((v, k) => {
                    const px = -22 + (k / (trace[i].length - 1)) * 72;
                    const py = 0 - Math.max(-1, Math.min(1, v / (component.scopeScale || 10))) * 44;
                    k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                });
                ctx.stroke();
            }
        });
        this.drawLabel(component);
    }

    drawLogan(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#e8edf5"); ctx.lineWidth = this.lw(2); ctx.fillStyle = "#101820";
        ctx.beginPath(); ctx.rect(-40, -98, 96, 176); ctx.fill(); ctx.stroke();
        const colors = ["#ffd54a", "#4fc3f7", "#ff6e9a", "#7cf08a", "#ffab40", "#b388ff", "#80deea", "#e6ee9c"], tr = component.logTrace;
        [-80, -60, -40, -20, 0, 20, 40, 60].forEach((y, i) => {
            ctx.strokeStyle = this.col("#e8edf5"); ctx.lineWidth = this.lw(2);
            ctx.beginPath(); ctx.moveTo(-80, y); ctx.lineTo(-40, y); ctx.stroke();
            ctx.font = "bold 9px system-ui"; ctx.fillStyle = colors[i]; ctx.textAlign = "left"; ctx.textBaseline = "middle";
            ctx.fillText(String(i), -36, y);
            ctx.strokeStyle = colors[i]; ctx.lineWidth = 1.2; ctx.beginPath();
            const a = tr && tr[i];
            if (a && a.length > 1) a.forEach((v, k) => { const px = -26 + (k / (a.length - 1)) * 76, py = y + (v ? -6 : 6); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
            else { ctx.moveTo(-26, y + 6); ctx.lineTo(50, y + 6); }
            ctx.stroke();
        });
        this.drawLabel(component);
    }

    drawDiode(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#ff79c6");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-14, 0);
        ctx.moveTo(14, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.fillStyle = this.col("#ff79c6");
        ctx.beginPath();
        ctx.moveTo(-14, -12);
        ctx.lineTo(14, 0);
        ctx.lineTo(-14, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(14, -12);
        ctx.lineTo(14, 12);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawZener(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#ff79c6");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-14, 0);
        ctx.moveTo(14, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.fillStyle = this.col("#ff79c6");
        ctx.beginPath();
        ctx.moveTo(-14, -12);
        ctx.lineTo(14, 0);
        ctx.lineTo(-14, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(8, -16);
        ctx.lineTo(14, -12);
        ctx.lineTo(14, 12);
        ctx.lineTo(20, 16);
        ctx.stroke();

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawLED(component) {
        this.drawDiode(component);
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#50fa7b");
        ctx.lineWidth = this.lw(2);

        ctx.beginPath();
        ctx.moveTo(2, -14);
        ctx.lineTo(10, -24);
        ctx.moveTo(10, -14);
        ctx.lineTo(18, -24);
        ctx.stroke();
    }

    drawTransistorNPN(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#bd93f9");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-10, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -20);
        ctx.lineTo(-10, 20);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(20, -40);
        ctx.moveTo(-10, 10);
        ctx.lineTo(20, 40);
        ctx.stroke();

        ctx.fillStyle = this.col("#bd93f9");
        ctx.beginPath();
        ctx.moveTo(20, 40);
        ctx.lineTo(10, 32);
        ctx.lineTo(14, 22);
        ctx.closePath();
        ctx.fill();

        this.drawTerminal(-40, 0);
        this.drawTerminal(20, -40);
        this.drawTerminal(20, 40);
        this.drawLabel(component);
    }

    drawTransistorPNP(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#bd93f9");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-10, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -20);
        ctx.lineTo(-10, 20);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(20, -40);
        ctx.moveTo(-10, 10);
        ctx.lineTo(20, 40);
        ctx.stroke();

        ctx.fillStyle = this.col("#bd93f9");
        ctx.beginPath();
        ctx.moveTo(-10, 10);
        ctx.lineTo(0, 18);
        ctx.lineTo(-4, 28);
        ctx.closePath();
        ctx.fill();

        this.drawTerminal(-40, 0);
        this.drawTerminal(20, -40);
        this.drawTerminal(20, 40);
        this.drawLabel(component);
    }

    drawMOSFETN(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#50fa7b");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-12, 0);
        ctx.moveTo(-12, -18);
        ctx.lineTo(-12, 18);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-4, -18);
        ctx.lineTo(-4, 18);
        ctx.moveTo(-4, -15);
        ctx.lineTo(20, -40);
        ctx.moveTo(-4, 15);
        ctx.lineTo(20, 40);
        ctx.stroke();

        // body terminal: a lead from the channel to the right edge with an arrow (in for N, out for P)
        const pmos = component.type === "PMOS";
        ctx.beginPath();
        ctx.lineWidth = this.lw(1.5);
        ctx.moveTo(-4, 0); ctx.lineTo(40, 0);
        const ax = pmos ? 4 : -4, dir = pmos ? -1 : 1;
        ctx.moveTo(pmos ? 6 : 4, 0); ctx.lineTo(pmos ? 14 : 12, -4); ctx.moveTo(pmos ? 6 : 4, 0); ctx.lineTo(pmos ? 14 : 12, 4);
        ctx.stroke();
        ctx.lineWidth = this.lw(3);

        this.drawTerminal(-40, 0);
        this.drawTerminal(20, -40);
        this.drawTerminal(20, 40);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawMOSFETP(component) {
        this.drawMOSFETN(component);
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#50fa7b");
        ctx.lineWidth = this.lw(2);
        ctx.fillStyle = this.col("#171b23");
        ctx.beginPath();
        ctx.arc(-22, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    drawOpAmp(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#ffb86c");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(25, 0);
        ctx.lineTo(40, 0);
        ctx.moveTo(-40, -20);
        ctx.lineTo(-25, -20);
        ctx.moveTo(-40, 20);
        ctx.lineTo(-25, 20);
        ctx.stroke();

        ctx.fillStyle = this.col("rgba(255, 184, 108, 0.1)");
        ctx.beginPath();
        ctx.moveTo(-25, -35);
        ctx.lineTo(25, 0);
        ctx.lineTo(-25, 35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 14px system-ui";
        ctx.fillStyle = this.col("#ffb86c");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("−", -15, -20);
        ctx.fillText("+", -15, 20);

        this.drawTerminal(-40, -20);
        this.drawTerminal(-40, 20);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawIC555(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#8be9fd");
        ctx.lineWidth = this.lw(3);

        ctx.fillStyle = this.col("#171b23");
        ctx.beginPath();
        ctx.rect(-40, -55, 80, 110);
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 13px system-ui";
        ctx.fillStyle = this.col("#8be9fd");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("NE555", 0, 0);

        ctx.font = "9px system-ui";
        for (const [name, x, y, dx] of this.getSymbolDef(component).pins) {
            ctx.strokeStyle = this.col("#8be9fd");
            ctx.lineWidth = this.lw(3);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(dx * 40, y);
            ctx.stroke();

            ctx.fillStyle = this.col("#9aa4b5");
            ctx.textAlign = dx < 0 ? "left" : "right";
            ctx.fillText(name, dx * 36, y);
        }

        this.drawLabel(component);
    }

    drawLogicGate(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#f1fa8c");
        ctx.lineWidth = this.lw(3);

        const isNot = component.type === "NOT" || component.type === "BUF";
        if (isNot) {
            ctx.beginPath();
            ctx.moveTo(-40, 0);
            ctx.lineTo(-20, 0);
            ctx.moveTo(20, 0);
            ctx.lineTo(40, 0);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(-20, -20);
            ctx.lineTo(15, 0);
            ctx.lineTo(-20, 20);
            ctx.closePath();
            ctx.stroke();

            if (component.type === "NOT") {
                ctx.beginPath();
                ctx.arc(18, 0, 4, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(15, 0); ctx.lineTo(20, 0);
                ctx.stroke();
            }

            this.drawTerminal(-40, 0);
            this.drawTerminal(40, 0);
        } else {
            ctx.beginPath();
            ctx.moveTo(-40, -20);
            ctx.lineTo(-20, -20);
            ctx.moveTo(-40, 20);
            ctx.lineTo(-20, 20);
            ctx.moveTo(20, 0);
            ctx.lineTo(40, 0);
            ctx.stroke();

            ctx.font = "bold 13px system-ui";
            ctx.fillStyle = this.col("#f1fa8c");
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(component.type, 0, 0);

            ctx.beginPath();
            ctx.rect(-20, -25, 40, 50);
            ctx.stroke();


        }

        this.drawLabel(component);
    }

    drawGround(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.col("#e8edf5");
        ctx.lineWidth = this.lw(3);

        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(0, 5);
        ctx.moveTo(-20, 5);
        ctx.lineTo(20, 5);
        ctx.moveTo(-13, 12);
        ctx.lineTo(13, 12);
        ctx.moveTo(-6, 19);
        ctx.lineTo(6, 19);
        ctx.stroke();

        this.drawTerminal(0, -15);

        ctx.save();
        this.upright(component);
        ctx.font = "12px system-ui";
        ctx.fillStyle = this.col("#e8edf5");
        ctx.textAlign = "center";
        const o = this.rotateOffset(0, 35, component.rotation);
        ctx.fillText("GND", o.x, o.y + 4);
        ctx.restore();
    }

    // Pins are drawn generically in drawComponent from the symbol table
    drawTerminal() {}

    // Labels stay upright whatever the part's rotation (like Proteus): the text is
    // drawn in world orientation, beside the part's rotated body.
    drawLabel(component) {
        const ctx = this.ctx;
        const b = this.getComponentBox(component);
        const vertical = component.rotation === 90 || component.rotation === 270;
        const right = b.x2 - component.x;
        const top = b.y1 - component.y, bottom = b.y2 - component.y;

        ctx.save();
        this.upright(component);
        ctx.textBaseline = "alphabetic";

        // after un-rotating, local axes are world axes, so the world-space box applies directly
        const nameAt = vertical ? { x: right + 8, y: -2, align: "left" } : { x: 0, y: top + 5, align: "center" };
        const valueAt = vertical ? { x: right + 8, y: 12, align: "left" } : { x: 0, y: bottom + 8, align: "center" };

        ctx.font = "12px system-ui";
        ctx.fillStyle = this.tok("label");
        ctx.textAlign = nameAt.align;
        ctx.fillText(component.name, nameAt.x, nameAt.y);

        ctx.font = "10px system-ui";
        ctx.fillStyle = this.tok("value");
        ctx.textAlign = valueAt.align;
        ctx.fillText(component.value, valueAt.x, valueAt.y);
        ctx.restore();
    }
}

// Symbol artwork for SchematicEditor. Pins are drawn generically from SYMBOL_DEFS
// (drawComponent), so each symbol function only draws its own body artwork.

class SymbolRenderer {

    drawComponent(component, ghost = null) {
        const ctx = this.ctx;

        ctx.save();
        ctx.translate(component.x, component.y);
        ctx.rotate((component.rotation * Math.PI) / 180);
        if (ghost) ctx.globalAlpha = 0.55;

        if (!ghost && this.isSelected(component)) {
            ctx.strokeStyle = "#6ea8fe";
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
                this.drawLogicGate(component);
                break;
            case "GND": this.drawGround(component); break;
            case "NODEIC": this.drawNodeIC(component); break;
        }

        // Unconnected pins show as red rings (Proteus-style); wired pins are hidden
        ctx.strokeStyle = ghost && !ghost.free ? "#ff5555" : "#ff5555";
        ctx.lineWidth = 1.5;
        for (const terminal of this.getTerminals(component)) {
            const p = this.getTerminalPosition(component, terminal);
            if (!ghost && this.connectedPins && this.connectedPins.has(`${p.x},${p.y}`)) continue;
            ctx.beginPath();
            ctx.arc(terminal.x, terminal.y, 3.5, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (ghost && !ghost.free) {
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = "#ff5555";
            const [bx1, by1, bx2, by2] = this.getSymbolDef(component).box;
            ctx.fillRect(bx1, by1, bx2 - bx1, by2 - by1);
        }

        ctx.restore();
    }

    drawResistor(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ffb86c";
        ctx.lineWidth = 3;

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
        ctx.strokeStyle = "#8be9fd";
        ctx.lineWidth = 3;

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
        ctx.strokeStyle = "#bd93f9";
        ctx.lineWidth = 3;

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
        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-24, 0);
        ctx.moveTo(24, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = "18px system-ui";
        ctx.fillStyle = "#50fa7b";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("−", -11, 0);
        ctx.fillText("+", 11, 0);

        this.drawTerminal(-40, 0);
        this.drawTerminal(40, 0);
        this.drawLabel(component);
    }

    drawCurrentSource(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-40, 0); ctx.lineTo(-24, 0);
        ctx.moveTo(24, 0); ctx.lineTo(40, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();

        // arrow along the current direction (pin 1 -> pin 2)
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-13, 0); ctx.lineTo(13, 0);
        ctx.stroke();
        ctx.fillStyle = "#50fa7b";
        ctx.beginPath();
        ctx.moveTo(15, 0); ctx.lineTo(6, -6); ctx.lineTo(6, 6);
        ctx.closePath();
        ctx.fill();
        this.drawLabel(component);
    }

    // Dependent source: diamond with the control pair on the left, output on the right.
    drawControlledSource(component, current) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#f1fa8c";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-40, -20); ctx.lineTo(-22, -20);
        ctx.moveTo(-40, 20); ctx.lineTo(-22, 20);
        ctx.moveTo(40, -20); ctx.lineTo(22, -20);
        ctx.moveTo(40, 20); ctx.lineTo(22, 20);
        ctx.stroke();

        ctx.fillStyle = "rgba(241, 250, 140, 0.08)";
        ctx.beginPath();
        ctx.moveTo(0, -34); ctx.lineTo(24, 0); ctx.lineTo(0, 34); ctx.lineTo(-24, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 11px system-ui";
        ctx.fillStyle = "#f1fa8c";
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
        ctx.strokeStyle = "#8be9fd";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-40, 0); ctx.lineTo(-18, 0);
        ctx.moveTo(18, 0); ctx.lineTo(40, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-18, 0);
        if (component.closed) ctx.lineTo(18, 0);
        else ctx.lineTo(14, -16);
        ctx.stroke();
        ctx.fillStyle = "#171b23";
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
        ctx.strokeStyle = "#ffb86c";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-40, 0); ctx.lineTo(-28, 0);
        ctx.lineTo(-20, -8); ctx.lineTo(-8, 8); ctx.lineTo(4, -8); ctx.lineTo(16, 8); ctx.lineTo(28, -8);
        ctx.lineTo(34, 0); ctx.lineTo(40, 0);
        ctx.stroke();

        // wiper arrow from the top pin onto the resistor, positioned by its setting
        const pos = Math.min(1, Math.max(0, component.position === undefined ? 0.5 : component.position));
        const wx = -28 + pos * 56;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -40); ctx.lineTo(0, -22); ctx.lineTo(wx, -22); ctx.lineTo(wx, -10);
        ctx.stroke();
        ctx.fillStyle = "#ffb86c";
        ctx.beginPath();
        ctx.moveTo(wx, -6); ctx.lineTo(wx - 4, -13); ctx.lineTo(wx + 4, -13);
        ctx.closePath();
        ctx.fill();
        this.drawLabel(component);
    }

    // Initial-condition flag: forces the net's starting voltage in a "start from 0" transient.
    drawNodeIC(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ff79c6";
        ctx.fillStyle = "rgba(255, 121, 198, 0.12)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, 20); ctx.lineTo(0, 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.rect(-28, -14, 56, 22);
        ctx.fill();
        ctx.stroke();
        ctx.font = "bold 11px system-ui";
        ctx.fillStyle = "#ff79c6";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`IC=${component.value || "0 V"}`, 0, -3);
    }

    drawDiode(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ff79c6";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-14, 0);
        ctx.moveTo(14, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.fillStyle = "#ff79c6";
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
        ctx.strokeStyle = "#ff79c6";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(-40, 0);
        ctx.lineTo(-14, 0);
        ctx.moveTo(14, 0);
        ctx.lineTo(40, 0);
        ctx.stroke();

        ctx.fillStyle = "#ff79c6";
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
        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(2, -14);
        ctx.lineTo(10, -24);
        ctx.moveTo(10, -14);
        ctx.lineTo(18, -24);
        ctx.stroke();
    }

    drawTransistorNPN(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#bd93f9";
        ctx.lineWidth = 3;

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

        ctx.fillStyle = "#bd93f9";
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
        ctx.strokeStyle = "#bd93f9";
        ctx.lineWidth = 3;

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

        ctx.fillStyle = "#bd93f9";
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
        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 3;

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

        this.drawTerminal(-40, 0);
        this.drawTerminal(20, -40);
        this.drawTerminal(20, 40);
        this.drawLabel(component);
    }

    drawMOSFETP(component) {
        this.drawMOSFETN(component);
        const ctx = this.ctx;
        ctx.strokeStyle = "#50fa7b";
        ctx.lineWidth = 2;
        ctx.fillStyle = "#171b23";
        ctx.beginPath();
        ctx.arc(-22, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    drawOpAmp(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ffb86c";
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(25, 0);
        ctx.lineTo(40, 0);
        ctx.moveTo(-40, -20);
        ctx.lineTo(-25, -20);
        ctx.moveTo(-40, 20);
        ctx.lineTo(-25, 20);
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 184, 108, 0.1)";
        ctx.beginPath();
        ctx.moveTo(-25, -35);
        ctx.lineTo(25, 0);
        ctx.lineTo(-25, 35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 14px system-ui";
        ctx.fillStyle = "#ffb86c";
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
        ctx.strokeStyle = "#8be9fd";
        ctx.lineWidth = 3;

        ctx.fillStyle = "#171b23";
        ctx.beginPath();
        ctx.rect(-40, -55, 80, 110);
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 13px system-ui";
        ctx.fillStyle = "#8be9fd";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("NE555", 0, 0);

        ctx.font = "9px system-ui";
        for (const [name, x, y, dx] of this.getSymbolDef(component).pins) {
            ctx.strokeStyle = "#8be9fd";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(dx * 40, y);
            ctx.stroke();

            ctx.fillStyle = "#9aa4b5";
            ctx.textAlign = dx < 0 ? "left" : "right";
            ctx.fillText(name, dx * 36, y);
        }

        this.drawLabel(component);
    }

    drawLogicGate(component) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#f1fa8c";
        ctx.lineWidth = 3;

        const isNot = component.type === "NOT";
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

            ctx.beginPath();
            ctx.arc(18, 0, 4, 0, Math.PI * 2);
            ctx.stroke();

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
            ctx.fillStyle = "#f1fa8c";
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
        ctx.strokeStyle = "#e8edf5";
        ctx.lineWidth = 3;

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
        ctx.rotate((-component.rotation * Math.PI) / 180);
        ctx.font = "12px system-ui";
        ctx.fillStyle = "#e8edf5";
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
        ctx.rotate((-component.rotation * Math.PI) / 180);
        ctx.textBaseline = "alphabetic";

        // after un-rotating, local axes are world axes, so the world-space box applies directly
        const nameAt = vertical ? { x: right + 8, y: -2, align: "left" } : { x: 0, y: top + 5, align: "center" };
        const valueAt = vertical ? { x: right + 8, y: 12, align: "left" } : { x: 0, y: bottom + 8, align: "center" };

        ctx.font = "12px system-ui";
        ctx.fillStyle = "#e8edf5";
        ctx.textAlign = nameAt.align;
        ctx.fillText(component.name, nameAt.x, nameAt.y);

        ctx.font = "10px system-ui";
        ctx.fillStyle = "#9aa4b5";
        ctx.textAlign = valueAt.align;
        ctx.fillText(component.value, valueAt.x, valueAt.y);
        ctx.restore();
    }
}

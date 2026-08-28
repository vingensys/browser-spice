/**
 * Industry Standard SPICE Netlist (.cir / .net) Parser
 * Supports parsing LTspice, PSPICE, and ngspice netlist syntax.
 */
class SpiceNetlistParser {
    /**
     * Parses a SPICE netlist string into schematic components and connections
     * @param {string} text 
     * @returns {{ components: Array, title: string, models: Map }}
     */
    static parse(text) {
        const lines = text.split(/\r?\n/);
        let title = "SPICE Circuit";
        const components = [];
        const models = new Map();

        let xPos = 160;
        let yPos = 160;

        lines.forEach((rawLine, index) => {
            let line = rawLine.trim();
            if (!line || line.startsWith("*")) {
                if (index === 0 && line.startsWith("*")) {
                    title = line.replace(/^\*\s*/, "");
                }
                return;
            }

            // Remove trailing inline comments
            line = line.split(";")[0].trim();

            const tokens = line.split(/\s+/);
            if (tokens.length === 0) return;

            const name = tokens[0].toUpperCase();

            // .MODEL statement parsing
            if (name === ".MODEL") {
                if (tokens.length >= 3) {
                    const modelName = tokens[1];
                    const modelType = tokens[2];
                    models.set(modelName, { type: modelType, line });
                }
                return;
            }

            // Skip control statements (.tran, .op, .end, etc.)
            if (name.startsWith(".")) return;

            // Element Stamping
            const prefix = name.charAt(0);
            if (prefix === "R" && tokens.length >= 4) {
                components.push({
                    type: "R",
                    name: tokens[0],
                    node1: tokens[1],
                    node2: tokens[2],
                    value: tokens[3],
                    x: xPos,
                    y: yPos
                });
                xPos += 120;
                if (xPos > 600) { xPos = 160; yPos += 120; }
            } else if (prefix === "C" && tokens.length >= 4) {
                components.push({
                    type: "C",
                    name: tokens[0],
                    node1: tokens[1],
                    node2: tokens[2],
                    value: tokens[3],
                    x: xPos,
                    y: yPos
                });
                xPos += 120;
                if (xPos > 600) { xPos = 160; yPos += 120; }
            } else if (prefix === "L" && tokens.length >= 4) {
                components.push({
                    type: "L",
                    name: tokens[0],
                    node1: tokens[1],
                    node2: tokens[2],
                    value: tokens[3],
                    x: xPos,
                    y: yPos
                });
                xPos += 120;
                if (xPos > 600) { xPos = 160; yPos += 120; }
            } else if (prefix === "V" && tokens.length >= 4) {
                components.push({
                    type: "V",
                    name: tokens[0],
                    node1: tokens[1],
                    node2: tokens[2],
                    dcVoltage: tokens[3] === "DC" ? (tokens[4] || "5") : tokens[3],
                    value: tokens[3] === "DC" ? (tokens[4] || "5V") : (tokens[3] + "V"),
                    x: xPos,
                    y: yPos
                });
                xPos += 120;
                if (xPos > 600) { xPos = 160; yPos += 120; }
            }
        });

        return { title, components, models };
    }
}

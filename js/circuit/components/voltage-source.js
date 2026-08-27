class VoltageSource extends Component {

    constructor(name, node1, node2, voltage = 5, phase = 0) {
        super(name, node1, node2);

        this.sourceType = "DC"; // "DC" or "AC"
        this.dcVoltage = voltage;
        this.dcOffset = 0;
        this.acMagnitude = voltage;
        this.acPhase = phase;
        this.frequency = 1000; // 1 kHz default
    }

    getType() {
        return "VOLTAGE_SOURCE";
    }

    phasor() {
        if (this.sourceType === "DC") {
            return new Complex(this.dcVoltage, 0);
        }
        return Complex.polar(this.acMagnitude, this.acPhase);
    }

    getVoltageAtTime(t) {
        if (this.sourceType === "DC") {
            return this.dcVoltage;
        }
        const omega = 2 * Math.PI * this.frequency;
        const phaseRad = (this.acPhase * Math.PI) / 180;
        return (this.dcOffset || 0) + this.acMagnitude * Math.sin(omega * t + phaseRad);
    }
}
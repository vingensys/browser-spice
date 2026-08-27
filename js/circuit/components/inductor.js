class Inductor extends Component {

    constructor(name, node1, node2, inductance) {
        super(name, node1, node2);

        if (inductance <= 0) {
            throw new Error(`Invalid inductance for ${name}`);
        }

        this.inductance = inductance;
    }

    getType() {
        return "INDUCTOR";
    }

    impedance(frequency) {
        if (frequency <= 0) {
            return new Complex(0, 0); // Short circuit at DC
        }

        const omega = 2 * Math.PI * frequency;
        return new Complex(0, omega * this.inductance);
    }

    admittance(frequency) {
        if (frequency <= 0) {
            return new Complex(1e6, 0); // High conductance for DC short
        }

        const omega = 2 * Math.PI * frequency;
        return new Complex(0, -1 / (omega * this.inductance));
    }
}

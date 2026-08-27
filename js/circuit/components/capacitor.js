class Capacitor extends Component {

    constructor(name, node1, node2, capacitance) {
        super(name, node1, node2);

        if (capacitance <= 0) {
            throw new Error(`Invalid capacitance for ${name}`);
        }

        this.capacitance = capacitance;
    }

    getType() {
        return "CAPACITOR";
    }

    impedance(frequency) {

        if (frequency <= 0) {
            return new Complex(Infinity, 0);
        }

        const omega = 2 * Math.PI * frequency;

        return new Complex(
            0,
            -1 / (omega * this.capacitance)
        );
    }

    admittance(frequency) {

        if (frequency <= 0) {
            return new Complex(0, 0);
        }

        const omega = 2 * Math.PI * frequency;

        return new Complex(
            0,
            omega * this.capacitance
        );
    }
}
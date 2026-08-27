class Resistor extends Component {

    constructor(name, node1, node2, resistance) {
        super(name, node1, node2);

        if (resistance <= 0) {
            throw new Error(`Invalid resistance for ${name}`);
        }

        this.resistance = resistance;
    }

    getType() {
        return "RESISTOR";
    }

    impedance() {
        return new Complex(this.resistance, 0);
    }

    admittance() {
        return new Complex(1 / this.resistance, 0);
    }
}
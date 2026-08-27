class Ground extends Component {

    constructor(name = "GND", node = "0") {
        super(name, node, node);
        this.node = node;
    }

    getType() {
        return "GROUND";
    }

    getNodes() {
        return [this.node];
    }
}

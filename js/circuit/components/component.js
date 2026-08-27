class Component {

    constructor(name, node1, node2) {
        this.name = name;
        this.node1 = node1;
        this.node2 = node2;
    }

    getNodes() {
        return [this.node1, this.node2];
    }

    getType() {
        return "COMPONENT";
    }
}
class Circuit {

    constructor() {
        this.nodes = new Map();
        this.components = [];

        // Ground is always node "0"
        this.addNode("0");
    }

    addNode(name) {

        if (!this.nodes.has(name)) {
            this.nodes.set(
                name,
                new CircuitNode(name)
            );
        }

        return this.nodes.get(name);
    }

    addComponent(component) {

        this.addNode(component.node1);
        this.addNode(component.node2);

        this.components.push(component);

        return component;
    }

    getNodeNames() {

        return Array.from(this.nodes.keys());
    }

    getNonGroundNodes() {

        return this.getNodeNames()
            .filter(name => name !== "0");
    }

    getVoltageSources() {

        return this.components.filter(
            component =>
                component.getType() === "VOLTAGE_SOURCE"
        );
    }

    clear() {

        this.nodes.clear();
        this.components = [];

        this.addNode("0");
    }
}
export class ComputerService {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    /**
     * Execute one step of a computer-use agent loop. Given a screenshot
     * and conversation history, returns the next action(s) the model
     * wants the caller to execute.
     */
    async step(model, params, init) {
        return this.transport.postJSON("/v1/computer/step", { model, ...params }, init);
    }
}
//# sourceMappingURL=computer.js.map
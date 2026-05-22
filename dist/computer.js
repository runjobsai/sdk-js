import { wrapEvents } from "./event-wrap.js";
export class ComputerService {
    transport;
    events;
    constructor(transport, events) {
        this.transport = transport;
        this.events = events;
    }
    /**
     * Execute one step of a computer-use agent loop. Given a screenshot
     * and conversation history, returns the next action(s) the model
     * wants the caller to execute.
     */
    async step(model, params, init) {
        return wrapEvents(this.events, { model, capability: "computer_use" }, () => this.transport.postJSON("/v1/computer/step", { model, ...params }, init), (r) => ({
            totalTokens: r.usage?.completion_tokens,
            costUSD: r.usage?.total_cost,
        }));
    }
}
//# sourceMappingURL=computer.js.map
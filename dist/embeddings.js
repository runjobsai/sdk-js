import { wrapEvents } from "./event-wrap.js";
export class EmbeddingsService {
    transport;
    events;
    constructor(transport, events) {
        this.transport = transport;
        this.events = events;
    }
    /**
     * Create one or more embeddings.
     *
     * ```ts
     * const r = await client.embeddings.create("text-embedding-3-small", {
     *   input: ["alpha", "beta"],
     *   dimensions: 1536,
     * });
     * for (const e of r.data) {
     *   console.log(e.index, (e.embedding as number[]).slice(0, 4));
     * }
     * console.log(`Cost: $${r.usage.total_cost.toFixed(6)}`);
     * ```
     */
    async create(model, params, init) {
        return wrapEvents(this.events, { model, capability: "embedding" }, () => this.transport.postJSON("/v1/embeddings", { model, ...params }, init), (r) => ({
            totalTokens: r.usage?.total_tokens,
            costUSD: r.usage?.total_cost,
        }));
    }
}
//# sourceMappingURL=embeddings.js.map
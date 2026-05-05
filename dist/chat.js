/* ------------------------------------------------------------------ */
/* Convenience builders                                                */
/* ------------------------------------------------------------------ */
export const userMessage = (content) => ({ role: "user", content });
export const systemMessage = (content) => ({ role: "system", content });
export const assistantMessage = (content) => ({ role: "assistant", content });
export const toolResultMessage = (toolCallId, content) => ({ role: "tool", tool_call_id: toolCallId, content });
export const userMessageParts = (...parts) => ({ role: "user", content: parts });
export const textPart = (text) => ({ type: "text", text });
export const imagePart = (url, detail) => ({
    type: "image_url",
    image_url: detail ? { url, detail } : { url },
});
/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */
export class ChatService {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    /**
     * Create a chat completion (non-streaming).
     *
     * Streaming is forced off — pass `stream()` instead for incremental output.
     */
    async create(params, init) {
        const body = { ...params, stream: false };
        return this.transport.postJSON("/v1/chat/completions", body, init);
    }
    /**
     * Create a streaming chat completion. Returns an async iterator over
     * `ChatCompletionChunk`. The final chunk carries `usage` (token / cost
     * totals) — `stream_options.include_usage` is set automatically.
     *
     * ```ts
     * let cost = 0;
     * for await (const chunk of client.chat.stream({ ... })) {
     *   for (const c of chunk.choices) process.stdout.write(c.delta.content ?? "");
     *   if (chunk.usage) cost = chunk.usage.total_cost;
     * }
     * ```
     */
    async *stream(params, init) {
        const body = {
            ...params,
            stream: true,
            stream_options: params.stream_options ?? { include_usage: true },
        };
        const resp = await this.transport.postJSONStream("/v1/chat/completions", body, init);
        if (!resp.body) {
            throw new Error("runjobs: streaming response had no body");
        }
        yield* parseSSE(resp.body);
    }
}
/* ------------------------------------------------------------------ */
/* SSE parsing                                                         */
/* ------------------------------------------------------------------ */
/**
 * Decode an `text/event-stream` body into a stream of parsed JSON chunks.
 * Stops at the `[DONE]` sentinel. Lines that don't start with `data: ` are
 * ignored (keep-alive comments, etc.).
 */
async function* parseSSE(body) {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, nl).replace(/\r$/, "");
                buffer = buffer.slice(nl + 1);
                if (!line.startsWith("data: "))
                    continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]")
                    return;
                if (!data)
                    continue;
                try {
                    yield JSON.parse(data);
                }
                catch (e) {
                    throw new Error(`runjobs: decode stream chunk: ${e.message}`);
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
//# sourceMappingURL=chat.js.map
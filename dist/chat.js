import { wrapEvents, wrapStream } from "./event-wrap.js";
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
/**
 * Video content part. Only supported by chat models whose
 * input_modalities includes `"video"` (currently Gemini 3.x). Other
 * models 400 at the gateway. URL may be http(s) or a
 * `data:video/mp4;base64,...` inline upload.
 */
export const videoPart = (url) => ({
    type: "video_url",
    video_url: { url },
});
/**
 * Audio content part. Only supported by chat models whose
 * input_modalities includes `"audio"` (currently Gemini 3.x). Other
 * models 400 at the gateway. URL may be http(s) or a
 * `data:audio/wav;base64,...` inline upload.
 */
export const audioPart = (url) => ({
    type: "audio_url",
    audio_url: { url },
});
/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */
export class ChatService {
    transport;
    events;
    constructor(transport, events) {
        this.transport = transport;
        this.events = events;
    }
    /**
     * Create a chat completion (non-streaming).
     *
     * Streaming is forced off — pass `stream()` instead for incremental output.
     */
    async create(params, init) {
        const body = { ...params, stream: false };
        return wrapEvents(this.events, { model: params.model, capability: "text" }, () => this.transport.postJSON("/v1/chat/completions", body, init), (r) => ({
            totalTokens: r.usage?.completion_tokens,
            costUSD: r.usage?.total_cost,
            finishReason: r.choices?.[0]?.finish_reason,
        }));
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
     *
     * Also fires `request:streamDelta` on `client.events` for each chunk
     * that carried text — drives the badge's tokens/sec rate display.
     */
    async *stream(params, init) {
        const body = {
            ...params,
            stream: true,
            stream_options: params.stream_options ?? { include_usage: true },
        };
        const sourceGen = async function* () {
            const resp = await this.transport.postJSONStream("/v1/chat/completions", body, init);
            if (!resp.body) {
                throw new Error("runjobs: streaming response had no body");
            }
            yield* parseSSE(resp.body);
        }.bind(this);
        yield* wrapStream(this.events, { model: params.model, capability: "text" }, sourceGen, (chunk) => ({
            deltaText: chunk.choices?.[0]?.delta?.content ?? "",
            completionTokens: chunk.usage?.completion_tokens,
            costUSD: chunk.usage?.total_cost,
            finishReason: chunk.choices?.[0]?.finish_reason ?? undefined,
        }));
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
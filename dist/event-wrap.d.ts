/**
 * Tiny wrapper used by every LLM-ish service to fire
 * `request:start` → `request:end` / `request:error` events around a
 * single network call. Centralised here so the service files don't
 * duplicate the try/catch + latency-stopwatch pattern N times.
 *
 * Streaming chat has its own logic (it must yield deltas mid-flight)
 * — see `wrapStream` below.
 */
import { type SDKCapability, type SDKEvents } from "./events.js";
interface CallMeta {
    model: string;
    capability: SDKCapability;
}
interface EndInfo {
    totalTokens?: number;
    costUSD?: number;
    finishReason?: string;
}
/**
 * Run `fn` while emitting start/end/error events around it.
 * `extractEnd` plucks token / cost / finish_reason off the response
 * shape so each service can map its own response type without the
 * helper knowing about it.
 *
 * Re-throws on error so the caller still sees the rejection — the
 * helper only inserts telemetry, it doesn't swallow.
 */
export declare function wrapEvents<T>(events: SDKEvents, meta: CallMeta, fn: () => Promise<T>, extractEnd?: (r: T) => EndInfo): Promise<T>;
/**
 * Token-count estimator for stream deltas. Stream chunks carry text,
 * not tokens — getting an exact count would mean shipping a
 * tokenizer in the SDK (huge), so we use the standard ~4-chars =
 * 1-token English heuristic. Off by 10-30% for code or non-English,
 * but the badge UI shows tokens/sec as a vibe indicator, not for
 * billing, so the imprecision is fine.
 */
export declare function estimateTokens(text: string): number;
/**
 * Stream wrapper — same start/end/error envelope as wrapEvents but
 * also fires `request:streamDelta` for each yielded chunk so the
 * badge's tokens/sec sliding window has samples.
 *
 * Generic over the chunk type because each service's stream
 * (chat / video / etc.) carries its own shape. The caller passes a
 * `extractDelta` that pulls text + cumulative usage off the chunk.
 *
 * Usage:
 *   yield* wrapStream(events, {model, capability}, () => transport.postJSONStream(...),
 *     (chunk) => ({ deltaText: chunk.choices[0]?.delta?.content, usage: chunk.usage }));
 */
export declare function wrapStream<TChunk>(events: SDKEvents, meta: CallMeta, source: () => AsyncIterable<TChunk>, extractDelta: (chunk: TChunk) => {
    deltaText?: string;
    completionTokens?: number;
    costUSD?: number;
    finishReason?: string;
}): AsyncGenerator<TChunk, void, unknown>;
export {};
//# sourceMappingURL=event-wrap.d.ts.map
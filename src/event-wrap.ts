/**
 * Tiny wrapper used by every LLM-ish service to fire
 * `request:start` → `request:end` / `request:error` events around a
 * single network call. Centralised here so the service files don't
 * duplicate the try/catch + latency-stopwatch pattern N times.
 *
 * Streaming chat has its own logic (it must yield deltas mid-flight)
 * — see `wrapStream` below.
 */

import { newRequestId, type SDKCapability, type SDKEvents } from "./events.js";

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
export async function wrapEvents<T>(
  events: SDKEvents,
  meta: CallMeta,
  fn: () => Promise<T>,
  extractEnd?: (r: T) => EndInfo,
): Promise<T> {
  const id = newRequestId();
  const startedAt = Date.now();
  events.emit("request:start", {
    id,
    model: meta.model,
    capability: meta.capability,
    startedAt,
    streaming: false,
  });
  try {
    const result = await fn();
    const info = extractEnd ? extractEnd(result) : {};
    events.emit("request:end", {
      id,
      model: meta.model,
      capability: meta.capability,
      latencyMs: Date.now() - startedAt,
      totalTokens: info.totalTokens ?? 0,
      ...(info.costUSD !== undefined && { costUSD: info.costUSD }),
      ...(info.finishReason !== undefined && { finishReason: info.finishReason }),
    });
    return result;
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    events.emit("request:error", {
      id,
      model: meta.model,
      capability: meta.capability,
      latencyMs: Date.now() - startedAt,
      error: e,
      ...(typeof e.statusCode === "number" && { statusCode: e.statusCode }),
    });
    throw err;
  }
}

/**
 * Token-count estimator for stream deltas. Stream chunks carry text,
 * not tokens — getting an exact count would mean shipping a
 * tokenizer in the SDK (huge), so we use the standard ~4-chars =
 * 1-token English heuristic. Off by 10-30% for code or non-English,
 * but the badge UI shows tokens/sec as a vibe indicator, not for
 * billing, so the imprecision is fine.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

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
export async function* wrapStream<TChunk>(
  events: SDKEvents,
  meta: CallMeta,
  source: () => AsyncIterable<TChunk>,
  extractDelta: (chunk: TChunk) => {
    deltaText?: string;
    // When a chunk carries cumulative usage (final chunk in OpenAI
    // streams), surface it so the end event can use exact totals
    // instead of the heuristic running sum.
    completionTokens?: number;
    costUSD?: number;
    finishReason?: string;
  },
): AsyncGenerator<TChunk, void, unknown> {
  const id = newRequestId();
  const startedAt = Date.now();
  events.emit("request:start", {
    id,
    model: meta.model,
    capability: meta.capability,
    startedAt,
    streaming: true,
  });
  let totalTokens = 0;
  let lastUsageTokens: number | undefined;
  let costUSD: number | undefined;
  let finishReason: string | undefined;
  try {
    for await (const chunk of source()) {
      const info = extractDelta(chunk);
      if (info.deltaText) {
        const delta = estimateTokens(info.deltaText);
        totalTokens += delta;
        events.emit("request:streamDelta", {
          id,
          deltaTokens: delta,
          totalTokens,
        });
      }
      if (info.completionTokens !== undefined) lastUsageTokens = info.completionTokens;
      if (info.costUSD !== undefined) costUSD = info.costUSD;
      if (info.finishReason !== undefined) finishReason = info.finishReason;
      yield chunk;
    }
    events.emit("request:end", {
      id,
      model: meta.model,
      capability: meta.capability,
      latencyMs: Date.now() - startedAt,
      // Prefer the exact upstream count over our heuristic when it
      // arrived in the final chunk.
      totalTokens: lastUsageTokens ?? totalTokens,
      ...(costUSD !== undefined && { costUSD }),
      ...(finishReason !== undefined && { finishReason }),
    });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    events.emit("request:error", {
      id,
      model: meta.model,
      capability: meta.capability,
      latencyMs: Date.now() - startedAt,
      error: e,
      ...(typeof e.statusCode === "number" && { statusCode: e.statusCode }),
    });
    throw err;
  }
}

/**
 * Typed runtime event bus for SDK call telemetry.
 *
 * Every LLM-ish service method (chat, embeddings, image, audio, video,
 * computer) emits start / streamDelta / end / error events on the
 * shared `client.events` bus so UI overlays (e.g. the bottom-right
 * identity badge with its activity ring) can render real-time state
 * without business code having to thread anything through.
 *
 * Goals:
 *   - **Typed**: handler signatures are inferred from the event name.
 *   - **Zero-cost when nobody listens**: no listeners → emit is a few
 *     property reads. The browser `EventTarget` does the heavy lifting.
 *   - **Service-agnostic**: events carry just enough context (id /
 *     model / capability / token counts) for a generic UI to render
 *     them without knowing which service fired the call.
 *
 * Why a custom wrapper instead of `EventTarget` directly:
 *   - The native API is untyped (`addEventListener("foo", anyHandler)`).
 *   - Browser CustomEvent's `detail` payload trick is awkward to read.
 *   - Subscribers want an `off()` closure, not a separate
 *     `removeEventListener` call with the same callback reference.
 */

/** Capability bucket of the calling service, mirroring /v1/models. */
export type SDKCapability =
  | "text"
  | "vision"
  | "embedding"
  | "image_generation"
  | "image_edit"
  | "text_to_speech"
  | "speech_to_text"
  | "video_generation"
  | "computer_use";

/** Fired the moment a request hits the wire. */
export interface RequestStartEvent {
  /** Stable id correlating start → end/error events for one call. */
  id: string;
  /** Model name the caller asked for (NOT the upstream id). */
  model: string;
  /** Capability bucket — drives badge icon / colour. */
  capability: SDKCapability;
  /** ms since epoch when the request left the SDK. */
  startedAt: number;
  /** `true` for stream:true requests so the UI can pre-pick the
   *  pulsing-ring animation instead of swapping mid-call. */
  streaming: boolean;
}

/** Fired on every stream chunk that carried new content tokens. */
export interface RequestStreamDeltaEvent {
  /** Matches the corresponding RequestStartEvent.id. */
  id: string;
  /** Approximate completion tokens in THIS chunk (one delta event
   *  per visible SSE chunk; usage roll-up arrives in end). */
  deltaTokens: number;
  /** Cumulative completion tokens since stream start. */
  totalTokens: number;
}

/** Fired once when the call settles successfully. */
export interface RequestEndEvent {
  id: string;
  model: string;
  capability: SDKCapability;
  /** Wall-clock from start to settle. */
  latencyMs: number;
  /** Final completion tokens (matches the gateway's usage.completion_tokens
   *  when the response carries it; 0 otherwise). */
  totalTokens: number;
  /** USD cost as reported by the gateway's `usage.total_cost`. May be
   *  undefined for endpoints that don't return cost (rare). */
  costUSD?: number;
  /** OpenAI-style stop / length / tool_calls / content_filter, or
   *  undefined for non-chat endpoints. */
  finishReason?: string;
}

/** Fired once when the call fails — at start, mid-stream, or anywhere. */
export interface RequestErrorEvent {
  id: string;
  model: string;
  capability: SDKCapability;
  latencyMs: number;
  /** The thrown Error (typically `APIError` with statusCode / body). */
  error: Error;
  /** HTTP status when known (forwarded from APIError when present). */
  statusCode?: number;
}

/** Compile-time map of event name → payload shape. Drives handler
 *  inference in `on()` / `emit()` so callers can't subscribe to a
 *  typo'd name or read a non-existent field. */
export interface SDKEventMap {
  "request:start": RequestStartEvent;
  "request:streamDelta": RequestStreamDeltaEvent;
  "request:end": RequestEndEvent;
  "request:error": RequestErrorEvent;
}

/** Disposer returned by `on()` — call to unsubscribe. */
export type Unsubscribe = () => void;

/**
 * Lightweight typed event bus. Backed by `EventTarget` so memory
 * leaks from un-disposed listeners surface in the standard DevTools
 * memory profile path. In Node we fall back to a plain Map<string,
 * Set<handler>> since `EventTarget` was only added in Node 15+ and we
 * still support 14 in places (the SDK targets 18+ but tests sometimes
 * stub globals).
 */
export class SDKEvents {
  private readonly handlers = new Map<keyof SDKEventMap, Set<(payload: unknown) => void>>();

  /**
   * Subscribe to an event. Returns a disposer; calling the disposer
   * removes the subscription. Multiple subscriptions to the same
   * event are supported.
   */
  on<K extends keyof SDKEventMap>(name: K, handler: (event: SDKEventMap[K]) => void): Unsubscribe {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const wrapped = handler as (payload: unknown) => void;
    set.add(wrapped);
    return () => {
      this.handlers.get(name)?.delete(wrapped);
    };
  }

  /**
   * Fire an event. Handlers run synchronously in subscription order.
   * Throws inside one handler don't prevent the others from running —
   * the bus catches and logs (console.error) so a buggy listener can't
   * take down the rest of the UI.
   */
  emit<K extends keyof SDKEventMap>(name: K, payload: SDKEventMap[K]): void {
    const set = this.handlers.get(name);
    if (!set || set.size === 0) return;
    for (const h of set) {
      try {
        h(payload);
      } catch (err) {
        // Listener bug — don't propagate, but surface in the console
        // so developers notice during integration.
        // eslint-disable-next-line no-console
        console.error("[runjobs sdk] event listener for", name, "threw:", err);
      }
    }
  }

  /** Drop all subscriptions. Tests call this between cases. */
  clear(): void {
    this.handlers.clear();
  }
}

/** Generate a short opaque ID for correlating start/end events.
 *  Not a UUID — sub-microsecond uniqueness within a session is
 *  enough, and we want to keep the wire log compact. */
export function newRequestId(): string {
  return (
    "req_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

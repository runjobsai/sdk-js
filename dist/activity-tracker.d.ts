/**
 * In-memory session-scoped activity index — turns the raw event
 * stream from `SDKEvents` into the snapshot the badge UI reads each
 * frame: which calls are in flight, what just finished, what the
 * running session cost is.
 *
 * Memory bounded:
 *   - `active` map shrinks on every end/error (calls don't accumulate
 *     past their settle event).
 *   - `recent` is a bounded ring of the last RECENT_MAX completions.
 *   - tokens/sec windows hold only `RATE_WINDOW_MS` worth of deltas;
 *     stale samples get dropped on every push.
 *
 * Snapshot pattern (vs. emitting another event per change): the
 * badge re-renders on `requestAnimationFrame` while it's open, so
 * a pull-snapshot API matches that cadence — pushing on every
 * delta would over-paint and cost battery on token-heavy streams.
 */
import type { SDKCapability, SDKEvents } from "./events.js";
/** One LLM call currently in flight. */
export interface ActiveCall {
    id: string;
    model: string;
    capability: SDKCapability;
    startedAt: number;
    /** True for stream:true. Drives the pulsing-ring animation. */
    streaming: boolean;
    /** Cumulative completion tokens (0 until first delta). */
    tokensSoFar: number;
    /** Tokens per second over the last RATE_WINDOW_MS. 0 until the
     *  window has 2+ samples. */
    tokensPerSec: number;
    /** Internal sample buffer — exposed for tests; UI ignores. */
    rateSamples: Array<{
        t: number;
        tokens: number;
    }>;
}
/** One LLM call that already finished (success OR failure). */
export interface CompletedCall {
    id: string;
    model: string;
    capability: SDKCapability;
    latencyMs: number;
    totalTokens: number;
    costUSD?: number;
    finishReason?: string;
    /** false for RequestErrorEvent settles. */
    ok: boolean;
    /** Error message when ok=false. */
    errorMessage?: string;
    /** Wall clock at settle — drives the "30s ago" relative display. */
    endedAt: number;
}
/** Running session totals — shown in the popover's footer. */
export interface SessionStats {
    totalCalls: number;
    totalCostUSD: number;
    errorCount: number;
    /** Wall clock when the tracker first saw an event. Drives the
     *  "session lasted N minutes" string. */
    startedAt: number;
}
/** Pull-snapshot of the tracker — taken once per badge re-render. */
export interface ActivitySnapshot {
    active: ActiveCall[];
    recent: CompletedCall[];
    session: SessionStats;
    /** Highest-priority status colour for the LED dot:
     *    "error"   → recent failure within ERROR_HIGHLIGHT_MS
     *    "active"  → at least one in-flight call
     *    "idle"    → nothing happening
     *  The badge's CSS uses this as a class. */
    status: "idle" | "active" | "error";
}
export declare class ActivityTracker {
    private active;
    private recent;
    private session;
    /** Track most recent error wall-clock so the LED stays red for
     *  ERROR_HIGHLIGHT_MS even after the error scrolls out of recent. */
    private lastErrorAt;
    /** "Snapshot changed" listeners. Fired AFTER every event handler
     *  runs (start / delta / end / error), letting UIs re-render in
     *  push-mode instead of polling. Without this hook, the badge's
     *  ring/LED stayed idle until the user opened the popover —
     *  events landed in the tracker but nobody told the DOM. */
    private changeListeners;
    /**
     * Subscribe the tracker to a bus. Returns a single disposer that
     * unsubscribes all four handlers — callers (BrowserAuth in our
     * case) attach this on construction and dispose on teardown.
     */
    attach(events: SDKEvents): () => void;
    /**
     * Subscribe to "snapshot may have changed" notifications. Fires
     * synchronously after each event handler runs — typical consumer
     * is the badge's `requestRedraw()` which coalesces multiple
     * notifications into one rAF paint.
     *
     * Returns a disposer; call to unsubscribe.
     */
    onChange(handler: () => void): () => void;
    private notify;
    /** O(active+recent) — small in practice, fine on every frame. */
    snapshot(): ActivitySnapshot;
    private onStart;
    private onDelta;
    private onEnd;
    private onError;
    private pushRecent;
}
//# sourceMappingURL=activity-tracker.d.ts.map
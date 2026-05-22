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
/** Sliding window for tokens/sec — 1.5s gives a snappy display
 *  without jittering on every chunk arrival (most providers emit
 *  ~5-30 deltas/s). */
const RATE_WINDOW_MS = 1500;
/** Cap on the recent-completion ring buffer. The popover lists the
 *  last 5 by default but we keep a few extra so a future "show more"
 *  UI doesn't need a refactor. */
const RECENT_MAX = 20;
/** Window during which a recent error keeps the LED red. 30s is
 *  long enough to grab attention but short enough that an old
 *  failure doesn't dominate when subsequent calls succeed. */
const ERROR_HIGHLIGHT_MS = 30_000;
export class ActivityTracker {
    active = new Map();
    recent = [];
    session = {
        totalCalls: 0,
        totalCostUSD: 0,
        errorCount: 0,
        startedAt: Date.now(),
    };
    /** Track most recent error wall-clock so the LED stays red for
     *  ERROR_HIGHLIGHT_MS even after the error scrolls out of recent. */
    lastErrorAt = 0;
    /** "Snapshot changed" listeners. Fired AFTER every event handler
     *  runs (start / delta / end / error), letting UIs re-render in
     *  push-mode instead of polling. Without this hook, the badge's
     *  ring/LED stayed idle until the user opened the popover —
     *  events landed in the tracker but nobody told the DOM. */
    changeListeners = new Set();
    /**
     * Subscribe the tracker to a bus. Returns a single disposer that
     * unsubscribes all four handlers — callers (BrowserAuth in our
     * case) attach this on construction and dispose on teardown.
     */
    attach(events) {
        const offs = [
            events.on("request:start", (e) => { this.onStart(e); this.notify(); }),
            events.on("request:streamDelta", (e) => { this.onDelta(e); this.notify(); }),
            events.on("request:end", (e) => { this.onEnd(e); this.notify(); }),
            events.on("request:error", (e) => { this.onError(e); this.notify(); }),
        ];
        return () => {
            for (const o of offs)
                o();
        };
    }
    /**
     * Subscribe to "snapshot may have changed" notifications. Fires
     * synchronously after each event handler runs — typical consumer
     * is the badge's `requestRedraw()` which coalesces multiple
     * notifications into one rAF paint.
     *
     * Returns a disposer; call to unsubscribe.
     */
    onChange(handler) {
        this.changeListeners.add(handler);
        return () => this.changeListeners.delete(handler);
    }
    notify() {
        for (const h of this.changeListeners) {
            try {
                h();
            }
            catch (err) {
                // eslint-disable-next-line no-console
                console.error("[runjobs sdk] ActivityTracker onChange listener threw:", err);
            }
        }
    }
    /** O(active+recent) — small in practice, fine on every frame. */
    snapshot() {
        const now = Date.now();
        return {
            active: Array.from(this.active.values()),
            recent: this.recent.slice(),
            session: { ...this.session },
            status: now - this.lastErrorAt < ERROR_HIGHLIGHT_MS
                ? "error"
                : this.active.size > 0
                    ? "active"
                    : "idle",
        };
    }
    // ─── handlers ─────────────────────────────────────────────────
    onStart(e) {
        this.active.set(e.id, {
            id: e.id,
            model: e.model,
            capability: e.capability,
            startedAt: e.startedAt,
            streaming: e.streaming,
            tokensSoFar: 0,
            tokensPerSec: 0,
            rateSamples: [],
        });
    }
    onDelta(e) {
        const call = this.active.get(e.id);
        if (!call)
            return; // delta after end — drop
        call.tokensSoFar = e.totalTokens;
        const now = Date.now();
        call.rateSamples.push({ t: now, tokens: e.deltaTokens });
        // Drop samples older than the window.
        const cutoff = now - RATE_WINDOW_MS;
        while (call.rateSamples.length > 0 && call.rateSamples[0].t < cutoff) {
            call.rateSamples.shift();
        }
        if (call.rateSamples.length >= 2) {
            const sumTokens = call.rateSamples.reduce((s, x) => s + x.tokens, 0);
            const spanMs = now - call.rateSamples[0].t;
            call.tokensPerSec = spanMs > 0 ? (sumTokens * 1000) / spanMs : 0;
        }
    }
    onEnd(e) {
        const call = this.active.get(e.id);
        this.active.delete(e.id);
        this.pushRecent({
            id: e.id,
            model: e.model,
            capability: e.capability,
            latencyMs: e.latencyMs,
            totalTokens: e.totalTokens || call?.tokensSoFar || 0,
            ...(e.costUSD !== undefined && { costUSD: e.costUSD }),
            ...(e.finishReason !== undefined && { finishReason: e.finishReason }),
            ok: true,
            endedAt: Date.now(),
        });
        this.session.totalCalls += 1;
        if (e.costUSD !== undefined)
            this.session.totalCostUSD += e.costUSD;
    }
    onError(e) {
        const call = this.active.get(e.id);
        this.active.delete(e.id);
        this.pushRecent({
            id: e.id,
            model: e.model,
            capability: e.capability,
            latencyMs: e.latencyMs,
            totalTokens: call?.tokensSoFar || 0,
            ok: false,
            errorMessage: e.error.message,
            endedAt: Date.now(),
        });
        this.session.totalCalls += 1;
        this.session.errorCount += 1;
        this.lastErrorAt = Date.now();
    }
    pushRecent(c) {
        // Newest first — popover renders top-to-bottom newest→oldest.
        this.recent.unshift(c);
        if (this.recent.length > RECENT_MAX)
            this.recent.length = RECENT_MAX;
    }
}
//# sourceMappingURL=activity-tracker.js.map
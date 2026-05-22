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
/**
 * Lightweight typed event bus. Backed by `EventTarget` so memory
 * leaks from un-disposed listeners surface in the standard DevTools
 * memory profile path. In Node we fall back to a plain Map<string,
 * Set<handler>> since `EventTarget` was only added in Node 15+ and we
 * still support 14 in places (the SDK targets 18+ but tests sometimes
 * stub globals).
 */
export class SDKEvents {
    handlers = new Map();
    /**
     * Subscribe to an event. Returns a disposer; calling the disposer
     * removes the subscription. Multiple subscriptions to the same
     * event are supported.
     */
    on(name, handler) {
        let set = this.handlers.get(name);
        if (!set) {
            set = new Set();
            this.handlers.set(name, set);
        }
        const wrapped = handler;
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
    emit(name, payload) {
        const set = this.handlers.get(name);
        if (!set || set.size === 0)
            return;
        for (const h of set) {
            try {
                h(payload);
            }
            catch (err) {
                // Listener bug — don't propagate, but surface in the console
                // so developers notice during integration.
                // eslint-disable-next-line no-console
                console.error("[runjobs sdk] event listener for", name, "threw:", err);
            }
        }
    }
    /** Drop all subscriptions. Tests call this between cases. */
    clear() {
        this.handlers.clear();
    }
}
/** Generate a short opaque ID for correlating start/end events.
 *  Not a UUID — sub-microsecond uniqueness within a session is
 *  enough, and we want to keep the wire log compact. */
export function newRequestId() {
    return ("req_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 8));
}
//# sourceMappingURL=events.js.map
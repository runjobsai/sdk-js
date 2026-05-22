import { wrapEvents } from "./event-wrap.js";
export class VideoService {
    transport;
    events;
    constructor(transport, events) {
        this.transport = transport;
        this.events = events;
    }
    /** Submit a video generation task.
     *
     * Telemetry note: only the submit step fires start/end on
     * `client.events` — the per-call latency reflects the gateway
     * accepting the job, NOT how long upstream takes to render. The
     * caller's poll loop sees status flips but the SDK doesn't emit
     * end events for those (would otherwise leave the badge "active"
     * for as long as the upstream renders, sometimes minutes). */
    async generate(model, params, init) {
        return wrapEvents(this.events, { model, capability: "video_generation" }, () => this.transport.postJSON("/v1/videos/generations", { model, ...params }, init));
    }
    /** Fetch the current status of a task. */
    async getStatus(taskID, init) {
        return this.transport.getJSON(`/v1/videos/generations/${encodeURIComponent(taskID)}`, init);
    }
    /**
     * Poll `getStatus()` until the task reaches a terminal state
     * (`succeeded` / `failed`). Default poll interval is 5s.
     */
    async wait(taskID, opts = {}) {
        const interval = opts.pollIntervalMs ?? 5000;
        while (true) {
            const status = await this.getStatus(taskID, { signal: opts.signal });
            if (status.status === "succeeded" || status.status === "failed") {
                return status;
            }
            await sleep(interval, opts.signal);
        }
    }
    /** Download the raw video bytes for a completed task. */
    async getContent(taskID, init) {
        return this.transport.getRaw(`/v1/videos/${encodeURIComponent(taskID)}/content`, init);
    }
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error("aborted"));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
//# sourceMappingURL=video.js.map
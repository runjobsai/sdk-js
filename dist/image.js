import { wrapEvents } from "./event-wrap.js";
/* ------------------------------------------------------------------ */
export class ImageService {
    transport;
    events;
    constructor(transport, events) {
        this.transport = transport;
        this.events = events;
    }
    /**
     * Generate images from a text prompt via the synchronous endpoint.
     * For long-running requests (large Seedream batches, slow upstreams)
     * use `generateAsync()` to avoid 100-second origin timeouts.
     */
    async generate(model, params, init) {
        return wrapEvents(this.events, { model, capability: "image_generation" }, () => this.transport.postJSON("/v1/images/generations", { model, ...params }, init), (r) => ({ costUSD: r.usage?.total_cost }));
    }
    /**
     * Async equivalent of `generate()`. Submits a job to
     * `/v1/async/images/generations`, polls `/v1/async/images/generations/:id`
     * until terminal, then resolves to a sync-shape `ImageResponse`. Use
     * this when a request may exceed the ~100s origin timeout (Cloudflare
     * otherwise replaces the real upstream error with its own 502 page).
     *
     * Implementation is `submitGenerate` + `getAsyncStatus` poll loop, so
     * the path layout matches the rest of the async API (`/v1/async/...`
     * everywhere). The caller's `signal` aborts both the submit and the
     * poll wait; `pollIntervalMs` defaults to 2s.
     */
    async generateAsync(model, params, init) {
        const interval = init?.pollIntervalMs ?? 2000;
        const signal = init?.signal;
        return wrapEvents(this.events, { model, capability: "image_generation" }, async () => {
            const job = await this.transport.postJSON("/v1/async/images/generations", { model, ...params }, { signal });
            let current = job;
            while (current.status !== "succeeded" && current.status !== "failed") {
                await sleep(interval, signal);
                current = await this.getAsyncStatus(current.id, { signal });
            }
            if (current.status === "failed") {
                throw new Error(current.error ?? "image generation failed");
            }
            return {
                created: current.created_at ?? Math.floor(Date.now() / 1000),
                data: current.data ?? [],
                usage: current.usage ?? { total_cost: 0 },
            };
        }, (r) => ({ costUSD: r.usage?.total_cost }));
    }
    /**
     * Submit-only variant of `generate()`. Returns the gateway's job
     * descriptor (`id`, `status`, `usage`) without polling. Use this
     * when you want to PERSIST the job id and resume polling later
     * (e.g. across page reloads, in a separate worker process). Pair
     * with `getAsyncStatus(id)` to drive the polling loop yourself.
     *
     * For a one-shot "submit and wait" call site, use `generateAsync()`
     * — that wraps the same underlying endpoint with a built-in poll.
     *
     * Telemetry note: only the SUBMIT step fires start/end on
     * `client.events` — the per-call latency reflects the gateway
     * accepting the job, NOT how long the upstream takes to render.
     * Track render progress via your own poll loop's status responses.
     */
    async submitGenerate(model, params, init) {
        return wrapEvents(this.events, { model, capability: "image_generation" }, () => this.transport.postJSON("/v1/async/images/generations", { model, ...params }, init));
    }
    /**
     * Single poll of an in-flight async image job. Returns the same
     * shape `submitGenerate()` returned, with `data[]` populated once
     * `status` flips to `succeeded`. Caller decides cadence + bail-out;
     * the gateway's per-poll `current_time` / `created_at` together
     * give a server-truth elapsed reading regardless of client clock skew.
     */
    async getAsyncStatus(id, init) {
        return this.transport.getJSON(`/v1/async/images/generations/${encodeURIComponent(id)}`, init);
    }
    /**
     * Edit an image (inpaint / outpaint / variations) via multipart upload.
     * Provider-dependent — only available on `gpt-image-1` and similar.
     */
    async edit(model, params, init) {
        const form = buildEditForm(model, params);
        return wrapEvents(this.events, { model, capability: "image_edit" }, () => this.transport.postMultipart("/v1/images/edits", form, init), (r) => ({ costUSD: r.usage?.total_cost }));
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
function buildEditForm(model, params) {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", params.prompt);
    if (params.size)
        form.set("size", params.size);
    if (params.n !== undefined)
        form.set("n", String(params.n));
    if (params.user)
        form.set("user", params.user);
    form.set("image", toBlob(params.image), params.image.filename);
    if (params.mask)
        form.set("mask", toBlob(params.mask), params.mask.filename);
    return form;
}
/** Internal: coerce ImageFileInput to a Blob the multipart layer accepts. */
function toBlob(input) {
    const ct = input.contentType ?? guessMime(input.filename);
    if (input.data instanceof Blob) {
        return input.data.type === ct ? input.data : new Blob([input.data], { type: ct });
    }
    if (typeof input.data === "string") {
        return new Blob([input.data], { type: ct });
    }
    // ArrayBuffer | Uint8Array — wrap in Blob. Cast widens TS's strict
    // Uint8Array<ArrayBuffer> back to BlobPart (it's accepted at runtime).
    return new Blob([input.data], { type: ct });
}
function guessMime(filename) {
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    switch (ext) {
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "webp":
            return "image/webp";
        case "gif":
            return "image/gif";
        default:
            return "application/octet-stream";
    }
}
//# sourceMappingURL=image.js.map
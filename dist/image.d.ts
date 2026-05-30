import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
import type { SDKEvents } from "./events.js";
/**
 * Image generation request.
 *
 * Sizing: prefer the 2-axis `resolution` + `aspect_ratio` controls —
 * the gateway translates them into a concrete WxH from the target
 * model's declared size enum. `size` is the legacy explicit override;
 * when set, it wins over `(resolution, aspect_ratio)`. When none of
 * the three is set, the gateway / upstream applies its own default.
 */
export interface ImageGenerateParams {
    prompt: string;
    /** Legacy explicit "WxH" override. Prefer `resolution` +
     *  `aspect_ratio` for new code. */
    size?: string;
    /** Short-side pixel tier — "512P" | "1K" | "2K" | "4K".
     *  Model-specific subset; `/v1/models` advertises which tiers each
     *  image model supports. */
    resolution?: string;
    /** Output shape — "1:1" | "9:16" | "16:9" | "3:4" | "4:3" | "3:2"
     *  | "2:3" | "5:4" | "4:5" | "21:9" | "adaptive". Model-specific
     *  subset; see `/v1/models`. */
    aspect_ratio?: string;
    n?: number;
    style?: string;
    reference_image_urls?: string[];
    user?: string;
    /**
     * Pass-through for provider-specific knobs.
     *
     * Note: `quality` (OpenAI's render-quality preset
     * — "low"/"medium"/"high"/"auto") was removed from the canonical
     * surface. Only one upstream used it and its own default ("auto") is
     * already optimal; the field caused naming confusion with the
     * "画质" resolution-tier control. The gateway silently drops it
     * from inbound requests, so legacy callers keep working.
     */
    [extra: string]: unknown;
}
/**
 * Single generated image. `url` carries the bytes via one of two
 * transport modes — `<img src={url}>` works for both:
 *   - "https://api.runjobs.ai/v1/blobs/<id>" — async / hosted blob
 *   - "data:<mime>;base64,<payload>"        — sync / inline
 *
 * `decodeMediaUrl(url)` resolves either shape into `Uint8Array` +
 * mime type when raw bytes are wanted (file save, post-process).
 *
 * `size` is the actual dimensions of this image — Seedream sequential
 * generation may produce results different from the requested size.
 */
export interface ImageResult {
    url: string;
    revised_prompt?: string;
    size?: string;
    /**
     * Human-readable credit line that the client SHOULD display
     * alongside the image. Populated by stock-library models (Pexels)
     * whose terms of service require crediting the photographer;
     * AI-generation models leave it empty. Render verbatim — don't
     * try to parse the format.
     *
     * Example: "Photo by Jane Doe on Pexels (https://www.pexels.com/photo/12345/)"
     */
    attribution?: string;
}
export interface ImageUsage extends Usage {
    generated_images?: number;
    output_tokens?: number;
    total_tokens?: number;
    /** Tool name → invocation count (e.g. Seedream 5.0 lite web_search). */
    tool_usage?: Record<string, number>;
}
export interface ImageResponse {
    created: number;
    data: ImageResult[];
    usage: ImageUsage;
}
/**
 * Status payload returned by the resumable async-image endpoints
 * (`/v1/async/images/generations` and friends). Returned verbatim by
 * `submitGenerate()` (job is still queued / running), and again by
 * `getAsyncStatus()` (status may now be terminal — `data[]` is
 * populated when `status === 'succeeded'`).
 *
 * The fully-managed `generateAsync()` hides this type behind an
 * `ImageResponse`; `submitGenerate` + `getAsyncStatus` expose it for
 * callers who need to PERSIST the job id (e.g. resume polling across
 * a page refresh, drive their own UI progress, etc.).
 */
export interface AsyncImageJob {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | (string & {});
    data?: ImageResult[];
    usage?: ImageUsage;
    error?: string;
    /** Unix epoch seconds — same semantics as VideoStatus.created_at /
     *  current_time. Pair to compute server-truth elapsed. */
    created_at?: number;
    current_time?: number;
}
/** Minimal interface for an image / mask file passed to `edit()`. */
export interface ImageFileInput {
    /** File contents — Blob, ArrayBuffer, Uint8Array, or string. */
    data: Blob | ArrayBuffer | Uint8Array | string;
    /** File name including extension (sent in the multipart field). */
    filename: string;
    /** Optional MIME type — inferred from the extension when omitted. */
    contentType?: string;
}
export interface ImageEditParams {
    image: ImageFileInput;
    mask?: ImageFileInput;
    prompt: string;
    size?: string;
    n?: number;
    user?: string;
}
export declare class ImageService {
    private readonly transport;
    private readonly events;
    constructor(transport: Transport, events: SDKEvents);
    /**
     * Generate images from a text prompt via the synchronous endpoint.
     * For long-running requests (large Seedream batches, slow upstreams)
     * use `generateAsync()` to avoid 100-second origin timeouts.
     */
    generate(model: string, params: ImageGenerateParams, init?: {
        signal?: AbortSignal;
    }): Promise<ImageResponse>;
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
    generateAsync(model: string, params: ImageGenerateParams, init?: {
        signal?: AbortSignal;
        pollIntervalMs?: number;
    }): Promise<ImageResponse>;
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
    submitGenerate(model: string, params: ImageGenerateParams, init?: {
        signal?: AbortSignal;
    }): Promise<AsyncImageJob>;
    /**
     * Single poll of an in-flight async image job. Returns the same
     * shape `submitGenerate()` returned, with `data[]` populated once
     * `status` flips to `succeeded`. Caller decides cadence + bail-out;
     * the gateway's per-poll `current_time` / `created_at` together
     * give a server-truth elapsed reading regardless of client clock skew.
     */
    getAsyncStatus(id: string, init?: {
        signal?: AbortSignal;
    }): Promise<AsyncImageJob>;
    /**
     * Edit an image (inpaint / outpaint / variations) via multipart upload.
     * Provider-dependent — only available on `gpt-image-1` and similar.
     */
    edit(model: string, params: ImageEditParams, init?: {
        signal?: AbortSignal;
    }): Promise<ImageResponse>;
}
//# sourceMappingURL=image.d.ts.map
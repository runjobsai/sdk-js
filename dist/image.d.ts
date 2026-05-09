import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
export interface ImageGenerateParams {
    prompt: string;
    size?: string;
    n?: number;
    quality?: string;
    style?: string;
    reference_image_urls?: string[];
    user?: string;
    /** Pass-through for provider-specific knobs. */
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
    constructor(transport: Transport);
    /**
     * Generate images from a text prompt via the synchronous endpoint.
     * For long-running requests (large Seedream batches, slow upstreams)
     * use `generateAsync()` to avoid 100-second origin timeouts.
     */
    generate(model: string, params: ImageGenerateParams, init?: {
        signal?: AbortSignal;
    }): Promise<ImageResponse>;
    /**
     * Async equivalent of `generate()`. Submits a job, polls until terminal,
     * downloads the result blobs. Use this when a request may exceed the
     * ~100s origin timeout (Cloudflare otherwise replaces the real upstream
     * error with its own 502 page).
     *
     * The caller's `signal` deadline bounds the poll wait.
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
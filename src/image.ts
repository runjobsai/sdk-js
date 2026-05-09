import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";

export interface ImageGenerateParams {
  prompt: string;
  size?: string;
  n?: number;
  quality?: string;
  style?: string;
  /** @deprecated The gateway always returns `url` (with a `data:` URI
   *  for inline bytes).  Field kept for backward compat only. */
  response_format?: "url" | "b64_json";
  reference_image_urls?: string[];
  user?: string;
  /** Pass-through for provider-specific knobs. */
  [extra: string]: unknown;
}

/**
 * Single generated image.  The gateway always populates `url`:
 *   - hosted https URL when the upstream returned one (most providers)
 *   - `data:<mime>;base64,<payload>` URI when the upstream returned
 *     inline bytes (gpt-image-1, Seedream variants etc.)
 *
 * Either form can go straight into `<img src=…>` — no branching needed.
 *
 * `size` is the actual dimensions of this image — Seedream sequential
 * generation may produce results different from the requested size.
 */
export interface ImageResult {
  url: string;
  /** @deprecated Always empty now — gateway folds inline bytes into
   *  `url` as a `data:` URI.  Kept on the type to avoid breaking
   *  consumers that read this field defensively. */
  b64_json?: string;
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
  response_format?: "url" | "b64_json";
  user?: string;
}

/* ------------------------------------------------------------------ */

export class ImageService {
  constructor(private readonly transport: Transport) {}

  /**
   * Generate images from a text prompt via the synchronous endpoint.
   * For long-running requests (large Seedream batches, slow upstreams)
   * use `generateAsync()` to avoid 100-second origin timeouts.
   */
  async generate(
    model: string,
    params: ImageGenerateParams,
    init?: { signal?: AbortSignal },
  ): Promise<ImageResponse> {
    return this.transport.postJSON<ImageResponse>(
      "/v1/images/generations",
      { model, ...params },
      init,
    );
  }

  /**
   * Async equivalent of `generate()`. Submits a job, polls until terminal,
   * downloads the result blobs. Use this when a request may exceed the
   * ~100s origin timeout (Cloudflare otherwise replaces the real upstream
   * error with its own 502 page).
   *
   * The caller's `signal` deadline bounds the poll wait.
   */
  async generateAsync(
    model: string,
    params: ImageGenerateParams,
    init?: { signal?: AbortSignal; pollIntervalMs?: number },
  ): Promise<ImageResponse> {
    return this.transport.postJSON<ImageResponse>(
      "/v1/images/generations/async",
      { model, ...params, _poll_interval_ms: init?.pollIntervalMs },
      init,
    );
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
   */
  async submitGenerate(
    model: string,
    params: ImageGenerateParams,
    init?: { signal?: AbortSignal },
  ): Promise<AsyncImageJob> {
    return this.transport.postJSON<AsyncImageJob>(
      "/v1/async/images/generations",
      { model, ...params },
      init,
    );
  }

  /**
   * Single poll of an in-flight async image job. Returns the same
   * shape `submitGenerate()` returned, with `data[]` populated once
   * `status` flips to `succeeded`. Caller decides cadence + bail-out;
   * the gateway's per-poll `current_time` / `created_at` together
   * give a server-truth elapsed reading regardless of client clock skew.
   */
  async getAsyncStatus(
    id: string,
    init?: { signal?: AbortSignal },
  ): Promise<AsyncImageJob> {
    return this.transport.getJSON<AsyncImageJob>(
      `/v1/async/images/generations/${encodeURIComponent(id)}`,
      init,
    );
  }

  /**
   * Edit an image (inpaint / outpaint / variations) via multipart upload.
   * Provider-dependent — only available on `gpt-image-1` and similar.
   */
  async edit(
    model: string,
    params: ImageEditParams,
    init?: { signal?: AbortSignal },
  ): Promise<ImageResponse> {
    const form = buildEditForm(model, params);
    return this.transport.postMultipart<ImageResponse>(
      "/v1/images/edits",
      form,
      init,
    );
  }
}

function buildEditForm(model: string, params: ImageEditParams): FormData {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", params.prompt);
  if (params.size) form.set("size", params.size);
  if (params.n !== undefined) form.set("n", String(params.n));
  if (params.response_format) form.set("response_format", params.response_format);
  if (params.user) form.set("user", params.user);
  form.set("image", toBlob(params.image), params.image.filename);
  if (params.mask) form.set("mask", toBlob(params.mask), params.mask.filename);
  return form;
}

/** Internal: coerce ImageFileInput to a Blob the multipart layer accepts. */
function toBlob(input: ImageFileInput): Blob {
  const ct = input.contentType ?? guessMime(input.filename);
  if (input.data instanceof Blob) {
    return input.data.type === ct ? input.data : new Blob([input.data], { type: ct });
  }
  if (typeof input.data === "string") {
    return new Blob([input.data], { type: ct });
  }
  // ArrayBuffer | Uint8Array — wrap in Blob. Cast widens TS's strict
  // Uint8Array<ArrayBuffer> back to BlobPart (it's accepted at runtime).
  return new Blob([input.data as BlobPart], { type: ct });
}

function guessMime(filename: string): string {
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

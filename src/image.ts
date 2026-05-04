import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";

export interface ImageGenerateParams {
  prompt: string;
  size?: string;
  n?: number;
  quality?: string;
  style?: string;
  response_format?: "url" | "b64_json";
  reference_image_urls?: string[];
  user?: string;
  /** Pass-through for provider-specific knobs. */
  [extra: string]: unknown;
}

/**
 * Single generated image. `b64_json` is set when the gateway returned the
 * bytes inline; `url` when the gateway returned a hosted URL. `size` is
 * the *actual* dimensions of this image — Seedream sequential generation
 * may produce results different from the requested size.
 */
export interface ImageResult {
  url?: string;
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

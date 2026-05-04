import { APIError } from "./errors.js";

/**
 * Internal — shared HTTP transport used by every service. Not part of the
 * public API; do not import from outside `src/`.
 *
 * Uses the global `fetch` (Node 18+ / browsers / Deno / Bun all ship it).
 * Errors from the gateway (status >= 400) are parsed and surfaced as
 * `APIError`. Network errors propagate as the underlying fetch reject.
 */
export interface TransportOptions {
  baseURL: string;
  apiKey: string;
  /** Optional fetch override (e.g. node-fetch with custom agent). */
  fetchImpl?: typeof fetch;
}

export class Transport {
  readonly baseURL: string;
  readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TransportOptions) {
    this.baseURL = opts.baseURL.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** POST JSON body; parse JSON response. */
  async postJSON<T>(
    path: string,
    body: unknown,
    init?: { signal?: AbortSignal },
  ): Promise<T> {
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
      signal: init?.signal,
    });
    if (!resp.ok) {
      throw await this.parseError(resp);
    }
    return (await resp.json()) as T;
  }

  /** GET path; parse JSON response. */
  async getJSON<T>(
    path: string,
    init?: { signal?: AbortSignal },
  ): Promise<T> {
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "GET",
      headers: this.authHeaders(),
      signal: init?.signal,
    });
    if (!resp.ok) {
      throw await this.parseError(resp);
    }
    return (await resp.json()) as T;
  }

  /** GET path; return raw bytes + content-type (for video/audio downloads). */
  async getRaw(
    path: string,
    init?: { signal?: AbortSignal },
  ): Promise<{ data: Uint8Array; contentType: string }> {
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "GET",
      headers: this.authHeaders(),
      signal: init?.signal,
    });
    if (!resp.ok) {
      throw await this.parseError(resp);
    }
    const buf = new Uint8Array(await resp.arrayBuffer());
    const contentType = resp.headers.get("content-type") ?? "";
    return { data: buf, contentType };
  }

  /** POST a multipart/form-data body. Used by audio.transcribe and image.edit. */
  async postMultipart<T>(
    path: string,
    form: FormData,
    init?: { signal?: AbortSignal },
  ): Promise<T> {
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "POST",
      headers: this.authHeaders(), // do NOT set Content-Type — fetch sets it with boundary
      body: form,
      signal: init?.signal,
    });
    if (!resp.ok) {
      throw await this.parseError(resp);
    }
    return (await resp.json()) as T;
  }

  /**
   * POST JSON body; return the raw streaming Response. Used by chat
   * streaming. Caller is responsible for consuming the SSE body.
   */
  async postJSONStream(
    path: string,
    body: unknown,
    init?: { signal?: AbortSignal },
  ): Promise<Response> {
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "POST",
      headers: {
        ...this.jsonHeaders(),
        "Accept-Encoding": "identity", // SSE lines arrive immediately, no gzip
      },
      body: JSON.stringify(body),
      signal: init?.signal,
    });
    if (!resp.ok) {
      throw await this.parseError(resp);
    }
    return resp;
  }

  private jsonHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async parseError(resp: Response): Promise<APIError> {
    const text = await resp.text();
    let type = "error";
    let message = text || resp.statusText;
    try {
      const parsed = JSON.parse(text) as { type?: string; message?: string };
      if (parsed.type) type = parsed.type;
      if (parsed.message) message = parsed.message;
    } catch {
      // Body wasn't JSON — fall back to raw text.
    }
    return new APIError(resp.status, type, message);
  }
}

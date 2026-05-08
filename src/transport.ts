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
  /** Static bearer token. Required unless `apiKeyResolver` is supplied. */
  apiKey?: string;
  /** Dynamic resolver — called immediately before each request. Use this
   *  when the token is short-lived and refreshed externally (e.g. running
   *  inside a runjobs resource bundle that exposes
   *  `window.runjobs.getToken()`). The result is awaited per request, so
   *  the caller can return a Promise that hits a token endpoint. Wins
   *  over `apiKey` when both are supplied. */
  apiKeyResolver?: () => string | Promise<string>;
  /** Optional fetch override (e.g. node-fetch with custom agent). */
  fetchImpl?: typeof fetch;
}

export class Transport {
  readonly baseURL: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyResolver: (() => string | Promise<string>) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TransportOptions) {
    if (!opts.apiKey && !opts.apiKeyResolver) {
      throw new Error(
        "RunJobs: pass either `apiKey` or `apiKeyResolver` when constructing the client",
      );
    }
    this.baseURL = opts.baseURL.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.apiKeyResolver = opts.apiKeyResolver;
    // Bind to globalThis when using the platform's native fetch.
    // Without binding, `this.fetchImpl(...)` invokes with `this`
    // pointing at the Transport instance, and the browser's
    // `Window.fetch` rejects that with "Illegal invocation".
    // Caller-supplied `fetchImpl` is used as-is — they're responsible
    // for any binding their wrapper needs.
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  /** Resolve the bearer token for the next request. */
  private async resolveToken(): Promise<string> {
    if (this.apiKeyResolver) return await this.apiKeyResolver();
    return this.apiKey ?? "";
  }

  /** POST JSON body; parse JSON response. */
  async postJSON<T>(
    path: string,
    body: unknown,
    init?: { signal?: AbortSignal },
  ): Promise<T> {
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "POST",
      headers: await this.jsonHeaders(),
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
      headers: await this.authHeaders(),
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
      headers: await this.authHeaders(),
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
      headers: await this.authHeaders(), // do NOT set Content-Type — fetch sets it with boundary
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
        ...(await this.jsonHeaders()),
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

  /** PUT raw bytes with caller-supplied content type and headers. */
  async putBytes<T>(
    path: string,
    body: BodyInit,
    opts?: {
      contentType?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      parse?: "json" | "none";
    },
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...(await this.authHeaders()),
      "Content-Type": opts?.contentType ?? "application/octet-stream",
    };
    if (opts?.headers) Object.assign(headers, opts.headers);
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "PUT",
      headers,
      body,
      signal: opts?.signal,
    });
    if (!resp.ok) throw await this.parseError(resp);
    if (opts?.parse === "none") return undefined as unknown as T;
    return (await resp.json()) as T;
  }

  /** DELETE path; parse JSON response (or no body). */
  async deletePath<T>(
    path: string,
    init?: { signal?: AbortSignal; parse?: "json" | "none" },
  ): Promise<T> {
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "DELETE",
      headers: await this.authHeaders(),
      signal: init?.signal,
    });
    if (!resp.ok) throw await this.parseError(resp);
    if (init?.parse === "none") return undefined as unknown as T;
    return (await resp.json()) as T;
  }

  /** HEAD path; surface status + selected response headers.  Used by
   *  exists / stat where the body would just be an opaque blob. */
  async head(
    path: string,
    init?: { signal?: AbortSignal },
  ): Promise<{ status: number; headers: Headers }> {
    const resp = await this.fetchImpl(this.baseURL + path, {
      method: "HEAD",
      headers: await this.authHeaders(),
      signal: init?.signal,
    });
    return { status: resp.status, headers: resp.headers };
  }

  private async jsonHeaders(): Promise<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await this.resolveToken()}`,
    };
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.resolveToken()}` };
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

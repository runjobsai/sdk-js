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
export declare class Transport {
    readonly baseURL: string;
    private readonly apiKey;
    private readonly apiKeyResolver;
    private readonly fetchImpl;
    constructor(opts: TransportOptions);
    /** Resolve the bearer token for the next request. */
    private resolveToken;
    /** POST JSON body; parse JSON response. */
    postJSON<T>(path: string, body: unknown, init?: {
        signal?: AbortSignal;
    }): Promise<T>;
    /** GET path; parse JSON response. */
    getJSON<T>(path: string, init?: {
        signal?: AbortSignal;
    }): Promise<T>;
    /** GET path; return raw bytes + content-type (for video/audio downloads). */
    getRaw(path: string, init?: {
        signal?: AbortSignal;
    }): Promise<{
        data: Uint8Array;
        contentType: string;
    }>;
    /** POST a multipart/form-data body. Used by audio.transcribe and image.edit. */
    postMultipart<T>(path: string, form: FormData, init?: {
        signal?: AbortSignal;
    }): Promise<T>;
    /**
     * POST JSON body; return the raw streaming Response. Used by chat
     * streaming. Caller is responsible for consuming the SSE body.
     */
    postJSONStream(path: string, body: unknown, init?: {
        signal?: AbortSignal;
    }): Promise<Response>;
    private jsonHeaders;
    private authHeaders;
    private parseError;
}
//# sourceMappingURL=transport.d.ts.map
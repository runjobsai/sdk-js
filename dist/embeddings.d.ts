import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
export interface EmbeddingsParams {
    /** Single string OR array of strings — gateway forwards either
     *  shape verbatim. Passing a string returns `data: [{...}]` (1
     *  element), passing an array returns one element per input. */
    input: string | string[];
    /** OpenAI per-end-user observability tag. */
    user?: string;
    /** "float" (default) or "base64". `base64` packs vectors as
     *  little-endian float32 + base64-encoded — saves bandwidth for
     *  high-D embeddings (3072-D × 1000 docs is ~3× smaller than the
     *  JSON float-array form). */
    encoding_format?: "float" | "base64";
    /** Truncate the output vector. text-embedding-3-* only — other
     *  models reject. */
    dimensions?: number;
}
export interface Embedding {
    object: "embedding";
    /** Vector. When `encoding_format` was "float" (default), this is
     *  `number[]`. When "base64", this is the encoded `string`. */
    embedding: number[] | string;
    index: number;
}
/** OpenAI's usage block plus the gateway's billing extension
 *  (`total_cost` in USD).
 *
 *  Shape parallels the `Usage` type used by chat / image / video so
 *  callers can read `.total_cost` on every response uniformly. */
export interface EmbeddingsUsage extends Usage {
    prompt_tokens: number;
    total_tokens: number;
}
export interface EmbeddingsResponse {
    object: "list";
    data: Embedding[];
    model: string;
    usage: EmbeddingsUsage;
}
export declare class EmbeddingsService {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * Create one or more embeddings.
     *
     * ```ts
     * const r = await client.embeddings.create("text-embedding-3-small", {
     *   input: ["alpha", "beta"],
     *   dimensions: 1536,
     * });
     * for (const e of r.data) {
     *   console.log(e.index, (e.embedding as number[]).slice(0, 4));
     * }
     * console.log(`Cost: $${r.usage.total_cost.toFixed(6)}`);
     * ```
     */
    create(model: string, params: EmbeddingsParams, init?: {
        signal?: AbortSignal;
    }): Promise<EmbeddingsResponse>;
}
//# sourceMappingURL=embeddings.d.ts.map
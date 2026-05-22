import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
import type { SDKEvents } from "./events.js";
import { wrapEvents } from "./event-wrap.js";

/* ------------------------------------------------------------------ */
/* Embeddings — POST /v1/embeddings                                    */
/* ------------------------------------------------------------------ */
/*                                                                     */
/* OpenAI-compatible vector embedding endpoint. Wire shape mirrors     */
/* OpenAI's `/v1/embeddings` exactly so callers porting from the      */
/* official `openai` SDK can swap the import line and keep working.    */
/* ------------------------------------------------------------------ */

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

export class EmbeddingsService {
  constructor(
    private readonly transport: Transport,
    private readonly events: SDKEvents,
  ) {}

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
  async create(
    model: string,
    params: EmbeddingsParams,
    init?: { signal?: AbortSignal },
  ): Promise<EmbeddingsResponse> {
    return wrapEvents(
      this.events,
      { model, capability: "embedding" },
      () =>
        this.transport.postJSON<EmbeddingsResponse>(
          "/v1/embeddings",
          { model, ...params },
          init,
        ),
      (r) => ({
        totalTokens: r.usage?.total_tokens,
        costUSD: r.usage?.total_cost,
      }),
    );
  }
}

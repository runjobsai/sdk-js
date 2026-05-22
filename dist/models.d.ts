import type { Transport } from "./transport.js";
/**
 * One model available on the gateway. Pricing is in **pips** (1 USD =
 * 1,000,000 pips), per million tokens — multiply by tokens / 10⁶ for the
 * billed pip cost, or by tokens / 10¹² for USD.
 */
export interface Model {
    id: string;
    object: string;
    capability: string;
    provider?: string;
    /**
     * Server-derived "what this model can actually do" tags
     * (e.g. {id:"t2v", label:"Text-to-Video"}, {id:"i2v", label:"Image-to-Video"}).
     * Use `hasCapabilityTag` for stable filter checks; iterate for display.
     * Labels are in English — frontends localise on their side.
     */
    capability_tags?: Tag[];
    /**
     * Accepted input modalities for chat models. Omitted on capabilities
     * where it doesn't apply (image generation, TTS, etc.). Mirrors
     * Anthropic / Gemini's own `inputModalities` field — operator-set on
     * the gateway, surfaced verbatim here.
     *
     * Canonical values: `"text"`, `"image"`, `"video"`, `"audio"`. The
     * list is open — future modalities ride through without an SDK
     * update. Use `acceptsModality` for the stable filter check.
     *
     * @example
     *   const videoCapable = models.filter(m => acceptsModality(m, "video"));
     */
    input_modalities?: string[];
    options?: Record<string, unknown>;
    input_price_per_mtok: number;
    output_price_per_mtok: number;
    fixed_price: boolean;
    fixed_cost: number;
    max_tokens: number;
    max_input_tokens: number;
    icon_url?: string;
    available_voices?: string[];
}
/**
 * One capability tag. Mirrors options_schema.Tag on the gateway. IDs
 * are stable across releases; Labels are subject to translation.
 */
export interface Tag {
    id: string;
    label: string;
}
/** True iff `model.capability_tags` includes a tag with the given stable ID. */
export declare const hasCapabilityTag: (model: Model, id: string) => boolean;
/**
 * True iff the chat model accepts the given input modality. Lets you
 * filter by `"image"` / `"video"` / `"audio"` (or `"text"`, always
 * true for chat models that set the field at all) without remembering
 * whether the gateway uses canonical or aliased names.
 *
 * Returns `false` when `input_modalities` is unset — text-only is the
 * conservative default.
 *
 * @example
 *   const videoModels = (await client.models.list())
 *     .filter(m => acceptsModality(m, "video"));
 */
export declare const acceptsModality: (model: Model, modality: string) => boolean;
export interface ModelListOptions {
    /** Filter to one capability (e.g. "text", "vision", "image", "tts"). */
    capability?: string;
}
/** Convenience: TTS model accepts a reference audio clip as `voice`? */
export declare const supportsVoiceClone: (model: Model) => boolean;
/** Convenience: TTS model accepts a free-form `instruct_text` directive? */
export declare const supportsInstructText: (model: Model) => boolean;
/** Convenience: admin-set default voice for a TTS model, or null. */
export declare const defaultVoice: (model: Model) => string | null;
export declare class ModelsService {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * List models available on the gateway. Pass `{ capability: "..." }` to
     * filter server-side.
     */
    list(opts?: ModelListOptions, init?: {
        signal?: AbortSignal;
    }): Promise<Model[]>;
}
//# sourceMappingURL=models.d.ts.map
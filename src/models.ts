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
export const hasCapabilityTag = (model: Model, id: string): boolean =>
  Array.isArray(model.capability_tags) &&
  model.capability_tags.some((t) => t.id === id);

export interface ModelListOptions {
  /** Filter to one capability (e.g. "text", "vision", "image", "tts"). */
  capability?: string;
}

/** True iff the gateway flag in `options[key]` is set. Accepts bool or numeric 1. */
function optBool(model: Model, key: string): boolean {
  const v = model.options?.[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return false;
}

/** Convenience: TTS model accepts a reference audio clip as `voice`? */
export const supportsVoiceClone = (model: Model): boolean =>
  optBool(model, "supports_voice_clone");

/** Convenience: TTS model accepts a free-form `instruct_text` directive? */
export const supportsInstructText = (model: Model): boolean =>
  optBool(model, "supports_instruct_text");

/** Convenience: admin-set default voice for a TTS model, or null. */
export const defaultVoice = (model: Model): string | null => {
  const v = model.options?.["default_voice"];
  return typeof v === "string" ? v : null;
};

export class ModelsService {
  constructor(private readonly transport: Transport) {}

  /**
   * List models available on the gateway. Pass `{ capability: "..." }` to
   * filter server-side.
   */
  async list(
    opts: ModelListOptions = {},
    init?: { signal?: AbortSignal },
  ): Promise<Model[]> {
    let path = "/v1/models";
    if (opts.capability) {
      path += `?capability=${encodeURIComponent(opts.capability)}`;
    }
    const resp = await this.transport.getJSON<{ data: Model[] }>(path, init);
    return resp.data;
  }
}

// Mirror of internal/api/options_schema/types.go on the JS side.
// See API.md "Options schema" for the full contract; the gateway
// materialises this from the legacy options blob at /v1/models
// response time.

import type { Model } from "./models.js";

/** Wire-format options shape returned by /v1/models. */
export interface Schema {
  /** Schema version stamp. SDKs refuse to validate against unknown versions. */
  version: number;
  /**
   * Per-field constraints, keyed by canonical request field name
   * (matching the JSON keys on Image/Video/Speech/Embed/Transcribe
   * params). A field absent from this map is NOT accepted by the
   * model.
   */
  inputs?: Record<string, FieldSchema>;
  /** Cross-field rules. */
  constraints?: Constraint[];
  /** Rich content (TTS voices, emotions). */
  catalog?: Catalog;
}

export interface FieldSchema {
  type:
    | "string"
    | "int"
    | "float"
    | "bool"
    | "url"
    | "url[]"
    | "string[]"
    | "file";
  /** Default when omitted is "optional". */
  presence?: "required" | "optional" | "forbidden";
  min?: number;
  max?: number;
  default?: unknown;
  enum?: unknown[];
  max_items?: number;
  /** Semantic hint for media-input fields. */
  role?: "source" | "reference" | "motion";

  // ─── Display metadata — drives auto-rendered playground / form UIs.
  // All optional; renderers fall back to type/role-based rendering
  // when absent. See API.md "Options schema" for the full vocabulary.

  /** Human-readable display label. Falls back to the field name. */
  label?: string;
  /** One-sentence tooltip / sub-text explainer. */
  help?: string;
  /**
   * Widget override hint:
   *   "textarea"     — large multi-line string
   *   "slider"       — numeric with min/max
   *   "radio"        — small enum
   *   "voice_picker" — string with values from catalog.voices
   *   "code"         — long string with syntax highlighting
   * Unknown values fall back to the type default (forward-compat).
   */
  widget?: string;
  /**
   * Nested presentational hints:
   *   "group" (string) — sectional grouping ("main"/"advanced"/"output").
   *   "order" (int)    — display order within the group; lower first.
   */
  ui?: { group?: string; order?: number; [k: string]: unknown };
}

export type ConstraintKind =
  | "any_of_required"
  | "mutually_exclusive"
  | "requires_all"
  | "pixel_bounds";

export interface Constraint {
  kind: ConstraintKind;
  fields?: string[];
  when?: string;
  then?: string[];
  min?: number;
  max?: number;
}

export interface Catalog {
  voices?: Array<Record<string, unknown>>;
  emotions?: string[];
}

/**
 * Parse the model's wire-format `options` blob into the typed Schema.
 * Returns null when the model has no options or the blob can't be
 * structurally decoded — callers fall back to whatever default
 * behaviour they had pre-schema.
 */
export function getOptionsSchema(model: Model): Schema | null {
  const opts = model.options;
  if (!opts || typeof opts !== "object") return null;
  // The Model interface types options as Record<string, unknown>;
  // Schema has the same JSON layout, so a structural cast is safe
  // as long as the gateway emits the wire shape we expect. SDK
  // consumers should call validateRequest() to surface errors —
  // this getter is a thin typed view over the same data.
  return opts as unknown as Schema;
}

/**
 * True iff the model declares an Inputs entry for `name` with
 * presence != "forbidden". Use for "should I show this UI chip"
 * decisions.
 */
export function acceptsField(model: Model, name: string): boolean {
  const schema = getOptionsSchema(model);
  const f = schema?.inputs?.[name];
  if (!f) return false;
  return f.presence !== "forbidden";
}

/**
 * True iff the schema marks `name` as presence: "required". Use for
 * red-star UI marks and submit-button gating.
 */
export function requiresField(model: Model, name: string): boolean {
  const schema = getOptionsSchema(model);
  return schema?.inputs?.[name]?.presence === "required";
}

/**
 * Discrete enum for the named field, or null if no enum constraint.
 * Use to populate dropdown options on the client.
 */
export function allowedValuesFor(model: Model, name: string): unknown[] | null {
  const schema = getOptionsSchema(model);
  return schema?.inputs?.[name]?.enum ?? null;
}

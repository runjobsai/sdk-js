import type { Model } from "./models.js";
/** Wire-format options shape returned by /v1/models. */
export interface Schema {
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
    type: "string" | "int" | "float" | "bool" | "url" | "url[]" | "string[]" | "file";
    /** Default when omitted is "optional". */
    presence?: "required" | "optional" | "forbidden";
    min?: number;
    max?: number;
    default?: unknown;
    enum?: unknown[];
    max_items?: number;
    /** Semantic hint for media-input fields. */
    role?: "source" | "reference" | "motion";
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
    ui?: {
        group?: string;
        order?: number;
        [k: string]: unknown;
    };
}
export type ConstraintKind = "any_of_required" | "mutually_exclusive" | "group_mutex" | "requires_all" | "pixel_bounds";
export interface Constraint {
    kind: ConstraintKind;
    fields?: string[];
    /**
     * Used by `group_mutex`: at most one group may have any field set.
     * Fields inside the same group can co-exist.
     */
    groups?: string[][];
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
export declare function getOptionsSchema(model: Model): Schema | null;
/**
 * True iff the model declares an Inputs entry for `name` with
 * presence != "forbidden". Use for "should I show this UI chip"
 * decisions.
 */
export declare function acceptsField(model: Model, name: string): boolean;
/**
 * True iff the schema marks `name` as presence: "required". Use for
 * red-star UI marks and submit-button gating.
 */
export declare function requiresField(model: Model, name: string): boolean;
/**
 * Discrete enum for the named field, or null if no enum constraint.
 * Use to populate dropdown options on the client.
 */
export declare function allowedValuesFor(model: Model, name: string): unknown[] | null;
//# sourceMappingURL=model_options.d.ts.map
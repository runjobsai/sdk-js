import type { Schema } from "./model_options.js";
export interface ValidationError {
    field: string;
    reason: string;
}
/**
 * Three-pass validator: per-field type/enum/bounds → per-field
 * presence → cross-field constraints. Unknown fields in `req`
 * (vendor passthroughs) are silently ignored — the gateway still
 * validates them server-side if it cares.
 *
 * Returns an empty array on success, or a flat list of all
 * validation failures so the UI can surface them at once.
 */
export declare function validateRequest(schema: Schema | null | undefined, req?: Record<string, unknown>): ValidationError[];
//# sourceMappingURL=validate.d.ts.map
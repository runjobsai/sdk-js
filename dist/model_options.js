// Mirror of internal/api/options_schema/types.go on the JS side.
// See API.md "Options schema" for the full contract; the gateway
// materialises this from the legacy options blob at /v1/models
// response time.
/**
 * Normalize either legacy `string[][]` or new `Group[]` into a
 * uniform `Group[]`. Mirror of sdk-go's `Group.UnmarshalJSON`.
 */
export function normalizeGroups(g) {
    if (!g)
        return [];
    return g.map(item => Array.isArray(item) ? { fields: item } : item);
}
/**
 * Parse the model's wire-format `options` blob into the typed Schema.
 * Returns null when the model has no options or the blob can't be
 * structurally decoded — callers fall back to whatever default
 * behaviour they had pre-schema.
 */
export function getOptionsSchema(model) {
    const opts = model.options;
    if (!opts || typeof opts !== "object")
        return null;
    // The Model interface types options as Record<string, unknown>;
    // Schema has the same JSON layout, so a structural cast is safe
    // as long as the gateway emits the wire shape we expect. SDK
    // consumers should call validateRequest() to surface errors —
    // this getter is a thin typed view over the same data.
    return opts;
}
/**
 * True iff the model declares an Inputs entry for `name` with
 * presence != "forbidden". Use for "should I show this UI chip"
 * decisions.
 */
export function acceptsField(model, name) {
    const schema = getOptionsSchema(model);
    const f = schema?.inputs?.[name];
    if (!f)
        return false;
    return f.presence !== "forbidden";
}
/**
 * True iff the schema marks `name` as presence: "required". Use for
 * red-star UI marks and submit-button gating.
 */
export function requiresField(model, name) {
    const schema = getOptionsSchema(model);
    return schema?.inputs?.[name]?.presence === "required";
}
/**
 * Discrete enum for the named field, or null if no enum constraint.
 * Use to populate dropdown options on the client.
 */
export function allowedValuesFor(model, name) {
    const schema = getOptionsSchema(model);
    return schema?.inputs?.[name]?.enum ?? null;
}
//# sourceMappingURL=model_options.js.map
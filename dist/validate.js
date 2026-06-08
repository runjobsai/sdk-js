// Generic validator for the gateway's options schema. Mirrors
// /Users/zero/repos/sdk-go/validate.go — three-pass algorithm,
// same field/constraint vocabulary, same parse logic.
import { normalizeGroups } from "./model_options.js";
/**
 * Three-pass validator: per-field type/enum/bounds → per-field
 * presence → cross-field constraints. Unknown fields in `req`
 * (vendor passthroughs) are silently ignored — the gateway still
 * validates them server-side if it cares.
 *
 * Returns an empty array on success, or a flat list of all
 * validation failures so the UI can surface them at once.
 */
export function validateRequest(schema, req = {}) {
    if (!schema)
        return [];
    const errors = [];
    // Pass 1+2: per-field.
    if (schema.inputs) {
        for (const [name, field] of Object.entries(schema.inputs)) {
            const set = name in req;
            const val = req[name];
            if (set && !isEmpty(val)) {
                errors.push(...validateFieldValue(name, field, val));
            }
            else if (set && field.min_items !== undefined) {
                // Empty array trips min_items even when isEmpty() short-
                // circuits validateFieldValue. Mirrors the sdk-go fix: bound
                // was declared explicitly, dropping it silently would let a
                // client POST `groups: []` to a schema that requires >=1.
                if (Array.isArray(val) && val.length < field.min_items) {
                    errors.push({ field: name, reason: `at least ${field.min_items} items` });
                }
            }
            errors.push(...validatePresence(name, field, val, set));
        }
    }
    // Pass 3: cross-field.
    for (const c of schema.constraints ?? []) {
        errors.push(...validateConstraint(c, req));
    }
    return errors;
}
function validateFieldValue(name, field, val) {
    const errors = [];
    if (!typeMatches(field.type, val)) {
        errors.push({
            field: name,
            reason: `expected type ${field.type}, got ${describeType(val)}`,
        });
        return errors; // bail early — bound/enum checks need correct type
    }
    if (field.enum && field.enum.length > 0 && !inEnum(val, field.enum)) {
        errors.push({
            field: name,
            reason: `must be one of ${JSON.stringify(field.enum)}`,
        });
    }
    if (field.type === "int" || field.type === "float") {
        const n = numberValue(val);
        if (n !== null) {
            if (field.min !== undefined && n < field.min) {
                errors.push({ field: name, reason: `must be >= ${field.min}` });
            }
            if (field.max !== undefined && n > field.max) {
                errors.push({ field: name, reason: `must be <= ${field.max}` });
            }
        }
    }
    // Array bounds — apply to scalar array Types ("url[]", "string[]")
    // AND to `repeatable` object groups whose value is a JSON array.
    if (Array.isArray(val)) {
        if (field.max_items !== undefined && val.length > field.max_items) {
            errors.push({
                field: name,
                reason: `at most ${field.max_items} items`,
            });
        }
        if (field.min_items !== undefined && val.length < field.min_items) {
            errors.push({
                field: name,
                reason: `at least ${field.min_items} items`,
            });
        }
    }
    // Nested object recursion. `field.fields` declares a structured
    // sub-object; with `repeatable: true` the wire value is an array of
    // such objects. Errors carry a dotted path like
    // "groups[1].prompt: required" so callers see the offending row.
    // `ui.show_when` is deliberately NOT honoured at validation time —
    // it's a UI hint only; conditionally-hidden fields are still
    // subject to the same checks if a client sends them.
    if (field.fields) {
        if (field.repeatable) {
            if (!Array.isArray(val)) {
                errors.push({
                    field: name,
                    reason: `expected array of objects, got ${describeType(val)}`,
                });
            }
            else {
                val.forEach((item, i) => {
                    if (typeof item !== "object" || item === null || Array.isArray(item)) {
                        errors.push({
                            field: `${name}[${i}]`,
                            reason: `expected object, got ${describeType(item)}`,
                        });
                        return;
                    }
                    errors.push(...validateObject(`${name}[${i}]`, field.fields, item));
                });
            }
        }
        else {
            if (typeof val !== "object" || val === null || Array.isArray(val)) {
                errors.push({
                    field: name,
                    reason: `expected object, got ${describeType(val)}`,
                });
            }
            else {
                errors.push(...validateObject(name, field.fields, val));
            }
        }
    }
    return errors;
}
/** validateObject runs per-field validation against a sub-schema's
 *  `fields` map for one object value. Errors return with
 *  `<pathPrefix>.<innerName>` so the caller sees the full nested path. */
function validateObject(pathPrefix, fields, obj) {
    const errors = [];
    for (const [innerName, innerField] of Object.entries(fields)) {
        const childPath = `${pathPrefix}.${innerName}`;
        const val = obj[innerName];
        const set = innerName in obj;
        if (set && !isEmpty(val)) {
            errors.push(...validateFieldValue(childPath, innerField, val));
        }
        errors.push(...validatePresence(childPath, innerField, val, set));
    }
    return errors;
}
function validatePresence(name, field, val, set) {
    const presence = field.presence ?? "optional";
    if (presence === "required" && (!set || isEmpty(val))) {
        return [{ field: name, reason: "required" }];
    }
    if (presence === "forbidden" && set && !isEmpty(val)) {
        return [{ field: name, reason: "must not be set for this model" }];
    }
    return [];
}
function validateConstraint(c, req) {
    switch (c.kind) {
        case "any_of_required": {
            const fields = c.fields ?? [];
            const anySet = fields.some((f) => f in req && !isEmpty(req[f]));
            if (anySet)
                return [];
            return [
                {
                    field: fields.join("/"),
                    reason: `at least one of ${fields.join(", ")} is required`,
                },
            ];
        }
        case "mutually_exclusive": {
            const fields = c.fields ?? [];
            const setFields = fields.filter((f) => f in req && !isEmpty(req[f]));
            if (setFields.length > 1) {
                return [
                    {
                        field: setFields.join("/"),
                        reason: `at most one of ${fields.join(", ")} may be set (got: ${setFields.join(", ")})`,
                    },
                ];
            }
            return [];
        }
        case "group_mutex": {
            // Best-effort: enforce only the anonymous "at most one group
            // active" rule for both shapes. The strict discriminator-based
            // check (validating `c.name`'s value + rejecting non-active
            // group fields) lives in the gateway only — SDK validation
            // stays a fast pre-flight hint, not a contract enforcer, so we
            // avoid doubling the maintenance surface across SDKs.
            const groups = normalizeGroups(c.groups);
            const activeGroups = [];
            const activeFields = [];
            for (const g of groups) {
                const setHere = g.fields.filter((f) => f in req && !isEmpty(req[f]));
                if (setHere.length > 0) {
                    activeGroups.push(g);
                    activeFields.push(...setHere);
                }
            }
            if (activeGroups.length > 1) {
                const labels = groups.map((g) => `[${g.fields.join("+")}]`).join(" or ");
                return [
                    {
                        field: activeFields.join("/"),
                        reason: `at most one of ${labels} may be used (got: ${activeFields.join(", ")})`,
                    },
                ];
            }
            return [];
        }
        case "requires_all": {
            const whenName = c.when;
            if (!whenName)
                return [];
            const whenSet = whenName in req && !isEmpty(req[whenName]);
            if (!whenSet)
                return [];
            const missing = (c.then ?? []).filter((f) => !(f in req) || isEmpty(req[f]));
            if (missing.length === 0)
                return [];
            return [
                {
                    field: missing.join("/"),
                    reason: `required when ${whenName} is set`,
                },
            ];
        }
        case "pixel_bounds": {
            const fieldName = c.fields?.[0];
            if (!fieldName)
                return [];
            const raw = req[fieldName];
            if (typeof raw !== "string" || raw === "")
                return [];
            const dims = parsePixelDims(raw);
            if (!dims) {
                return [{ field: fieldName, reason: `expected WxH dimensions, got "${raw}"` }];
            }
            const [w, h] = dims;
            const px = w * h;
            const errs = [];
            if (c.min !== undefined && px < c.min) {
                errs.push({
                    field: fieldName,
                    reason: `image too small: ${w}x${h} = ${px} pixels, minimum ${c.min}`,
                });
            }
            if (c.max !== undefined && px > c.max) {
                errs.push({
                    field: fieldName,
                    reason: `image too large: ${w}x${h} = ${px} pixels, maximum ${c.max}`,
                });
            }
            return errs;
        }
    }
    // Unknown constraint kind — skip (forward-compat).
    return [];
}
// ─── Type helpers ────────────────────────────────────────────────────
function typeMatches(typ, val) {
    switch (typ) {
        case "string":
            return typeof val === "string";
        case "int":
        case "float":
            return numberValue(val) !== null;
        case "bool":
            return typeof val === "boolean";
        case "url":
            return typeof val === "string" && isURLLike(val);
        case "url[]":
            return Array.isArray(val) && val.every((v) => typeof v === "string" && isURLLike(v));
        case "string[]":
            return Array.isArray(val) && val.every((v) => typeof v === "string");
        case "file":
            return true; // multipart — can't validate
        default:
            return true; // unknown type — forward-compat
    }
}
function describeType(val) {
    if (val === null)
        return "null";
    if (Array.isArray(val))
        return "array";
    return typeof val;
}
function numberValue(val) {
    if (typeof val === "number" && Number.isFinite(val))
        return val;
    return null;
}
function isURLLike(s) {
    return s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:");
}
function isEmpty(val) {
    if (val === undefined || val === null)
        return true;
    if (typeof val === "string")
        return val === "";
    if (Array.isArray(val))
        return val.length === 0;
    return false;
}
function inEnum(val, enumVals) {
    for (const e of enumVals) {
        if (equalLoose(val, e))
            return true;
    }
    return false;
}
function equalLoose(a, b) {
    // Numbers compared as JS numbers (already float64-equivalent);
    // strings/bools by ===.
    return a === b;
}
function parsePixelDims(s) {
    for (const sep of ["x", "X", "*", "×"]) {
        const idx = s.indexOf(sep);
        if (idx <= 0)
            continue;
        const w = parseInt(s.slice(0, idx).trim(), 10);
        const h = parseInt(s.slice(idx + sep.length).trim(), 10);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            return [w, h];
        }
    }
    return null;
}
//# sourceMappingURL=validate.js.map
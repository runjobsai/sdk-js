// Generic validator for the gateway's options schema. Mirrors
// /Users/zero/repos/sdk-go/validate.go — three-pass algorithm,
// same field/constraint vocabulary, same parse logic.

import type { Schema, FieldSchema, Constraint } from "./model_options.js";

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
export function validateRequest(
  schema: Schema | null | undefined,
  req: Record<string, unknown> = {},
): ValidationError[] {
  if (!schema) return [];
  const errors: ValidationError[] = [];

  // Pass 1+2: per-field.
  if (schema.inputs) {
    for (const [name, field] of Object.entries(schema.inputs)) {
      const set = name in req;
      const val = req[name];
      if (set && !isEmpty(val)) {
        errors.push(...validateFieldValue(name, field, val));
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

function validateFieldValue(
  name: string,
  field: FieldSchema,
  val: unknown,
): ValidationError[] {
  const errors: ValidationError[] = [];

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

  if (field.max_items !== undefined && Array.isArray(val) && val.length > field.max_items) {
    errors.push({
      field: name,
      reason: `at most ${field.max_items} items`,
    });
  }

  return errors;
}

function validatePresence(
  name: string,
  field: FieldSchema,
  val: unknown,
  set: boolean,
): ValidationError[] {
  const presence = field.presence ?? "optional";
  if (presence === "required" && (!set || isEmpty(val))) {
    return [{ field: name, reason: "required" }];
  }
  if (presence === "forbidden" && set && !isEmpty(val)) {
    return [{ field: name, reason: "must not be set for this model" }];
  }
  return [];
}

function validateConstraint(
  c: Constraint,
  req: Record<string, unknown>,
): ValidationError[] {
  switch (c.kind) {
    case "any_of_required": {
      const fields = c.fields ?? [];
      const anySet = fields.some((f) => f in req && !isEmpty(req[f]));
      if (anySet) return [];
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

    case "requires_all": {
      const whenName = c.when;
      if (!whenName) return [];
      const whenSet = whenName in req && !isEmpty(req[whenName]);
      if (!whenSet) return [];
      const missing = (c.then ?? []).filter(
        (f) => !(f in req) || isEmpty(req[f]),
      );
      if (missing.length === 0) return [];
      return [
        {
          field: missing.join("/"),
          reason: `required when ${whenName} is set`,
        },
      ];
    }

    case "pixel_bounds": {
      const fieldName = c.fields?.[0];
      if (!fieldName) return [];
      const raw = req[fieldName];
      if (typeof raw !== "string" || raw === "") return [];
      const dims = parsePixelDims(raw);
      if (!dims) {
        return [{ field: fieldName, reason: `expected WxH dimensions, got "${raw}"` }];
      }
      const [w, h] = dims;
      const px = w * h;
      const errs: ValidationError[] = [];
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

function typeMatches(typ: string, val: unknown): boolean {
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

function describeType(val: unknown): string {
  if (val === null) return "null";
  if (Array.isArray(val)) return "array";
  return typeof val;
}

function numberValue(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  return null;
}

function isURLLike(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:");
}

function isEmpty(val: unknown): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === "string") return val === "";
  if (Array.isArray(val)) return val.length === 0;
  return false;
}

function inEnum(val: unknown, enumVals: unknown[]): boolean {
  for (const e of enumVals) {
    if (equalLoose(val, e)) return true;
  }
  return false;
}

function equalLoose(a: unknown, b: unknown): boolean {
  // Numbers compared as JS numbers (already float64-equivalent);
  // strings/bools by ===.
  return a === b;
}

function parsePixelDims(s: string): [number, number] | null {
  for (const sep of ["x", "X", "*", "×"]) {
    const idx = s.indexOf(sep);
    if (idx <= 0) continue;
    const w = parseInt(s.slice(0, idx).trim(), 10);
    const h = parseInt(s.slice(idx + sep.length).trim(), 10);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return [w, h];
    }
  }
  return null;
}

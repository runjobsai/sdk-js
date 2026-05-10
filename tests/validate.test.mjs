// Tests for the options-schema validator. Mirrors sdk-go's
// validate_test.go — same constraint vocabulary, same per-pass
// behaviour. Imports from dist/ since the smoke tests do too;
// `npm run build` is run before `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateRequest } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));

// Helper: build a Schema literal in one line.
const newSchema = (inputs, ...constraints) => ({
  inputs,
  constraints,
});

// ─── Per-field validation ────────────────────────────────────────────

test("required field missing → error", () => {
  const s = newSchema({ prompt: { type: "string", presence: "required" } });
  const errs = validateRequest(s, {});
  assert.equal(errs.length, 1);
  assert.equal(errs[0].field, "prompt");
  assert.equal(errs[0].reason, "required");
});

test("required field present → no error", () => {
  const s = newSchema({ prompt: { type: "string", presence: "required" } });
  const errs = validateRequest(s, { prompt: "hi" });
  assert.equal(errs.length, 0);
});

test("required empty string → error", () => {
  const s = newSchema({ prompt: { type: "string", presence: "required" } });
  const errs = validateRequest(s, { prompt: "" });
  assert.ok(errs.some((e) => e.field === "prompt"));
});

test("forbidden field set → error", () => {
  const s = newSchema({ prompt: { type: "string", presence: "forbidden" } });
  const errs = validateRequest(s, { prompt: "x" });
  assert.ok(errs.some((e) => e.field === "prompt"));
});

test("forbidden field absent → no error", () => {
  const s = newSchema({ prompt: { type: "string", presence: "forbidden" } });
  const errs = validateRequest(s, {});
  assert.equal(errs.length, 0);
});

test("type matches", () => {
  const cases = [
    ["string", "x", false],
    ["string", 1, true],
    ["int", 5, false],
    ["int", "5", true],
    ["bool", true, false],
    ["bool", "true", true],
    ["url", "https://x.com", false],
    ["url", "data:image/png;base64,abc", false],
    ["url", "not a url", true],
    ["url[]", ["https://a", "https://b"], false],
    ["url[]", ["https://a", 5], true],
    ["file", "anything", false],
  ];
  for (const [typ, val, wantErr] of cases) {
    const s = newSchema({ x: { type: typ, presence: "optional" } });
    const errs = validateRequest(s, { x: val });
    const got = errs.some((e) => e.field === "x");
    assert.equal(got, wantErr, `type=${typ} val=${JSON.stringify(val)}`);
  }
});

test("numeric bounds", () => {
  const s = newSchema({ duration: { type: "int", min: 2, max: 20 } });
  for (const [val, wantErr] of [
    [1, true],
    [2, false],
    [10, false],
    [20, false],
    [21, true],
  ]) {
    const errs = validateRequest(s, { duration: val });
    assert.equal(
      errs.some((e) => e.field === "duration"),
      wantErr,
      `duration=${val}`,
    );
  }
});

test("enum", () => {
  const s = newSchema({
    aspect_ratio: { type: "string", enum: ["auto", "16:9", "9:16"] },
  });
  assert.equal(validateRequest(s, { aspect_ratio: "16:9" }).length, 0);
  const errs = validateRequest(s, { aspect_ratio: "21:9" });
  assert.ok(errs.some((e) => e.field === "aspect_ratio"));
});

test("max_items", () => {
  const s = newSchema({
    refs: { type: "url[]", max_items: 2 },
  });
  assert.equal(validateRequest(s, { refs: ["https://a", "https://b"] }).length, 0);
  const errs = validateRequest(s, {
    refs: ["https://a", "https://b", "https://c"],
  });
  assert.ok(errs.some((e) => e.field === "refs"));
});

// ─── Cross-field constraints ─────────────────────────────────────────

test("any_of_required — none set fails", () => {
  const s = newSchema(
    {
      prompt: { type: "string", presence: "optional" },
      source_image_url: { type: "url", presence: "optional" },
    },
    { kind: "any_of_required", fields: ["prompt", "source_image_url"] },
  );
  assert.notEqual(validateRequest(s, {}).length, 0);
});

test("any_of_required — one set passes", () => {
  const s = newSchema(
    {
      prompt: { type: "string", presence: "optional" },
      source_image_url: { type: "url", presence: "optional" },
    },
    { kind: "any_of_required", fields: ["prompt", "source_image_url"] },
  );
  assert.equal(validateRequest(s, { prompt: "hi" }).length, 0);
});

test("mutually_exclusive — both set fails", () => {
  const s = newSchema(
    {
      voice: { type: "string", presence: "optional" },
      reference_audio_url: { type: "url", presence: "optional" },
    },
    { kind: "mutually_exclusive", fields: ["voice", "reference_audio_url"] },
  );
  const errs = validateRequest(s, {
    voice: "alloy",
    reference_audio_url: "https://x/a.wav",
  });
  assert.notEqual(errs.length, 0);
});

test("group_mutex — within-group co-exists, across-group fails", () => {
  const s = newSchema(
    {
      first_frame_url: { type: "url", presence: "optional" },
      last_frame_url: { type: "url", presence: "optional" },
      reference_image_urls: { type: "url[]", presence: "optional" },
      reference_video_urls: { type: "url[]", presence: "optional" },
    },
    {
      kind: "group_mutex",
      groups: [
        ["first_frame_url", "last_frame_url"],
        ["reference_image_urls", "reference_video_urls"],
      ],
    },
  );
  // Empty request passes.
  assert.equal(validateRequest(s, {}).length, 0);
  // Within-group co-existence passes.
  assert.equal(
    validateRequest(s, {
      first_frame_url: "https://x/a.png",
      last_frame_url: "https://x/b.png",
    }).length,
    0,
  );
  assert.equal(
    validateRequest(s, {
      reference_image_urls: ["https://x/r.png"],
      reference_video_urls: ["https://x/r.mp4"],
    }).length,
    0,
  );
  // Across-group → fail.
  assert.notEqual(
    validateRequest(s, {
      first_frame_url: "https://x/a.png",
      reference_image_urls: ["https://x/r.png"],
    }).length,
    0,
  );
});

test("requires_all — when set without then fails", () => {
  const s = newSchema(
    {
      audio: { type: "bool", presence: "optional" },
      source_image_url: { type: "url", presence: "optional" },
    },
    { kind: "requires_all", when: "audio", then: ["source_image_url"] },
  );
  // Inactive constraint.
  assert.equal(validateRequest(s, {}).length, 0);
  // Active without then → fail.
  assert.notEqual(validateRequest(s, { audio: true }).length, 0);
  // Active with then → pass.
  assert.equal(
    validateRequest(s, { audio: true, source_image_url: "https://x" }).length,
    0,
  );
});

test("pixel_bounds", () => {
  const s = newSchema(
    { size: { type: "string", presence: "optional" } },
    {
      kind: "pixel_bounds",
      fields: ["size"],
      min: 1048576,
      max: 16777216,
    },
  );
  assert.equal(validateRequest(s, { size: "1024x1024" }).length, 0);
  assert.notEqual(validateRequest(s, { size: "100x100" }).length, 0); // below min
  assert.notEqual(validateRequest(s, { size: "8192x8192" }).length, 0); // above max
  assert.notEqual(validateRequest(s, { size: "not-a-size" }).length, 0); // parse fail
});

// ─── Integration: real LTX 2.3 schema (golden fixture) ───────────────

test("LTX 2.3 audio-to-video — golden fixture parity with sdk-go", () => {
  const fixturePath = join(
    here,
    "..",
    "..",
    "ai-gateway",
    "internal",
    "api",
    "options_schema",
    "testdata",
    "ltx_2_3_audio_to_video.json",
  );
  let raw;
  try {
    raw = readFileSync(fixturePath, "utf8");
  } catch {
    // Gateway repo not checked out — skip rather than fail. Same
    // behaviour as sdk-go's loadGoldenFixture.
    return;
  }
  const schema = JSON.parse(raw);

  // Empty request — audio missing + any_of_required fails.
  const errsEmpty = validateRequest(schema, {});
  assert.ok(errsEmpty.some((e) => e.field === "source_audio_url"));
  assert.ok(
    errsEmpty.some(
      (e) => e.field.includes("prompt") && e.field.includes("source_image_url"),
    ),
    `missing any_of error; got ${JSON.stringify(errsEmpty)}`,
  );

  // Audio + prompt → OK.
  assert.equal(
    validateRequest(schema, {
      source_audio_url: "https://x/audio.mp3",
      prompt: "a cat singing",
    }).length,
    0,
  );

  // Bad aspect ratio.
  const errsAspect = validateRequest(schema, {
    source_audio_url: "https://x/audio.mp3",
    prompt: "x",
    aspect_ratio: "21:9",
  });
  assert.ok(errsAspect.some((e) => e.field === "aspect_ratio"));

  // Out-of-range duration.
  const errsDur = validateRequest(schema, {
    source_audio_url: "https://x/audio.mp3",
    prompt: "x",
    duration: 1,
  });
  assert.ok(errsDur.some((e) => e.field === "duration"));
});

test("Wan animate-move — prompt forbidden", () => {
  const fixturePath = join(
    here,
    "..",
    "..",
    "ai-gateway",
    "internal",
    "api",
    "options_schema",
    "testdata",
    "wan_animate_move.json",
  );
  let raw;
  try {
    raw = readFileSync(fixturePath, "utf8");
  } catch {
    return;
  }
  const schema = JSON.parse(raw);

  const errs = validateRequest(schema, {
    prompt: "should not be set",
    source_image_url: "https://x/a.png",
    source_video_url: "https://x/v.mp4",
  });
  assert.ok(errs.some((e) => e.field === "prompt"));
});

test("schema=null is a no-op (caller without options)", () => {
  assert.equal(validateRequest(null, { anything: "goes" }).length, 0);
  assert.equal(validateRequest(undefined, {}).length, 0);
});

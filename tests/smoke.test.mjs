// Smoke test: verifies the SDK imports cleanly, the client constructs
// without making any network calls, and the public surface exports
// what the README documents.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RunJobs,
  APIError,
  userMessage,
  systemMessage,
  textPart,
  imagePart,
  supportsVoiceClone,
  supportsInstructText,
  defaultVoice,
} from "../dist/index.js";

test("RunJobs constructs with apiKey and exposes all services", () => {
  const client = new RunJobs({ apiKey: "gw-test" });
  assert.ok(client.chat, "chat service");
  assert.ok(client.models, "models service");
  assert.ok(client.image, "image service");
  assert.ok(client.audio, "audio service");
  assert.ok(client.video, "video service");
  assert.ok(client.computer, "computer service");
});

test("RunJobs throws when apiKey is missing", () => {
  assert.throws(() => new RunJobs({ apiKey: "" }), /apiKey is required/);
});

test("APIError carries statusCode and is instanceof Error", () => {
  const err = new APIError(429, "rate_limited", "slow down");
  assert.equal(err.statusCode, 429);
  assert.equal(err.type, "rate_limited");
  assert.match(err.message, /429/);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof APIError);
});

test("Message builders produce the right shapes", () => {
  assert.deepEqual(userMessage("hi"), { role: "user", content: "hi" });
  assert.deepEqual(systemMessage("be brief"), { role: "system", content: "be brief" });

  assert.deepEqual(textPart("hello"), { type: "text", text: "hello" });
  assert.deepEqual(imagePart("https://x/y.png"), {
    type: "image_url",
    image_url: { url: "https://x/y.png" },
  });
  assert.deepEqual(imagePart("https://x/y.png", "high"), {
    type: "image_url",
    image_url: { url: "https://x/y.png", detail: "high" },
  });
});

test("Model option helpers handle missing / typed fields", () => {
  const m = {
    id: "test",
    object: "model",
    capability: "tts",
    input_price_per_mtok: 0,
    output_price_per_mtok: 0,
    fixed_price: false,
    fixed_cost: 0,
    max_tokens: 0,
    max_input_tokens: 0,
    options: {
      supports_voice_clone: true,
      supports_instruct_text: 1, // numeric truthy
      default_voice: "nova",
    },
  };
  assert.equal(supportsVoiceClone(m), true);
  assert.equal(supportsInstructText(m), true);
  assert.equal(defaultVoice(m), "nova");

  const empty = { ...m, options: {} };
  assert.equal(supportsVoiceClone(empty), false);
  assert.equal(defaultVoice(empty), null);
});

test("Default base URL is https://api.runjobs.ai", () => {
  // Construct with a fake fetch that captures the URL — verifies baseURL plumbing.
  const seen = { url: "" };
  const fakeFetch = async (input, _init) => {
    seen.url = String(input);
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new RunJobs({ apiKey: "gw-test", fetch: fakeFetch });
  return client.models.list().then(() => {
    assert.match(seen.url, /^https:\/\/api\.runjobs\.ai\/v1\/models/);
  });
});

test("Custom baseURL overrides default", () => {
  const seen = { url: "" };
  const fakeFetch = async (input, _init) => {
    seen.url = String(input);
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new RunJobs({
    apiKey: "gw-test",
    baseURL: "http://localhost:8081/",
    fetch: fakeFetch,
  });
  return client.models.list().then(() => {
    assert.equal(seen.url, "http://localhost:8081/v1/models");
  });
});

test("APIError is thrown for non-2xx", async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ type: "rate_limited", message: "too many" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  const client = new RunJobs({ apiKey: "gw-test", fetch: fakeFetch });
  await assert.rejects(
    () => client.models.list(),
    (err) =>
      err instanceof APIError &&
      err.statusCode === 429 &&
      err.type === "rate_limited" &&
      err.message.includes("too many"),
  );
});

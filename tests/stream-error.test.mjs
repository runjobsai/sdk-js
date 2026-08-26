// The gateway reports mid-stream failures as an SSE error event
// (`data: {"error":{...}}`) followed by [DONE] — e.g. a model rejecting
// an unsupported temperature. Before the fix that event had no "choices",
// so it surfaced as an empty chunk and the stream just ended, leaving
// callers with a silent no-op instead of the upstream reason.
//
// Runs against the COMPILED dist/ build, like events.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RunJobs, APIError } from "../dist/index.js";

/** A fetch stub that replays `lines` as an SSE body. */
function sseFetch(lines) {
  return async () =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const l of lines) c.enqueue(new TextEncoder().encode(l));
          c.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
}

test("stream — SSE error event throws APIError instead of ending empty", async () => {
  const client = new RunJobs({
    apiKey: "gw-test",
    fetch: sseFetch([
      'data: {"error":{"code":400,"type":"upstream_error","message":"invalid temperature: only 1 is allowed for this model"}}\n\n',
      "data: [DONE]\n\n",
    ]),
  });

  await assert.rejects(
    async () => {
      for await (const _ of client.chat.stream({
        model: "Kimi K3",
        messages: [{ role: "user", content: "hi" }],
      })) {
        /* should throw before yielding anything */
      }
    },
    (e) => {
      assert.ok(e instanceof APIError, `expected APIError, got ${e?.name}`);
      assert.equal(e.statusCode, 400);
      assert.match(e.message, /only 1 is allowed/);
      return true;
    },
  );
});

test("stream — normal chunks still stream through untouched", async () => {
  const client = new RunJobs({
    apiKey: "gw-test",
    fetch: sseFetch([
      'data: {"choices":[{"index":0,"delta":{"content":"An"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":" API"}}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  });

  const out = [];
  for await (const chunk of client.chat.stream({
    model: "DeepSeek",
    messages: [{ role: "user", content: "hi" }],
  })) {
    out.push(chunk.choices?.[0]?.delta?.content ?? "");
  }
  assert.equal(out.join(""), "An API");
});

// Regression tests for the two properties that keep one bundle from
// reading another bundle's files.
//
// Background: the file API authenticates from the Authorization header
// but the URL used to carry no identity at all — every bundle built
// from the same template requested the very same
// `/v1/files/projects/index.json`.  The browser's HTTP cache does not
// key on request headers and is partitioned by registrable domain, so
// all `*.runjobs.dev` bundles share one partition.  One cacheable
// response was enough for app A to read app B's index and then persist
// it as its own.
//
// Two independent guards, one test each:
//   1. every request is issued with `cache: "no-store"`
//   2. a client with `project` set puts the project in the URL

import { test } from "node:test";
import assert from "node:assert/strict";

import { RunJobs } from "../dist/index.js";

/** Records (url, init) for each call and answers with an empty JSON body. */
function recordingFetch(calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

test("file requests are issued with cache: no-store", async () => {
  const calls = [];
  const client = new RunJobs({
    apiKey: "gw-test",
    baseURL: "https://example.test",
    fetch: recordingFetch(calls),
  });

  await client.files.list();
  await client.files.putString("projects/index.json", "{}");
  await client.files.del("projects/index.json");

  assert.equal(calls.length, 3);
  for (const { url, init } of calls) {
    assert.equal(init.cache, "no-store", `no-store missing for ${url}`);
  }
});

test("project-scoped client puts the project in the file URL", async () => {
  const calls = [];
  const client = new RunJobs({
    apiKey: "gw-test",
    baseURL: "https://example.test",
    project: "videomaker",
    fetch: recordingFetch(calls),
  });

  await client.files.list();
  await client.files.putString("projects/index.json", "{}");
  await client.files.move("a.txt", "b.txt");

  assert.deepEqual(
    calls.map((c) => c.url),
    [
      "https://example.test/v1/p/videomaker/files",
      "https://example.test/v1/p/videomaker/files/projects/index.json",
      "https://example.test/v1/p/videomaker/files/move",
    ],
  );
});

test("unscoped client keeps the legacy /v1/files URLs", async () => {
  // Bundles already published without `project` must keep working
  // against the same routes they shipped with.
  const calls = [];
  const client = new RunJobs({
    apiKey: "gw-test",
    baseURL: "https://example.test",
    fetch: recordingFetch(calls),
  });

  await client.files.list();
  await client.files.putString("projects/index.json", "{}");

  assert.deepEqual(
    calls.map((c) => c.url),
    [
      "https://example.test/v1/files",
      "https://example.test/v1/files/projects/index.json",
    ],
  );
});

test("two projects never produce the same file URL", async () => {
  // The property that actually prevents the cross-app read: identical
  // relative paths must not collapse to one cache key.
  const a = [];
  const b = [];
  const mk = (project, calls) =>
    new RunJobs({
      apiKey: "gw-test",
      baseURL: "https://example.test",
      project,
      fetch: recordingFetch(calls),
    });

  await mk("videomaker", a).files.list({ prefix: "projects/" });
  await mk("infinite-canvas", b).files.list({ prefix: "projects/" });

  assert.notEqual(a[0].url, b[0].url);
});

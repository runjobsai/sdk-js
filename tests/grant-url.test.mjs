// Verifies the URL the SDK redirects to during runjobs auth.  Owned
// by browser-auth.ts; covered here because the grant URL is the
// gateway's contract surface — a typo in a query-param name silently
// breaks every dev-time login flow.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BrowserAuth } from "../dist/index.js";

test("grant URL omits project_id when no project pinned", () => {
  const auth = new BrowserAuth({ origin: "https://www.runjobs.ai" });
  const url = auth._buildGrantUrlForTest({
    pageOrigin: "https://my-bundle.runjobs.ai",
    app: "my-bundle.runjobs.ai",
    redirectTo: "https://my-bundle.runjobs.ai/",
    scheme: "light",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://www.runjobs.ai");
  assert.equal(parsed.pathname, "/api/sdk/grant");
  assert.equal(parsed.searchParams.get("origin"), "https://my-bundle.runjobs.ai");
  assert.equal(parsed.searchParams.get("app"), "my-bundle.runjobs.ai");
  assert.equal(parsed.searchParams.get("redirect_to"), "https://my-bundle.runjobs.ai/");
  assert.equal(parsed.searchParams.get("scheme"), "light");
  assert.equal(parsed.searchParams.has("project_id"), false);
});

test("grant URL includes project_id when project pinned", () => {
  const auth = new BrowserAuth({
    origin: "https://www.runjobs.ai",
    project: "storyflow",
  });
  const url = auth._buildGrantUrlForTest({
    pageOrigin: "http://localhost:5173",
    app: "localhost:5173",
    redirectTo: "http://localhost:5173/",
    scheme: "dark",
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("project_id"), "storyflow");
  assert.equal(parsed.searchParams.get("origin"), "http://localhost:5173");
  assert.equal(parsed.searchParams.get("scheme"), "dark");
});

test("grant URL handles project ids with special chars (URL-encoded)", () => {
  const auth = new BrowserAuth({
    origin: "https://www.runjobs.ai",
    project: "team/proj name",
  });
  const url = auth._buildGrantUrlForTest({
    pageOrigin: "http://localhost:5173",
    app: "localhost:5173",
    redirectTo: "http://localhost:5173/?x=1",
    scheme: "light",
  });
  // The raw query string should encode the slash + space; decoding via
  // URLSearchParams should round-trip back to the original.
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("project_id"), "team/proj name");
  assert.equal(parsed.searchParams.get("redirect_to"), "http://localhost:5173/?x=1");
});

test("origin trailing slash is normalised away", () => {
  const auth = new BrowserAuth({ origin: "https://www.runjobs.ai/" });
  const url = auth._buildGrantUrlForTest({
    pageOrigin: "http://localhost:5173",
    app: "localhost:5173",
    redirectTo: "http://localhost:5173/",
    scheme: "light",
  });
  // No double-slash before /api.
  assert.match(url, /^https:\/\/www\.runjobs\.ai\/api\/sdk\/grant\?/);
});

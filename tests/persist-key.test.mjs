// Verifies per-project localStorage namespacing.  The SDK is meant to
// be safely embeddable on origins that host multiple bundles — most
// commonly `localhost:5173` during development, but also production
// origins that ship more than one SDK-using app.  Before namespacing,
// every BrowserAuth instance wrote to the same `__runjobs_auth_v1__`
// slot, so opening bundle A right after bundle B would either reuse
// B's wrongly-scoped token (gateway 404s on `files/...` calls) or
// force a fresh sign-in on every reload.
//
// The fix appends `:<project>` to the storage key when a project is
// pinned.  Iframe / parent-handshake bundles construct BrowserAuth
// without a project and keep the legacy unsuffixed key, which
// preserves back-compat for tokens persisted before this change.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BrowserAuth } from "../dist/index.js";

test("storage keys include the pinned project", () => {
  const auth = new BrowserAuth({
    origin: "https://www.runjobs.ai",
    project: "infinite-canvas",
  });
  const keys = auth._storageKeysForTest();
  assert.equal(keys.auth, "__runjobs_auth_v1__:infinite-canvas");
  assert.equal(keys.signedOut, "__runjobs_signed_out_v1__:infinite-canvas");
});

test("two bundles pinned to different projects get distinct keys", () => {
  const a = new BrowserAuth({
    origin: "https://www.runjobs.ai",
    project: "infinite-canvas",
  });
  const b = new BrowserAuth({
    origin: "https://www.runjobs.ai",
    project: "storyflow",
  });
  const ka = a._storageKeysForTest();
  const kb = b._storageKeysForTest();
  assert.notEqual(ka.auth, kb.auth);
  assert.notEqual(ka.signedOut, kb.signedOut);
});

test("no-project bundle keeps the legacy unsuffixed keys (back-compat)", () => {
  // iframe / parent-handshake mode constructs BrowserAuth without a
  // project — falling back to the v1 keys preserves any token already
  // persisted by pre-namespacing versions of the SDK.
  const auth = new BrowserAuth({ origin: "https://www.runjobs.ai" });
  const keys = auth._storageKeysForTest();
  assert.equal(keys.auth, "__runjobs_auth_v1__");
  assert.equal(keys.signedOut, "__runjobs_signed_out_v1__");
});

test("project id is used verbatim in the key (no encoding)", () => {
  // The grant-url path URL-encodes project ids with special chars;
  // localStorage keys are just strings and we deliberately don't
  // double-encode here.  Verifies the boundary so a future refactor
  // doesn't accidentally introduce encoding mismatches between the
  // two paths.
  const auth = new BrowserAuth({
    origin: "https://www.runjobs.ai",
    project: "team/proj name",
  });
  const keys = auth._storageKeysForTest();
  assert.equal(keys.auth, "__runjobs_auth_v1__:team/proj name");
});

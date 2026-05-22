// Test the typed event bus + activity tracker that feed the
// bottom-right badge's real-time activity ring. The SDK ships these
// as building blocks; runjobs.ai (and any embedder) reads
// `client.events` and `client.activitySnapshot()` to render
// the desktop-ball-style live indicator.
//
// We test against the COMPILED `dist/` build to mirror what users
// see — guards against type-only changes that silently broke the
// emitted output.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SDKEvents, ActivityTracker, newRequestId } from "../dist/index.js";

test("SDKEvents — handlers fire in order on emit", () => {
  const bus = new SDKEvents();
  const calls = [];
  bus.on("request:start", (e) => calls.push(["a", e.id]));
  bus.on("request:start", (e) => calls.push(["b", e.id]));
  bus.emit("request:start", {
    id: "x",
    model: "m",
    capability: "text",
    startedAt: 0,
    streaming: false,
  });
  assert.deepEqual(calls, [
    ["a", "x"],
    ["b", "x"],
  ]);
});

test("SDKEvents — disposer removes only its own handler", () => {
  const bus = new SDKEvents();
  const calls = [];
  const off1 = bus.on("request:end", () => calls.push("a"));
  bus.on("request:end", () => calls.push("b"));
  off1();
  bus.emit("request:end", {
    id: "x",
    model: "m",
    capability: "text",
    latencyMs: 1,
    totalTokens: 0,
  });
  assert.deepEqual(calls, ["b"]);
});

test("SDKEvents — a throwing handler doesn't break the others", () => {
  const bus = new SDKEvents();
  const calls = [];
  // Silence the console.error the bus emits to keep test output clean.
  const orig = console.error;
  console.error = () => {};
  bus.on("request:error", () => {
    throw new Error("boom");
  });
  bus.on("request:error", () => calls.push("ok"));
  bus.emit("request:error", {
    id: "x",
    model: "m",
    capability: "text",
    latencyMs: 1,
    error: new Error("upstream"),
  });
  console.error = orig;
  assert.deepEqual(calls, ["ok"]);
});

test("newRequestId — unique within 1000-id batch", () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(newRequestId());
  assert.equal(ids.size, 1000);
});

test("ActivityTracker — start moves call into active", () => {
  const bus = new SDKEvents();
  const tr = new ActivityTracker();
  tr.attach(bus);
  bus.emit("request:start", {
    id: "r1",
    model: "Gemini 3 Flash",
    capability: "text",
    startedAt: Date.now(),
    streaming: true,
  });
  const snap = tr.snapshot();
  assert.equal(snap.active.length, 1);
  assert.equal(snap.active[0].id, "r1");
  assert.equal(snap.active[0].streaming, true);
  assert.equal(snap.status, "active");
});

test("ActivityTracker — end moves call into recent + updates session", () => {
  const bus = new SDKEvents();
  const tr = new ActivityTracker();
  tr.attach(bus);
  const t0 = Date.now();
  bus.emit("request:start", {
    id: "r1",
    model: "Claude Haiku 4.5",
    capability: "text",
    startedAt: t0,
    streaming: false,
  });
  bus.emit("request:end", {
    id: "r1",
    model: "Claude Haiku 4.5",
    capability: "text",
    latencyMs: 1234,
    totalTokens: 50,
    costUSD: 0.0012,
    finishReason: "stop",
  });
  const snap = tr.snapshot();
  assert.equal(snap.active.length, 0, "active drained");
  assert.equal(snap.recent.length, 1);
  assert.equal(snap.recent[0].ok, true);
  assert.equal(snap.recent[0].latencyMs, 1234);
  assert.equal(snap.recent[0].costUSD, 0.0012);
  assert.equal(snap.session.totalCalls, 1);
  assert.ok(Math.abs(snap.session.totalCostUSD - 0.0012) < 1e-9);
  assert.equal(snap.session.errorCount, 0);
});

test("ActivityTracker — error flips status red and increments errorCount", () => {
  const bus = new SDKEvents();
  const tr = new ActivityTracker();
  tr.attach(bus);
  bus.emit("request:start", {
    id: "r1",
    model: "Claude",
    capability: "text",
    startedAt: Date.now(),
    streaming: false,
  });
  bus.emit("request:error", {
    id: "r1",
    model: "Claude",
    capability: "text",
    latencyMs: 50,
    error: new Error("400 invalid_request"),
    statusCode: 400,
  });
  const snap = tr.snapshot();
  assert.equal(snap.active.length, 0);
  assert.equal(snap.recent.length, 1);
  assert.equal(snap.recent[0].ok, false);
  assert.equal(snap.recent[0].errorMessage, "400 invalid_request");
  assert.equal(snap.session.errorCount, 1);
  // Recent error within 30s → status=error overrides idle.
  assert.equal(snap.status, "error");
});

test("ActivityTracker — streamDelta updates tokensPerSec via sliding window", async () => {
  const bus = new SDKEvents();
  const tr = new ActivityTracker();
  tr.attach(bus);
  bus.emit("request:start", {
    id: "s1",
    model: "Gemini 3 Flash",
    capability: "text",
    startedAt: Date.now(),
    streaming: true,
  });
  // Fire 3 deltas spaced ~50ms apart, each carrying 5 tokens.
  // Window should converge to ~50 tok/s.
  const fire = (totalTokens) =>
    bus.emit("request:streamDelta", {
      id: "s1",
      deltaTokens: 5,
      totalTokens,
    });
  fire(5);
  await new Promise((r) => setTimeout(r, 60));
  fire(10);
  await new Promise((r) => setTimeout(r, 60));
  fire(15);
  const snap = tr.snapshot();
  assert.equal(snap.active.length, 1);
  assert.equal(snap.active[0].tokensSoFar, 15);
  // 10 tokens over ~120ms = ~83 tok/s. Wide tolerance for CI flakiness.
  assert.ok(
    snap.active[0].tokensPerSec > 30 && snap.active[0].tokensPerSec < 200,
    `expected 30 < tokensPerSec < 200, got ${snap.active[0].tokensPerSec}`,
  );
});

test("ActivityTracker — recent is bounded to RECENT_MAX (20)", () => {
  const bus = new SDKEvents();
  const tr = new ActivityTracker();
  tr.attach(bus);
  for (let i = 0; i < 25; i++) {
    bus.emit("request:start", {
      id: `r${i}`,
      model: "m",
      capability: "text",
      startedAt: Date.now(),
      streaming: false,
    });
    bus.emit("request:end", {
      id: `r${i}`,
      model: "m",
      capability: "text",
      latencyMs: 10,
      totalTokens: 1,
    });
  }
  const snap = tr.snapshot();
  assert.equal(snap.recent.length, 20, "ring buffer caps at 20");
  // Newest first: r24 ... r5.
  assert.equal(snap.recent[0].id, "r24");
  assert.equal(snap.recent[19].id, "r5");
});

test("ActivityTracker — late streamDelta after end is silently dropped", () => {
  const bus = new SDKEvents();
  const tr = new ActivityTracker();
  tr.attach(bus);
  bus.emit("request:start", {
    id: "r1",
    model: "m",
    capability: "text",
    startedAt: Date.now(),
    streaming: true,
  });
  bus.emit("request:end", {
    id: "r1",
    model: "m",
    capability: "text",
    latencyMs: 50,
    totalTokens: 10,
  });
  // Should be a no-op, not a crash, not a resurrection.
  bus.emit("request:streamDelta", {
    id: "r1",
    deltaTokens: 1,
    totalTokens: 11,
  });
  const snap = tr.snapshot();
  assert.equal(snap.active.length, 0);
  assert.equal(snap.recent.length, 1);
});

# RunJobs SDK for JavaScript / TypeScript

JavaScript / TypeScript client for the [RunJobs AI Gateway](https://github.com/runjobsai/ai-gateway). Zero runtime dependencies — uses the platform's native `fetch`, `FormData`, and `ReadableStream` (Node 18+, browsers, Deno, Bun).

Covers every public endpoint the gateway exposes — chat, embeddings, image, audio (TTS + STT), video, computer use, the `/v1/files` per-project file system, the typed model-options schema, and the built-in runjobs.ai browser auth flow for client-side resource bundles.

## Install

```bash
npm install @runjobsai/sdk
# or: pnpm add @runjobsai/sdk  / yarn add @runjobsai/sdk
```

Or via CDN for `<script>`-tag use:

```html
<script src="https://cdn.jsdelivr.net/npm/@runjobsai/sdk/dist/sdk.umd.js"></script>
<script>
  const client = new RunJobs.Client({ authProvider: "runjobs" });
</script>
```

## Quick Start

```ts
import { RunJobs, APIError } from "@runjobsai/sdk";

const client = new RunJobs({ apiKey: "gw-your-api-key" });

try {
  const resp = await client.chat.create({
    model: "Claude Haiku 4.5",
    messages: [{ role: "user", content: "Hello!" }],
  });
  console.log(resp.choices[0].message.content);
  console.log(`Cost: $${resp.usage.total_cost.toFixed(6)}`);
} catch (e) {
  if (e instanceof APIError) console.error(`API ${e.statusCode}: ${e.message}`);
  else throw e;
}
```

Default base URL is `https://api.runjobs.ai`. Override with `new RunJobs({ apiKey, baseURL: "…" })` for self-hosted gateways.

## Authentication

| Mode | Use for | How |
|------|---------|-----|
| **Static** (default) | Server / CLI | `new RunJobs({ apiKey: "gw-…" })` or `apiKeyResolver: async () => "…"` |
| **runjobs.ai browser auth** | Client-side bundles | `new RunJobs({ authProvider: "runjobs" })` |

API key prefixes: `gw-…` (user-level), `rj_…` (workspace agent), `rrt_…` (project-bound resource token, required for `client.files.*`).

### Browser auth (`authProvider: "runjobs"`)

For resource bundles embedded into runjobs.ai or shipped as standalone web apps. The SDK handles the redirect-grant handshake with `https://www.runjobs.ai/api/sdk/grant`, parses the returned `#runjobs_token=…` fragment, persists the token in `localStorage`, and silently refreshes on expiry.

```ts
const client = new RunJobs({
  authProvider: "runjobs",
  project: "proj_abc",          // optional — pin to a specific project
  showIdentityBadge: true,      // floating bottom-right pill; default false
});

await client.chat.create({ ... });   // redirects to grant on first call

// Manual control:
client.signIn();                     // force redirect to grant page
client.signOut();                    // clear cache + mark signed-out (sticky)
client.user;                         // { id, name } | null
client.auth?.onTokenChange(t => {}); // subscribe to (re)acquisition
client.auth?.hasFreshToken();        // bool — avoids unnecessary "sign in" UI
```

**`project`** — pin the grant to a project regardless of where the bundle is served from. Required for `client.files.*` on origins not registered as `(origin, app)` pairs (e.g. `localhost:5173` during dev).

**Iframe mode** — when embedded under the runjobs dashboard, the SDK first attempts a silent `postMessage` handshake with the parent before falling back to redirect-grant.

In Node / non-window environments, the `runjobs` provider is a no-op — fall back to `apiKey` / `apiKeyResolver`.

## Services

### `client.models`

```ts
const all = await client.models.list();
const videoModels = await client.models.list({ capability: "video_generation" });
```

Pricing is in **pips per million tokens** (1 USD = 1,000,000 pips). Multiply by `tokens / 1e6` for pip cost, or `tokens / 1e12` for USD.

```ts
import { hasCapabilityTag } from "@runjobsai/sdk";

for (const m of videoModels) {
  const ids = (m.capability_tags ?? []).map(t => t.id).join(",");
  console.log(`${m.id} [${ids}] in=${m.input_price_per_mtok} out=${m.output_price_per_mtok}`);
  if (hasCapabilityTag(m, "first_last_frame")) { /* show keyframe uploader */ }
}
```

**Capability tag vocabulary** — stable IDs, safe to filter on:

| Capability         | Tag IDs |
|--------------------|---------|
| `video_generation` | `t2v`, `i2v`, `v2v`, `a2v`, `first_last_frame`, `reference`, `motion_transfer`, `audio_track` |
| `image_generation` | `t2i`, `i2i`, `inpaint` |
| `text_to_speech`   | `tts`, `voice_clone`, `instruct`, `emotion`, `voice_catalog` |
| `speech_to_text`   | `stt`, `timestamps` |
| `embedding`        | `embedding` |
| `text` / `vision`  | `chat`, `vision` |
| `computer_use`     | `computer_use` |

`Tag.label` is English-only; localise on your side. Always filter on `Tag.id`.

### Options schema — per-model field contract

`getOptionsSchema(model)` returns the typed view of the model's input contract: which fields are accepted, their bounds / enums / defaults, cross-field constraints (XOR groups, requires-all, pixel bounds), plus a `catalog` of rich content (voices, emotions) an enum alone can't express.

```ts
import {
  getOptionsSchema, acceptsField, requiresField, allowedValuesFor, validateRequest,
} from "@runjobsai/sdk";

const list = await client.models.list({ capability: "text_to_speech" });
const cosy = list.find(m => m.id === "CosyVoice")!;
const schema = getOptionsSchema(cosy);                   // Schema | null

acceptsField(cosy, "reference_audio_url");               // boolean
requiresField(cosy, "source_audio_url");                 // boolean — red-star this?
allowedValuesFor(cosy, "emotion");                       // unknown[] | null

for (const v of schema?.catalog?.voices ?? []) {
  console.log(v.id, v.name, v.gender, v.language, v.preview_url);
}
console.log(schema?.catalog?.emotions);
console.log(cosy.available_voices);                      // top-level convenience: voice IDs only
```

**Pre-flight validation** — returns a flat list of errors so the UI can surface them all at once:

```ts
const errs = validateRequest(schema, {
  input: "Hello",
  voice: "alloy",
  reference_audio_url: "https://x/sample.wav",           // mutex violation
});
for (const e of errs) console.log(`${e.field}: ${e.reason}`);
```

Constraint kinds: `any_of_required`, `mutually_exclusive`, `group_mutex` (block-level XOR — e.g. keyframe block XOR reference block), `requires_all`, `pixel_bounds`. Unknown kinds are skipped (forward-compatible).

### `client.chat`

OpenAI-compatible. Streaming + non-streaming.

```ts
const resp = await client.chat.create({
  model: "Claude Sonnet 4.6",
  messages: [{ role: "user", content: "Explain async iterators in one sentence." }],
});
console.log(resp.choices[0].message.content);
console.log(`Cost: $${resp.usage.total_cost.toFixed(6)}`);
```

**Streaming** — async iterator. The final chunk carries `usage` (forced on via `stream_options.include_usage`):

```ts
let cost = 0;
for await (const chunk of client.chat.stream({
  model: "Gemini 3 Flash",
  messages: [{ role: "user", content: "Count 1 to 5" }],
})) {
  for (const c of chunk.choices) process.stdout.write(c.delta.content ?? "");
  if (chunk.usage) cost = chunk.usage.total_cost;
}
```

**Multi-modal**:

```ts
import { userMessageParts, textPart, imagePart } from "@runjobsai/sdk";

await client.chat.create({
  model: "Claude Sonnet 4.6",
  messages: [
    userMessageParts(
      textPart("What's in this image?"),
      imagePart("https://example.com/photo.jpg", "high"),
    ),
  ],
});
```

`ContentPart` supports `{ type: "text" | "image_url" | "video_url" | "audio_url" }`. Unsupported variants are rejected server-side with a clear error.

**Tool calling** — populate `tools: [{ type: "function", function: { name, description, parameters } }]`, read `choices[0].message.tool_calls`, return `toolResultMessage(toolCallId, jsonOutput)` on the next turn.

Builders re-exported from the top level: `userMessage`, `systemMessage`, `assistantMessage`, `toolResultMessage`, `userMessageParts`, `textPart`, `imagePart`.

### `client.embeddings`

OpenAI-compatible `/v1/embeddings`. Single string or batch.

```ts
const r = await client.embeddings.create("text-embedding-3-small", {
  input: ["alpha", "beta"],                    // string | string[]
  dimensions: 1536,                            // text-embedding-3-* only
});
for (const e of r.data) console.log(e.index, (e.embedding as number[]).slice(0, 4));
console.log(`Cost: $${r.usage.total_cost.toFixed(6)}`);
```

`encoding_format: "base64"` returns vectors as a packed base64 string instead of a number array — ~3× smaller on the wire for high-D embeddings.

### `client.image`

```ts
const img = await client.image.generate("MiniMax Image-01", {
  prompt: "a developer at a laptop, anime style",
  size: "1024x1024",
  n: 1,
  reference_image_urls: ["https://..."],
});

// img.data[i].url is either a "data:image/png;base64,..." inline URI (sync)
// or a "https://api.runjobs.ai/v1/blobs/<id>" hosted blob (async). Drop it
// straight into <img src=…>; for raw bytes:
import { decodeMediaUrl } from "@runjobsai/sdk";
const { bytes, contentType } = await decodeMediaUrl(img.data[0].url);

// Edit (multipart).
import { readFile } from "node:fs/promises";
const photoBytes = await readFile("photo.png");
await client.image.edit("GPT Image", {
  image: { data: photoBytes, filename: "photo.png" },
  // mask: { data: ..., filename: "mask.png" },     // optional alpha mask
  prompt: "add a party hat",
});
```

**Async** — `client.image.generateAsync()` for requests that may exceed the ~100 s origin timeout (large Seedream batches, slow upstreams). Returns the same `ImageResponse` shape.

**Resumable async** — when you need to PERSIST the job id (cross page-reload, separate worker process):

```ts
const job = await client.image.submitGenerate("Seedream 5", { prompt: "..." });
// Persist job.id somewhere...

// Later, poll yourself:
const status = await client.image.getAsyncStatus(jobId);
// status.status: "queued" | "running" | "succeeded" | "failed"
// status.data[] populated when succeeded
```

`ImageResult.attribution` is a credit string that stock-library providers (Pexels) require you to render verbatim alongside the image.

### `client.audio` — TTS + STT

```ts
// Basic TTS.
import { writeFile } from "node:fs/promises";
const speech = await client.audio.speech("OpenAI/TTS", {
  input: "Hello from the gateway",
  voice: "nova",
});
await writeFile("output.mp3", speech.data);

// Full surface — provider-dependent.
await client.audio.speech("MiniMax Speech 2.6 HD", {
  input: "I'm so happy to see you!",
  voice: "English_radiant_girl",
  speed: 1.1,
  pitch: 0,           // -12..12 semitones
  volume: 1.0,        // 0.1..10
  timber: 0,          // -12..12
  emotion: "happy",
  // Zero-shot voice clone — overrides `voice`. Voiceclone-capable models only.
  // reference_audio_url: "https://.../sample.wav",
  // reference_text: "what's said in the sample",
  // CosyVoice free-form directive — overrides emotion/speed/volume hints.
  // instruct_text: "用四川话快速地说",
});

// Vendor-specific knobs (ACE-Step music).
const song = await client.audio.speechAsync("ACE-Step", {
  input: "[verse]\nUnder the stars tonight",
  extra: { tags: "indie rock, melancholic", duration: 60 },
});
await writeFile("song.wav", song.data);
```

Use `speechAsync()` whenever generation may exceed the ~100 s sync ceiling. Same `SpeechResponse` shape — submit + poll happens internally; bound the wait via `signal`.

**Speech-to-text** — multipart upload:

```ts
const audioBytes = await readFile("recording.mp3");
const t = await client.audio.transcribe("OpenAI/Whisper", {
  file: { data: audioBytes, filename: "recording.mp3" },
  language: "en",                                                  // optional ISO hint
});
console.log(t.text);

// Long audio — use transcribeAsync; verbose_json + timestamps land in t.raw.
const long = await client.audio.transcribeAsync("OpenAI/Whisper", {
  file: { data: podcastBytes, filename: "podcast-2h.mp3" },
  response_format: "verbose_json",
  timestamp_granularities: ["segment"],                            // or ["word"]
});
```

Voice catalogs + supported emotions live on the model's `getOptionsSchema(m).catalog`. The legacy `audio.listVoices()` endpoint was removed.

### `client.video` — async only

```ts
const task = await client.video.generate("MiniMax Hailuo 2.3", {
  prompt: "a gentle ocean wave",
  duration: 5,
});

const status = await client.video.wait(task.id, { pollIntervalMs: 5000 });
// or: const status = await client.video.getStatus(task.id) — single poll

if (status.status === "succeeded") {
  const { data, contentType } = await client.video.getContent(task.id);
}
```

`VideoGenerateParams` covers every gateway field — `aspect_ratio`, `duration` / `frames`, `resolution`, `generate_audio`, `first_frame_url` / `last_frame_url` (keyframes), `reference_image_urls` / `reference_video_urls` / `reference_audio_urls` (Seedance 2.0 multi-input), `source_video_url` / `source_image_url` / `source_audio_url` (single-input drivers for video-edit, motion-transfer, lip-sync), `watermark`, `camera_fixed`, `return_last_frame`, `seed`, `draft` + `draft_task_id` (Seedance 1.5 pro draft mode), `service_tier` (`"flex"` = offline, ~50 % price), `execution_expires_after`, `callback_url`, `user`. Boolean fields are tri-state — omit for upstream default, explicit `false` to force off.

All `*_url` fields accept hosted `https://` URLs or `data:` URIs — use `encodeImageUrl(rawBytes)` to wrap local bytes; the gateway materialises data URIs as short-lived blobs before forwarding upstream.

### `client.computer` — AI GUI control

One step of a computer-use agent loop. Given conversation history (including screenshots and tool results), returns the next action(s) the model wants the caller to execute.

```ts
const step = await client.computer.step("AI Control", {
  messages: [{ role: "user", content: "Open the browser and go to example.com" }],
  display_width: 1920,
  display_height: 1080,
  // enable_zoom: true,
  // previous_response_id: "...",   // OpenAI Responses state chain
  // openai_input: {...},           // follow-up computer_call_output
});

for (const block of step.content) {
  switch (block.type) {
    case "text":          console.log(block.text); break;
    case "tool_use":      console.log(block.name, block.input); break;     // Anthropic
    case "computer_call": console.log(block.call_id, block.action); break; // OpenAI
  }
}
```

The `messages` shape is intentionally opaque — both Anthropic and OpenAI computer-use protocols round-trip through it. `step.protocol` tells you which one the upstream returned.

### `client.files` — per-project file system

Backed by `/v1/files/*`. Files are stored under `(user, project)` on the gateway and addressed by POSIX-style paths. Every `FileObject.url` is a stable, **public** address — embed it in `<img>`, share it, persist it.

Requires an `rrt_*` project-bound token. In browser-auth mode, set `project` on the client (see Authentication above).

```ts
// Upload — BodyInit (Blob, File, ArrayBuffer, Uint8Array, ReadableStream, string).
const obj = await client.files.put("assets/logo.png", pngBlob, {
  contentType: "image/png",
  ifNoneMatch: true,                  // refuse to overwrite (409 on collision)
});
console.log(obj.url);

// Strings.
await client.files.putString("notes.md", "# hello");

// Server-side ingest — gateway fetches src and stores it (saves a round trip).
await client.files.putFromURL("cache/cat.jpg", "https://example.com/cat.jpg");

// Read.
const blob = await client.files.get("assets/logo.png");           // returns Blob
const url = URL.createObjectURL(blob);                            // temp local URL

// Metadata only (HEAD).
const meta = await client.files.stat("assets/logo.png");
console.log(meta.size, meta.etag, meta.last_modified);

await client.files.exists("assets/logo.png");                     // boolean

// List — pagination + optional shell-glob filter.
const page = await client.files.list({
  prefix: "assets/",                  // optional namespace
  glob: "**/*.png",                   // *, **, ?, [abc]
  limit: 100,
  cursor: undefined,                  // page.next_cursor for the next page
});

// Mutate.
await client.files.move("draft.md", "published.md");
await client.files.copy("template.md", "instances/2026-05-16.md");
await client.files.del("old.log");                                // idempotent

// Bulk delete by prefix / glob (at least one required).
await client.files.deleteMany({ prefix: "tmp/" });                // wipe "directory"
await client.files.deleteMany({ glob: "**/*.tmp" });              // wipe by pattern
await client.files.deleteMany({ prefix: "logs/", glob: "*.bak" });

// Pipeline several ops in one round trip. Operations execute in submission
// order; one op failing does NOT abort the rest — inspect each result.ok.
// Auto-chunks long arrays into 30-op requests (gateway caps at 64).
const results = await client.files.batch([
  { op: "put_url", path: "a.jpg", src_url: "https://example.com/a.jpg" },
  { op: "copy",    from: "a.jpg", to: "b.jpg" },
  { op: "exists",  path: "b.jpg" },
  { op: "stat",    path: "b.jpg" },
  { op: "del",     path: "a.jpg" },
]);
```

`glob` patterns are matched after the underlying S3 prefix scan. The gateway folds the literal head of the pattern into the prefix automatically. Patterns match the WHOLE path; no implicit anchoring.

## Helpers

**`encodeImageUrl(bytes: Uint8Array | ArrayBuffer)`** — wrap raw bytes as `data:<mime>;base64,…` for any `*_url` field that accepts data URIs (`first_frame_url`, `last_frame_url`, `reference_image_urls`, `source_image_url`, …). MIME is sniffed.

**`decodeMediaUrl(url)`** — inverse: resolves the `data:` URI or hosted `https://` URL into `{ bytes: Uint8Array, contentType: string }`. Used on every image / audio result.

## Cancellation

Every method accepts an optional `{ signal }` for `AbortController` cancellation:

```ts
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 5000);

await client.chat.create({ model: "...", messages: [...] }, { signal: ctrl.signal });
```

`speechAsync` / `transcribeAsync` / `video.wait` also accept `{ pollIntervalMs }`.

## Error Handling

All gateway errors surface as `APIError`:

```ts
import { APIError } from "@runjobsai/sdk";

try {
  await client.chat.create({ ... });
} catch (e) {
  if (e instanceof APIError) console.error(e.statusCode, e.type, e.message);
  else throw e;                       // network errors propagate as fetch TypeError
}
```

Browser-auth mode automatically retries once on `401` (with the cached token invalidated, triggering a fresh sign-in flow). Network errors propagate as the underlying `fetch` rejection.

## API Reference

### Services

| Service             | Methods | Description |
|---------------------|---------|-------------|
| `client.chat`       | `create`, `stream` | OpenAI-compatible chat completions |
| `client.models`     | `list` | Model catalog + pricing + capability tags + options schema |
| `client.embeddings` | `create` | OpenAI-compatible `/v1/embeddings` |
| `client.image`      | `generate`, `edit`, `generateAsync`, `submitGenerate`, `getAsyncStatus` | Image generation + editing. Async variants for >100 s jobs; resumable polling for cross-session jobs |
| `client.audio`      | `speech`, `speechAsync`, `transcribe`, `transcribeAsync` | TTS + STT. Async variants for long music / multi-hour audio |
| `client.video`      | `generate`, `getStatus`, `wait`, `getContent` | Async video generation |
| `client.computer`   | `step` | AI GUI control loop (Anthropic + OpenAI protocols) |
| `client.files`      | `put`, `putString`, `putFromURL`, `get`, `stat`, `exists`, `del`, `list`, `deleteMany`, `move`, `copy`, `batch` | Per-project file system at `/v1/files/*` |

### Browser auth

| Member | Description |
|--------|-------------|
| `client.signIn()` | Force a redirect to the runjobs.ai grant page |
| `client.signOut()` | Clear cached token + identity (sticky across reloads) |
| `client.user` | `{ id, name } \| null` — currently signed-in user |
| `client.auth` | The underlying `BrowserAuth` (advanced: `onTokenChange`, `hasFreshToken`, `invalidate`) |

### Tree-shakeable helpers

| Helper | Returns | Use |
|--------|---------|-----|
| `hasCapabilityTag(model, id)` | `boolean` | Filter by stable capability tag |
| `model.capability_tags` | `Tag[]` | Iterate `{id, label}` for display chips |
| `getOptionsSchema(model)` | `Schema \| null` | Typed view of the model's input contract |
| `acceptsField(model, name)` | `boolean` | Does the model accept this field? |
| `requiresField(model, name)` | `boolean` | Is this field required? |
| `allowedValuesFor(model, name)` | `unknown[] \| null` | Discrete enum, or null |
| `model.available_voices` | `string[]` | TTS voice IDs (top-level convenience) |
| `supportsVoiceClone(model)` | `boolean` | Accepts `reference_audio_url` as the voice? |
| `supportsInstructText(model)` | `boolean` | Accepts `instruct_text` directive? |
| `defaultVoice(model)` | `string \| null` | Admin-configured default voice |
| `validateRequest(schema, req)` | `ValidationError[]` | Pre-flight validate a request body |
| `encodeImageUrl(bytes)` | `string` | Wrap raw bytes as a `data:` URI |
| `decodeMediaUrl(url)` | `{ bytes, contentType }` | Resolve a `data:` URI or hosted URL into bytes |

## Compatibility

- **Node**: 18+ (uses built-in `fetch`).
- **Browsers**: any modern browser. For static auth, proxy through your own backend — don't ship `gw-…` keys to clients. For runjobs.ai-issued bundles, use `authProvider: "runjobs"`.
- **Deno / Bun**: works out of the box.

## License

MIT

# RunJobs SDK for JavaScript / TypeScript

JavaScript / TypeScript client for the [RunJobs AI Gateway](https://github.com/runjobsai/ai-gateway). Zero runtime dependencies — uses the platform's native `fetch`, `FormData`, and `ReadableStream` (Node 18+, browsers, Deno, Bun).

## Install

```bash
npm install @runjobsai/sdk
# or
pnpm add @runjobsai/sdk
# or
yarn add @runjobsai/sdk
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
  if (e instanceof APIError) {
    console.error(`API ${e.statusCode}: ${e.message}`);
  } else {
    throw e;
  }
}
```

The default base URL is `https://api.runjobs.ai`. Override with `new RunJobs({ apiKey, baseURL: "..." })` when pointing at a self-hosted gateway.

## Services

### Models

List available models with pricing, capability tags, and the
structured input schema.

```ts
const all = await client.models.list();

// Filter server-side by capability
const videoModels = await client.models.list({ capability: "video_generation" });

for (const m of videoModels) {
  // capability_tags is the auto-derived "what this model can actually
  // do" array — much more informative than the broad capability bucket.
  const ids = (m.capability_tags ?? []).map(t => t.id).join(",");
  console.log(`${m.id.padEnd(30)} [${ids}]  in=${m.input_price_per_mtok} out=${m.output_price_per_mtok} pips/MTok`);
  // → "Seedance 2.0  [t2v,first_last_frame,reference,audio_track]  in=0 out=0 pips/MTok"
}

// hasCapabilityTag for quick filter checks (use stable IDs, not labels):
import { hasCapabilityTag } from "@runjobsai/sdk";
for (const m of videoModels) {
  if (hasCapabilityTag(m, "first_last_frame")) {
    console.log(m.id, "supports first/last keyframe input");
  }
}
```

Tag vocabulary (per capability):

| Capability         | Stable IDs |
|--------------------|------------|
| `video_generation` | `t2v`, `i2v`, `v2v`, `a2v`, `first_last_frame`, `reference`, `motion_transfer`, `audio_track` |
| `image_generation` | `t2i`, `i2i`, `inpaint` |
| `text_to_speech`   | `tts`, `voice_clone`, `instruct`, `emotion`, `voice_catalog` |
| `speech_to_text`   | `stt`, `timestamps` |
| `embedding`        | `embedding` |
| `text` / `vision`  | `chat`, `vision` |
| `computer_use`     | `computer_use` |

The `Tag.label` field is a human-readable English string
(`"Image-to-Video"`, `"First/Last Frame"`, …) — translate / re-style on
your side. **Filter on `Tag.id`**; labels can shift between gateway
versions.

### Model Capabilities & Validation (Options Schema)

Each model row carries a typed `Schema` describing exactly which
request fields it accepts, with bounds, enums, defaults, roles, and
cross-field constraints. Use it to build dynamic UIs and to validate
request bodies *before* shipping them to the gateway.

```ts
import {
  getOptionsSchema, acceptsField, requiresField, allowedValuesFor,
  validateRequest,
} from "@runjobsai/sdk";

const list = await client.models.list({ capability: "text_to_speech" });
const cosy = list.find(m => m.id === "CosyVoice")!;

const schema = getOptionsSchema(cosy); // typed Schema | null

// Quick presence checks — handy for "should I render this UI chip" decisions.
if (acceptsField(cosy, "reference_audio_url")) { /* show voice-clone uploader */ }
if (requiresField(cosy, "source_audio_url"))   { /* mark this field with a red star */ }
const allowed = allowedValuesFor(cosy, "emotion"); // unknown[] | null

// Voice catalog (id + name + gender + language + preview_url, ...) lives
// on the schema — not on the legacy options bag.
if (schema?.catalog) {
  for (const v of schema.catalog.voices ?? []) {
    console.log(`${v.id}  ${v.name}  ${v.gender}  ${v.language}`);
  }
  console.log("Emotions:", schema.catalog.emotions);
}

// Or if you only need the IDs (no metadata), the gateway also exposes
// them as a top-level convenience field.
console.log("Voice IDs:", cosy.available_voices);

// Pre-flight validate a request body before sending — catches missing
// required fields, out-of-range numbers, mutually-exclusive combos,
// pixel-bounds violations, etc.
const errs = validateRequest(schema, {
  input: "Hello",
  voice: "alloy",
  reference_audio_url: "https://x/sample.wav", // mutex violation: voice XOR reference
});
for (const e of errs) console.log(`  ${e.field}: ${e.reason}`);
// → "voice/reference_audio_url: at most one of voice, reference_audio_url may be set"
```

Constraint vocabulary the validator understands: `any_of_required`,
`mutually_exclusive`, `group_mutex` (block-level XOR — e.g.
Seedance/Veo "keyframe block XOR reference block"), `requires_all`
(when X is set, Y must also be set — e.g. `last_frame_url` requires
`first_frame_url`), `pixel_bounds`. Unknown constraint kinds are
silently skipped (forward-compat with newer gateway versions).

### Chat

Both streaming and non-streaming use the OpenAI-compatible format.

```ts
// Non-streaming
const resp = await client.chat.create({
  model: "Claude Sonnet 4.6",
  messages: [{ role: "user", content: "Explain async iterators in one sentence." }],
});
console.log(resp.choices[0].message.content);
console.log(`Cost: $${resp.usage.total_cost.toFixed(6)}`);

// Streaming
let cost = 0;
for await (const chunk of client.chat.stream({
  model: "Gemini 3 Flash",
  messages: [{ role: "user", content: "Count 1 to 5" }],
})) {
  for (const c of chunk.choices) process.stdout.write(c.delta.content ?? "");
  if (chunk.usage) cost = chunk.usage.total_cost;
}
console.log(`\nCost: $${cost.toFixed(6)}`);
```

Multi-modal messages and tool calling work the same as OpenAI's API:

```ts
import { userMessageParts, textPart, imagePart } from "@runjobsai/sdk";

const resp = await client.chat.create({
  model: "Claude Sonnet 4.6",
  messages: [
    userMessageParts(
      textPart("What's in this image?"),
      imagePart("https://example.com/photo.jpg", "high"),
    ),
  ],
});
```

### Image Generation & Editing

```ts
// Generate
const img = await client.image.generate("MiniMax Image-01", {
  prompt: "a developer at a laptop, anime style",
  size: "1024x1024",
});
// img.data[0].url is either "data:image/png;base64,..." (sync) or
// "https://api.runjobs.ai/v1/blobs/<id>" (async). Either way, drop it
// straight into <img src=…>; for raw bytes, decodeMediaUrl handles
// both shapes uniformly.
import { decodeMediaUrl } from "@runjobsai/sdk";
const { bytes, contentType } = await decodeMediaUrl(img.data[0].url);
console.log(`Got ${bytes.length} bytes (${contentType}), cost $${img.usage.total_cost.toFixed(6)}`);

// Edit (multipart)
import { readFile } from "node:fs/promises";

const photoBytes = await readFile("photo.png");
const edited = await client.image.edit("GPT Image", {
  image: { data: photoBytes, filename: "photo.png" },
  prompt: "add a party hat",
});
```

`image.generate` and `image.edit` hit the gateway's synchronous OpenAI-compatible endpoints (`POST /v1/images/generations`, `POST /v1/images/edits`). For requests expected to run longer than ~100 seconds — large Seedream batches, slow upstream queues — use `image.generateAsync` instead. The async variant submits the job, polls the gateway for completion, and downloads the result blobs. It returns the same `ImageResponse` shape but avoids Cloudflare's origin timeout (which otherwise replaces the real upstream error with `error code: 502`).

### Text-to-Speech & Speech-to-Text

```ts
// Voice catalog (id + name + gender + language + preview_url + …)
// lives on the model's options Schema — see "Model Capabilities &
// Validation" above for the full pattern. Quick lookup:
import { getOptionsSchema } from "@runjobsai/sdk";

const list = await client.models.list({ capability: "text_to_speech" });
const minimax = list.find(m => m.id === "MiniMax Speech 2.6 HD")!;
const schema = getOptionsSchema(minimax);
for (const v of schema?.catalog?.voices ?? []) {
  console.log(`${v.id}  ${v.name}  ${v.gender ?? ""}  ${v.language ?? ""}`);
}
console.log("Emotions:", schema?.catalog?.emotions);
// → ["happy","sad","angry","fearful","disgusted","surprised","calm","whisper"]

// TTS (basic)
import { writeFile } from "node:fs/promises";

const speech = await client.audio.speech("OpenAI/TTS", {
  input: "Hello from the gateway",
  voice: "nova",
});
await writeFile("output.mp3", speech.data);
console.log(`Cost: $${speech.usage.total_cost.toFixed(6)}`);

// TTS with emotion / speed (provider-dependent)
await client.audio.speech("MiniMax Speech 2.6 HD", {
  input: "I'm so happy to see you!",
  voice: "English_radiant_girl",
  speed: 1.1,
  emotion: "happy",
});

// STT
import { readFile } from "node:fs/promises";
const audioBytes = await readFile("recording.mp3");
const transcript = await client.audio.transcribe("OpenAI/Whisper", {
  file: { data: audioBytes, filename: "recording.mp3" },
});
console.log(transcript.text);
console.log(`Cost: $${transcript.usage.total_cost.toFixed(6)}`);
```

### Video Generation (Async)

```ts
// Submit
const task = await client.video.generate("MiniMax Hailuo 2.3", {
  prompt: "a gentle ocean wave",
  duration: 5,
});
console.log(`Task: ${task.id}  Cost: $${task.usage.total_cost.toFixed(6)}`);

// Wait (default poll interval 5s)
const status = await client.video.wait(task.id);

// Download
if (status.status === "succeeded") {
  const { data, contentType } = await client.video.getContent(task.id);
  console.log(`${contentType}, ${data.length} bytes`);
}
```

### Computer Use (AI GUI Control)

```ts
const step = await client.computer.step("AI Control", {
  messages: [
    {
      role: "user",
      content: "Open the browser and go to example.com",
    },
  ],
  display_width: 1920,
  display_height: 1080,
});

for (const block of step.content) {
  switch (block.type) {
    case "text":
      console.log("Text:", block.text);
      break;
    case "tool_use":
      console.log(`Action: ${block.name}`, block.input);
      break;
    case "computer_call":
      console.log(`Call: ${block.call_id}`, block.action);
      break;
  }
}
console.log(`Cost: $${step.usage.total_cost.toFixed(6)}`);
```

## Error Handling

All gateway errors surface as `APIError`:

```ts
import { APIError } from "@runjobsai/sdk";

try {
  await client.chat.create({ ... });
} catch (e) {
  if (e instanceof APIError) {
    console.error(e.statusCode, e.type, e.message);
  } else {
    throw e; // network / runtime errors propagate untouched
  }
}
```

Network errors (DNS failure, socket reset, etc.) propagate as the underlying `fetch` rejection — typically a `TypeError`. Wrap them yourself if you need cross-cutting retry logic.

## Cancellation

Every method accepts an optional `{ signal }` for `AbortController` cancellation:

```ts
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 5000);

const resp = await client.chat.create(
  { model: "...", messages: [...] },
  { signal: ctrl.signal },
);
```

## API Reference

### Services

| Service          | Methods                                        | Description                                  |
| ---------------- | ---------------------------------------------- | -------------------------------------------- |
| `client.chat`    | `create`, `stream`                             | OpenAI-compatible chat completions           |
| `client.models`  | `list`                                         | Model catalog with pricing, capability tags, and options schema |
| `client.image`   | `generate`, `edit`, `generateAsync`            | Image generation and editing                 |
| `client.audio`   | `speech`, `transcribe`                         | Text-to-speech and transcription (voice catalog on `getOptionsSchema(model).catalog`) |
| `client.video`   | `generate`, `getStatus`, `wait`, `getContent`  | Async video generation                       |
| `client.computer`| `step`                                         | Computer use (AI GUI control)                |

### Model helpers (importable functions)

Standalone functions that take a `Model` (or `Schema`) — kept outside
the service classes so they're tree-shakeable:

| Helper | Returns | Use for |
|--------|---------|---------|
| `hasCapabilityTag(model, id)` | `boolean` | Filter models by stable capability tag (`"i2v"`, `"voice_clone"`, …). |
| `model.capability_tags` | `Tag[] \| undefined` | Iterate `{id, label}` for display chips. |
| `getOptionsSchema(model)` | `Schema \| null` | Typed view of the model's input contract — inputs, constraints, catalog. |
| `acceptsField(model, name)` | `boolean` | Does the model accept this request field at all? |
| `requiresField(model, name)` | `boolean` | Is this field required (red-star UI)? |
| `allowedValuesFor(model, name)` | `unknown[] \| null` | Discrete enum for dropdown options, or null. |
| `model.available_voices` | `string[] \| undefined` | TTS-only: voice IDs the model accepts (top-level convenience field). |
| `validateRequest(schema, req)` | `ValidationError[]` | Pre-flight validate a request body against the schema before submitting. |

## Compatibility

- **Node**: 18 or newer (uses built-in `fetch`).
- **Browsers**: any modern browser. CORS / API key handling is your responsibility — typically you'd proxy through your own backend rather than ship `gw-...` keys to clients.
- **Deno / Bun**: works out of the box.

## License

MIT

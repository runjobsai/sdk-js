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

List available models with pricing and capability metadata.

```ts
const all = await client.models.list();

// Filter server-side by capability
const textModels = await client.models.list({ capability: "text" });

for (const m of textModels) {
  console.log(`${m.id}  in=${m.input_price_per_mtok} out=${m.output_price_per_mtok} pips/MTok`);
}
```

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
import { decodeMediaUrl } from "@runjobs/sdk";
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
// Voice metadata (id, name, gender, preview_url, supported_emotions) is
// carried on the model row itself — fetch via models.get and read off
// the options bag.
const m = await client.models.get("MiniMax Speech 2.6 HD");
const voices = (m.options?.voices ?? []) as Array<{
  id: string; name: string; gender?: string; language?: string;
}>;
for (const v of voices) {
  console.log(`${v.id}  ${v.name}  ${v.gender ?? ""}  ${v.language ?? ""}`);
}
console.log("Emotions:", m.options?.supported_emotions);
// e.g. ["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "whisper"]

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

| Service          | Methods                                        | Description                                  |
| ---------------- | ---------------------------------------------- | -------------------------------------------- |
| `client.chat`    | `create`, `stream`                             | OpenAI-compatible chat completions           |
| `client.models`  | `list`                                         | Model catalog with pricing and capabilities  |
| `client.image`   | `generate`, `edit`, `generateAsync`            | Image generation and editing                 |
| `client.audio`   | `speech`, `transcribe`                         | Text-to-speech and transcription (voice catalog now on the model row via `models.get`) |
| `client.video`   | `generate`, `getStatus`, `wait`, `getContent`  | Async video generation                       |
| `client.computer`| `step`                                         | Computer use (AI GUI control)                |

## Compatibility

- **Node**: 18 or newer (uses built-in `fetch`).
- **Browsers**: any modern browser. CORS / API key handling is your responsibility — typically you'd proxy through your own backend rather than ship `gw-...` keys to clients.
- **Deno / Bun**: works out of the box.

## License

MIT

import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
import { decodeMediaUrl } from "./media.js";

/* ------------------------------------------------------------------ */
/* TTS                                                                 */
/* ------------------------------------------------------------------ */
/*                                                                     */
/* Voice metadata (id / name / gender / preview_url / supported        */
/* emotions) is no longer fetched through a dedicated endpoint —       */
/* every text_to_speech row on /v1/models carries its full catalog     */
/* under `options.voices` and `options.supported_emotions`. Use        */
/* `client.models.get(name)` (or the entry from `client.models.list`)  */
/* and read those fields off `model.options`.                          */
/* ------------------------------------------------------------------ */

export interface SpeechParams {
  input: string;
  /** Named voice id (`alloy`, `nova`, …; provider-dependent). Omit
   *  when supplying `reference_audio_url` for zero-shot voice
   *  cloning — the cloned timbre overrides any named voice. */
  voice?: string;
  response_format?: string;
  speed?: number;
  /** Provider-specific. Inspect the chosen TTS model's
   *  `options.supported_emotions` (via `client.models.get(name)`) for
   *  the legal enum values. */
  emotion?: string;
  /** -12 … 12 semitones (provider-dependent). */
  pitch?: number;
  /** 0.1 … 10.0 — 1.0 = normal. */
  volume?: number;
  /** -12 … 12 — voice timbre shift (provider-dependent). */
  timber?: number;
  /**
   * Free-form natural-language directive for voiceclone (CosyVoice).
   * e.g. "用四川话快速地说"
   */
  instruct_text?: string;
  /**
   * Public URL of a reference clip whose timbre to match (zero-shot
   * voice cloning). When set, voiceclone-capable models ignore `voice`
   * and synthesize matching the referenced audio.
   */
  reference_audio_url?: string;
  /** Transcript of the reference clip — improves CosyVoice quality. */
  reference_text?: string;
  user?: string;
  /**
   * Vendor-specific top-level fields the canonical params don't model.
   * Used for music-generation models on the TTS bucket — ACE-Step needs
   * `tags` (genre, required), `duration`, `seed`, `scheduler`, etc.
   * The SDK spreads these at the request body's TOP LEVEL (not nested
   * under "extra") to match the gateway's extractSpeechExtra contract.
   * Canonical fields above always win over extra keys with the same name.
   */
  extra?: Record<string, unknown>;
}

export interface SpeechResponse {
  /** Decoded audio bytes. */
  data: Uint8Array;
  /** MIME type reported by the gateway (e.g. "audio/mpeg"). */
  contentType: string;
  usage: Usage;
}

/* ------------------------------------------------------------------ */
/* STT                                                                 */
/* ------------------------------------------------------------------ */

/** Same shape as image.ImageFileInput — kept independent so callers can import either. */
export interface AudioFileInput {
  data: Blob | ArrayBuffer | Uint8Array | string;
  filename: string;
  contentType?: string;
}

export interface TranscribeParams {
  file: AudioFileInput;
  language?: string;
  prompt?: string;
  response_format?: string;
  timestamp_granularities?: ("segment" | "word")[];
  user?: string;
}

export interface TranscribeResponse {
  text: string;
  usage: Usage;
  /** Raw upstream payload — segment timings, etc., when present. */
  raw?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class AudioService {
  constructor(private readonly transport: Transport) {}

  // (Removed: listVoices — fetch voice metadata via client.models.get /
  //  client.models.list and read model.options.voices /
  //  model.options.supported_emotions.)

  /**
   * Generate speech from text. Output bytes are base64-decoded by the SDK
   * — `response.data` is a `Uint8Array` you can write directly to disk:
   *
   * ```ts
   * await fs.writeFile("out.mp3", await client.audio.speech("OpenAI/TTS", {
   *   input: "Hello!",
   *   voice: "nova",
   * }).then(r => r.data));
   * ```
   */
  async speech(
    model: string,
    params: SpeechParams,
    init?: { signal?: AbortSignal },
  ): Promise<SpeechResponse> {
    // Wire shape: {audio_url: "data:<mime>;base64,...", usage: ...}.
    // The data: URI carries both the mime label and the base64 payload;
    // decodeMediaUrl handles both data: URIs and (for forward compat,
    // should the gateway ever switch to a hosted blob URL) http(s)
    // URLs symmetrically.
    const raw = await this.transport.postJSON<{
      audio_url: string;
      usage: Usage;
    }>(
      "/v1/audio/speech",
      buildSpeechBody(model, params),
      init,
    );
    const { bytes, contentType } = await decodeMediaUrl(raw.audio_url);
    return {
      data: bytes,
      contentType,
      usage: raw.usage,
    };
  }

  /**
   * Async equivalent of `speech()`. Submits the job to the gateway's
   * async TTS endpoint, polls every ~3s until terminal, then decodes
   * the result audio_url. Use this when a request may exceed the
   * ~100s origin timeout — ACE-Step music generation at high quality,
   * large CosyVoice batches, etc. The sync `speech()` method is the
   * right choice for short-clip TTS that fits inside Cloudflare's
   * timeout (skips the submit + poll round-trips).
   *
   * Returns the same `SpeechResponse` shape as `speech()` — `data` +
   * `usage` — so callers can swap the two methods with no other change.
   *
   * Caller's `signal` deadline bounds the poll wait. Without one,
   * an internal 10-minute cap applies.
   */
  async speechAsync(
    model: string,
    params: SpeechParams,
    init?: { signal?: AbortSignal; pollIntervalMs?: number },
  ): Promise<SpeechResponse> {
    const submit = await this.transport.postJSON<{ id: string; status: string }>(
      "/v1/async/audio/speech",
      buildSpeechBody(model, params),
      init,
    );
    if (!submit.id) {
      throw new Error("runjobs: speech submit response missing job id");
    }
    return waitSpeechJob(this.transport, submit.id, init);
  }

  /** Transcribe audio to text via multipart upload. */
  async transcribe(
    model: string,
    params: TranscribeParams,
    init?: { signal?: AbortSignal },
  ): Promise<TranscribeResponse> {
    const form = buildTranscribeForm(model, params);
    return this.transport.postMultipart<TranscribeResponse>(
      "/v1/audio/transcriptions",
      form,
      init,
    );
  }

  /**
   * Async equivalent of `transcribe()`. Submits the upload, polls
   * every ~3s until terminal, returns the same `TranscribeResponse`.
   * Use this for long audio (lectures, podcasts, multi-hour
   * recordings) where Whisper can take minutes — well past
   * Cloudflare's ~100s sync ceiling.
   *
   * Caller's `signal` deadline bounds the poll wait. Without one,
   * an internal 10-minute cap applies.
   */
  async transcribeAsync(
    model: string,
    params: TranscribeParams,
    init?: { signal?: AbortSignal; pollIntervalMs?: number },
  ): Promise<TranscribeResponse> {
    const form = buildTranscribeForm(model, params);
    const submit = await this.transport.postMultipart<{ id: string; status: string }>(
      "/v1/async/audio/transcriptions",
      form,
      init,
    );
    if (!submit.id) {
      throw new Error("runjobs: transcribe submit response missing job id");
    }
    return waitTranscribeJob(this.transport, submit.id, init);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Polls the gateway's async speech-status endpoint until the job
 * reaches a terminal state, then decodes the result `audio_url`
 * data: URI into raw bytes + mime. Used by `AudioService.speechAsync`.
 *
 * Default poll cadence: first poll 2s after submit, then every 3s.
 * Caller can override via `init.pollIntervalMs`. `init.signal`
 * cancels the poll loop.
 */
async function waitSpeechJob(
  transport: Transport,
  jobId: string,
  init?: { signal?: AbortSignal; pollIntervalMs?: number },
): Promise<SpeechResponse> {
  const path = `/v1/async/audio/speech/${encodeURIComponent(jobId)}`;
  const interval = init?.pollIntervalMs ?? 3000;
  // First poll happens fast — typical TTS already done in 2-5s.
  await sleep(2000, init?.signal);
  // 10-minute hard cap if caller didn't supply a signal with a
  // narrower deadline. Long enough for the slowest ACE-Step jobs.
  const startedAt = Date.now();
  const internalDeadline = startedAt + 10 * 60 * 1000;

  for (;;) {
    if (init?.signal?.aborted) {
      throw new DOMException("speech poll aborted", "AbortError");
    }
    if (!init?.signal && Date.now() > internalDeadline) {
      throw new Error("runjobs: speech job timed out (10 min internal cap)");
    }
    const status = await transport.getJSON<{
      id: string;
      status: string;
      audio_url?: string;
      usage?: Usage;
      error?: string;
    }>(path, init);
    if (status.status === "succeeded") {
      if (!status.audio_url) {
        throw new Error("runjobs: speech job succeeded but no audio_url returned");
      }
      const { bytes, contentType } = await decodeMediaUrl(status.audio_url);
      return {
        data: bytes,
        contentType,
        usage: status.usage ?? { total_cost: 0 },
      };
    }
    if (status.status === "failed") {
      throw new Error(status.error || "runjobs: speech job failed");
    }
    // queued | running → wait + retry.
    await sleep(interval, init?.signal);
  }
}

/**
 * Polls the gateway's async transcribe-status endpoint until terminal,
 * then assembles a TranscribeResponse from the final payload. Used by
 * `AudioService.transcribeAsync`.
 */
async function waitTranscribeJob(
  transport: Transport,
  jobId: string,
  init?: { signal?: AbortSignal; pollIntervalMs?: number },
): Promise<TranscribeResponse> {
  const path = `/v1/async/audio/transcriptions/${encodeURIComponent(jobId)}`;
  const interval = init?.pollIntervalMs ?? 3000;
  await sleep(2000, init?.signal);
  const internalDeadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    if (init?.signal?.aborted) {
      throw new DOMException("transcribe poll aborted", "AbortError");
    }
    if (!init?.signal && Date.now() > internalDeadline) {
      throw new Error("runjobs: transcribe job timed out (10 min internal cap)");
    }
    const status = await transport.getJSON<Record<string, unknown>>(path, init);
    switch (status.status) {
      case "succeeded":
        return assembleTranscribeResponse(status);
      case "failed":
        throw new Error((status.error as string) || "runjobs: transcribe job failed");
      case "queued":
      case "running":
        await sleep(interval, init?.signal);
        break;
      default:
        throw new Error(`runjobs: unknown transcribe job status ${JSON.stringify(status.status)}`);
    }
  }
}

/**
 * Pulls canonical text + usage out of a succeeded transcribe-status
 * payload, leaves the rest under .raw — matches the sync response
 * shape produced by `transcribe()`.
 */
function assembleTranscribeResponse(payload: Record<string, unknown>): TranscribeResponse {
  const out: TranscribeResponse = {
    text: (payload.text as string) ?? "",
    usage: (payload.usage as Usage) ?? { total_cost: 0 },
  };
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "text" || k === "usage" || k === "id" || k === "status") continue;
    raw[k] = v;
  }
  if (Object.keys(raw).length > 0) {
    out.raw = raw;
  }
  return out;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * buildSpeechBody assembles the wire body for /v1/audio/speech (and
 * its async sibling): `{model, ...canonical, ...extra}` flattened at
 * the top level. The gateway's extractSpeechExtra peels non-canonical
 * keys back into req.Extra, so the round-trip is symmetric. Canonical
 * fields always win over `extra` keys of the same name — never let
 * Extra silently override a typed field.
 */
function buildSpeechBody(model: string, params: SpeechParams): Record<string, unknown> {
  const { extra, ...canonical } = params;
  const body: Record<string, unknown> = { model, ...canonical };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (k in body) continue;
      body[k] = v;
    }
  }
  return body;
}

function buildTranscribeForm(model: string, params: TranscribeParams): FormData {
  const form = new FormData();
  form.set("model", model);
  if (params.language) form.set("language", params.language);
  if (params.prompt) form.set("prompt", params.prompt);
  if (params.response_format) form.set("response_format", params.response_format);
  if (params.timestamp_granularities) {
    for (const g of params.timestamp_granularities) {
      form.append("timestamp_granularities[]", g);
    }
  }
  if (params.user) form.set("user", params.user);

  const ct = params.file.contentType ?? guessAudioMime(params.file.filename);
  const blob =
    params.file.data instanceof Blob
      ? params.file.data
      : new Blob([params.file.data as BlobPart], { type: ct });
  form.set("file", blob, params.file.filename);
  return form;
}

function guessAudioMime(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    case "ogg":
      return "audio/ogg";
    case "webm":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
}

// (base64ToBytes was here — promoted to media.ts as part of
// decodeMediaUrl. The audio path now goes through that single helper
// so image and audio decode through one implementation.)

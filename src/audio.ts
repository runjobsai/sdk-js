import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";

/* ------------------------------------------------------------------ */
/* Voices                                                              */
/* ------------------------------------------------------------------ */

export interface Voice {
  id: string;
  name: string;
  gender?: string;
  language?: string;
}

export interface VoiceCatalog {
  voices: Voice[];
  /** e.g. ["happy","sad","angry","fearful","disgusted","surprised","calm","whisper"] */
  supported_emotions?: string[];
}

/* ------------------------------------------------------------------ */
/* TTS                                                                 */
/* ------------------------------------------------------------------ */

export interface SpeechParams {
  input: string;
  /** Named voice id (`alloy`, `nova`, …; provider-dependent). Omit
   *  when supplying `reference_audio_url` for zero-shot voice
   *  cloning — the cloned timbre overrides any named voice. */
  voice?: string;
  response_format?: string;
  speed?: number;
  /** Provider-specific; see `VoiceCatalog.supported_emotions`. */
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

  /** List voices + supported emotions for a TTS model. */
  async listVoices(
    model: string,
    init?: { signal?: AbortSignal },
  ): Promise<VoiceCatalog> {
    const path = `/v1/audio/voices?model=${encodeURIComponent(model)}`;
    return this.transport.getJSON<VoiceCatalog>(path, init);
  }

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
    const raw = await this.transport.postJSON<{
      b64_audio: string;
      content_type: string;
      usage: Usage;
    }>(
      "/v1/audio/speech",
      { model, ...params },
      init,
    );
    return {
      data: base64ToBytes(raw.b64_audio),
      contentType: raw.content_type,
      usage: raw.usage,
    };
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
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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

/** Decode standard base64 to bytes. Uses Node's Buffer when available. */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  // Browser fallback.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

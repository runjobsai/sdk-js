import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
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
export declare class AudioService {
    private readonly transport;
    constructor(transport: Transport);
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
    speech(model: string, params: SpeechParams, init?: {
        signal?: AbortSignal;
    }): Promise<SpeechResponse>;
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
    speechAsync(model: string, params: SpeechParams, init?: {
        signal?: AbortSignal;
        pollIntervalMs?: number;
    }): Promise<SpeechResponse>;
    /** Transcribe audio to text via multipart upload. */
    transcribe(model: string, params: TranscribeParams, init?: {
        signal?: AbortSignal;
    }): Promise<TranscribeResponse>;
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
    transcribeAsync(model: string, params: TranscribeParams, init?: {
        signal?: AbortSignal;
        pollIntervalMs?: number;
    }): Promise<TranscribeResponse>;
}
//# sourceMappingURL=audio.d.ts.map
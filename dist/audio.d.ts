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
    /** Transcribe audio to text via multipart upload. */
    transcribe(model: string, params: TranscribeParams, init?: {
        signal?: AbortSignal;
    }): Promise<TranscribeResponse>;
}
//# sourceMappingURL=audio.d.ts.map
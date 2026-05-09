import { decodeMediaUrl } from "./media.js";
/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */
export class AudioService {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
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
    async speech(model, params, init) {
        // Wire shape: {audio_url: "data:<mime>;base64,...", usage: ...}.
        // The data: URI carries both the mime label and the base64 payload;
        // decodeMediaUrl handles both data: URIs and (for forward compat,
        // should the gateway ever switch to a hosted blob URL) http(s)
        // URLs symmetrically.
        const raw = await this.transport.postJSON("/v1/audio/speech", { model, ...params }, init);
        const { bytes, contentType } = await decodeMediaUrl(raw.audio_url);
        return {
            data: bytes,
            contentType,
            usage: raw.usage,
        };
    }
    /** Transcribe audio to text via multipart upload. */
    async transcribe(model, params, init) {
        const form = buildTranscribeForm(model, params);
        return this.transport.postMultipart("/v1/audio/transcriptions", form, init);
    }
}
/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function buildTranscribeForm(model, params) {
    const form = new FormData();
    form.set("model", model);
    if (params.language)
        form.set("language", params.language);
    if (params.prompt)
        form.set("prompt", params.prompt);
    if (params.response_format)
        form.set("response_format", params.response_format);
    if (params.timestamp_granularities) {
        for (const g of params.timestamp_granularities) {
            form.append("timestamp_granularities[]", g);
        }
    }
    if (params.user)
        form.set("user", params.user);
    const ct = params.file.contentType ?? guessAudioMime(params.file.filename);
    const blob = params.file.data instanceof Blob
        ? params.file.data
        : new Blob([params.file.data], { type: ct });
    form.set("file", blob, params.file.filename);
    return form;
}
function guessAudioMime(filename) {
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
//# sourceMappingURL=audio.js.map
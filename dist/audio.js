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
        const raw = await this.transport.postJSON("/v1/audio/speech", { model, ...params }, init);
        return {
            data: base64ToBytes(raw.b64_audio),
            contentType: raw.content_type,
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
/** Decode standard base64 to bytes. Uses Node's Buffer when available. */
function base64ToBytes(b64) {
    if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(b64, "base64"));
    }
    // Browser fallback.
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
//# sourceMappingURL=audio.js.map
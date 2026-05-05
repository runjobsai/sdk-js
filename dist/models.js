/** True iff the gateway flag in `options[key]` is set. Accepts bool or numeric 1. */
function optBool(model, key) {
    const v = model.options?.[key];
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    return false;
}
/** Convenience: TTS model accepts a reference audio clip as `voice`? */
export const supportsVoiceClone = (model) => optBool(model, "supports_voice_clone");
/** Convenience: TTS model accepts a free-form `instruct_text` directive? */
export const supportsInstructText = (model) => optBool(model, "supports_instruct_text");
/** Convenience: admin-set default voice for a TTS model, or null. */
export const defaultVoice = (model) => {
    const v = model.options?.["default_voice"];
    return typeof v === "string" ? v : null;
};
export class ModelsService {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    /**
     * List models available on the gateway. Pass `{ capability: "..." }` to
     * filter server-side.
     */
    async list(opts = {}, init) {
        let path = "/v1/models";
        if (opts.capability) {
            path += `?capability=${encodeURIComponent(opts.capability)}`;
        }
        const resp = await this.transport.getJSON(path, init);
        return resp.data;
    }
}
//# sourceMappingURL=models.js.map
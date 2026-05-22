/**
 * RunJobs SDK for JavaScript / TypeScript.
 *
 * Top-level entry point — exports the `RunJobs` client class plus all
 * public types so callers can write strongly-typed wrappers without
 * reaching into per-service modules.
 */
export { RunJobs, RunJobs as Client } from "./client.js";
// SDK telemetry — `client.events` fires these around every LLM-ish
// service call so UI overlays (the badge being the canonical example)
// can render real-time state. The ActivityTracker turns the raw
// stream into the snapshot the badge reads each frame; exported
// alongside the bus so power users can build their own status UI.
export { SDKEvents, newRequestId, } from "./events.js";
export { ActivityTracker, } from "./activity-tracker.js";
export { BrowserAuth } from "./browser-auth.js";
export { APIError } from "./errors.js";
export { userMessage, systemMessage, assistantMessage, toolResultMessage, userMessageParts, textPart, imagePart, videoPart, audioPart, } from "./chat.js";
export { hasCapabilityTag, acceptsModality, supportsVoiceClone, supportsInstructText, defaultVoice, } from "./models.js";
export { getOptionsSchema, acceptsField, requiresField, allowedValuesFor, } from "./model_options.js";
export { validateRequest } from "./validate.js";
// Media helpers (shared by image + video + chat-multimodal)
export { encodeImageUrl, decodeMediaUrl } from "./media.js";
//# sourceMappingURL=index.js.map
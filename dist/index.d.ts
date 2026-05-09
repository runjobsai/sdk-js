/**
 * RunJobs SDK for JavaScript / TypeScript.
 *
 * Top-level entry point — exports the `RunJobs` client class plus all
 * public types so callers can write strongly-typed wrappers without
 * reaching into per-service modules.
 */
export { RunJobs, RunJobs as Client, type ClientOptions, type AuthProvider } from "./client.js";
export { BrowserAuth, type BrowserAuthOptions, type BrowserUser } from "./browser-auth.js";
export { APIError } from "./errors.js";
export type { Usage } from "./types.js";
export type { ChatMessage, ContentPart, ChatTool, StreamOptions, ChatCompletionParams, ChatToolCall, ChatChoiceMessage, ChatChoice, ChatCompletion, ChatChunkDelta, ChatChunkChoice, ChatCompletionChunk, } from "./chat.js";
export { userMessage, systemMessage, assistantMessage, toolResultMessage, userMessageParts, textPart, imagePart, } from "./chat.js";
export type { Model, ModelListOptions } from "./models.js";
export { supportsVoiceClone, supportsInstructText, defaultVoice } from "./models.js";
export type { ImageGenerateParams, ImageResult, ImageUsage, ImageResponse, ImageEditParams, ImageFileInput, AsyncImageJob, } from "./image.js";
export type { SpeechParams, SpeechResponse, TranscribeParams, TranscribeResponse, AudioFileInput, } from "./audio.js";
export type { VideoGenerateParams, VideoTask, VideoStatus, VideoUsageTokens, WaitOptions, } from "./video.js";
export { encodeImageUrl, decodeMediaUrl } from "./media.js";
export type { ComputerStepParams, ComputerContentBlock, ComputerResponse, } from "./computer.js";
export type { FileObject, FileListResult, PutOptions as FilePutOptions, ListOptions as FileListOptions, PutFromURLOptions as FilePutFromURLOptions, BatchOp as FileBatchOp, BatchResult as FileBatchResult, } from "./files.js";
export type { EmbeddingsParams, Embedding, EmbeddingsUsage, EmbeddingsResponse, } from "./embeddings.js";
//# sourceMappingURL=index.d.ts.map
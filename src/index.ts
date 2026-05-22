/**
 * RunJobs SDK for JavaScript / TypeScript.
 *
 * Top-level entry point — exports the `RunJobs` client class plus all
 * public types so callers can write strongly-typed wrappers without
 * reaching into per-service modules.
 */

export { RunJobs, RunJobs as Client, type ClientOptions, type AuthProvider } from "./client.js";

// SDK telemetry — `client.events` fires these around every LLM-ish
// service call so UI overlays (the badge being the canonical example)
// can render real-time state. The ActivityTracker turns the raw
// stream into the snapshot the badge reads each frame; exported
// alongside the bus so power users can build their own status UI.
export {
  SDKEvents,
  newRequestId,
  type RequestStartEvent,
  type RequestStreamDeltaEvent,
  type RequestEndEvent,
  type RequestErrorEvent,
  type SDKEventMap,
  type SDKCapability,
  type Unsubscribe,
} from "./events.js";
export {
  ActivityTracker,
  type ActiveCall,
  type CompletedCall,
  type SessionStats,
  type ActivitySnapshot,
} from "./activity-tracker.js";
export { BrowserAuth, type BrowserAuthOptions, type BrowserUser } from "./browser-auth.js";
export { APIError } from "./errors.js";
export type { Usage } from "./types.js";

// Chat — service class is internal; types + builders are public.
export type {
  ChatMessage,
  ContentPart,
  ChatTool,
  StreamOptions,
  ChatCompletionParams,
  ChatToolCall,
  ChatChoiceMessage,
  ChatChoice,
  ChatCompletion,
  ChatChunkDelta,
  ChatChunkChoice,
  ChatCompletionChunk,
} from "./chat.js";
export {
  userMessage,
  systemMessage,
  assistantMessage,
  toolResultMessage,
  userMessageParts,
  textPart,
  imagePart,
  videoPart,
  audioPart,
} from "./chat.js";

// Models
export type { Model, ModelListOptions, Tag } from "./models.js";
export {
  hasCapabilityTag,
  acceptsModality,
  supportsVoiceClone,
  supportsInstructText,
  defaultVoice,
} from "./models.js";

// Model options schema (input validation + capability introspection)
export type {
  Schema,
  FieldSchema,
  Constraint,
  ConstraintKind,
  Catalog,
} from "./model_options.js";
export {
  getOptionsSchema,
  acceptsField,
  requiresField,
  allowedValuesFor,
} from "./model_options.js";
export type { ValidationError } from "./validate.js";
export { validateRequest } from "./validate.js";

// Image
export type {
  ImageGenerateParams,
  ImageResult,
  ImageUsage,
  ImageResponse,
  ImageEditParams,
  ImageFileInput,
  AsyncImageJob,
} from "./image.js";

// Audio
export type {
  SpeechParams,
  SpeechResponse,
  TranscribeParams,
  TranscribeResponse,
  AudioFileInput,
} from "./audio.js";

// Video
export type {
  VideoGenerateParams,
  VideoTask,
  VideoStatus,
  VideoUsageTokens,
  WaitOptions,
} from "./video.js";

// Media helpers (shared by image + video + chat-multimodal)
export { encodeImageUrl, decodeMediaUrl } from "./media.js";

// Computer
export type {
  ComputerStepParams,
  ComputerContentBlock,
  ComputerResponse,
} from "./computer.js";

// Files (per-project file system)
export type {
  FileObject,
  FileListResult,
  PutOptions as FilePutOptions,
  ListOptions as FileListOptions,
  PutFromURLOptions as FilePutFromURLOptions,
  BatchOp as FileBatchOp,
  BatchResult as FileBatchResult,
} from "./files.js";

// Embeddings
export type {
  EmbeddingsParams,
  Embedding,
  EmbeddingsUsage,
  EmbeddingsResponse,
} from "./embeddings.js";

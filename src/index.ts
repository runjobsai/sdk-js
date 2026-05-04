/**
 * RunJobs SDK for JavaScript / TypeScript.
 *
 * Top-level entry point — exports the `RunJobs` client class plus all
 * public types so callers can write strongly-typed wrappers without
 * reaching into per-service modules.
 */

export { RunJobs, type ClientOptions } from "./client.js";
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
} from "./chat.js";

// Models
export type { Model, ModelListOptions } from "./models.js";
export { supportsVoiceClone, supportsInstructText, defaultVoice } from "./models.js";

// Image
export type {
  ImageGenerateParams,
  ImageResult,
  ImageUsage,
  ImageResponse,
  ImageEditParams,
  ImageFileInput,
} from "./image.js";

// Audio
export type {
  Voice,
  VoiceCatalog,
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

// Computer
export type {
  ComputerStepParams,
  ComputerContentBlock,
  ComputerResponse,
} from "./computer.js";

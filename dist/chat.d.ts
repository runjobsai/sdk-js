import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
import type { SDKEvents } from "./events.js";
/**
 * A single message in a chat conversation. Content is a string for plain
 * text, or an array of `ContentPart` for multi-modal messages.
 */
export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | ContentPart[] | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ChatToolCall[];
}
/** One block inside a multi-modal message content array.
 *
 * Multi-modal LLMs see content as a heterogeneous list — some mix
 * text + images (gpt-4o, claude), some accept video frames or raw
 * audio (Gemini 2.x). The shape mirrors OpenAI's chat completions
 * schema and is forwarded verbatim to the gateway; unsupported
 * variants are rejected server-side with a clear error rather than
 * silently ignored. */
export type ContentPart = {
    type: "text";
    text: string;
} | {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "auto" | "low" | "high";
    };
} | {
    type: "video_url";
    video_url: {
        url: string;
    };
} | {
    type: "audio_url";
    audio_url: {
        url: string;
    };
};
export interface ChatTool {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    };
}
export interface StreamOptions {
    include_usage: boolean;
}
export interface ChatCompletionParams {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    stop?: string[];
    frequency_penalty?: number;
    presence_penalty?: number;
    n?: number;
    tools?: ChatTool[];
    tool_choice?: unknown;
    user?: string;
    metadata?: Record<string, unknown>;
    stream?: boolean;
    stream_options?: StreamOptions;
    /** Pass-through for provider-specific knobs. */
    [extra: string]: unknown;
}
export interface ChatToolCall {
    index?: number;
    id?: string;
    type?: string;
    function: {
        name: string;
        arguments: string;
    };
}
export interface ChatChoiceMessage {
    role: string;
    content: string | null;
    tool_calls?: ChatToolCall[];
}
export interface ChatChoice {
    index: number;
    message: ChatChoiceMessage;
    finish_reason: string;
}
export interface ChatCompletion {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: ChatChoice[];
    usage: Usage;
}
export interface ChatChunkDelta {
    role?: string;
    content?: string;
    tool_calls?: ChatToolCall[];
}
export interface ChatChunkChoice {
    index: number;
    delta: ChatChunkDelta;
    finish_reason?: string | null;
}
export interface ChatCompletionChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: ChatChunkChoice[];
    usage?: Usage;
}
export declare const userMessage: (content: string) => ChatMessage;
export declare const systemMessage: (content: string) => ChatMessage;
export declare const assistantMessage: (content: string) => ChatMessage;
export declare const toolResultMessage: (toolCallId: string, content: string) => ChatMessage;
export declare const userMessageParts: (...parts: ContentPart[]) => ChatMessage;
export declare const textPart: (text: string) => ContentPart;
export declare const imagePart: (url: string, detail?: "auto" | "low" | "high") => ContentPart;
/**
 * Video content part. Only supported by chat models whose
 * input_modalities includes `"video"` (currently Gemini 3.x). Other
 * models 400 at the gateway. URL may be http(s) or a
 * `data:video/mp4;base64,...` inline upload.
 */
export declare const videoPart: (url: string) => ContentPart;
/**
 * Audio content part. Only supported by chat models whose
 * input_modalities includes `"audio"` (currently Gemini 3.x). Other
 * models 400 at the gateway. URL may be http(s) or a
 * `data:audio/wav;base64,...` inline upload.
 */
export declare const audioPart: (url: string) => ContentPart;
export declare class ChatService {
    private readonly transport;
    private readonly events;
    constructor(transport: Transport, events: SDKEvents);
    /**
     * Create a chat completion (non-streaming).
     *
     * Streaming is forced off — pass `stream()` instead for incremental output.
     */
    create(params: ChatCompletionParams, init?: {
        signal?: AbortSignal;
    }): Promise<ChatCompletion>;
    /**
     * Create a streaming chat completion. Returns an async iterator over
     * `ChatCompletionChunk`. The final chunk carries `usage` (token / cost
     * totals) — `stream_options.include_usage` is set automatically.
     *
     * ```ts
     * let cost = 0;
     * for await (const chunk of client.chat.stream({ ... })) {
     *   for (const c of chunk.choices) process.stdout.write(c.delta.content ?? "");
     *   if (chunk.usage) cost = chunk.usage.total_cost;
     * }
     * ```
     *
     * Also fires `request:streamDelta` on `client.events` for each chunk
     * that carried text — drives the badge's tokens/sec rate display.
     */
    stream(params: ChatCompletionParams, init?: {
        signal?: AbortSignal;
    }): AsyncGenerator<ChatCompletionChunk, void, unknown>;
}
//# sourceMappingURL=chat.d.ts.map
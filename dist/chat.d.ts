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
/**
 * Names of platform-executed tools the SDK can ask the gateway to run on
 * its behalf during a chat completion.  When you set `server_tools` on a
 * `ChatCompletionParams`, the gateway resolves each name to its tool
 * schema, sends both server tools and your own `tools` (if any) to the
 * model, then handles any server-tool calls itself — looping with the
 * model until it produces a final answer.  Your code only sees the final
 * response; you don't have to implement web search yourself.
 *
 * The whitelist is intentionally narrow.  For image, audio, file, and
 * vision generation the SDK already exposes dedicated endpoints
 * (`client.image.*`, `client.audio.*`, etc.) that callers should hit
 * directly instead of paying for an LLM-in-the-middle.  Search-class
 * tools live here because they need the model in the loop — "search →
 * read result → fetch → answer" can't be expressed as a single call.
 */
export type ServerToolName = "web_search" | "web_fetch" | "twitter_search";
/** Typed constants for {@link ServerToolName} so you get autocomplete. */
export declare const ServerTools: {
    readonly WebSearch: "web_search";
    readonly WebFetch: "web_fetch";
    readonly TwitterSearch: "twitter_search";
};
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
    /**
     * Names of platform-executed tools — the gateway will run these for
     * you and loop with the model until it produces a final answer.  Mix
     * freely with your own `tools`: the model can call either; the
     * platform handles the server ones, your code handles the rest.
     */
    server_tools?: ServerToolName[];
    /**
     * Maximum number of LLM round-trips the server-tool loop will make
     * (default 5, hard cap 10).  Only meaningful when `server_tools` is
     * set.  Tune up for chains like "search → fetch → answer", down for
     * tighter cost guarantees.
     */
    max_server_iterations?: number;
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
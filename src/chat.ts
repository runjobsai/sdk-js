import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";

/* ------------------------------------------------------------------ */
/* Request types                                                       */
/* ------------------------------------------------------------------ */

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

/** One block inside a multi-modal message content array. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

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

/* ------------------------------------------------------------------ */
/* Response types                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Convenience builders                                                */
/* ------------------------------------------------------------------ */

export const userMessage = (content: string): ChatMessage =>
  ({ role: "user", content });

export const systemMessage = (content: string): ChatMessage =>
  ({ role: "system", content });

export const assistantMessage = (content: string): ChatMessage =>
  ({ role: "assistant", content });

export const toolResultMessage = (toolCallId: string, content: string): ChatMessage =>
  ({ role: "tool", tool_call_id: toolCallId, content });

export const userMessageParts = (...parts: ContentPart[]): ChatMessage =>
  ({ role: "user", content: parts });

export const textPart = (text: string): ContentPart => ({ type: "text", text });

export const imagePart = (
  url: string,
  detail?: "auto" | "low" | "high",
): ContentPart => ({
  type: "image_url",
  image_url: detail ? { url, detail } : { url },
});

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class ChatService {
  constructor(private readonly transport: Transport) {}

  /**
   * Create a chat completion (non-streaming).
   *
   * Streaming is forced off — pass `stream()` instead for incremental output.
   */
  async create(
    params: ChatCompletionParams,
    init?: { signal?: AbortSignal },
  ): Promise<ChatCompletion> {
    const body = { ...params, stream: false };
    return this.transport.postJSON<ChatCompletion>(
      "/v1/chat/completions",
      body,
      init,
    );
  }

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
   */
  async *stream(
    params: ChatCompletionParams,
    init?: { signal?: AbortSignal },
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const body = {
      ...params,
      stream: true,
      stream_options: params.stream_options ?? { include_usage: true },
    };
    const resp = await this.transport.postJSONStream(
      "/v1/chat/completions",
      body,
      init,
    );
    if (!resp.body) {
      throw new Error("runjobs: streaming response had no body");
    }
    yield* parseSSE<ChatCompletionChunk>(resp.body);
  }
}

/* ------------------------------------------------------------------ */
/* SSE parsing                                                         */
/* ------------------------------------------------------------------ */

/**
 * Decode an `text/event-stream` body into a stream of parsed JSON chunks.
 * Stops at the `[DONE]` sentinel. Lines that don't start with `data: ` are
 * ignored (keep-alive comments, etc.).
 */
async function* parseSSE<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T, void, unknown> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        if (!data) continue;
        try {
          yield JSON.parse(data) as T;
        } catch (e) {
          throw new Error(
            `runjobs: decode stream chunk: ${(e as Error).message}`,
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

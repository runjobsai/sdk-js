import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
import type { SDKEvents } from "./events.js";
import { wrapEvents } from "./event-wrap.js";

/** Single-step computer-use request — a screenshot + history → next action(s). */
export interface ComputerStepParams {
  /**
   * Conversation history including screenshots and tool results. Each
   * entry has `role` + `content` (string or array of blocks). Format is
   * intentionally opaque to support both Anthropic and OpenAI computer-use
   * protocols — the gateway adapts.
   */
  messages: Record<string, unknown>[];
  /** Screen resolution. Defaults to 1920×1080 if omitted. */
  display_width?: number;
  display_height?: number;
  max_tokens?: number;
  enable_zoom?: boolean;
  /** OpenAI Responses-API state chaining. */
  previous_response_id?: string;
  /** Follow-up `computer_call_output` for OpenAI's Responses API. */
  openai_input?: unknown;
  user?: string;
}

/** One block of a computer-use response: text, tool_use (Anthropic), or computer_call (OpenAI). */
export interface ComputerContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  /** Anthropic tool input (raw JSON). */
  input?: unknown;
  call_id?: string;
  /** OpenAI computer-call action. */
  action?: Record<string, unknown>;
}

export interface ComputerResponse {
  content: ComputerContentBlock[];
  stop_reason?: string;
  usage: Usage;
  response_id?: string;
  /** "anthropic" | "openai" — which protocol the upstream returned. */
  protocol?: string;
}

export class ComputerService {
  constructor(
    private readonly transport: Transport,
    private readonly events: SDKEvents,
  ) {}

  /**
   * Execute one step of a computer-use agent loop. Given a screenshot
   * and conversation history, returns the next action(s) the model
   * wants the caller to execute.
   */
  async step(
    model: string,
    params: ComputerStepParams,
    init?: { signal?: AbortSignal },
  ): Promise<ComputerResponse> {
    return wrapEvents(
      this.events,
      { model, capability: "computer_use" },
      () =>
        this.transport.postJSON<ComputerResponse>(
          "/v1/computer/step",
          { model, ...params },
          init,
        ),
      (r) => ({
        totalTokens: r.usage?.completion_tokens,
        costUSD: r.usage?.total_cost,
      }),
    );
  }
}

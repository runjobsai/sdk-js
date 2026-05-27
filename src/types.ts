/**
 * Usage carries token consumption and cost information returned with every
 * gateway response. `total_cost` is the gateway's billing total in USD —
 * always present, while token counts are only populated when the upstream
 * provider surfaces them.
 *
 * For chat completions that invoked server-executed tools (via the
 * `server_tools` field), `total_cost` includes BOTH the model's raw
 * upstream cost (summed across iterations) AND the post-markup USD price
 * of every tool invocation.  The per-tool breakdown lives in `tool_costs`
 * so callers can attribute charges without having to re-run the loop.
 */
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  total_cost: number;
  tool_costs?: ToolCost[];
}

/**
 * Per-tool spend for a single chat completion that used server-executed
 * tools.  `cost` is in USD and already post-markup — it matches the
 * amount actually deducted from the user's balance for that tool's
 * invocations during the request.
 */
export interface ToolCost {
  name: string;
  count: number;
  cost: number;
}

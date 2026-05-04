/**
 * Usage carries token consumption and cost information returned with every
 * gateway response. `total_cost` is the gateway's billing total in USD —
 * always present, while token counts are only populated when the upstream
 * provider surfaces them.
 */
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  total_cost: number;
}

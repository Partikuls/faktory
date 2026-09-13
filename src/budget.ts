import type { FaktoryConfig } from "./config.js";
import type { SiteState } from "./state.js";

/** Throws the standard budget message when the site has already spent its cap (shared by `run`, `approve`, `resync` and the per-page loop). */
export function assertBudget(config: FaktoryConfig, state: SiteState): void {
  if (state.costUsd >= config.maxCostUsd) {
    throw new Error(`Cost budget reached ($${state.costUsd.toFixed(2)} >= $${config.maxCostUsd}); raise maxCostUsd in faktory.config.json or pass --max-cost to continue`);
  }
}

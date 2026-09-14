import type { FaktoryConfig } from "./config.js";
import type { SiteState } from "./state.js";
import type { SiteContext } from "./docker.js";

/** Throws the standard budget message when the site has already spent its cap (shared by `run`, `approve`, `resync` and the per-page loop). */
export function assertBudget(config: FaktoryConfig, state: SiteState): void {
  if (state.costUsd >= config.maxCostUsd) {
    throw new Error(`Cost budget reached ($${state.costUsd.toFixed(2)} >= $${config.maxCostUsd}); raise maxCostUsd in faktory.config.json or pass --max-cost to continue`);
  }
}

/** Smallest cap an agent is ever given (the SDK rejects a zero budget). */
export const MIN_AGENT_BUDGET_USD = 0.05;

type SlotGroup = { slots: number; active: number; reserved: number };
// In memory only: a group lives for one concurrent loop of one stage run.
const groups = new WeakMap<SiteContext, SlotGroup>();

const floorCents = (n: number): number => Math.floor(Math.round(n * 10000) / 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Open a group of `slots` concurrent agent runs for the duration of `fn`: every `reserveBudget` inside it gets a
 * share of what is left after the site's spend and the caps still reserved, so the caps in flight never add up to
 * more than the remaining budget.
 */
export async function withBudgetSlots<T>(ctx: SiteContext, slots: number, fn: () => Promise<T>): Promise<T> {
  if (groups.has(ctx)) throw new Error("withBudgetSlots: a budget group is already open for this site");
  groups.set(ctx, { slots: Math.max(1, slots), active: 0, reserved: 0 });
  try { return await fn(); } finally { groups.delete(ctx); }
}

export type BudgetReservation = { capUsd: number; release(): void };

/** The `maxBudgetUsd` of one agent run. Outside a group: the whole remaining budget. Call `release` once the run's real cost is on `ctx.state`. */
export function reserveBudget(ctx: SiteContext): BudgetReservation {
  const left = ctx.config.maxCostUsd - ctx.state.costUsd;
  const group = groups.get(ctx);
  if (!group) return { capUsd: Math.max(MIN_AGENT_BUDGET_USD, floorCents(left)), release: () => {} };
  const free = Math.max(1, group.slots - group.active);
  const capUsd = Math.max(MIN_AGENT_BUDGET_USD, floorCents((left - group.reserved) / free));
  group.active++;
  group.reserved = round4(group.reserved + capUsd);
  let released = false;
  return {
    capUsd,
    release: () => {
      if (released) return;
      released = true;
      group.active--;
      group.reserved = round4(group.reserved - capUsd);
    },
  };
}

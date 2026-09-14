import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { addCost } from "../../src/agent.js";
import { reserveBudget, withBudgetSlots } from "../../src/budget.js";
import type { SiteContext } from "../../src/docker.js";

const site = (spent: number, max = 40): SiteContext => ({
  config: { ...loadConfig("/tmp/fk"), maxCostUsd: max }, slug: "d", siteDir: "/tmp/fk/sites/d",
  state: { ...createState("d", 8100, "pw"), costUsd: spent },
});

describe("reserveBudget", () => {
  it("outside a group, the cap is the whole remaining budget floored to the cent, at least $0.05", () => {
    expect(reserveBudget(site(10.004)).capUsd).toBe(29.99);
    expect(reserveBudget(site(45)).capUsd).toBe(0.05);
  });
  it("inside a group, splits what is left among the free slots and never reserves more than is left", async () => {
    const ctx = site(10);
    await withBudgetSlots(ctx, 3, async () => {
      const a = reserveBudget(ctx), b = reserveBudget(ctx), c = reserveBudget(ctx);
      expect([a.capUsd, b.capUsd, c.capUsd]).toEqual([10, 10, 10]);
      ctx.state = addCost(ctx.state, 4); // a finishes having spent $4
      a.release();
      const d = reserveBudget(ctx); // (40 - 14 - 20) / 1
      expect(d.capUsd).toBe(6);
      expect(b.capUsd + c.capUsd + d.capUsd).toBeLessThanOrEqual(40 - ctx.state.costUsd);
    });
  });
  it("release is idempotent, and the group closes even when fn throws", async () => {
    const ctx = site(0);
    await expect(withBudgetSlots(ctx, 2, async () => {
      const r = reserveBudget(ctx);
      r.release(); r.release();
      expect(reserveBudget(ctx).capUsd).toBe(20);
      throw new Error("x");
    })).rejects.toThrow("x");
    expect(reserveBudget(ctx).capUsd).toBe(40);
  });
  it("refuses a nested group", async () => {
    const ctx = site(0);
    await expect(withBudgetSlots(ctx, 2, () => withBudgetSlots(ctx, 2, async () => 1))).rejects.toThrow(/already open/);
  });
});

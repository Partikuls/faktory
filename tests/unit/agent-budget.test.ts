import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({ ...(await importOriginal<object>()), query: vi.fn() }));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { runAgent } from "../../src/agent.js";
import { reserveBudget, withBudgetSlots } from "../../src/budget.js";

describe("runAgent budget", () => {
  it("passes a reserved cap as maxBudgetUsd and releases it after an error and after a result", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-ab-")));
    await initSite(config, { slug: "ab", briefPath: "fixtures/briefs/boulangerie.md" });
    const ctx = loadContext(config, "ab");
    const q = query as unknown as ReturnType<typeof vi.fn>;
    const seen: number[] = [];
    await withBudgetSlots(ctx, 2, async () => {
      q.mockImplementationOnce(({ options }: { options: { maxBudgetUsd: number } }) => {
        seen.push(options.maxBudgetUsd);
        return (async function* () { throw new Error("boom"); })();
      });
      await expect(runAgent(ctx, { stage: "pages", prompt: "x", allowedTools: [] })).rejects.toThrow("boom");
      q.mockImplementationOnce(({ options }: { options: { maxBudgetUsd: number } }) => {
        seen.push(options.maxBudgetUsd);
        return (async function* () { yield { type: "result", subtype: "success", total_cost_usd: 1, result: "ok", session_id: "s", num_turns: 1 }; })();
      });
      await runAgent(ctx, { stage: "pages", prompt: "x", allowedTools: [] });
      expect(seen).toEqual([20, 20]); // the failed run gave its slot back
      expect(reserveBudget(ctx).capUsd).toBe(19.5); // (40 - 1) / 2: nothing left reserved
    });
  });
});

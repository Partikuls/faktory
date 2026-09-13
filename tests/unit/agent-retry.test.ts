import { describe, it, expect, vi } from "vitest";
import { runValidated, retryPrompt, type AgentOptions, type AgentRun, type AgentRunner } from "../../src/agent.js";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";

const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "d", siteDir: "/tmp/fk/sites/d", state: createState("d", 8100, "pw") };
const opts: AgentOptions = { stage: "spec", prompt: "go", allowedTools: ["Read"], maxTurns: 5 };
const run = (structured: unknown, sessionId: string, costUsd = 0.5): AgentRun => ({ text: "", structured, costUsd, sessionId, numTurns: 3 });

describe("runValidated", () => {
  it("returns the first run when it validates", async () => {
    const runner = vi.fn<AgentRunner>().mockResolvedValueOnce(run({ ok: true }, "s1"));
    const r = await runValidated(runner, ctx, opts, (x) => { if (!(x.structured as { ok: boolean }).ok) throw new Error("not ok"); return "fine"; });
    expect(r).toMatchObject({ value: "fine", attempts: 1, costUsd: 0.5 });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][1].resume).toBeUndefined();
  });
  it("retries once in the same session with the validation error, summing the cost", async () => {
    const runner = vi.fn<AgentRunner>()
      .mockResolvedValueOnce(run({ ok: false }, "s1", 0.5))
      .mockResolvedValueOnce(run({ ok: true }, "s1", 0.2));
    const r = await runValidated(runner, ctx, opts, (x) => { if (!(x.structured as { ok: boolean }).ok) throw new Error("sitemap: needs exactly one home"); return "fine"; });
    expect(r).toMatchObject({ value: "fine", attempts: 2, costUsd: 0.7 });
    expect(runner).toHaveBeenCalledTimes(2);
    const second = runner.mock.calls[1][1];
    expect(second.resume).toBe("s1");
    expect(second.prompt).toBe(retryPrompt("sitemap: needs exactly one home"));
    expect(second.stage).toBe("spec");
    expect(second.allowedTools).toEqual(["Read"]);
  });
  it("throws after the second failure with the stage name and the last error", async () => {
    const runner = vi.fn<AgentRunner>().mockResolvedValue(run({ ok: false }, "s1"));
    await expect(runValidated(runner, ctx, opts, () => { throw new Error("still bad"); })).rejects.toThrow(/spec: output still invalid after one retry — still bad/);
    expect(runner).toHaveBeenCalledTimes(2);
  });
  it("supports an async validator", async () => {
    const runner = vi.fn<AgentRunner>().mockResolvedValueOnce(run(null, "s1"));
    const r = await runValidated(runner, ctx, opts, async () => 42);
    expect(r.value).toBe(42);
  });
});

describe("retryPrompt", () => {
  it("quotes the error and asks for the same format", () => {
    const p = retryPrompt("x: bad");
    expect(p).toContain("x: bad");
    expect(p).toMatch(/même format/);
  });
});

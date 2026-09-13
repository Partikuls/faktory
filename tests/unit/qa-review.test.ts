import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { writeState } from "../../src/state.js";
import { pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { TOOL_GB_BUILD } from "../../src/tools/server.js";
import type { PageCheck } from "../../src/schemas/qa.js";
import type { AgentRun } from "../../src/agent.js";
import { qaUserPrompt, qaResumePrompt, screenshotList, reviewPage, deps, QA_MAX_TURNS, QA_TOOLS, QA_WRITE_ROOTS } from "../../src/qa/review.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const home = spec.sitemap.find((p) => p.kind === "home")!;
const check = (): PageCheck => ({ ...JSON.parse(readFileSync("fixtures/qa/contact.check.json", "utf8")), url: "http://localhost:8101/" });
const TILES = { desktop: 2, mobile: 4 } as const;
const OK = { verdict: "ok", summary: "Rien à signaler.", issues: [] };
const FIXED = { verdict: "fixed", summary: "Titre mobile réduit.", issues: [{ severity: "minor", where: "section hero", what: "titre trop grand en mobile", action: "fixed" }] };

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-qareview-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  mkdirSync(join(c.siteDir, "pages"), { recursive: true });
  copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
  return c;
}
/** Simulates the agent: optionally rewrites the tree (adding cost to the state like runAgent does), then returns `structured`. */
function agent(steps: { structured: unknown; rewrite?: string; cost?: number }[]) {
  let i = 0;
  return vi.spyOn(deps, "runAgent").mockImplementation(async (c, opts) => {
    const s = steps[Math.min(i++, steps.length - 1)];
    if (s.rewrite !== undefined) writeFileSync(pageTreePath(c, "accueil"), s.rewrite);
    c.state = { ...c.state, costUsd: c.state.costUsd + (s.cost ?? 0.5) };
    writeState(c.siteDir, c.state);
    return { text: "", transcript: "", structured: s.structured, costUsd: s.cost ?? 0.5, sessionId: `s${i}`, numTurns: 3 } satisfies AgentRun;
  });
}

describe("qa prompts", () => {
  it("lists the screenshots full page first, then tiles, desktop then mobile", () => {
    expect(screenshotList("accueil", TILES)).toEqual([
      "qa/accueil.desktop.png", "qa/accueil.desktop.1.png", "qa/accueil.desktop.2.png",
      "qa/accueil.mobile.png", "qa/accueil.mobile.1.png", "qa/accueil.mobile.2.png", "qa/accueil.mobile.3.png", "qa/accueil.mobile.4.png",
    ]);
  });
  it("user prompt carries the page, its sections, the automated issues and the files to read", () => {
    const p = qaUserPrompt(spec, home, { ...check(), h1Count: 2, mobileOverflow: true }, TILES);
    expect(p).toContain("# Page `accueil` — ");
    expect(p).toContain("1. **hero**");
    expect(p).toContain("- 2 h1 (attendu : 1)");
    expect(p).toContain("- débordement horizontal en mobile");
    expect(p).toContain("qa/accueil.desktop.png");
    expect(p).toContain("qa/accueil.mobile.4.png");
    expect(p).toContain("pages/accueil.gb.json");
    expect(p).toContain("design-system.md");
    expect(qaUserPrompt(spec, home, check(), TILES)).toContain("Aucun défaut automatique.");
  });
  it("resume prompt says the page was republished, lists the remaining automated issues, and the recaptured screenshots", () => {
    const p = qaResumePrompt({ ...check(), missingAlt: 1 }, "accueil", TILES);
    expect(p).toContain("republiée");
    expect(p).toContain("- 1 image(s) sans alt");
    expect(p).toContain("Captures (refaites, à relire dans cet ordre)");
    expect(p).toContain("qa/accueil.desktop.png");
    expect(p).toContain("qa/accueil.mobile.4.png");
    expect(qaResumePrompt(check(), "accueil", TILES)).toContain("Aucun défaut automatique.");
  });
});

describe("reviewPage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs the qa agent with the right options and returns an unchanged tree on ok", async () => {
    const c = await ctx();
    const run = agent([{ structured: OK, cost: 0.4 }]);
    const r = await reviewPage(c, spec, home, check(), TILES);
    expect(r.verdict).toEqual(OK);
    expect(r.treeChanged).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.costUsd).toBe(0.4);
    expect(r.sessionId).toBe("s1");
    const opts = run.mock.calls[0][1];
    expect(opts.stage).toBe("qa");
    expect(opts.allowedTools).toEqual(["Read", "Write", TOOL_GB_BUILD]);
    expect(QA_TOOLS).toEqual(["Read", "Write", TOOL_GB_BUILD]);
    expect(opts.maxTurns).toBe(QA_MAX_TURNS);
    expect(opts.writeRoots).toEqual(QA_WRITE_ROOTS);
    expect(opts.outputFormat?.type).toBe("json_schema");
    expect(opts.resume).toBeUndefined();
    expect(opts.systemPrompt).toContain("relecteur QA");
  });
  it("returns the rewritten, validated tree on fixed", async () => {
    const c = await ctx();
    const tree = JSON.parse(readFileSync(pageTreePath(c, "accueil"), "utf8"));
    tree[0].styles = { ...(tree[0].styles ?? {}), paddingTop: "32px" };
    agent([{ structured: FIXED, rewrite: JSON.stringify(tree, null, 2) }]);
    const r = await reviewPage(c, spec, home, check(), TILES);
    expect(r.treeChanged).toBe(true);
    expect(r.verdict.verdict).toBe("fixed");
    expect((r.tree[0].styles as any).paddingTop).toBe("32px");
  });
  it("resumes the given session for a second round", async () => {
    const c = await ctx();
    const run = agent([{ structured: OK }]);
    await reviewPage(c, spec, home, check(), TILES, { resume: "prev" });
    expect(run.mock.calls[0][1].resume).toBe("prev");
    expect(run.mock.calls[0][1].prompt).toContain("republiée");
  });
  it("retries once on an inconsistent verdict, then accepts", async () => {
    const c = await ctx();
    const run = agent([{ structured: FIXED }, { structured: OK }]); // "fixed" without a change → retry → ok
    const r = await reviewPage(c, spec, home, check(), TILES);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1].resume).toBe("s1");
    expect(run.mock.calls[1][1].prompt).toContain("did not change");
    expect(r.attempts).toBe(2);
    expect(r.verdict).toEqual(OK);
    expect(r.costUsd).toBe(1);
  });
  it("restores an invalid rewritten tree and reports a rejected fix instead of failing", async () => {
    const c = await ctx();
    const before = readFileSync(pageTreePath(c, "accueil"), "utf8");
    agent([{ structured: FIXED, rewrite: "[]" }, { structured: FIXED, rewrite: "{ nope" }]);
    const r = await reviewPage(c, spec, home, check(), TILES);
    expect(readFileSync(pageTreePath(c, "accueil"), "utf8")).toBe(before);
    expect(r.treeChanged).toBe(false);
    expect(r.verdict.verdict).toBe("needs_human");
    expect(r.verdict.issues).toHaveLength(1);
    expect(r.verdict.issues[0]).toMatchObject({ severity: "major", where: "pages/accueil.gb.json", action: "left" });
    expect(r.verdict.issues[0].what).toMatch(/correction refusée : .*not valid JSON/);
    expect(r.rejected).toMatch(/output still invalid after one retry/);
    expect(r.attempts).toBe(2);
  });
  it("propagates other agent failures (budget, SDK error)", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockRejectedValue(new Error("Cost budget reached ($40.00 >= $40)"));
    await expect(reviewPage(c, spec, home, check(), TILES)).rejects.toThrow(/Cost budget reached/);
  });
});

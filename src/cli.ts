#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { initSite, listSites } from "./workspace.js";
import { runSite, approveSite, destroySite, loadContext } from "./pipeline.js";
import { STAGES, type StageName } from "./state.js";
import { run } from "./exec.js";
import { runAgent, pluginPath, pluginSkillNames } from "./agent.js";
import { gbScript } from "./gb.js";
import { findVendorZip, VENDOR_PLUGINS } from "./provision/stack.js";
import { TOOL_WP } from "./tools/server.js";

function asStage(v: string | undefined): StageName | undefined {
  if (v === undefined) return undefined;
  if (!(STAGES as readonly string[]).includes(v)) throw new Error(`Unknown stage "${v}". Stages: ${STAGES.join(", ")}`);
  return v as StageName;
}

const program = new Command();
program.name("faktory").description("WordPress AI software factory").version("0.1.0");

program.command("init <slug>").description("Create a site workspace from a brief")
  .requiredOption("--brief <path>", "Path to brief.md")
  .action(async (slug: string, opts: { brief: string }) => {
    const config = loadConfig();
    const { dir, state } = await initSite(config, { slug, briefPath: opts.brief });
    console.log(`Site "${slug}" created at ${dir} (port ${state.port}).`);
    console.log(`Next: faktory run ${slug}`);
  });
function withMaxCost(maxCost?: string) {
  const config = loadConfig();
  if (maxCost === undefined) return config;
  const n = Number(maxCost);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--max-cost must be a positive number of USD, got "${maxCost}"`);
  return { ...config, maxCostUsd: n };
}

program.command("run <slug>").description("Run the pipeline from the first incomplete stage")
  .option("--from <stage>").option("--only <stage>")
  .option("--max-cost <usd>", "Stop before any stage once the cumulated cost reaches this amount (default: faktory.config.json maxCostUsd)")
  .action(async (slug: string, opts: { from?: string; only?: string; maxCost?: string }) => {
    await runSite(withMaxCost(opts.maxCost), slug, { from: asStage(opts.from), only: asStage(opts.only) });
  });
program.command("provision <slug>").description("Alias for run --only provision")
  .action(async (slug: string) => { await runSite(loadConfig(), slug, { only: "provision" }); });
program.command("approve <slug>").description("Mark the awaiting checkpoint as approved (re-syncs JSON from an edited markdown when needed)")
  .action(async (slug: string) => { const s = await approveSite(loadConfig(), slug); console.log(`Approved. Next: faktory run ${s.slug}`); });
program.command("destroy <slug>").description("Stop containers, drop volumes, delete workspace")
  .option("--yes", "Skip confirmation")
  .option("--force", "Delete the workspace even if docker compose down fails")
  .action(async (slug: string, opts: { yes?: boolean; force?: boolean }) => {
    if (!opts.yes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question(`Destroy site "${slug}" (containers, volumes, workspace)? [y/N] `);
      rl.close();
      if (a.trim().toLowerCase() !== "y") { console.log("Aborted."); return; }
    }
    await destroySite(loadConfig(), slug, { force: opts.force });
    console.log(`Site "${slug}" destroyed.`);
  });
program.command("doctor").description("Check local toolchain and skill loading")
  .option("--agent", "Also run a tiny Agent SDK query to verify skill/plugin loading (costs a few cents)")
  .action(async (opts: { agent?: boolean }) => {
    const config = loadConfig();
    const checks: [string, boolean, string, boolean?][] = [];
    const ver = async (cmd: string, args: string[]) => (await run(cmd, args)).code === 0;
    checks.push(["docker", await ver("docker", ["--version"]), "install Docker Desktop"]);
    checks.push(["docker compose", await ver("docker", ["compose", "version"]), "Compose v2+ required"]);
    checks.push(["python3", await ver("python3", ["--version"]), "needed by gb_build.py"]);
    checks.push(["rsync", await ver("rsync", ["--version"]), "needed by sync-skills"]);
    checks.push(["skills synced", existsSync(join(pluginPath(config), "skills", "generatepress-generateblocks", "SKILL.md")), "run npm run sync-skills"]);
    const gbProbe = await run("python3", [gbScript(config, "gb_build.py")], { input: JSON.stringify({ type: "text", content: "ok" }) });
    checks.push(["gb_build.py", gbProbe.code === 0 && gbProbe.stdout.includes("wp:generateblocks/text"), "python3 + synced skills required"]);
    for (const v of VENDOR_PLUGINS) checks.push([`vendor ${v.slug}`, !!findVendorZip(config.vendorDir, v.prefix), `drop ${v.prefix}*.zip in docker/vendor/ (optional)`, true]);
    for (const [name, ok, hint, optional] of checks) console.log(`${ok ? "✔" : optional ? "ℹ" : "✖"} ${name}${ok ? "" : ` — ${hint}`}`);
    if (process.env.ANTHROPIC_API_KEY) {
      console.log("✔ ANTHROPIC_API_KEY set");
    } else {
      console.log("ℹ ANTHROPIC_API_KEY unset — the SDK will use the Claude Code login; run doctor --agent to prove it");
    }

    if (opts.agent) {
      const sites = listSites(config);
      if (!sites.length) throw new Error("Create a site first (faktory init) so doctor has a workspace to run in");
      const ctx = loadContext(config, sites[0]);
      const r = await runAgent(ctx, {
        stage: "doctor",
        prompt: "List the names of every skill available to you, one per line, then call the wp tool with args [\"cli\",\"version\"] and print its output verbatim. Nothing else.",
        allowedTools: [TOOL_WP],
        maxTurns: 4,
        model: "claude-sonnet-5",
      });
      console.log("\n--- agent ---\n" + r.text + `\n--- cost $${r.costUsd.toFixed(4)}, ${r.numTurns} turns ---`);
      const missing = pluginSkillNames().filter((n) => !r.text.includes(n));
      const hasWpCli = /WP-CLI \d/.test(r.text);
      const leakedUser = r.text.includes("wordpress-content-writer");
      const leakedBundled = r.text.includes("keybindings-help");
      let ok = true;
      if (missing.length) { console.log(`✖ missing plugin skill(s): ${missing.join(", ")}`); ok = false; }
      if (!hasWpCli) { console.log("✖ no WP-CLI version line in agent output"); ok = false; }
      if (leakedUser) { console.log("✖ global (user) skills leaked into the agent context"); ok = false; }
      if (leakedBundled) { console.log("✖ Claude Code bundled skills leaked into the agent context"); ok = false; }
      console.log(ok ? "✔ skills loaded and wp tool reachable" : "✖ skills or wp tool not visible to the agent — check plugin/ layout and docker state");
      if (!ok) process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline/promises";
import { loadConfig } from "./config.js";
import { initSite } from "./workspace.js";
import { runSite, approveSite, destroySite } from "./pipeline.js";
import { STAGES, type StageName } from "./state.js";

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
    const { dir, state } = initSite(config, { slug, briefPath: opts.brief });
    console.log(`Site "${slug}" created at ${dir} (port ${state.port}).`);
    console.log(`Next: faktory run ${slug}`);
  });
program.command("run <slug>").description("Run the pipeline from the first incomplete stage")
  .option("--from <stage>").option("--only <stage>")
  .action(async (slug: string, opts: { from?: string; only?: string }) => {
    await runSite(loadConfig(), slug, { from: asStage(opts.from), only: asStage(opts.only) });
  });
program.command("provision <slug>").description("Alias for run --only provision")
  .action(async (slug: string) => { await runSite(loadConfig(), slug, { only: "provision" }); });
program.command("approve <slug>").description("Mark the awaiting checkpoint as approved")
  .action(async (slug: string) => { const s = approveSite(loadConfig(), slug); console.log(`Approved. Next: faktory run ${s.slug}`); });
program.command("destroy <slug>").description("Stop containers, drop volumes, delete workspace")
  .option("--yes", "Skip confirmation")
  .action(async (slug: string, opts: { yes?: boolean }) => {
    if (!opts.yes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question(`Destroy site "${slug}" (containers, volumes, workspace)? [y/N] `);
      rl.close();
      if (a.trim().toLowerCase() !== "y") { console.log("Aborted."); return; }
    }
    await destroySite(loadConfig(), slug);
    console.log(`Site "${slug}" destroyed.`);
  });
program.command("doctor").description("Check local toolchain and skill loading")
  .action(async () => { throw new Error("not implemented"); });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

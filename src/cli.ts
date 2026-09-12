#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();
program.name("faktory").description("WordPress AI software factory").version("0.1.0");

program.command("init <slug>").description("Create a site workspace from a brief")
  .requiredOption("--brief <path>", "Path to brief.md")
  .action(async () => { throw new Error("not implemented"); });
program.command("run <slug>").description("Run the pipeline from the first incomplete stage")
  .option("--from <stage>").option("--only <stage>")
  .action(async () => { throw new Error("not implemented"); });
program.command("provision <slug>").description("Alias for run --only provision")
  .action(async () => { throw new Error("not implemented"); });
program.command("approve <slug>").description("Mark the awaiting checkpoint as approved")
  .action(async () => { throw new Error("not implemented"); });
program.command("destroy <slug>").description("Stop containers, drop volumes, delete workspace")
  .option("--yes", "Skip confirmation")
  .action(async () => { throw new Error("not implemented"); });
program.command("doctor").description("Check local toolchain and skill loading")
  .action(async () => { throw new Error("not implemented"); });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

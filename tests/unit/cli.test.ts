import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

describe("cli", () => {
  it("prints help with the expected commands", async () => {
    const { stdout } = await exec("npx", ["tsx", "src/cli.ts", "--help"]);
    for (const cmd of ["init", "run", "provision", "export", "approve", "resync", "status", "compare", "destroy", "doctor"]) {
      expect(stdout).toContain(cmd);
    }
  }, 20000);

  it("documents run --yes and status --history", async () => {
    const run = await exec("npx", ["tsx", "src/cli.ts", "run", "--help"]);
    expect(run.stdout).toContain("--yes");
    const status = await exec("npx", ["tsx", "src/cli.ts", "status", "--help"]);
    expect(status.stdout).toContain("--history");
  }, 20000);
});

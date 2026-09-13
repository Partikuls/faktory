import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

describe("cli", () => {
  it("prints help with the expected commands", async () => {
    const { stdout } = await exec("npx", ["tsx", "src/cli.ts", "--help"]);
    for (const cmd of ["init", "run", "provision", "approve", "resync", "destroy", "doctor"]) {
      expect(stdout).toContain(cmd);
    }
  });
});

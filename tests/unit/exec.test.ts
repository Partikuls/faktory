import { describe, it, expect } from "vitest";
import { run } from "../../src/exec.js";

describe("run", () => {
  it("captures stdout and code 0", async () => {
    const r = await run("echo", ["hello"]);
    expect(r.stdout.trim()).toBe("hello");
    expect(r.code).toBe(0);
  });
  it("returns non-zero code instead of throwing", async () => {
    const r = await run("sh", ["-c", "echo oops >&2; exit 3"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("oops");
  });
  it("returns code 127 when the binary is missing", async () => {
    const r = await run("definitely-not-a-binary-xyz", []);
    expect(r.code).toBe(127);
  });
  it("does not crash when the child exits before draining stdin", async () => {
    const r = await run("sh", ["-c", "exit 0"], { input: "y".repeat(2_000_000) });
    expect(r.code).toBe(0);
  });
  it("captures multi-byte UTF-8 characters split across stdout chunks without corruption", async () => {
    const expected = "é à € ".repeat(60_000); // ~1 MB, written in one process.stdout.write so Node splits it across chunks
    const r = await run("node", ["-e", `process.stdout.write(${JSON.stringify(expected)})`]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(expected);
    expect(r.stdout).not.toContain("�");
  });
});

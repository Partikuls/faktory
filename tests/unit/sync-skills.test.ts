import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/exec.js";

const NAMES = ["generatepress-generateblocks", "wp-plugin-development", "wp-block-development", "wp-wpcli-and-ops"];

describe("sync-skills.sh", () => {
  it("copies each skill directory and fails loudly when one is missing", async () => {
    const src = mkdtempSync(join(tmpdir(), "skills-src-"));
    const dest = mkdtempSync(join(tmpdir(), "skills-dest-"));
    for (const n of NAMES.slice(0, 3)) { mkdirSync(join(src, n, "scripts"), { recursive: true }); writeFileSync(join(src, n, "SKILL.md"), `# ${n}`); }
    const r1 = await run("bash", ["scripts/sync-skills.sh"], { env: { SKILLS_SRC: src, SKILLS_DEST: dest } });
    expect(r1.code).toBe(1);
    expect(r1.stderr).toContain("wp-wpcli-and-ops");
    mkdirSync(join(src, NAMES[3]), { recursive: true }); writeFileSync(join(src, NAMES[3], "SKILL.md"), "# x");
    const r2 = await run("bash", ["scripts/sync-skills.sh"], { env: { SKILLS_SRC: src, SKILLS_DEST: dest } });
    expect(r2.code, r2.stderr).toBe(0);
    for (const n of NAMES) expect(readFileSync(join(dest, n, "SKILL.md"), "utf8")).toContain(n === NAMES[3] ? "# x" : n);
    expect(existsSync(join(dest, NAMES[0], "scripts"))).toBe(true);
  });
});

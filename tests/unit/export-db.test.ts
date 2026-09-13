import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { DIST_DIR } from "../../src/artifacts.js";
import { SITE_URL_PLACEHOLDER, escapeSlashes, replaceEscapedUrls, assertPlaceholderDump, exportDb } from "../../src/export/db.js";

const LOCAL = "http://localhost:8101";
const DUMP = `\nDROP TABLE IF EXISTS \`wp_options\`;\nINSERT INTO \`wp_options\` VALUES (1,'siteurl','${SITE_URL_PLACEHOLDER}','yes');\nINSERT INTO \`wp_yoast_indexable\` VALUES (5,'{\\"url\\": \\"http:\\\\/\\\\/localhost:8101\\\\/wp-content\\\\/uploads\\\\/a.png\\"}');\n`;

function ctx(): SiteContext {
  const root = mkdtempSync(join(tmpdir(), "fk-exportdb-"));
  return { config: loadConfig(root), slug: "d", siteDir: join(root, "sites", "d"), state: createState("d", 8101, "pw") };
}

describe("db export helpers", () => {
  it("names dist and the placeholder", () => {
    expect(DIST_DIR).toBe("dist");
    expect(SITE_URL_PLACEHOLDER).toBe("https://SITE_URL_PLACEHOLDER");
  });
  it("escapes slashes the way JSON-in-SQL does", () => {
    expect(escapeSlashes("http://localhost:8101")).toBe("http:\\/\\/localhost:8101");
  });
  it("replaces the escaped local url (single- and double-backslash forms) by the escaped placeholder", () => {
    const out = replaceEscapedUrls(DUMP, LOCAL);
    expect(out).not.toContain("localhost:8101");
    expect(out).toContain("https:\\\\/\\\\/SITE_URL_PLACEHOLDER\\\\/wp-content");
    expect(replaceEscapedUrls("x http:\\/\\/localhost:8101\\/p y", LOCAL)).toBe("x https:\\/\\/SITE_URL_PLACEHOLDER\\/p y");
  });
  it("asserts the placeholder is present and no local url remains", () => {
    expect(() => assertPlaceholderDump(replaceEscapedUrls(DUMP, LOCAL), LOCAL)).not.toThrow();
    expect(() => assertPlaceholderDump(DUMP, LOCAL)).toThrow(/db.sql still contains 1 occurrence\(s\) of localhost:8101/);
    expect(() => assertPlaceholderDump("DROP TABLE x;", LOCAL)).toThrow(/db.sql does not contain https:\/\/SITE_URL_PLACEHOLDER — is the site url http:\/\/localhost:8101\?/);
    expect(() => assertPlaceholderDump("", LOCAL)).toThrow(/db.sql is empty/);
  });
});

describe("exportDb", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs search-replace --export against the site url and post-processes stdout", async () => {
    const c = ctx();
    const exec = vi.spyOn(wpDeps, "composeExec").mockResolvedValue({ stdout: DUMP, stderr: "PHP Warning: Constant WP_DEBUG already defined\nWarning: Skipping an uninitialized class", code: 0 });
    const r = await exportDb(c);
    expect(exec.mock.calls[0][2]).toEqual(["wp", "search-replace", LOCAL, SITE_URL_PLACEHOLDER, "--all-tables-with-prefix", "--export"]);
    expect(r.sql).not.toContain("localhost:8101");
    expect(r.sql).toContain(`'siteurl','${SITE_URL_PLACEHOLDER}'`);
    expect(r.bytes).toBe(Buffer.byteLength(r.sql));
  });
  it("fails with stderr when wp fails, and when the dump still has the local url", async () => {
    const c = ctx();
    vi.spyOn(wpDeps, "composeExec").mockResolvedValue({ stdout: "", stderr: "Error: no db", code: 1 });
    await expect(exportDb(c)).rejects.toThrow(/wp search-replace .* failed: Error: no db/);
    vi.spyOn(wpDeps, "composeExec").mockResolvedValue({ stdout: "INSERT x 'http://localhost:8101/' 'https://SITE_URL_PLACEHOLDER';", stderr: "", code: 0 });
    await expect(exportDb(c)).rejects.toThrow(/still contains 1 occurrence/);
  });
});

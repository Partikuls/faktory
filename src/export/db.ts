import { siteUrl, type SiteContext } from "../docker.js";
import { runWp } from "../wp.js";

export const deps = { runWp };
export const SITE_URL_PLACEHOLDER = "https://SITE_URL_PLACEHOLDER";

export const escapeSlashes = (s: string): string => s.replace(/\//g, "\\/");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * `wp search-replace` handles PHP-serialized values but not JSON stored as text: Yoast indexables keep the url
 * as `http:\/\/localhost:<port>` (and, once dumped inside a SQL string, `http:\\/\\/…`). Replace both forms.
 */
export function replaceEscapedUrls(dump: string, localUrl: string): string {
  const one = new RegExp(escapeRe(escapeSlashes(localUrl)), "g");
  const two = new RegExp(escapeRe(localUrl.replace(/\//g, "\\\\/")), "g");
  return dump.replace(two, SITE_URL_PLACEHOLDER.replace(/\//g, "\\\\/")).replace(one, escapeSlashes(SITE_URL_PLACEHOLDER));
}

export function assertPlaceholderDump(dump: string, localUrl: string): void {
  if (!dump.trim()) throw new Error("db.sql is empty — wp search-replace --export produced nothing");
  if (!dump.includes(SITE_URL_PLACEHOLDER)) throw new Error(`db.sql does not contain ${SITE_URL_PLACEHOLDER} — is the site url ${localUrl}?`);
  const host = localUrl.replace(/^https?:\/\//, "");
  const left = dump.split(host).length - 1;
  if (left) throw new Error(`db.sql still contains ${left} occurrence(s) of ${host} — the export must not leak the local url`);
}

/** Decision 13: the whole database with the local url replaced, captured on stdout; the live database is untouched. */
export async function exportDb(ctx: SiteContext): Promise<{ sql: string; bytes: number }> {
  const local = siteUrl(ctx);
  const args = ["search-replace", local, SITE_URL_PLACEHOLDER, "--all-tables-with-prefix", "--export"];
  const r = await deps.runWp(ctx, args);
  if (r.code !== 0) throw new Error(`wp ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim().split("\n").filter((l) => !l.includes("WP_DEBUG already defined")).join("\n")}`);
  const sql = replaceEscapedUrls(r.stdout, local);
  assertPlaceholderDump(sql, local);
  return { sql, bytes: Buffer.byteLength(sql) };
}

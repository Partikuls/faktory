import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { FaktoryConfig } from "./config.js";
import { createState, readState, writeState, STATE_FILE, type SiteState } from "./state.js";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

export function siteDir(config: FaktoryConfig, slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid slug "${slug}"`);
  return join(config.sitesRoot, slug);
}

export function listSites(config: FaktoryConfig): string[] {
  if (!existsSync(config.sitesRoot)) return [];
  return readdirSync(config.sitesRoot).filter((d) => existsSync(join(config.sitesRoot, d, STATE_FILE)));
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(false);
      else resolve(false);
    });
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

export async function allocatePort(config: FaktoryConfig): Promise<number> {
  const used = new Set(listSites(config).map((s) => readState(siteDir(config, s)).port));
  let port = config.portBase;
  while (used.has(port) || !(await isPortFree(port))) port++;
  return port;
}

export async function initSite(config: FaktoryConfig, opts: { slug: string; briefPath: string }): Promise<{ dir: string; state: SiteState }> {
  if (!SLUG_RE.test(opts.slug)) throw new Error(`Invalid slug "${opts.slug}": use lowercase letters, digits, dashes (2-31 chars)`);
  if (!existsSync(opts.briefPath)) throw new Error(`Brief not found: ${opts.briefPath}`);
  const dir = siteDir(config, opts.slug);
  if (existsSync(join(dir, STATE_FILE))) throw new Error(`Site "${opts.slug}" already exists at ${dir}`);
  for (const sub of ["", "wp-content", "pages", "plugins", "content", "qa", "dist"]) mkdirSync(join(dir, sub), { recursive: true });
  copyFileSync(opts.briefPath, join(dir, "brief.md"));
  const state = createState(opts.slug, await allocatePort(config), randomBytes(12).toString("base64url"));
  writeState(dir, state);
  return { dir, state };
}

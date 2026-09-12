import { existsSync, readdirSync } from "node:fs";
import type { SiteContext } from "../docker.js";
import { wpOk, wpJson } from "../wp.js";

export const WPORG_PLUGINS = ["generateblocks", "wordpress-seo"] as const;
export const VENDOR_PLUGINS = [
  { prefix: "gp-premium", slug: "gp-premium" },
  { prefix: "generateblocks-pro", slug: "generateblocks-pro" },
  { prefix: "gravityforms", slug: "gravityforms" },
  { prefix: "gravityformscli", slug: "gravityformscli" },
] as const;

export function findVendorZip(vendorDir: string, prefix: string): string | undefined {
  if (!existsSync(vendorDir)) return undefined;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([-_.].*)?\\.zip$`);
  return readdirSync(vendorDir).sort().find((f) => re.test(f));
}

type Item = { name: string; status: string };

export async function installStack(ctx: SiteContext): Promise<{ installed: string[]; missingVendor: string[] }> {
  const installed: string[] = [];
  const missingVendor: string[] = [];
  const childSlug = `faktory-${ctx.slug}`;

  const themes = await wpJson<Item[]>(ctx, ["theme", "list", "--fields=name,status"]);
  const hasTheme = (n: string) => themes.some((t) => t.name === n);
  if (!hasTheme("generatepress")) { await wpOk(ctx, ["theme", "install", "generatepress", "--activate"]); installed.push("generatepress"); }

  const plugins = await wpJson<Item[]>(ctx, ["plugin", "list", "--fields=name,status"]);
  const installedSet = new Set(plugins.map((p) => p.name));
  const activeSet = new Set(plugins.filter((p) => p.status === "active").map((p) => p.name));

  const wporgToInstall = WPORG_PLUGINS.filter((p) => !installedSet.has(p));
  const wporgToActivate = WPORG_PLUGINS.filter((p) => installedSet.has(p) && !activeSet.has(p));
  if (wporgToInstall.length) { await wpOk(ctx, ["plugin", "install", ...wporgToInstall, "--activate"]); installed.push(...wporgToInstall); }
  if (wporgToActivate.length) { await wpOk(ctx, ["plugin", "activate", ...wporgToActivate]); installed.push(...wporgToActivate); }

  for (const v of VENDOR_PLUGINS) {
    if (activeSet.has(v.slug)) continue;
    if (installedSet.has(v.slug)) { await wpOk(ctx, ["plugin", "activate", v.slug]); installed.push(v.slug); continue; }
    const zip = findVendorZip(ctx.config.vendorDir, v.prefix);
    if (!zip) { missingVendor.push(v.slug); continue; }
    await wpOk(ctx, ["plugin", "install", `/vendor/${zip}`, "--activate"]);
    installed.push(v.slug);
  }

  if (!hasTheme(childSlug)) {
    await wpOk(ctx, ["scaffold", "child-theme", childSlug, "--parent_theme=generatepress", `--theme_name=Faktory ${ctx.slug}`, "--activate"]);
    installed.push(childSlug);
  } else if (!themes.some((t) => t.name === childSlug && t.status === "active")) {
    await wpOk(ctx, ["theme", "activate", childSlug]);
  }
  return { installed, missingVendor };
}

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const ConfigFile = z.object({
  sitesRoot: z.string().default("sites"),
  vendorDir: z.string().default("docker/vendor"),
  portBase: z.number().int().min(1024).default(8100),
  adminEmail: z.string().email().default("khelil@partikuls.com"),
  models: z.object({ default: z.string().default("claude-opus-5") }).catchall(z.string()).default({ default: "claude-opus-5" }),
});

export type FaktoryConfig = {
  repoRoot: string;
  sitesRoot: string;
  vendorDir: string;
  portBase: number;
  adminEmail: string;
  models: { default: string } & Record<string, string>;
};

export function loadConfig(repoRoot: string = process.cwd()): FaktoryConfig {
  const file = join(repoRoot, "faktory.config.json");
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const parsed = ConfigFile.parse(raw);
  return {
    repoRoot,
    sitesRoot: resolve(repoRoot, parsed.sitesRoot),
    vendorDir: resolve(repoRoot, parsed.vendorDir),
    portBase: parsed.portBase,
    adminEmail: parsed.adminEmail,
    models: parsed.models as FaktoryConfig["models"],
  };
}

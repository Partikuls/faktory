import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FaktoryConfig } from "./config.js";
import { pluginPath } from "./agent.js";

export type PromptName = "spec" | "design";

export function loadPrompt(name: PromptName): string {
  return readFileSync(fileURLToPath(new URL(`./prompts/${name}.md`, import.meta.url)), "utf8");
}

export function designDoctrine(config: FaktoryConfig): string {
  const p = join(pluginPath(config), "skills", "generatepress-generateblocks", "references", "design-system.md");
  if (!existsSync(p)) { console.warn(`⚠ ${p} missing — run npm run sync-skills; design prompt continues without the doctrine`); return ""; }
  return readFileSync(p, "utf8");
}

export function designSystemPrompt(config: FaktoryConfig): string {
  const doctrine = designDoctrine(config);
  return doctrine ? `${loadPrompt("design")}\n\n---\n\n# Doctrine de design (références/design-system.md)\n\n${doctrine}` : loadPrompt("design");
}

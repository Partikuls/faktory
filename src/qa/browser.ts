import { existsSync } from "node:fs";
import { chromium } from "playwright";

/** True when the Chromium build matching the installed `playwright` package is present (`npm run setup-playwright`). */
export function chromiumInstalled(): boolean {
  return existsSync(chromium.executablePath());
}

import { composeExec, type SiteContext } from "./docker.js";
import type { ExecResult } from "./exec.js";

export const deps = { composeExec };

export function runWp(ctx: SiteContext, args: string[], opts: { input?: string } = {}): Promise<ExecResult> {
  return deps.composeExec(ctx, "wpcli", ["wp", ...args], { input: opts.input });
}

export async function wpOk(ctx: SiteContext, args: string[]): Promise<string> {
  const r = await runWp(ctx, args);
  if (r.code !== 0) throw new Error(`wp ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export async function wpJson<T = unknown>(ctx: SiteContext, args: string[]): Promise<T> {
  const out = await wpOk(ctx, [...args, "--format=json"]);
  return JSON.parse(out) as T;
}

/**
 * `waitForDb` is the only synchronization point between the `wordpress` container's
 * entrypoint bootstrap (which copies WordPress core into the shared volume and then
 * writes `wp-config.php`) and the `wpcli` sidecar. `wp db check` fails until
 * `wp-config.php` exists, so retrying it here is what makes later `wp` commands safe.
 */
export async function waitForDb(ctx: SiteContext, opts: { attempts?: number; delayMs?: number } = {}): Promise<void> {
  const attempts = opts.attempts ?? 30, delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < attempts; i++) {
    const r = await runWp(ctx, ["db", "check"]);
    if (r.code === 0) return;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error(`Database not reachable after ${attempts} attempts`);
}

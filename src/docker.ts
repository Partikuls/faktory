import { join } from "node:path";
import type { FaktoryConfig } from "./config.js";
import type { SiteState } from "./state.js";
import { run, type ExecResult } from "./exec.js";

export type SiteContext = { config: FaktoryConfig; slug: string; siteDir: string; state: SiteState };

export function composeFile(config: FaktoryConfig): string {
  return join(config.repoRoot, "docker", "docker-compose.yml");
}

export function composeEnv(ctx: SiteContext): Record<string, string> {
  return {
    FAKTORY_PORT: String(ctx.state.port),
    FAKTORY_SITE_DIR: ctx.siteDir,
    FAKTORY_VENDOR_DIR: ctx.config.vendorDir,
    COMPOSE_PROJECT_NAME: `faktory-${ctx.slug}`,
  };
}

export function composeArgs(ctx: SiteContext, ...rest: string[]): string[] {
  return ["compose", "-p", `faktory-${ctx.slug}`, "-f", composeFile(ctx.config), ...rest];
}

export function composeUp(ctx: SiteContext): Promise<ExecResult> {
  return run("docker", composeArgs(ctx, "up", "-d", "--wait"), { env: composeEnv(ctx) });
}

export function composeDown(ctx: SiteContext, opts: { volumes?: boolean } = {}): Promise<ExecResult> {
  return run("docker", composeArgs(ctx, "down", ...(opts.volumes ? ["-v"] : [])), { env: composeEnv(ctx) });
}

export function composeExec(ctx: SiteContext, service: string, cmd: string[], opts: { input?: string } = {}): Promise<ExecResult> {
  return run("docker", composeArgs(ctx, "exec", "-T", service, ...cmd), { env: composeEnv(ctx), input: opts.input });
}

export function siteUrl(ctx: SiteContext): string {
  return `http://localhost:${ctx.state.port}`;
}

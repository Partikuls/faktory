import { STAGES, type SiteState } from "./state.js";

/** `1h 03m 11s`, `2m 06s`, `0s`; a dash when the stage has no measured duration. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "–";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

export function formatCost(usd: number | undefined): string {
  return usd === undefined ? "–" : `$${usd.toFixed(2)}`;
}

/** Sum of the measured `run` durations (approval time is never counted). */
export function totalDurationMs(state: SiteState): number {
  return STAGES.reduce((sum, name) => sum + (state.stages[name].durationMs ?? 0), 0);
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]))).join("  ").trimEnd()).join("\n");
}

/** Human-readable status of a site: header line, one row per stage, totals, and the next command when a checkpoint awaits approval. */
export function renderStatus(state: SiteState): string {
  const rows: string[][] = [["stage", "status", "cost", "duration", "message"]];
  for (const name of STAGES) {
    const st = state.stages[name];
    rows.push([name, st.status, formatCost(st.costUsd), formatDuration(st.durationMs), st.message ?? ""]);
  }
  rows.push(["total", "", formatCost(state.costUsd), formatDuration(totalDurationMs(state)), ""]);
  const lines = [`${state.slug} — http://localhost:${state.port} (admin: ${state.adminUser}) — created ${state.createdAt}`, "", table(rows)];
  const waiting = STAGES.find((s) => state.stages[s].status === "awaiting_approval");
  if (waiting) lines.push("", `Stage ${waiting} awaits approval: faktory approve ${state.slug} && faktory run ${state.slug}`);
  return lines.join("\n");
}

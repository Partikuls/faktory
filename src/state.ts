import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const STAGES = ["spec", "design", "provision", "plugins", "pages", "content", "qa", "export"] as const;
export type StageName = (typeof STAGES)[number];
export const STAGE_STATUSES = ["pending", "running", "awaiting_approval", "done", "failed"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

const StageRecord = z.object({
  status: z.enum(STAGE_STATUSES),
  message: z.string().optional(),
  updatedAt: z.string().optional(),
});

const SiteStateSchema = z.object({
  slug: z.string(),
  port: z.number().int(),
  adminUser: z.string(),
  adminPassword: z.string(),
  createdAt: z.string(),
  costUsd: z.number(),
  stages: z.object(Object.fromEntries(STAGES.map((s) => [s, StageRecord])) as Record<StageName, typeof StageRecord>),
});

export type SiteState = z.infer<typeof SiteStateSchema>;

export const STATE_FILE = "faktory.json";

export function createState(slug: string, port: number, adminPassword: string): SiteState {
  return {
    slug, port, adminUser: "admin", adminPassword,
    createdAt: new Date().toISOString(), costUsd: 0,
    stages: Object.fromEntries(STAGES.map((s) => [s, { status: "pending" }])) as SiteState["stages"],
  };
}

export function readState(siteDir: string): SiteState {
  return SiteStateSchema.parse(JSON.parse(readFileSync(join(siteDir, STATE_FILE), "utf8")));
}

export function writeState(siteDir: string, state: SiteState): void {
  writeFileSync(join(siteDir, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
}

export function setStage(state: SiteState, name: StageName, status: StageStatus, message?: string): SiteState {
  return {
    ...state,
    stages: { ...state.stages, [name]: { status, message, updatedAt: new Date().toISOString() } },
  };
}

export function firstIncompleteStage(state: SiteState): StageName | undefined {
  return STAGES.find((s) => state.stages[s].status !== "done");
}

export function awaitingStage(state: SiteState): StageName | undefined {
  return STAGES.find((s) => state.stages[s].status === "awaiting_approval");
}

import type { Stage } from "../pipeline.js";
import { composeUp } from "../docker.js";
import { waitForDb } from "../wp.js";
import { installCore } from "../provision/core.js";
import { installStack } from "../provision/stack.js";

export const provisionStage: Stage = {
  name: "provision",
  async run(ctx) {
    const up = await composeUp(ctx);
    if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr.trim()}`);
    await waitForDb(ctx);
    const core = await installCore(ctx, { title: ctx.slug });
    const stack = await installStack(ctx);
    const parts = [core.freshInstall ? "fresh install" : "already installed", `installed: ${stack.installed.join(", ") || "nothing new"}`];
    if (stack.missingVendor.length) parts.push(`missing vendor zips: ${stack.missingVendor.join(", ")}`);
    return parts.join("; ");
  },
};

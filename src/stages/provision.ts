import type { Stage } from "../pipeline.js";
import { composeUp } from "../docker.js";
import { waitForDb } from "../wp.js";
import { installCore } from "../provision/core.js";
import { installStack, installLanguagePacks } from "../provision/stack.js";
import { applyIdentity, applyTokens } from "../provision/settings.js";
import { ensurePages, ensureMenus } from "../provision/pages.js";
import { installFooter } from "../provision/footer.js";
import { installChildTheme } from "../provision/child-theme.js";
import { installBlog } from "../provision/blog.js";
import { hasArtifact, readJsonArtifact } from "../artifacts.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { parseDesignTokens } from "../schemas/design-tokens.js";

export const deps = { composeUp, waitForDb, installCore, installStack, installLanguagePacks, applyIdentity, ensurePages, ensureMenus, applyTokens, installChildTheme, installFooter, installBlog };

export const provisionStage: Stage = {
  name: "provision",
  async run(ctx) {
    const spec = hasArtifact(ctx, "siteSpecJson") ? readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec) : undefined;
    const tokens = hasArtifact(ctx, "designTokensJson") ? readJsonArtifact(ctx, "designTokensJson", parseDesignTokens) : undefined;

    const up = await deps.composeUp(ctx);
    if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr.trim()}`);
    await deps.waitForDb(ctx);
    const core = await deps.installCore(ctx, { title: spec?.identity.name ?? ctx.slug });
    const stack = await deps.installStack(ctx);
    const parts = [core.freshInstall ? "fresh install" : "already installed", `installed: ${stack.installed.join(", ") || "nothing new"}`];
    if (stack.missingVendor.length) parts.push(`missing vendor zips: ${stack.missingVendor.join(", ")}`);
    const languageWarnings = await deps.installLanguagePacks(ctx);
    parts.push(languageWarnings.length ? `fr_FR packs: warn (${languageWarnings.join("; ")})` : "fr_FR packs: ok");

    if (spec) {
      await deps.applyIdentity(ctx, spec);
      const ids = await deps.ensurePages(ctx, spec);
      await deps.ensureMenus(ctx, spec, ids);
      const n = Object.keys(ids).length;
      parts.push(`${n} page${n === 1 ? "" : "s"} + primary menu`);
    } else {
      parts.push("no site-spec.json: identity/pages/menus skipped");
    }
    if (tokens) {
      await deps.applyTokens(ctx, tokens);
      parts.push("tokens applied");
      await deps.installChildTheme(ctx, tokens);
      parts.push("child theme styles");
    } else {
      parts.push("no design-tokens.json: tokens/child theme/footer/blog skipped");
    }
    if (spec && tokens) {
      if (stack.missingVendor.includes("gp-premium")) {
        parts.push("footer skipped: gp-premium zip missing");
      } else {
        const id = await deps.installFooter(ctx, spec, tokens);
        parts.push(`footer element #${id}`);
        const blog = await deps.installBlog(ctx, spec, tokens);
        parts.push(blog ? `blog elements #${blog.join(" #")}` : "blog elements skipped: no blog page");
      }
    }
    return parts.join("; ");
  },
};

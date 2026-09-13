import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { runWp, wpOk, wpJson } from "../wp.js";
import { pageTreePath } from "../artifacts.js";
import { readPageTree } from "../pages/generate.js";
import { compilePage, publishPage } from "../pages/publish.js";
import { applyPlacements, formPlacements, pluginPlacements, readFormsManifest, readPluginManifests } from "../pages/placements.js";
import { assertFormRendered } from "../pages/render-check.js";
import { formPages, formsManifestPath, gfPlacement, type FormsManifest } from "../schemas/forms-manifest.js";
import type { Form, SiteSpec } from "../schemas/site-spec.js";

export const deps = { runWp, wpOk, wpJson, compilePage, publishPage };

export type GfField = {
  id: number; type: string; label: string; adminLabel: string; isRequired: boolean;
  phoneFormat?: string; dateType?: string; dateFormat?: string; numberFormat?: string; choices?: { text: string; value: string }[];
};
export type GfForm = {
  title: string; description: string; labelPlacement: string; requiredIndicator: string;
  button: { type: string; text: string }; fields: GfField[];
  notifications: Record<string, { id: string; name: string; event: string; to: string; toType: string; from: string; fromName: string; subject: string; message: string; isActive: boolean }>;
};

/** Spec form → Gravity Forms form JSON (spec « Formulaire Gravity Forms »). Throws on a select without options. */
export function buildGfForm(spec: SiteSpec, form: Form, slug = "<slug>"): GfForm {
  const fields = form.fields.map((f, i): GfField => {
    const base: GfField = { id: i + 1, type: f.type, label: f.label, adminLabel: f.key, isRequired: f.required };
    switch (f.type) {
      case "phone": return { ...base, phoneFormat: "international" };
      case "date": return { ...base, dateType: "datepicker", dateFormat: "dmy" };
      case "number": return { ...base, numberFormat: "decimal_dot" };
      case "select":
        if (!f.options?.length) throw new Error(`form "${form.id}": field "${f.key}" is a select without options — fix SITE-SPEC.md and run: faktory resync ${slug}`);
        return { ...base, choices: f.options.map((o) => ({ text: o, value: o })) };
      default: return base;
    }
  });
  const name = spec.identity.name;
  return {
    title: form.name, description: "", labelPlacement: "top_label", requiredIndicator: "text",
    button: { type: "text", text: "Envoyer" }, fields,
    notifications: { faktory_admin: {
      id: "faktory_admin", name: "Notification admin", event: "form_submission", to: form.recipient, toType: "email",
      from: "{admin_email}", fromName: name, subject: `[${name}] ${form.name}`, message: "{all_fields}", isActive: true,
    } },
  };
}

type Listed = { id: string; title: string; is_active: string };

async function formExists(ctx: SiteContext, gfId: number): Promise<boolean> {
  return (await deps.runWp(ctx, ["gf", "form", "get", String(gfId)])).code === 0;
}

/**
 * Create the Gravity Forms forms of the spec (decision 2): reuse the manifest entry when its form still exists,
 * else adopt an active form of the same title, else create. Writes `content/forms.json`; no form is ever deleted.
 */
export async function ensureForms(ctx: SiteContext, spec: SiteSpec): Promise<{ manifest: FormsManifest; created: string[]; reused: string[] }> {
  if (!spec.forms.length) return { manifest: {}, created: [], reused: [] };
  const previous = readFormsManifest(ctx);
  const manifest: FormsManifest = {};
  const created: string[] = [], reused: string[] = [];
  let listed: Listed[] | undefined;
  for (const form of spec.forms) {
    const gf = buildGfForm(spec, form, ctx.slug); // validates the spec before any wp call
    const prev = previous[form.id];
    if (prev && await formExists(ctx, prev.gfId)) {
      manifest[form.id] = { gfId: prev.gfId, placement: gfPlacement(prev.gfId) };
      reused.push(form.id);
      continue;
    }
    listed ??= await deps.wpJson<Listed[]>(ctx, ["gf", "form", "form_list"]);
    const twin = listed.find((l) => l.title === form.name && l.is_active === "1");
    if (twin) {
      manifest[form.id] = { gfId: Number(twin.id), placement: gfPlacement(Number(twin.id)) };
      reused.push(form.id);
      continue;
    }
    const gfId = Number(await deps.wpOk(ctx, ["gf", "form", "create", form.name, `--form-json=${JSON.stringify(gf)}`, "--porcelain"]));
    if (!Number.isInteger(gfId) || gfId <= 0) throw new Error(`wp gf form create "${form.name}" did not return a form id`);
    manifest[form.id] = { gfId, placement: gfPlacement(gfId) };
    created.push(form.id);
    console.log(`  ✔ form ${form.id} → Gravity Forms #${gfId}`);
  }
  const p = formsManifestPath(ctx);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, created, reused };
}

/**
 * For every page that carries a form of the manifest and whose tree exists: apply every placement of the site
 * (plugins + forms), recompile, republish, then require `gform_wrapper_<gfId>` on the page. Pages without a
 * tree are skipped: the `pages` stage applies the manifest — and checks the wrapper — when it builds them.
 */
export async function integrateForms(
  ctx: SiteContext, spec: SiteSpec, manifest: FormsManifest, ids: Record<string, number>,
): Promise<{ pages: string[]; skipped: string[] }> {
  const manifests = readPluginManifests(ctx);
  const slugs: string[] = [];
  for (const id of Object.keys(manifest)) for (const s of formPages(spec, id)) if (!slugs.includes(s)) slugs.push(s);
  const pages: string[] = [], skipped: string[] = [];
  for (const slug of slugs) {
    const page = spec.sitemap.find((p) => p.slug === slug)!;
    if (!existsSync(pageTreePath(ctx, slug))) { skipped.push(slug); continue; }
    const id = ids[slug];
    if (!id) throw new Error(`no WordPress page for slug "${slug}" — run the provision stage first`);
    const tree = readPageTree(ctx, page);
    const forms = formPlacements(manifest, page);
    const a = applyPlacements(tree, [...pluginPlacements(manifests, slug), ...forms]);
    const markup = await deps.compilePage(ctx, slug, a.tree);
    await deps.publishPage(ctx, id, markup);
    for (const f of forms) await assertFormRendered(ctx, page, manifest[f.id].gfId);
    pages.push(slug);
    console.log(`  ✔ /${slug}/ renders ${forms.map((f) => `form ${f.id} (#${manifest[f.id].gfId})`).join(", ")}`);
  }
  return { pages, skipped };
}

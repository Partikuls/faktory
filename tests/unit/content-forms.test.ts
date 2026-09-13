import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec, type Page } from "../../src/schemas/site-spec.js";
import { formMarker, FORM_WRAPPER_ATTR, type PageTree } from "../../src/schemas/page-tree.js";
import { gfPlacement, formsManifestPath } from "../../src/schemas/forms-manifest.js";
import { buildGfForm, ensureForms, integrateForms, deps } from "../../src/content/forms.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const devis = spec.forms.find((f) => f.id === "devis_evenement")!;
const contactForm = spec.forms.find((f) => f.id === "contact")!;
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i) => ({
    type: "element" as const, tagName: "section", innerBlocks: [
      { type: "text" as const, tagName: i === 0 ? "h1" : "h2", content: s.heading },
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element" as const, tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form }, innerBlocks: [
            { type: "raw" as const, rawMarkup: formMarker(s.form) }, { type: "text" as const, tagName: "p", content: "Le formulaire sera disponible ici." } ] }]
        : []),
    ],
  }));
}
async function ctx(): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-forms-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}

describe("buildGfForm", () => {
  it("maps every spec field type, required flags and the admin notification", () => {
    const f = buildGfForm(spec, devis);
    expect(f.title).toBe(devis.name);
    expect(f.description).toBe("");
    expect(f.labelPlacement).toBe("top_label");
    expect(f.requiredIndicator).toBe("text");
    expect(f.button).toEqual({ type: "text", text: "Envoyer" });
    expect(f.fields.map((x) => [x.id, x.type, x.label, x.adminLabel, x.isRequired])).toEqual([
      [1, "text", "Nom", "nom", true], [2, "email", "Email", "email", true], [3, "phone", "Téléphone", "telephone", true],
      [4, "date", "Date de l'événement", "date_evenement", true], [5, "number", "Nombre de personnes", "nombre_personnes", true], [6, "textarea", "Votre projet", "message", false],
    ]);
    expect(f.fields[2]).toMatchObject({ phoneFormat: "international" });
    expect(f.fields[3]).toMatchObject({ dateType: "datepicker", dateFormat: "dmy" });
    expect(f.fields[4]).toMatchObject({ numberFormat: "decimal_dot" });
    expect(f.notifications).toEqual({ faktory_admin: {
      id: "faktory_admin", name: "Notification admin", event: "form_submission", to: "contact@maisonrivet.fr", toType: "email",
      from: "{admin_email}", fromName: spec.identity.name, subject: `[${spec.identity.name}] ${devis.name}`, message: "{all_fields}", isActive: true,
    } });
  });
  it("maps select options to choices and refuses a select without options", () => {
    const f = buildGfForm(spec, { ...contactForm, fields: [...contactForm.fields, { key: "sujet", label: "Sujet", type: "select", required: false, options: ["Commande", "Autre"] }] });
    expect(f.fields[3]).toMatchObject({ type: "select", choices: [{ text: "Commande", value: "Commande" }, { text: "Autre", value: "Autre" }] });
    expect(() => buildGfForm(spec, { ...contactForm, fields: [{ key: "sujet", label: "Sujet", type: "select", required: false }] }))
      .toThrow(/form "contact": field "sujet" is a select without options — fix SITE-SPEC.md and run: faktory resync <slug>/);
  });
});

describe("ensureForms", () => {
  beforeEach(() => vi.restoreAllMocks());
  function spies(opts: { existing?: number[]; listed?: { id: string; title: string; is_active: string }[] } = {}) {
    let next = 100;
    const runWp = vi.spyOn(deps, "runWp").mockImplementation(async (_c, args) => {
      if (args[0] === "gf" && args[2] === "get") return { code: (opts.existing ?? []).includes(Number(args[3])) ? 0 : 1, stdout: "", stderr: "Error: Form not found" };
      throw new Error(`unexpected runWp ${args.join(" ")}`);
    });
    const wpJson = vi.spyOn(deps, "wpJson").mockImplementation(async (_c, args) => {
      if (args[0] === "gf" && args[2] === "form_list") return (opts.listed ?? []) as any;
      throw new Error(`unexpected wpJson ${args.join(" ")}`);
    });
    const wpOk = vi.spyOn(deps, "wpOk").mockImplementation(async (_c, args) => {
      if (args[0] === "gf" && args[2] === "create") return String(next++);
      throw new Error(`unexpected wpOk ${args.join(" ")}`);
    });
    return { runWp, wpJson, wpOk };
  }
  it("creates every form of the spec with its JSON, writes the manifest", async () => {
    const c = await ctx();
    const s = spies();
    const r = await ensureForms(c, spec);
    expect(r.created).toEqual(["devis_evenement", "contact"]);
    expect(r.reused).toEqual([]);
    expect(r.manifest).toEqual({ devis_evenement: { gfId: 100, placement: gfPlacement(100) }, contact: { gfId: 101, placement: gfPlacement(101) } });
    const call = s.wpOk.mock.calls[0][1] as string[];
    expect(call.slice(0, 4)).toEqual(["gf", "form", "create", devis.name]);
    expect(call[4].startsWith("--form-json=")).toBe(true);
    expect(JSON.parse(call[4].slice("--form-json=".length))).toEqual(buildGfForm(spec, devis));
    expect(call[5]).toBe("--porcelain");
    expect(JSON.parse(readFileSync(formsManifestPath(c), "utf8"))).toEqual(r.manifest);
  });
  it("reuses a manifest entry whose form still exists, recreates a vanished one", async () => {
    const c = await ctx();
    writeFileSync(formsManifestPath(c), JSON.stringify({ devis_evenement: { gfId: 3, placement: gfPlacement(3) }, contact: { gfId: 4, placement: gfPlacement(4) } }));
    const s = spies({ existing: [3] });
    const r = await ensureForms(c, spec);
    expect(r.reused).toEqual(["devis_evenement"]);
    expect(r.created).toEqual(["contact"]);
    expect(r.manifest.devis_evenement.gfId).toBe(3);
    expect(r.manifest.contact.gfId).toBe(100);
    expect(s.wpOk).toHaveBeenCalledTimes(1);
  });
  it("adopts an active form of the same title before creating", async () => {
    const c = await ctx();
    const s = spies({ listed: [{ id: "7", title: contactForm.name, is_active: "1" }, { id: "8", title: devis.name, is_active: "0" }] });
    const r = await ensureForms(c, spec);
    expect(r.manifest.contact.gfId).toBe(7);
    expect(r.reused).toEqual(["contact"]);
    expect(r.created).toEqual(["devis_evenement"]); // inactive twin ignored → created
    expect(s.wpOk).toHaveBeenCalledTimes(1);
  });
  it("writes nothing and returns an empty manifest when the spec has no forms", async () => {
    const c = await ctx();
    spies();
    const r = await ensureForms(c, { ...spec, forms: [], sitemap: spec.sitemap.map((p) => ({ ...p, sections: p.sections.filter((s) => s.type !== "form" && s.type !== "contact") })) });
    expect(r).toEqual({ manifest: {}, created: [], reused: [] });
    expect(existsSync(formsManifestPath(c))).toBe(false);
  });
});

describe("integrateForms", () => {
  beforeEach(() => vi.restoreAllMocks());
  const manifest = { devis_evenement: { gfId: 2, placement: gfPlacement(2) }, contact: { gfId: 1, placement: gfPlacement(1) } };
  function spies(html = (url: string) => `<div id="gform_wrapper_${url.includes("contact") ? 1 : 2}"></div>`) {
    const compile = vi.spyOn(deps, "compilePage").mockImplementation(async (_c, slug) => `<!-- ${slug} -->`);
    const publish = vi.spyOn(deps, "publishPage").mockResolvedValue(undefined);
    const fetchText = vi.spyOn(renderDeps, "fetchText").mockImplementation(async (url) => html(url));
    return { compile, publish, fetchText };
  }
  it("recompiles, republishes and checks each page whose tree exists; skips the others", async () => {
    const c = await ctx();
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    writeFileSync(pageTreePath(c, "contact"), JSON.stringify(stubTree(contact)));
    const s = spies();
    const r = await integrateForms(c, spec, manifest, IDS);
    expect(r).toEqual({ pages: ["contact"], skipped: ["commandes-evenements"] });
    const tree = s.compile.mock.calls[0][2] as PageTree;
    expect(JSON.stringify(tree)).toContain(gfPlacement(1).replace(/"/g, '\\"'));
    expect(JSON.stringify(tree)).not.toContain(FORM_WRAPPER_ATTR);
    expect(s.publish).toHaveBeenCalledWith(c, 15, "<!-- contact -->");
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/contact/`);
  });
  it("also applies the plugin manifests of the site when republishing", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", join(c.siteDir, "plugins/catalogue_produits.json"));
    const commandes = spec.sitemap.find((p) => p.slug === "commandes-evenements")!;
    writeFileSync(pageTreePath(c, "commandes-evenements"), JSON.stringify(stubTree(commandes)));
    spies();
    const r = await integrateForms(c, spec, manifest, IDS);
    expect(r.pages).toEqual(["commandes-evenements"]);
  });
  it("fails when the published page does not render the wrapper", async () => {
    const c = await ctx();
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    writeFileSync(pageTreePath(c, "contact"), JSON.stringify(stubTree(contact)));
    spies(() => "<html>no form</html>");
    await expect(integrateForms(c, spec, manifest, IDS)).rejects.toThrow(/\/contact\/ \(contact\) does not render gform_wrapper_1/);
  });
  it("fails on a page with a tree but no WordPress id", async () => {
    const c = await ctx();
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    writeFileSync(pageTreePath(c, "contact"), JSON.stringify(stubTree(contact)));
    spies();
    await expect(integrateForms(c, spec, manifest, {})).rejects.toThrow(/no WordPress page for slug "contact" — run the provision stage first/);
  });
});

import { z } from "zod";

export const PAGE_KINDS = ["home", "standard", "blog", "contact"] as const;
export const SECTION_TYPES = ["hero", "features", "text", "gallery", "testimonials", "faq", "cta", "contact", "form", "custom-query", "hours"] as const;
export const FIELD_TYPES = ["text", "textarea", "number", "price", "date", "select", "boolean", "image", "url"] as const;
export const FORM_FIELD_TYPES = ["text", "email", "phone", "date", "number", "textarea", "select"] as const;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case slug").describe("kebab-case, used in the URL");
const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key");

export const Section = z.object({
  type: z.enum(SECTION_TYPES),
  heading: z.string().describe("Short French heading"),
  summary: z.string().describe("What the section shows, 1-3 sentences; copy hints allowed"),
  feature: z.string().optional().describe("Feature id — required when type is custom-query"),
  form: z.string().optional().describe("Form id — required when type is form or contact"),
});

export const Page = z.object({
  slug,
  title: z.string(),
  kind: z.enum(PAGE_KINDS).describe("Exactly one home page; blog = the posts page; contact = the page carrying the main contact form"),
  goal: z.string().describe("What the visitor should do or learn on this page"),
  seo: z.object({
    title: z.string().max(70),
    metaDescription: z.string().max(160),
    keywords: z.array(z.string()).min(1).max(8),
  }),
  sections: z.array(Section).min(1),
});

export type Page = z.infer<typeof Page>;

export const Feature = z.object({
  id: key,
  name: z.string(),
  description: z.string(),
  cpt: z.object({
    slug: z.string().regex(/^[a-z][a-z0-9_]{0,18}$/).describe("WordPress post type key, max 19 chars"),
    singular: z.string(),
    plural: z.string(),
  }),
  fields: z.array(z.object({ key, label: z.string(), type: z.enum(FIELD_TYPES), options: z.array(z.string()).optional() })),
  taxonomies: z.array(z.object({
    slug: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    singular: z.string(),
    plural: z.string(),
    terms: z.array(z.string()),
  })),
  display: z.string().describe("How and where entries are rendered (grid on which page, how many featured on home, filters)"),
});

export type Feature = z.infer<typeof Feature>;

export const Form = z.object({
  id: key,
  name: z.string(),
  recipient: z.string().email(),
  fields: z.array(z.object({
    key, label: z.string(), type: z.enum(FORM_FIELD_TYPES), required: z.boolean(), options: z.array(z.string()).optional(),
  })).min(1),
});

export type Form = z.infer<typeof Form>;

export const SiteSpecShape = z.object({
  identity: z.object({
    name: z.string(),
    sector: z.string(),
    tagline: z.string().describe("One line, French, used as site tagline"),
    tone: z.string(),
    language: z.literal("fr"),
    location: z.string().optional().describe("City / neighbourhood for local SEO"),
    contact: z.object({
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      hours: z.array(z.string()).optional().describe("One line per day or group of days"),
    }),
  }),
  sitemap: z.array(Page).min(1).max(12),
  features: z.array(Feature).describe("Admin-managed content types that need a custom plugin; empty when none"),
  forms: z.array(Form),
  blog: z.object({
    categories: z.array(z.string()).min(1),
    articles: z.array(z.object({ title: z.string(), theme: z.string(), keywords: z.array(z.string()).min(1) })).min(3).max(5),
  }),
  menus: z.object({
    primary: z.array(slug).min(1).describe("Page slugs in order"),
    footer: z.array(slug),
  }),
});

export const SiteSpec = SiteSpecShape.superRefine((s, ctx) => {
  const slugs = new Set(s.sitemap.map((p) => p.slug));
  const features = new Set(s.features.map((f) => f.id));
  const forms = new Set(s.forms.map((f) => f.id));
  if (s.sitemap.filter((p) => p.kind === "home").length !== 1) ctx.addIssue({ code: "custom", path: ["sitemap"], message: "sitemap needs exactly one page with kind \"home\"" });
  if (slugs.size !== s.sitemap.length) ctx.addIssue({ code: "custom", path: ["sitemap"], message: "duplicate page slugs" });
  for (const m of ["primary", "footer"] as const) {
    for (const sl of s.menus[m]) if (!slugs.has(sl)) ctx.addIssue({ code: "custom", path: ["menus", m], message: `menus.${m}: unknown page slug "${sl}"` });
  }
  s.sitemap.forEach((p, pi) => p.sections.forEach((sec, si) => {
    const path = ["sitemap", pi, "sections", si];
    if (sec.type === "custom-query" && !sec.feature) ctx.addIssue({ code: "custom", path, message: `section "${sec.heading}" is custom-query but has no feature` });
    if ((sec.type === "form" || sec.type === "contact") && !sec.form) ctx.addIssue({ code: "custom", path, message: `section "${sec.heading}" is ${sec.type} but has no form` });
    if (sec.feature && !features.has(sec.feature)) ctx.addIssue({ code: "custom", path, message: `unknown feature "${sec.feature}"` });
    if (sec.form && !forms.has(sec.form)) ctx.addIssue({ code: "custom", path, message: `unknown form "${sec.form}"` });
  }));
});

export type SiteSpec = z.infer<typeof SiteSpecShape>;

export function parseSiteSpec(data: unknown): SiteSpec {
  const r = SiteSpec.safeParse(data);
  if (!r.success) throw new Error(`Invalid site spec: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

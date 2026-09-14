import type { Browser } from "playwright";
import type { SiteContext } from "../docker.js";
import { runWp } from "../wp.js";
import { VIEWPORTS, type FormSubmission } from "../schemas/qa.js";

export const deps = { runWp };

/** The parts of `wp gf form get <id>` the submission needs. */
export type GfLiveField = { id: number; type: string; isRequired?: boolean; choices?: { text: string; value: string }[] | "" };
export type GfLiveForm = { id: number | string; fields: GfLiveField[] };

const pad = (n: number): string => String(n).padStart(2, "0");

/** The next day in the `dmy` format Faktory gives its date fields. */
export function tomorrow(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** A valid value for every field of the live form; free-text values carry `marker` so the entry can be found and deleted. */
export function formValues(form: GfLiveForm, marker: string, now: Date = new Date()): Record<number, string> {
  const out: Record<number, string> = {};
  for (const f of form.fields) {
    switch (f.type) {
      case "email": out[f.id] = `qa+${marker}@faktory.test`; break;
      case "phone": out[f.id] = "+33 6 00 00 00 00"; break;
      case "date": out[f.id] = tomorrow(now); break;
      case "number": out[f.id] = "2"; break;
      case "textarea": out[f.id] = `Message de test Faktory ${marker}`; break;
      case "select": out[f.id] = Array.isArray(f.choices) && f.choices.length ? f.choices[0].value : ""; break;
      default: out[f.id] = `Test Faktory ${marker}`;
    }
  }
  return out;
}

type EntryRow = { id: string | number } & Record<string, unknown>;

/**
 * Fill and send form `gfId` on `url` like a visitor, wait for its confirmation, then find the entry by its marker and
 * delete it. Never throws: every problem is reported as `ok: false` with a French `error`. The admin notification is
 * not checked (no SMTP in the stack).
 */
export async function submitForm(
  browser: Browser, ctx: SiteContext, url: string, formId: string, gfId: number,
  opts: { values?: Record<number, string>; timeoutMs?: number } = {},
): Promise<FormSubmission> {
  const done = (error?: string): FormSubmission => ({ formId, gfId, url, ok: !error, ...(error ? { error } : {}), checkedAt: new Date().toISOString() });
  const marker = `fq${Date.now()}`;
  try {
    const got = await deps.runWp(ctx, ["gf", "form", "get", String(gfId)]);
    if (got.code !== 0) return done(`formulaire introuvable : ${(got.stderr || got.stdout).trim().slice(0, 200)}`);
    const form = JSON.parse(got.stdout) as GfLiveForm;
    const values = { ...formValues(form, marker), ...opts.values };
    let problem: string | undefined;
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      for (const f of form.fields) {
        const selector = `#input_${gfId}_${f.id}`, value = values[f.id] ?? "";
        if (f.type === "select") { if (value) await page.selectOption(selector, value); }
        else await page.fill(selector, value);
      }
      await page.keyboard.press("Escape"); // closes the date picker, which can cover the submit button
      await page.click(`#gform_submit_button_${gfId}`);
      try {
        await page.locator(`#gform_confirmation_message_${gfId}`).waitFor({ timeout: opts.timeoutMs ?? 15_000 });
      } catch {
        const messages = await page.locator(".gfield_validation_message, .gform_submission_error").allInnerTexts().catch(() => [] as string[]);
        problem = `pas de confirmation (« ${messages.map((m) => m.trim()).filter(Boolean).join(" ; ").slice(0, 200)} »)`;
      }
    } finally {
      await context.close();
    }
    const listed = await deps.runWp(ctx, ["gf", "entry", "list", String(gfId), "--format=json", "--page_size=50"]);
    const entries = listed.code === 0 ? (JSON.parse(listed.stdout) as EntryRow[]) : [];
    const entry = entries.find((e) => Object.values(e).some((v) => typeof v === "string" && v.includes(marker)));
    if (!entry) return done(problem ?? "aucune entrée créée");
    // An entry is always removed, even when the confirmation was missing.
    const removed = await deps.runWp(ctx, ["gf", "entry", "delete", String(entry.id), "--force"]);
    if (removed.code !== 0) return done(problem ?? `entrée #${entry.id} non supprimée`);
    return done(problem);
  } catch (err) {
    return done((err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 300));
  }
}

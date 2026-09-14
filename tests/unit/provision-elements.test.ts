import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { esc, stepper, text, upsertBlockElement } from "../../src/provision/elements.js";

const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));
const ctx: SiteContext = { config: loadConfig(process.cwd()), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };

describe("node helpers", () => {
  it("escapes html, clamps the spacing ramp and builds text nodes", () => {
    expect(esc(`Pain & "Co" <b>`)).toBe("Pain &amp; &quot;Co&quot; &lt;b&gt;");
    const step = stepper(tokens);
    expect(step(0)).toBe(tokens.spacing[0]);
    expect(step(99)).toBe(tokens.spacing.at(-1));
    expect(text("h1", "Titre")).toEqual({ type: "text", tagName: "h1", content: "Titre", styles: {} });
    expect(text("a", "x", {}, { href: "/" }).htmlAttributes).toEqual({ href: "/" });
  });
});

describe("upsertBlockElement", () => {
  beforeEach(() => vi.restoreAllMocks());
  const argsOf = (spy: any) => spy.mock.calls.map((c: any) => ({ a: (c[2] as string[]).slice(1).join(" "), input: (c[3] as { input?: string } | undefined)?.input }));
  it("creates the element, pushes markup on stdin, writes the type, every meta and the conditions", async () => {
    const spy = vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = cmd.slice(1).join(" ");
      if (a.startsWith("post list --post_type=gp_elements")) return { stdout: "[]", stderr: "", code: 0 };
      if (a.startsWith("post create")) return { stdout: "7\n", stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    const id = await upsertBlockElement(ctx, { slug: "faktory-x", title: "Faktory x", markup: "<p>m</p>", meta: { _generate_block_type: "page-hero", _generate_hook: "generate_after_header" }, conditions: [{ rule: "general:blog", object: "" }] });
    expect(id).toBe(7);
    const c = argsOf(spy);
    expect(c.map((x: any) => x.a)).toEqual([
      "option update generate_package_elements activated",
      "post list --post_type=gp_elements --post_status=any --fields=ID,post_name --format=json",
      "post create --post_type=gp_elements --post_status=publish --post_title=Faktory x --post_name=faktory-x --porcelain",
      "post update 7 -",
      "post meta update 7 _generate_element_type block",
      "post meta update 7 _generate_block_type page-hero",
      "post meta update 7 _generate_hook generate_after_header",
      'post meta update 7 _generate_element_display_conditions [{"rule":"general:blog","object":""}] --format=json',
    ]);
    expect(c[3].input).toBe("<p>m</p>");
  });
  it("reuses an existing element with the same slug", async () => {
    const spy = vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = cmd.slice(1).join(" ");
      if (a.startsWith("post list --post_type=gp_elements")) return { stdout: JSON.stringify([{ ID: 3, post_name: "faktory-x" }]), stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    expect(await upsertBlockElement(ctx, { slug: "faktory-x", title: "t", markup: "m", meta: {}, conditions: [] })).toBe(3);
    expect(argsOf(spy).some((x: any) => x.a.startsWith("post create"))).toBe(false);
  });
});

import { siteUrl, type SiteContext } from "../docker.js";
import { runWp, wpOk, wpJson } from "../wp.js";

export async function installCore(ctx: SiteContext, opts: { title: string }): Promise<{ freshInstall: boolean }> {
  const installed = (await runWp(ctx, ["core", "is-installed"])).code === 0;
  if (!installed) {
    await wpOk(ctx, [
      "core", "install",
      `--url=${siteUrl(ctx)}`, `--title=${opts.title}`,
      `--admin_user=${ctx.state.adminUser}`, `--admin_password=${ctx.state.adminPassword}`,
      `--admin_email=${ctx.config.adminEmail}`, "--skip-email",
    ]);
  }
  await wpOk(ctx, ["language", "core", "install", "fr_FR", "--activate"]);
  await wpOk(ctx, ["rewrite", "structure", "/%postname%/"]);
  await wpOk(ctx, ["option", "update", "timezone_string", "Europe/Paris"]);
  await wpOk(ctx, ["option", "update", "date_format", "j F Y"]);
  await wpOk(ctx, ["option", "update", "time_format", "G\\hi"]);
  await wpOk(ctx, ["option", "update", "start_of_week", "1"]);
  await wpOk(ctx, ["option", "update", "blogdescription", ""]);
  if (!installed) {
    const ids = await wpJson<number[]>(ctx, ["post", "list", "--post_type=post,page", "--field=ID"]);
    if (ids.length) await wpOk(ctx, ["post", "delete", ...ids.map(String), "--force"]);
    await runWp(ctx, ["plugin", "uninstall", "akismet", "hello", "--deactivate"]);
  }
  return { freshInstall: !installed };
}

import type { z } from "zod";
import type { SiteContext } from "./docker.js";
import { runAgent } from "./agent.js";
import { ARTIFACTS, isStale, writeJsonArtifact, type ArtifactKey } from "./artifacts.js";
import { toJsonSchema } from "./schemas/json-schema.js";

export const deps = { runAgent };

export type ResyncOptions<T> = {
  mdKey: ArtifactKey;
  jsonKey: ArtifactKey;
  shape: z.ZodType;
  parse: (u: unknown) => T;
  what: string;
};

/**
 * When the human-edited markdown is newer than its JSON twin, re-extract the JSON with a cheap
 * structured-output query (model `config.models.resync`). Returns the new data, or undefined when nothing to do.
 */
export async function resyncFromMarkdown<T>(ctx: SiteContext, opts: ResyncOptions<T>): Promise<T | undefined> {
  if (!isStale(ctx, opts.mdKey, opts.jsonKey)) return undefined;
  const md = ARTIFACTS[opts.mdKey], json = ARTIFACTS[opts.jsonKey];
  console.log(`↻ ${md} was edited after ${json}: re-extracting ${opts.what}…`);
  const r = await deps.runAgent(ctx, {
    stage: "resync",
    prompt: [
      `Le fichier \`${md}\` a été modifié à la main après la génération de \`${json}\`.`,
      `Lis les deux fichiers avec Read. Produis la nouvelle version structurée de ${opts.what} qui reflète exactement le contenu de \`${md}\` :`,
      `reprends les valeurs de \`${json}\` partout où le markdown n'a rien changé, et applique chaque modification du markdown (ajouts, suppressions, renommages, nouvelles valeurs).`,
      "N'invente rien qui ne soit ni dans le markdown ni dans le JSON. Réponds uniquement avec la structure demandée.",
    ].join("\n"),
    allowedTools: ["Read"],
    outputFormat: { type: "json_schema", schema: toJsonSchema(opts.shape) },
    maxTurns: 8,
  });
  const data = opts.parse(r.structured);
  writeJsonArtifact(ctx, opts.jsonKey, data);
  return data;
}

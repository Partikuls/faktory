import { z } from "zod";

/** JSON Schema for the Agent SDK `outputFormat`. zod 4 emits draft 2020-12 with a `$schema` key we drop. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

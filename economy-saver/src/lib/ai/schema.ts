import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";

/** Moves constraints a strict-schema API ignores into descriptions (the SDK's own transform); used for every tool schema. */
export const strictJsonSchema = (schema: Record<string, unknown>): Record<string, unknown> =>
  transformJSONSchema(schema) as Record<string, unknown>;

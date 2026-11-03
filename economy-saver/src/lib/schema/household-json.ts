// The committed JSON Schema (schema/household.v1.json) is generated from the zod definition with the same
// library the agent's tool schemas use (zod-to-json-schema). `npm run schema` writes it; snapshot-test fails on drift.
import { zodToJsonSchema } from "zod-to-json-schema";
import { HouseholdSnapshot } from "./household";

export const SCHEMA_FILE = "schema/household.v1.json";

/** Pretty-printed with a trailing newline. Key order follows the zod definition, so it is stable. */
export function householdJsonSchema(): string {
  const { $schema, description, ...rest } = zodToJsonSchema(HouseholdSnapshot, { $refStrategy: "none" }) as Record<string, unknown>;
  return JSON.stringify({ $schema, title: "HouseholdSnapshot", description, ...rest }, null, 2) + "\n";
}

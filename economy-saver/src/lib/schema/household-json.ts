// The committed JSON Schemas (schema/*.json) are generated from the zod definitions with the same library the agent's tool
// schemas use (z.toJSONSchema). `npm run schema` writes them; snapshot-test fails on drift.
import { z } from "zod";
import { recipeJsonSchema } from "@/lib/canvas/schema";
import { CashFlowEvent } from "./cash-flow";
import { HouseholdSnapshot } from "./household";
import { MemoryItem } from "./memory";
import { ConversationTurn } from "./turn";

export const SCHEMA_FILE = "schema/household.v5.json";

function titled(schema: z.ZodType, title: string): string {
  const { $schema, description, ...rest } = z.toJSONSchema(schema, { target: "draft-07", io: "input", reused: "inline", unrepresentable: "any" }) as Record<string, unknown>;
  return JSON.stringify({ $schema, title, ...(description ? { description } : {}), ...rest }, null, 2) + "\n";
}

/** Pretty-printed with a trailing newline. Key order follows the zod definition, so it is stable. */
export function householdJsonSchema(): string {
  return titled(HouseholdSnapshot, "HouseholdSnapshot");
}

/** Every committed schema file: path (from economy-saver/) and its text. */
export function schemaFiles(): { file: string; text: string }[] {
  return [
    { file: SCHEMA_FILE, text: householdJsonSchema() },
    { file: "schema/recipe.v1.json", text: recipeJsonSchema() },
    { file: "schema/memory.v1.json", text: titled(MemoryItem, "MemoryItem") },
    { file: "schema/turn.v1.json", text: titled(ConversationTurn, "ConversationTurn") },
    { file: "schema/cash-flow-event.v1.json", text: titled(CashFlowEvent, "CashFlowEvent") },
  ];
}

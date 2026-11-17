// One turn of the Ask conversation (D60), version 1: a question and the reply the app chose. The shape of a stored row and of the export.
import { z } from "zod";
import { RecipeSchema } from "@/lib/canvas/schema";
import { QUESTION_MAX } from "@/lib/question-limit";

export const TURN_VERSION = 1;
const sourceLabel = z.string().min(1).max(60);
export const LinkSource = z.object({ label: sourceLabel, href: z.string().min(1).max(200) }).strict();
export type LinkSource = z.infer<typeof LinkSource>;
export const DEVICE_MEMORY_SOURCE_LABEL = "Memory on this device";
export function memorySourceLabel(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= 60 ? line : `${line.slice(0, 59).replace(/[\uD800-\uDBFF]$/, "")}…`;
}
export const MemorySource = z.object({ kind: z.literal("memory"), id: z.uuid(), label: sourceLabel }).strict();
export type MemorySource = z.infer<typeof MemorySource>;
export const TurnSource = z.union([LinkSource, MemorySource]);
export type TurnSource = z.infer<typeof TurnSource>;
/** Where the turn kept something (D60), stored beside the sources so a reloaded turn shows the same buttons as the live one. */
const SavedLink = z.object({ kind: z.literal("saved"), label: sourceLabel, href: z.string().min(1).max(200) }).strict();
type SavedLink = z.infer<typeof SavedLink>;
export const StoredSource = z.union([LinkSource, MemorySource, SavedLink]);
export type StoredSource = z.infer<typeof StoredSource>;
/** The sources and the links of a turn as stored in one list. */
export const storeSources = (sources: readonly TurnSource[], links: readonly { label: string; href: string }[]): StoredSource[] =>
  [...sources, ...links.map(({ label, href }): SavedLink => ({ kind: "saved", label, href }))];
export function splitSources(stored: readonly StoredSource[]): { sources: TurnSource[]; links: { label: string; href: string }[] } {
  const sources: TurnSource[] = []; const links: { label: string; href: string }[] = [];
  for (const item of stored) { if ("kind" in item && item.kind === "saved") links.push({ label: item.label, href: item.href }); else sources.push(item); }
  return { sources, links };
}
export const TurnKind = z.enum(["answer", "clarify", "declined", "document"]);
export type TurnKind = z.infer<typeof TurnKind>;

export const ConversationTurn = z.object({
  version: z.literal(TURN_VERSION),
  id: z.uuid(),
  conversationId: z.uuid(),
  /** A device turn in a space carries its scope so a later deletion cannot turn it into a legacy conversation. */
  spaceId: z.uuid().optional(),
  question: z.string().min(1).max(QUESTION_MAX),
  kind: TurnKind,
  reply: z.string().min(1),
  choices: z.array(z.string().min(1).max(60)).min(2).max(4).nullable(),
  recipe: RecipeSchema.nullable(),
  sources: z.array(StoredSource),
  /** D60: the file attached in Ask (kind document); absent on every other turn. */
  documentId: z.uuid().nullable().optional(),
  thumb: z.union([z.literal(1), z.literal(-1)]).nullable(),
  createdAt: z.string(),
}).strict();
export type ConversationTurn = z.infer<typeof ConversationTurn>;

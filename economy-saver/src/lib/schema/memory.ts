// What the assistant remembers about a person (D58), version 1. One item is one short piece of text with a kind.
import { z } from "zod";

export const MEMORY_VERSION = 1;
export const MEMORY_LIMIT = 200;
export const MEMORY_TEXT_MAX = 400;
/** The most JSON characters of memory the agent reads at the start of a question (whole items only). */
export const MEMORY_PROMPT_MAX = 6_000;
/** A run of this many digits (spaces and hyphens between digits count as part of the run) is a card or account number. */
export const SECRET_DIGITS = 12;
export const SECRET_REFUSAL = "The assistant doesn't keep card or account numbers.";
export const hasLongNumber = (text: string): boolean =>
  new RegExp(`\\d(?:[ \\-\u2010-\u2015\u2212\u00a0]?\\d){${SECRET_DIGITS - 1},}`).test(text.normalize("NFKC"));

export const MEMORY_KIND_KEYS = ["fact", "preference", "goal", "instruction", "correction"] as const;
export const MemoryKind = z.enum(MEMORY_KIND_KEYS);
export type MemoryKind = z.infer<typeof MemoryKind>;

/** Plain label, a line of help and an example for each kind, in the order the page shows them. */
export const MEMORY_KINDS: Record<MemoryKind, { label: string; help: string; example: string }> = {
  fact: { label: "Fact", help: "Something true about your money life.", example: "Rent goes up in April" },
  preference: { label: "Preference", help: "How you like answers and suggestions.", example: "Answer in Japanese" },
  goal: { label: "Goal", help: "Something you are saving or working towards.", example: "¥300,000 for a trip in March" },
  instruction: { label: "Standing instruction", help: "Something to do every time it applies.", example: "Mention the tax pot when a payment lands" },
  correction: { label: "Correction", help: "Something it got wrong and learned from.", example: "The gym is shared, not mine alone" },
};

export const MemoryText = z.string().trim().min(1, "Write something for the assistant to remember.").max(MEMORY_TEXT_MAX, `Keep it under ${MEMORY_TEXT_MAX + 1} characters.`);

export const MemoryItem = z.object({
  id: z.string().uuid(),
  kind: MemoryKind,
  text: MemoryText,
  madeBy: z.enum(["form", "ask", "mcp"]),
  askId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type MemoryItem = z.infer<typeof MemoryItem>;

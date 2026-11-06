// One turn of the Ask conversation (D60), version 1: a question and the reply the app chose. The shape of a stored row and of the export.
import { z } from "zod";
import { RecipeSchema } from "@/lib/canvas/schema";

export const TURN_VERSION = 1;
/** The most turns a household keeps; the oldest go first. */
export const TURN_LIMIT = 200;
/** A conversation carries on while its last turn is younger than this; the last three turns then go to the model as context. */
export const CONVERSATION_MINUTES = 10;
export const CONTEXT_TURNS = 3;

export const TurnSource = z.object({ label: z.string().min(1).max(60), href: z.string().min(1).max(200) }).strict();
export type TurnSource = z.infer<typeof TurnSource>;
export const TurnKind = z.enum(["answer", "clarify", "declined"]);
export type TurnKind = z.infer<typeof TurnKind>;

export const ConversationTurn = z.object({
  version: z.literal(TURN_VERSION),
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  question: z.string().min(1).max(320),
  kind: TurnKind,
  reply: z.string().min(1),
  choices: z.array(z.string().min(1).max(60)).min(2).max(4).nullable(),
  recipe: RecipeSchema.nullable(),
  sources: z.array(TurnSource),
  thumb: z.union([z.literal(1), z.literal(-1)]).nullable(),
  createdAt: z.string(),
}).strict();
export type ConversationTurn = z.infer<typeof ConversationTurn>;

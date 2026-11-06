import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { aiConnection, connectionView } from "./ai-key";
import { requireHousehold, type Db } from "./household";
import { loadCanvasContext } from "@/lib/canvas/request";
import { resolveRecipe, type ResolvedBlock } from "@/lib/canvas/resolve";
import { RecipeSchema, type Recipe } from "@/lib/canvas/schema";
import { consumeRequest, requestCount } from "./rate-limit";
import { recentTurns, saveTurn } from "./conversation";
import { conversationTurns } from "./schema";
import { runAgent } from "@/lib/agent/run";
import { serverDefaultHost } from "@/lib/agent/availability";
import { DECLINES_PER_HOUR, FIXED, firstUse, type ReplyKind, type Source } from "@/lib/agent/reply";
import { CONTEXT_TURNS } from "@/lib/schema/turn";
import { appUrl } from "@/lib/supabase-auth";

export const askInput = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(), text: z.string().trim().min(1).max(320),
  source: z.enum(["voice", "manual"]),
  /** The canvas on screen, so "make it a table" or "what about March?" can change it. */
  canvas: RecipeSchema.nullable(),
});

// A constant, not a literal after the word kind and a colon: the Activity label scan reads those in src/db as event kinds.
const DECLINED: ReplyKind = "declined";

/** What the page and the route show for one question: the reply, the canvas the engine drew from the recipe, the pages it used. */
export type AskReply = {
  id: string; kind: ReplyKind; text: string; choices: string[] | null;
  canvas: { recipe: Recipe; blocks: ResolvedBlock[] } | null;
  sources: Source[]; links: { label: string; href: string }[]; pending: boolean; firstUse: string | null;
};

/** The earlier turns and the canvas on screen, as quoted data after the question (never an amount source). */
export async function conversationContext(db: Db, hid: string, input: Pick<z.infer<typeof askInput>, "conversationId" | "canvas">, now = new Date()): Promise<string> {
  const turns = await recentTurns(db, hid, input.conversationId, now);
  const parts: string[] = [];
  if (turns.length) {
    parts.push(`Earlier in this conversation, for context only; read every number again from the tools:\n${turns.slice(-CONTEXT_TURNS).map(turn => `Question: ${JSON.stringify(turn.question)}\nReply: ${JSON.stringify(turn.reply)}`).join("\n")}`);
  }
  if (input.canvas) parts.push(`The canvas on screen now, as data:\n${JSON.stringify(input.canvas)}`);
  return parts.join("\n\n");
}

/** The line above the question box until the household has an answer: null once it has one, or while no model is set up. */
export async function firstUseLine(db: Db, householdId: string): Promise<string | null> {
  const hid = requireHousehold(householdId);
  const [answered] = await db.select({ id: conversationTurns.id }).from(conversationTurns)
    .where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.kind, "answer"))).limit(1);
  if (answered) return null;
  const own = await connectionView(db, hid);
  const host = own?.host ?? serverDefaultHost();
  return host ? firstUse(host) : null;
}

/** Free-form questions go to the agent (D40). `pending` is true when a tool left a bill or charge in To check (D39). */
export async function answerQuestion(db: Db, hid: string, input: z.infer<typeof askInput>, deps: { fetch?: typeof globalThis.fetch; at?: Date } = {}): Promise<AskReply> {
  const { id, conversationId, text, source, canvas } = askInput.parse(input);
  const householdId = requireHousehold(hid);
  // Five declined questions an hour: the sixth gets a fixed sentence with no model call and no stored turn.
  if (await requestCount(db, householdId, "out-of-scope", "hour") >= DECLINES_PER_HOUR) {
    return { id, kind: DECLINED, text: FIXED.wait, choices: null, canvas: null, sources: [], links: [], pending: false, firstUse: null };
  }
  const context = await conversationContext(db, householdId, { conversationId, canvas }, deps.at);
  const result = await runAgent({ db, householdId, question: text, askId: id, source, appUrl: appUrl(), context, fetch: deps.fetch, connection: () => aiConnection(db, householdId, "text") });
  if (result.kind === "declined") await consumeRequest(db, householdId, "out-of-scope", DECLINES_PER_HOUR, "hour");
  await saveTurn(db, householdId, {
    id, conversationId, question: text, kind: result.kind, reply: result.answer, choices: result.choices, recipe: result.recipe, sources: result.sources,
  }, deps.at);
  const drawn = result.recipe ? { recipe: result.recipe, blocks: resolveRecipe(result.recipe, await loadCanvasContext(db, householdId)) } : null;
  return { id, kind: result.kind, text: result.answer, choices: result.choices, canvas: drawn, sources: result.sources, links: result.links, pending: result.pending, firstUse: await firstUseLine(db, householdId) };
}

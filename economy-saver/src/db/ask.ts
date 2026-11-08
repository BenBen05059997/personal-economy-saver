import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { aiConnection, connectionView } from "./ai-key";
import { requireHousehold, withHousehold, type Db } from "./household";
import { householdMoment } from "./clock";
import { InputError } from "./input-error";
import { readPlaces } from "./place";
import { loadCanvasContext } from "@/lib/canvas/request";
import { resolveRecipe, type ResolvedBlock } from "@/lib/canvas/resolve";
import { RecipeSchema, type Recipe } from "@/lib/canvas/schema";
import { askReceipt, noteAskReply, noteAskWrote } from "./ask-receipts";
import { requireSpace } from "./spaces";
import { recentTurns, saveTurn, turnById } from "./conversation";
import { documentCard } from "./document-card";
import { conversationTurns, households } from "./schema";
import { AgentError, runAgent, type AskResult } from "@/lib/agent/run";
import type { KeepOffer } from "@/lib/agent/keep-offer";
import { serverDefaultHost } from "@/lib/agent/availability";
import { FIXED, firstUse, type ReplyKind, type Source } from "@/lib/agent/reply";
import { cardContext, type DocumentCard } from "@/lib/reader/document-card";
import { MemoryItem } from "@/lib/schema/memory";
import { CONTEXT_TURNS, ConversationTurn } from "@/lib/schema/turn";
import type { DeviceMemory, MemoryChange } from "@/lib/store/memory-ops";
import { appUrl } from "@/lib/supabase-auth";

export const askInput = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(), text: z.string().trim().min(1).max(320),
  spaceId: z.string().uuid().optional(),
  source: z.enum(["voice", "manual"]),
  /** The canvas on screen, so "make it a table" or "what about March?" can change it. */
  canvas: RecipeSchema.nullable(),
  /** D59: sent only when the household keeps its memory on one device (the whole list, at most 200). Used for this question and never stored. */
  memory: z.array(MemoryItem).max(200).optional(),
  /** D59: sent only when the household keeps its conversations on one device (the conversation's last three turns, when it is under ten minutes old). Used for this question and never stored. */
  recent: z.array(ConversationTurn).max(3).optional(),
});

// A constant, not a literal after the word kind and a colon: the Activity label scan reads those in src/db as event kinds.
const ANSWER: ReplyKind = "answer";

/** What the page and the route show for one question: the reply, the canvas the engine drew from the recipe, the pages it used. */
export type AskReply = {
  id: string; kind: ReplyKind; text: string; choices: string[] | null;
  canvas: { recipe: Recipe; blocks: ResolvedBlock[] } | null;
  sources: Source[]; links: { label: string; href: string }[]; pending: boolean; firstUse: string | null;
  /** D59: what `remember` and `forget` did to the memory the question carried; the browser applies it to its own copy. Empty when memory is in the cloud. */
  memoryChanges: MemoryChange[];
  /** Offers live with this reply until the person chooses. They are not journal entries. */
  offers: KeepOffer[];
};

/** The earlier turns and the canvas on screen, as quoted data after the question (never an amount source). */
/** The household's current moment (a Try it household's fixed date at the real time of day). */
async function clockMoment(db: Db, hid: string, at?: Date): Promise<Date> {
  const [household] = await db.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid));
  if (!household) throw new InputError("Household not found");
  return householdMoment(household, at);
}

export async function conversationContext(db: Db, hid: string, input: Pick<z.infer<typeof askInput>, "conversationId" | "canvas">, now = new Date()): Promise<string> {
  return withHousehold(db, hid, async tx => {
    const turns = await recentTurns(tx, hid, input.conversationId, now);
    return contextText(turns, input.canvas, await documentCards(tx, hid, turns));
  });
}

/** The cards of the document turns among these turns (D61), without the money state: their words and read lines only. */
async function documentCards(db: Db, hid: string, turns: ConversationTurn[]): Promise<Map<string, DocumentCard>> {
  const ids = [...new Set(turns.slice(-CONTEXT_TURNS).flatMap(turn => (turn.kind === "document" && turn.documentId ? [turn.documentId] : [])))];
  return new Map(await Promise.all(ids.map(async id => [id, await documentCard(db, hid, id, { draw: false })] as const)));
}

/** The same text from turns already in hand (the ones a question carried from the device). */
export function contextText(turns: ConversationTurn[], canvas: Recipe | null, cards: ReadonlyMap<string, DocumentCard> = new Map()): string {
  const parts: string[] = [];
  if (turns.length) {
    parts.push(`Earlier in this conversation, for context only; read every number again from the tools:\n${turns.slice(-CONTEXT_TURNS).map(turn => {
      const card = turn.kind === "document" && turn.documentId ? cards.get(turn.documentId) : undefined;
      return `Question: ${JSON.stringify(turn.question)}\nReply: ${JSON.stringify(card ? cardContext(card) : turn.reply)}`;
    }).join("\n")}`);
  }
  if (canvas) parts.push(`The canvas on screen now, as data:\n${JSON.stringify(canvas)}`);
  return parts.join("\n\n");
}

/** The line above the question box until the household has an answer: null once it has one, or while no model is set up. */
export async function firstUseLine(db: Db, householdId: string, options: { skipAnswered?: boolean } = {}): Promise<string | null> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    // `skipAnswered`: the conversations are on the device, which knows whether it has an answer; the server cannot look.
    const [answered] = options.skipAnswered ? [] : await tx.select({ id: conversationTurns.id }).from(conversationTurns)
      .where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.kind, "answer"))).limit(1);
    if (answered) return null;
    const own = await connectionView(tx, hid);
    const host = own?.host ?? serverDefaultHost();
    return host ? firstUse(host) : null;
  });
}

/** Free-form questions go to the agent (D40). `pending` is true when a tool left a bill or charge in To check (D39). */
export async function answerQuestion(db: Db, hid: string, input: z.infer<typeof askInput>, deps: { fetch?: typeof globalThis.fetch; at?: Date; onStep?: (step: string) => void } = {}): Promise<AskReply> {
  const { id, conversationId, spaceId, text, source, canvas, memory, recent } = askInput.parse(input);
  const householdId = requireHousehold(hid);
  const prepared = await withHousehold<{ reply: AskReply } | { context: string; deviceMemory?: DeviceMemory }>(db, householdId, async tx => {
    // A kind kept on the device comes with the question and is never stored here; a kind kept in the cloud is read here and the question must not carry it.
    if (spaceId !== undefined) {
      await requireSpace(tx, householdId, spaceId);
      if (conversationId !== spaceId || recent?.some(turn => turn.conversationId !== spaceId))
        throw new InputError("Use the thread of the selected space.");
    }
    const places = await readPlaces(tx, householdId);
    if ((places.memory === "device") !== (memory !== undefined)) throw new InputError(places.memory === "device"
      ? "This household keeps its memory on this device, so the question has to bring it. Reload the page and ask again."
      : "This household keeps its memory in our cloud. Reload the page and ask again.");
    if ((places.journal === "device") !== (recent !== undefined)) throw new InputError(places.journal === "device"
      ? "This household keeps its conversations on this device, so the question has to bring the last ones. Reload the page and ask again."
      : "This household keeps its conversations in our cloud. Reload the page and ask again.");
    // A question retried after its reply was lost has the same id: the saved turn is the reply, and nothing runs or writes again.
    const kept = recent === undefined ? await turnById(tx, householdId, id) : null;
    if (kept && (kept.question !== text || kept.conversationId !== conversationId)) throw new InputError("This question was already answered. Reload the page and ask again.");
    if (kept) {
      const receipt = await askReceipt(tx, householdId, id);
      const drawn = kept.recipe ? { recipe: kept.recipe, blocks: resolveRecipe(kept.recipe, await loadCanvasContext(tx, householdId, kept.recipe)) } : null;
      return { reply: {
        id, kind: kept.kind === "document" ? ANSWER : kept.kind, text: kept.reply, choices: kept.choices, canvas: drawn,
        sources: kept.sources, links: receipt?.links ?? [], pending: receipt?.pending ?? false, firstUse: await firstUseLine(tx, householdId), memoryChanges: [], offers: [],
      } };
    }
    // The conversations are on the device, so no turn is stored here to replay; the receipt says this id already wrote, and nothing runs or writes again.
    const wrote = recent !== undefined ? await askReceipt(tx, householdId, id) : null;
    if (wrote) {
      return { reply: {
        id, kind: ANSWER, text: FIXED.alreadySaved, choices: null, canvas: null, sources: [],
        links: wrote.links.length ? wrote.links : [{ label: "Open To check", href: new URL("/to-check", appUrl()).href }], pending: wrote.pending, firstUse: null, memoryChanges: [], offers: [],
      } };
    }
    const context = recent !== undefined ? contextText(recent, canvas, await documentCards(tx, householdId, recent)) : await conversationContext(tx, householdId, { conversationId, canvas }, deps.at);
    const deviceMemory = memory === undefined ? undefined : { items: [...memory], changes: [], moment: await clockMoment(tx, householdId, deps.at) };
    return { context, deviceMemory };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if ("reply" in prepared) return prepared.reply;
  const { context, deviceMemory } = prepared;
  let result: AskResult;
  try {
    result = await runAgent({
      db, householdId, question: text, askId: id, source, appUrl: appUrl(), context, fetch: deps.fetch, deviceMemory, onStep: deps.onStep,
      onWrote: recent === undefined ? undefined : () => withHousehold(db, householdId, tx => noteAskWrote(tx, householdId, id)),
      connection: () => aiConnection(db, householdId, "text"),
    });
  } catch (error) {
    // A write tool already succeeded: what it kept is shown, with the reason the answer stopped, instead of an error that hides it (a retry would write it twice).
    if (!(error instanceof AgentError) || !error.saved) throw error;
    result = { kind: ANSWER, answer: FIXED.savedThenStopped + error.message, choices: null, recipe: null, sources: [], links: error.saved.links, pending: error.saved.pending, offers: [] };
  }
  await withHousehold(db, householdId, async tx => {
    if (spaceId !== undefined) await requireSpace(tx, householdId, spaceId, true);
    await noteAskReply(tx, householdId, id, result);
    if (recent === undefined) {
      await saveTurn(tx, householdId, {
        id, conversationId, question: text, kind: result.kind, reply: result.answer, choices: result.choices, recipe: result.recipe, sources: result.sources,
      }, deps.at);
    }
  });
  const { drawn, firstUse } = await withHousehold(db, householdId, async tx => ({
    drawn: result.recipe ? { recipe: result.recipe, blocks: resolveRecipe(result.recipe, await loadCanvasContext(tx, householdId, result.recipe)) } : null,
    firstUse: recent === undefined ? await firstUseLine(tx, householdId) : null,
  }), { isolationLevel: "repeatable read", accessMode: "read only" });
  return {
    id, kind: result.kind, text: result.answer, choices: result.choices, canvas: drawn, sources: result.sources, links: result.links, pending: result.pending,
    firstUse, memoryChanges: deviceMemory?.changes ?? [], offers: result.offers,
  };
}

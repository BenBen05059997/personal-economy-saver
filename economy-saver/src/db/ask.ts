import { and, desc, eq, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { aiConnection, connectionView } from "./ai-key";
import { requireHousehold, withHousehold, type Db } from "./household";
import { householdMoment } from "./clock";
import { InputError } from "./input-error";
import { readPlaces } from "./place";
import { loadCanvasContext } from "@/lib/canvas/request";
import { resolveRecipe, type ResolvedBlock } from "@/lib/canvas/resolve";
import { RecipeSchema, type Recipe } from "@/lib/canvas/schema";
import { askReceipt, claimAskReceipt, noteAskReply, noteAskWrote, releaseAskReceipt } from "./ask-receipts";
import { requireSpace, saveBrief } from "./spaces";
import { saveTurn, turnById } from "./conversation";
import { documentCard } from "./document-card";
import { conversationTurns, households, spaces } from "./schema";
import { AgentError, runAgent, type AskResult } from "@/lib/agent/run";
import type { KeepOffer } from "@/lib/agent/keep-offer";
import { serverDefaultHost } from "@/lib/agent/availability";
import { FIXED, firstUse, type ReplyKind, type Source } from "@/lib/agent/reply";
import { cardContext, type DocumentCard } from "@/lib/reader/document-card";
import { listMemory } from "./memory";
import { memoryBlock } from "@/lib/agent/memory-prompt";
import { BriefSchema, briefContext, type BriefRecord } from "@/lib/agent/brief";
import { ContextTurn, contextTail, THREAD_CONTEXT_MAX, turnWords } from "@/lib/agent/context";
import { DEVICE_MEMORY_SOURCE_LABEL } from "@/lib/schema/turn";
import { MemoryItem } from "@/lib/schema/memory";
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
  /** D59: the browser’s thread tail and brief, used for this question only. */
  recent: z.array(ContextTurn).optional(),
  history: z.array(ContextTurn).optional(),
  incognito: z.boolean().optional(),
  earlierCount: z.number().int().nonnegative().safe().optional(),
  deviceBrief: BriefSchema.optional(),
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
  brief?: BriefRecord;
  memoryChanged?: boolean;
  incognito?: boolean;
  openSpace?: { name: string };
};

/** The household's current moment (a Try it household's fixed date at the real time of day). */
async function clockMoment(db: Db, hid: string, at?: Date): Promise<Date> {
  const [household] = await db.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid));
  if (!household) throw new InputError("Household not found");
  return householdMoment(household, at);
}

type ContextInput = Pick<z.infer<typeof askInput>, "conversationId" | "canvas" | "spaceId" | "memory" | "recent" | "earlierCount" | "deviceBrief">;

/** Postgres counts a lower bound on serialized characters. JS checks the exact budget of the retained tail. */
async function storedContextTurns(tx: Db, hid: string, conversationId: string) {
  const t = conversationTurns;
  const newest = sql`order by ${t.createdAt} desc, ${t.id} desc`;
  const overhead = JSON.stringify({ question: "", reply: "" }).length;
  const measured = tx.select({
    id: t.id, conversationId: t.conversationId, question: t.question, reply: t.reply, kind: t.kind,
    documentId: t.documentId, createdAt: t.createdAt,
    total: sql<number>`count(*) over ()::int`.as("total"),
    size: sql<number>`sum(char_length(${t.question}) + char_length(${t.reply}) + ${overhead}) over (${newest} rows unbounded preceding)`.as("size"),
    rank: sql<number>`row_number() over (${newest})`.as("rank"),
  }).from(t).where(and(eq(t.householdId, hid), eq(t.conversationId, conversationId))).as("measured");
  const rows = await tx.select().from(measured).where(or(lte(measured.size, THREAD_CONTEXT_MAX), eq(measured.rank, 1)))
    .orderBy(desc(measured.createdAt), desc(measured.id));
  return {
    omitted: (rows[0]?.total ?? 0) - rows.length,
    turns: rows.reverse().map(row => ContextTurn.parse({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}

/** One budget for the quoted data going to the model, from either journal placement (D71). */
export async function assembleContext(db: Db, hid: string, input: ContextInput) {
  return withHousehold(db, hid, async tx => {
    const [memory, raw, space] = await Promise.all([
      input.memory ?? listMemory(tx, hid),
      input.recent ? { turns: input.recent, omitted: input.earlierCount ?? 0 } : storedContextTurns(tx, hid, input.conversationId),
      input.spaceId ? requireSpace(tx, hid, input.spaceId) : null,
    ]);
    const profile = memoryBlock(memory.filter(item => !item.spaceId));
    const notes = memoryBlock(memory.filter(item => item.spaceId && item.spaceId === space?.id), "notes");
    const brief = BriefSchema.parse(input.deviceBrief ?? space?.brief ?? {});
    const systemData = [profile, briefContext(brief), notes].filter(Boolean).join("\n\n");
    const { turns, omitted } = contextTail(raw.turns);
    const ids = [...new Set(turns.flatMap(turn => turn.kind === "document" && turn.documentId ? [turn.documentId] : []))];
    const cards = new Map(await Promise.all(ids.map(async id => [id, await documentCard(tx, hid, id, { draw: false })] as const)));
    return {
      systemData, memoryForAmounts: [profile, notes].filter(Boolean), memory,
      context: contextText(turns, input.canvas, cards, omitted + raw.omitted),
    };
  });
}

/** The raw thread and the cards are separate. A card for a retained turn is always included. */
export function contextText(turns: readonly ContextTurn[], canvas: Recipe | null, cards: ReadonlyMap<string, DocumentCard> = new Map(), omitted = 0): string {
  const parts: string[] = [];
  if (omitted) parts.push(`${omitted} earlier ${omitted === 1 ? "turn remains" : "turns remain"} in this thread. Call search_history to find them.`);
  if (turns.length) parts.push("Earlier in this conversation, for context only; read every number again from the tools:\n" + turns.map(turnWords).join("\n"));
  if (cards.size) parts.push("Cards for the attached documents in the thread above, as data:\n" +
    [...cards].map(([id, card]) => JSON.stringify({ id, card: cardContext(card) })).join("\n"));
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

function incognitoRetry(id: string): AskReply {
  return { id, kind: ANSWER, text: FIXED.incognitoRetried, choices: null, canvas: null, sources: [], links: [], pending: false,
    firstUse: null, memoryChanges: [], offers: [], incognito: true };
}

/** Free-form questions go to the agent (D40). `pending` is true when a tool left a bill or charge in To check (D39). */
export async function answerQuestion(db: Db, hid: string, input: z.infer<typeof askInput>, deps: { fetch?: typeof globalThis.fetch; at?: Date; onStep?: (step: string) => void } = {}): Promise<AskReply> {
  const { id, conversationId, spaceId, text, source, canvas, memory, recent, earlierCount, deviceBrief, history, incognito } = askInput.parse(input);
  const householdId = requireHousehold(hid);
  const prepared = await withHousehold<{ reply: AskReply } | { assembled: Awaited<ReturnType<typeof assembleContext>>; effectiveSpaceId?: string; deviceMemory?: DeviceMemory }>(db, householdId, async tx => {
    // A kind kept on the device comes with the question and is never stored here; a kind kept in the cloud is read here and the question must not carry it.
    // The older request shape still reaches legacy conversations, but cannot bypass an existing space’s archive guard.
    const [matching] = spaceId ? [] : await tx.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.householdId, householdId), eq(spaces.id, conversationId)));
    const effectiveSpaceId = spaceId ?? matching?.id;
    if (effectiveSpaceId !== undefined) {
      await requireSpace(tx, householdId, effectiveSpaceId);
      if (conversationId !== effectiveSpaceId || recent?.some(turn => turn.conversationId !== effectiveSpaceId))
        throw new InputError("Use the thread of the selected space.");
    }
    const places = await readPlaces(tx, householdId);
    if ((places.memory === "device") !== (memory !== undefined)) throw new InputError(places.memory === "device"
      ? "This household keeps its memory on this device, so the question has to bring it. Reload the page and ask again."
      : "This household keeps its memory in our cloud. Reload the page and ask again.");
    if ((places.journal === "device") !== (recent !== undefined)) throw new InputError(places.journal === "device"
      ? "This household keeps its conversations on this device, so the question has to bring the last ones. Reload the page and ask again."
      : "This household keeps its conversations in our cloud. Reload the page and ask again.");
    if (places.journal === "cloud" && (deviceBrief !== undefined || earlierCount !== undefined || history !== undefined))
      throw new InputError("This household keeps its conversations in our cloud. Reload the page and ask again.");
    // A question retried after its reply was lost has the same id: the saved turn is the reply, and nothing runs or writes again.
    const kept = recent === undefined ? await turnById(tx, householdId, id) : null;
    if (incognito && kept) throw new InputError("Start a new question for Incognito.");
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
    const wrote = await askReceipt(tx, householdId, id);
    if (incognito && wrote) return { reply: incognitoRetry(id) };
    if (wrote && recent === undefined) throw new InputError("This question already ran. Start a new question.");
    if (wrote) {
      return { reply: {
        id, kind: ANSWER, text: FIXED.alreadySaved, choices: null, canvas: null, sources: [],
        links: wrote.links.length ? wrote.links : [{ label: "Open To check", href: new URL("/to-check", appUrl()).href }], pending: wrote.pending, firstUse: null, memoryChanges: [], offers: [],
      } };
    }
    const assembled = await assembleContext(tx, householdId, {
      conversationId, canvas, spaceId: effectiveSpaceId, memory, recent, earlierCount, deviceBrief,
    });
    const deviceMemory = memory === undefined ? undefined : { items: [...memory], changes: [], moment: await clockMoment(tx, householdId, deps.at) };
    return { assembled, effectiveSpaceId, deviceMemory };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if ("reply" in prepared) return prepared.reply;
  if (incognito) {
    const first = await withHousehold(db, householdId, async tx => {
      await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
      if (await turnById(tx, householdId, id)) throw new InputError("Start a new question for Incognito.");
      return claimAskReceipt(tx, householdId, id);
    });
    if (!first) return incognitoRetry(id);
  }
  const { assembled, effectiveSpaceId, deviceMemory } = prepared;
  let result: AskResult;
  try {
    result = await runAgent({
      db, householdId, question: text, askId: id, source, appUrl: appUrl(), context: assembled.context, assembled, spaceId: effectiveSpaceId, fetch: deps.fetch, deviceMemory, deviceHistory: history ?? recent, incognito, onStep: deps.onStep,
      onWrote: incognito || recent === undefined ? undefined : () => withHousehold(db, householdId, tx => noteAskWrote(tx, householdId, id)),
      connection: () => aiConnection(db, householdId, "text"),
    });
  } catch (error) {
    if (incognito) {
      await withHousehold(db, householdId, tx => releaseAskReceipt(tx, householdId, id));
      throw error;
    }
    // A write tool already succeeded: what it kept is shown, with the reason the answer stopped, instead of an error that hides it (a retry would write it twice).
    if (!(error instanceof AgentError) || !error.saved) throw error;
    result = { kind: ANSWER, answer: FIXED.savedThenStopped + error.message, choices: null, recipe: null, sources: [], links: error.saved.links, pending: error.saved.pending, offers: [] };
  }
  const brief = incognito ? undefined : await withHousehold(db, householdId, async tx => {
    await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
    if (effectiveSpaceId !== undefined) await requireSpace(tx, householdId, effectiveSpaceId, true);
    const places = await readPlaces(tx, householdId);
    if ((places.journal === "device") !== (recent !== undefined))
      throw new InputError("Your journal moved while Ask was answering. Reload the page and ask again.");
    if (recent === undefined) {
      if (await askReceipt(tx, householdId, id) && !await turnById(tx, householdId, id))
        throw new InputError("This question already ran. Start a new question.");
      const saved = await saveTurn(tx, householdId, {
        id, conversationId, question: text, kind: result.kind, reply: result.answer, choices: result.choices, recipe: result.recipe, sources: result.sources.map(source => places.memory === "device" && "id" in source
          ? { ...source, label: DEVICE_MEMORY_SOURCE_LABEL } : source),
      }, deps.at);
      if (!saved) return undefined;
    }
    await noteAskReply(tx, householdId, id, result);
    if (!effectiveSpaceId || !result.brief) return undefined;
    if (places.journal === "cloud") return saveBrief(tx, householdId, effectiveSpaceId, result.brief, "ask", id);
    return { brief: result.brief, updatedAt: new Date().toISOString(), updatedBy: "ask" as const };
  });
  const { drawn, firstUse } = await withHousehold(db, householdId, async tx => ({
    drawn: result.recipe ? { recipe: result.recipe, blocks: resolveRecipe(result.recipe, await loadCanvasContext(tx, householdId, result.recipe)) } : null,
    firstUse: recent === undefined ? await firstUseLine(tx, householdId) : null,
  }), { isolationLevel: "repeatable read", accessMode: "read only" });
  return {
    id, kind: result.kind, text: result.answer, choices: result.choices, canvas: drawn, sources: result.sources, links: result.links, pending: result.pending,
    firstUse, memoryChanges: deviceMemory?.changes ?? [], offers: result.offers, ...(brief && { brief }), ...(result.memoryChanged && { memoryChanged: true }),
    ...(incognito && { incognito: true }), ...(result.openSpace && { openSpace: result.openSpace }),
  };
}

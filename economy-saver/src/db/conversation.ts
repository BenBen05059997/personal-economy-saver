// The Ask conversation (D60, D69): each space has a persistent thread. Earlier conversations keep their original ids.
// A failed question is never stored. Every query is scoped by the household.
import { and, asc, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { requireHousehold, withHousehold, type Db } from "./household";
import { conversationTurns, documents, readings, spaces } from "./schema";
import { CONTEXT_TURNS, live, TURN_VERSION, type ConversationTurn, type TurnKind, type TurnSource } from "@/lib/schema/turn";
import type { Recipe } from "@/lib/canvas/schema";

export type NewTurn = {
  id: string; conversationId: string; question: string; kind: TurnKind; reply: string;
  choices: string[] | null; recipe: Recipe | null; sources: TurnSource[];
  /** D60: the file attached in Ask (kind document). */
  documentId?: string | null;
};
type Row = typeof conversationTurns.$inferSelect;

const turnOf = (row: Row): ConversationTurn => ({
  version: TURN_VERSION, id: row.id, conversationId: row.conversationId, question: row.question, kind: row.kind as TurnKind, reply: row.reply,
  choices: (row.choices as string[] | null) ?? null, recipe: (row.recipe as Recipe | null) ?? null, sources: row.sources as TurnSource[],
  ...(row.documentId !== null && { documentId: row.documentId }),
  thumb: row.thumb === 1 ? 1 : row.thumb === -1 ? -1 : null, createdAt: row.createdAt.toISOString(),
});

/** True when a document attached in this conversation is still being read, or has a reading waiting in To check. One household-scoped query. */
async function holdsWaiting(db: Db, hid: string, conversationId: string): Promise<boolean> {
  const named = db.select({ id: conversationTurns.documentId }).from(conversationTurns)
    .where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.conversationId, conversationId), sql`${conversationTurns.documentId} is not null`));
  const [reading] = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.householdId, hid), inArray(documents.id, named), sql`(${documents.status} in ('queued', 'reading') or exists (
      select 1 from ${readings} where ${readings.documentId} = ${documents.id} and ${readings.householdId} = ${hid} and ${readings.status} = 'to_check'))`)).limit(1);
  return !!reading;
}

/** Stores one turn. A retry with the same id is one row. */
export async function saveTurn(db: Db, householdId: string, turn: NewTurn, at: Date = new Date()): Promise<void> {
  const hid = requireHousehold(householdId);
  const { documentId, ...rest } = turn;
  await db.insert(conversationTurns).values({ ...rest, documentId: documentId ?? null, householdId: hid, createdAt: at })
    .onConflictDoNothing({ target: conversationTurns.id });
}

/** The full thread, oldest first. A space and an earlier conversation use the same turn shape. */
export async function spaceThread(db: Db, householdId: string, conversationId: string): Promise<ConversationTurn[]> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => (await tx.select().from(conversationTurns)
    .where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.conversationId, conversationId)))
    .orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.id))).map(turnOf));
}

/** Conversations predating spaces, as individual threads in General. */
export async function legacyThreads(db: Db, householdId: string): Promise<{ id: string; question: string }[]> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const assigned = tx.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.householdId, hid), eq(spaces.id, conversationTurns.conversationId)));
    const rows = await tx.selectDistinctOn([conversationTurns.conversationId], {
      id: conversationTurns.conversationId, question: conversationTurns.question, at: conversationTurns.createdAt,
    }).from(conversationTurns).where(and(eq(conversationTurns.householdId, hid), notExists(assigned)))
      .orderBy(asc(conversationTurns.conversationId), asc(conversationTurns.createdAt), asc(conversationTurns.id));
    return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).map(({ id, question }) => ({ id, question }));
  });
}

/** One stored turn of this household by id, or null (a question retried after its reply was lost). */
export async function turnById(db: Db, householdId: string, id: string): Promise<ConversationTurn | null> {
  const hid = requireHousehold(householdId);
  const [row] = await db.select().from(conversationTurns).where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.id, id))).limit(1);
  return row ? turnOf(row) : null;
}

/** The conversation's last three turns, oldest first, when its latest turn is under ten minutes old (24 hours while a document attached in it is being read or waiting in To check); otherwise none. */
export async function recentTurns(db: Db, householdId: string, conversationId: string, now: Date = new Date()): Promise<ConversationTurn[]> {
  const hid = requireHousehold(householdId);
  const rows = await db.select().from(conversationTurns)
    .where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.conversationId, conversationId)))
    .orderBy(desc(conversationTurns.createdAt), desc(conversationTurns.id)).limit(CONTEXT_TURNS);
  if (rows.length === 0) return [];
  if (!live(rows[0].createdAt, now) && !(live(rows[0].createdAt, now, true) && await holdsWaiting(db, hid, conversationId))) return [];
  return rows.reverse().map(turnOf);
}

/** The newest conversation, all its turns oldest first, when its last turn is under ten minutes old (24 hours, same rule); otherwise null. */
export async function latestConversation(db: Db, householdId: string, now: Date = new Date()): Promise<{ conversationId: string; turns: ConversationTurn[] } | null> {
  const hid = requireHousehold(householdId);
  const [latest] = await db.select().from(conversationTurns).where(eq(conversationTurns.householdId, hid))
    .orderBy(desc(conversationTurns.createdAt), desc(conversationTurns.id)).limit(1);
  if (!latest) return null;
  if (!live(latest.createdAt, now) && !(live(latest.createdAt, now, true) && await holdsWaiting(db, hid, latest.conversationId))) return null;
  const rows = await db.select().from(conversationTurns)
    .where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.conversationId, latest.conversationId)))
    .orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.id));
  return { conversationId: latest.conversationId, turns: rows.map(turnOf) };
}

/** Every stored turn, oldest first (the export). */
export async function allTurns(db: Db, householdId: string): Promise<ConversationTurn[]> {
  const hid = requireHousehold(householdId);
  return (await db.select().from(conversationTurns).where(eq(conversationTurns.householdId, hid))
    .orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.id))).map(turnOf);
}

/** Sets or clears a thumb on one turn. False when the turn is not this household's. */
export async function setThumb(db: Db, householdId: string, turnId: string, thumb: 1 | -1 | null): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const rows = await db.update(conversationTurns).set({ thumb })
    .where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.id, turnId))).returning({ id: conversationTurns.id });
  return rows.length === 1;
}

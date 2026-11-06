// The Ask conversation (D60): the turns, kept in the database, 200 a household. A conversation carries on for ten minutes after its last turn.
// A failed question is never stored. Every query is scoped by the household.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { requireHousehold, type Db } from "./household";
import { conversationTurns } from "./schema";
import { CONTEXT_TURNS, live, TURN_LIMIT, TURN_VERSION, type ConversationTurn, type TurnKind, type TurnSource } from "@/lib/schema/turn";
import type { Recipe } from "@/lib/canvas/schema";

export type NewTurn = {
  id: string; conversationId: string; question: string; kind: TurnKind; reply: string;
  choices: string[] | null; recipe: Recipe | null; sources: TurnSource[];
};
type Row = typeof conversationTurns.$inferSelect;

const turnOf = (row: Row): ConversationTurn => ({
  version: TURN_VERSION, id: row.id, conversationId: row.conversationId, question: row.question, kind: row.kind as TurnKind, reply: row.reply,
  choices: (row.choices as string[] | null) ?? null, recipe: (row.recipe as Recipe | null) ?? null, sources: row.sources as TurnSource[],
  thumb: row.thumb === 1 ? 1 : row.thumb === -1 ? -1 : null, createdAt: row.createdAt.toISOString(),
});

/** Stores one turn (a retried question has the same id, so it is one row), then drops the oldest beyond 200, in one transaction. */
export async function saveTurn(db: Db, householdId: string, turn: NewTurn, at: Date = new Date()): Promise<void> {
  const hid = requireHousehold(householdId);
  await db.transaction(async tx => {
    await tx.insert(conversationTurns).values({ ...turn, householdId: hid, createdAt: at }).onConflictDoNothing({ target: conversationTurns.id });
    await tx.delete(conversationTurns).where(and(eq(conversationTurns.householdId, hid), sql`${conversationTurns.id} not in (
      select id from conversation_turns where household_id = ${hid} order by created_at desc, id desc limit ${TURN_LIMIT})`));
  });
}

/** The conversation's last three turns, oldest first, when its latest turn is under ten minutes old; otherwise none. */
export async function recentTurns(db: Db, householdId: string, conversationId: string, now: Date = new Date()): Promise<ConversationTurn[]> {
  const hid = requireHousehold(householdId);
  const rows = await db.select().from(conversationTurns)
    .where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.conversationId, conversationId)))
    .orderBy(desc(conversationTurns.createdAt), desc(conversationTurns.id)).limit(CONTEXT_TURNS);
  if (rows.length === 0 || !live(rows[0].createdAt, now)) return [];
  return rows.reverse().map(turnOf);
}

/** The newest conversation, all its turns oldest first, when its last turn is under ten minutes old; otherwise null. */
export async function latestConversation(db: Db, householdId: string, now: Date = new Date()): Promise<{ conversationId: string; turns: ConversationTurn[] } | null> {
  const hid = requireHousehold(householdId);
  const [latest] = await db.select().from(conversationTurns).where(eq(conversationTurns.householdId, hid))
    .orderBy(desc(conversationTurns.createdAt), desc(conversationTurns.id)).limit(1);
  if (!latest || !live(latest.createdAt, now)) return null;
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

// The Ask conversation (D60, D69): each space has a persistent thread. Earlier conversations keep their original ids.
// A failed question is never stored. Every query is scoped by the household.
import { and, asc, eq, notExists } from "drizzle-orm";
import { requireHousehold, withHousehold, type Db } from "./household";
import { conversationTurns, spaces } from "./schema";
import { TURN_VERSION, type ConversationTurn, type TurnKind, type StoredSource } from "@/lib/schema/turn";
import type { Recipe } from "@/lib/canvas/schema";

export type NewTurn = {
  id: string; conversationId: string; question: string; kind: TurnKind; reply: string;
  choices: string[] | null; recipe: Recipe | null; sources: StoredSource[];
  /** D60: the file attached in Ask (kind document). */
  documentId?: string | null;
};
type Row = typeof conversationTurns.$inferSelect;

const turnOf = (row: Row): ConversationTurn => ({
  version: TURN_VERSION, id: row.id, conversationId: row.conversationId, question: row.question, kind: row.kind as TurnKind, reply: row.reply,
  choices: (row.choices as string[] | null) ?? null, recipe: (row.recipe as Recipe | null) ?? null, sources: row.sources as StoredSource[],
  ...(row.documentId !== null && { documentId: row.documentId }),
  thumb: row.thumb === 1 ? 1 : row.thumb === -1 ? -1 : null, createdAt: row.createdAt.toISOString(),
});

/** Stores one turn. A retry with the same id is one row. */
export async function saveTurn(db: Db, householdId: string, turn: NewTurn, at: Date = new Date()): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const { documentId, ...rest } = turn;
  const rows = await db.insert(conversationTurns).values({ ...rest, documentId: documentId ?? null, householdId: hid, createdAt: at })
    .onConflictDoNothing({ target: conversationTurns.id }).returning({ id: conversationTurns.id });
  return rows.length > 0;
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

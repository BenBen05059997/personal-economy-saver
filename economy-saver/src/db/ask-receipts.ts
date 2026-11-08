import { and, eq, sql } from "drizzle-orm";
import { requireHousehold, type Db } from "./household";
import { askReceipts } from "./schema";

/** D59: notes, with no content, that the question with this id wrote something for this household. Noting it twice is the same as once. */
export async function noteAskWrote(db: Db, householdId: string, askId: string): Promise<void> {
  const hid = requireHousehold(householdId);
  await db.insert(askReceipts).values({ householdId: hid, askId }).onConflictDoNothing();
}

export type AskLink = { label: string; href: string };

/** Notes what the reply carried besides its words (the To check flag and its links: fixed words and app paths, never the question or answer), so a retry can return them. Nothing is kept when the reply carried neither. */
export async function noteAskReply(db: Db, householdId: string, askId: string, reply: { pending: boolean; links: AskLink[] }): Promise<void> {
  const hid = requireHousehold(householdId);
  if (!reply.pending && reply.links.length === 0) return;
  await db.insert(askReceipts).values({ householdId: hid, askId, pending: reply.pending, links: reply.links })
    .onConflictDoUpdate({ target: [askReceipts.householdId, askReceipts.askId], set: { pending: reply.pending, links: reply.links } });
}

/** This household's note for the question with this id, or null (a retry must not run again when it wrote something). */
export async function askReceipt(db: Db, householdId: string, askId: string): Promise<{ pending: boolean; links: AskLink[] } | null> {
  const hid = requireHousehold(householdId);
  const [row] = await db.select({ pending: askReceipts.pending, links: askReceipts.links }).from(askReceipts)
    .where(and(eq(askReceipts.householdId, hid), eq(askReceipts.askId, askId)));
  return row ? { pending: row.pending, links: row.links as AskLink[] } : null;
}

/** Removes this household's notes more than a day old (the daily job). Returns how many went. */
export async function pruneAskReceipts(db: Db, householdId: string): Promise<number> {
  const hid = requireHousehold(householdId);
  const gone = await db.delete(askReceipts).where(and(eq(askReceipts.householdId, hid), sql`${askReceipts.createdAt} < now() - interval '1 day'`)).returning({ id: askReceipts.askId });
  return gone.length;
}

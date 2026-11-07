import { and, eq, sql } from "drizzle-orm";
import { requireHousehold, type Db } from "./household";
import { askReceipts } from "./schema";

/** D59: notes, with no content, that the question with this id wrote something for this household. Noting it twice is the same as once. */
export async function noteAskWrote(db: Db, householdId: string, askId: string): Promise<void> {
  const hid = requireHousehold(householdId);
  await db.insert(askReceipts).values({ householdId: hid, askId }).onConflictDoNothing();
}

/** Whether the question with this id already wrote something for this household (a retry must not run again). */
export async function askAlreadyWrote(db: Db, householdId: string, askId: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const [row] = await db.select({ askId: askReceipts.askId }).from(askReceipts).where(and(eq(askReceipts.householdId, hid), eq(askReceipts.askId, askId)));
  return row !== undefined;
}

/** Removes this household's notes more than a day old (the daily job). Returns how many went. */
export async function pruneAskReceipts(db: Db, householdId: string): Promise<number> {
  const hid = requireHousehold(householdId);
  const gone = await db.delete(askReceipts).where(and(eq(askReceipts.householdId, hid), sql`${askReceipts.createdAt} < now() - interval '1 day'`)).returning({ id: askReceipts.askId });
  return gone.length;
}

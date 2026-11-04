import { and, asc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, requireHousehold } from "./household";
import { events, households } from "./schema";
import { seedBen } from "./seed";
import { deleteHouseholdKey } from "./ai-key";
import { removeHouseholdDocuments } from "./document-cleanup";

export async function findDemoHousehold(db: Db, id: string): Promise<string | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [demo] = await db.select({ id: households.id }).from(households)
    .where(and(eq(households.id, requireHousehold(id)), eq(households.isDemo, true)));
  return demo?.id ?? null;
}

// The one deletion of a demo household (Reset and the sweeper both call it): lock the row with is_demo re-checked,
// delete its AI key and Storage documents, then the row; the schema's cascades remove everything else.
// Call it inside a transaction. Returns false when the id is not a demo household.
export async function deleteDemoHousehold(tx: Db, id: string): Promise<boolean> {
  const [existing] = await tx.select({ id: households.id }).from(households)
    .where(and(eq(households.id, requireHousehold(id)), eq(households.isDemo, true))).for("update");
  if (!existing) return false;
  await deleteHouseholdKey(tx, id);
  await removeHouseholdDocuments(tx, id);
  const [deleted] = await tx.delete(households)
    .where(and(eq(households.id, requireHousehold(id)), eq(households.isDemo, true)))
    .returning({ id: households.id });
  return Boolean(deleted);
}

export async function resetDemoHousehold(db: Db, id: string): Promise<string | null> {
  return db.transaction(async tx => {
    if (!(await deleteDemoHousehold(tx, id))) return null;
    return seedBen(tx, { isDemo: true });
  });
}

// D49: a demo household lives seven days after its last change.
export const DEMO_LIFETIME_DAYS = 7;
export const SWEEP_LIMIT = 200;

const noRecentEvent = (cutoff: Date) => sql`not exists (select 1 from ${events} where ${events.householdId} = ${households.id} and ${events.createdAt} >= ${cutoff})`;

// Deletes demo households created and last changed more than seven days before `now`, oldest first, each in its own
// transaction. A failing deletion is counted and does not stop the others. Non-demo households are never selected.
export async function sweepDemoHouseholds(db: Db, now = new Date(), limit = SWEEP_LIMIT): Promise<{ swept: number; failed: number }> {
  const cutoff = new Date(now.getTime() - DEMO_LIFETIME_DAYS * 86_400_000);
  const stale = await db.select({ id: households.id }).from(households)
    .where(and(eq(households.isDemo, true), lt(households.createdAt, cutoff), noRecentEvent(cutoff)))
    .orderBy(asc(households.createdAt), asc(households.id)).limit(limit);
  let swept = 0, failed = 0;
  for (const { id } of stale) {
    try {
      const done = await db.transaction(async tx => {
        const [still] = await tx.select({ id: households.id }).from(households)
          .where(and(eq(households.id, id), eq(households.isDemo, true), lt(households.createdAt, cutoff), noRecentEvent(cutoff)));
        return still ? deleteDemoHousehold(tx, id) : false;
      });
      if (done) swept++;
    } catch (error) {
      failed++;
      console.error("[sweep] could not delete a demo household", error instanceof Error ? error.message : "unknown error");
    }
  }
  return { swept, failed };
}

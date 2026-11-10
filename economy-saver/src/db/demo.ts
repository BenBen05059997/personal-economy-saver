import { and, asc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, requireHousehold, withHousehold } from "./household";
import { events, households } from "./schema";
import { seedBenRows } from "./seed";
import { refreshSuggestions, runPass } from "./suggestions";
import { InputError } from "./input-error";
import { deleteHouseholdKey } from "./ai-key";
import { removeHouseholdDocuments } from "./document-cleanup";

/** A Try it cookie: 32 random bytes, base64url. Only its SHA-256 is stored, so the household id is never a bearer value (D34). */
const DEMO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function demoTokenHash(token: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
}

/** Gives a demo household a fresh cookie token (any earlier one stops working) and returns it; null when the id is no demo household. */
export async function issueDemoToken(db: Db, id: string): Promise<string | null> {
  const hid = requireHousehold(id);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const hash = await demoTokenHash(token);
  const [issued] = await withHousehold(db, hid, tx => tx.update(households).set({ demoTokenHash: hash })
    .where(and(eq(households.id, hid), eq(households.isDemo, true))).returning({ id: households.id }));
  return issued ? token : null;
}

/** The demo household a Try it cookie token opens, or null. */
export async function demoHouseholdForToken(db: Db, token: string): Promise<string | null> {
  if (!DEMO_TOKEN.test(token)) return null;
  const [demo] = await db.select({ id: households.id }).from(households)
    .where(and(eq(households.demoTokenHash, await demoTokenHash(token)), eq(households.isDemo, true)));
  return demo?.id ?? null;
}

/** Whether an id is a demo household (never a credential: the cookie holds a token, see demoHouseholdForToken). */
export async function findDemoHousehold(db: Db, id: string): Promise<string | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [demo] = await withHousehold(db, id, async tx => tx.select({ id: households.id }).from(households)
    .where(and(eq(households.id, requireHousehold(id)), eq(households.isDemo, true))));
  return demo?.id ?? null;
}

// Whether a demo household is Ben's Try it (it has a fixed date, D51) rather than a blank one; null when the id is no demo household.
export async function tryItKind(db: Db, id: string): Promise<"try-it" | "blank" | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db.select({ fixedToday: households.fixedToday }).from(households)
    .where(and(eq(households.id, requireHousehold(id)), eq(households.isDemo, true)));
  return row ? (row.fixedToday ? "try-it" : "blank") : null;
}

/** Advance a Try it fixture and refresh its findings atomically. A blank demo or signed-in household has no QA clock. */
export async function advanceTryItDate(db: Db, id: string, date: string): Promise<string | null> {
  if (!z.string().date().safeParse(date).success) throw new InputError("Enter a valid date in YYYY-MM-DD format.");
  const hid = requireHousehold(id);
  const tryIt = and(eq(households.id, hid), eq(households.isDemo, true), isNotNull(households.fixedToday));
  return withHousehold(db, hid, async tx => {
    const [changed] = await tx.update(households).set({ fixedToday: date })
      .where(and(tryIt, lt(households.fixedToday, date))).returning({ id: households.id });
    if (!changed) {
      const [current] = await tx.select({ id: households.id }).from(households).where(tryIt);
      if (!current) return null;
      throw new InputError("Choose a date later than the current Try it date.");
    }
    await runPass(tx, hid);
    return date;
  });
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
  const hid = await db.transaction(async tx => {
    if (!(await deleteDemoHousehold(tx, id))) return null;
    return seedBenRows(tx, { isDemo: true });
  });
  if (hid) await refreshSuggestions(db, hid, "resetDemoHousehold");
  return hid;
}

/** D34: a Try it household's own AI key is removed after a day with no Activity event; the household itself stays. */
export const DEMO_KEY_IDLE_HOURS = 24;

export async function dropIdleDemoKeys(db: Db, now = new Date(), limit = SWEEP_LIMIT): Promise<{ dropped: number; failed: number }> {
  const cutoff = new Date(now.getTime() - DEMO_KEY_IDLE_HOURS * 3_600_000);
  const idle = and(eq(households.isDemo, true), or(isNotNull(households.aiKeySecretId), isNotNull(households.aiProtocol)), noRecentEvent(cutoff));
  const rows = await db.select({ id: households.id }).from(households).where(idle).orderBy(asc(households.id)).limit(limit);
  let dropped = 0, failed = 0;
  for (const { id } of rows) {
    try {
      const done = await db.transaction(async tx => {
        const [still] = await tx.select({ id: households.id }).from(households).where(and(eq(households.id, id), idle)).for("update");
        if (!still) return false;
        await deleteHouseholdKey(tx, id);
        return true;
      });
      if (done) dropped++;
    } catch (error) {
      failed++;
      console.error("[sweep] could not remove an idle demo key", error instanceof Error ? error.message : "unknown error");
    }
  }
  return { dropped, failed };
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

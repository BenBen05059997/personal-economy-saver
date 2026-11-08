import { and, eq, or, sql } from "drizzle-orm";
import { CRON_BATCH_SIZE } from "@/lib/cron";
import { jobError } from "@/lib/job-error";
import { closingOnOrAfter, cycle } from "@/lib/money/runway";
import { clockForHousehold } from "./clock";
import { loadMoneyState, requireHousehold, type Db } from "./household";
import { cardStatements, households, members, reminderSettings } from "./schema";
import { toMinor } from "./money";
import { removeExpiredFiles } from "./document-cleanup";
import { pruneAskReceipts } from "./ask-receipts";
import { fetchReferenceRate, storeReferenceRate } from "./reference-rate";
import { observeRunway } from "./runway-events";
import { remindersDue, runReminders } from "./reminders";
import { runPass } from "./suggestions";

/** Start the pass at the earliest member reminder hour and return for later deliveries. */
export async function dueHouseholds(db: Db, now = new Date()) {
  const local = sql`timezone(${households.timeZone}, ${now.toISOString()}::timestamptz)`;
  const ownerHour = sql`coalesce((
    select min(${reminderSettings.hour}) from ${reminderSettings}
    join ${members} on ${members.householdId} = ${reminderSettings.householdId} and ${members.id} = ${reminderSettings.memberId}
    where ${reminderSettings.householdId} = ${households.id} and ${members.role} = 'owner'
  ), 8)`;
  const hour = sql`least(${ownerHour}, (
    select min(${reminderSettings.hour}) from ${reminderSettings} where ${reminderSettings.householdId} = ${households.id}
  ))`;
  const passDue = and(
    sql`(${households.dailyRanOn} is null or ${households.dailyRanOn} < ${local}::date)`,
    sql`extract(hour from ${local}) >= ${hour}`,
  );
  const rows = await db.select({ id: households.id }).from(households)
    .where(and(eq(households.isDemo, false), or(passDue, remindersDue(db, local))))
    .orderBy(sql`${households.dailyRanOn} asc nulls first`, households.createdAt, households.id).limit(CRON_BATCH_SIZE);
  return rows.map(row => row.id);
}

/** Log one operator line without SQL parameters, upstream responses or request data. */
export function logDailyError(at: "cron_household_failed" | "cron_fx_unavailable", householdId: string, error: unknown) {
  const { name, message } = jobError(error);
  console.error(JSON.stringify({ at, householdId, name, message: at === "cron_fx_unavailable" ? "ECB reference rate unavailable" : message }));
}

export async function runDaily(db: Db, id: string, now = new Date()) {
  const hid = requireHousehold(id);
  const [household] = await db.select().from(households).where(eq(households.id, hid));
  if (!household) throw new Error("Scheduled household not found");
  const { today } = clockForHousehold(household, now);
  if (household.dailyRanOn !== null && household.dailyRanOn >= today) {
    await runReminders(db, hid, now);
    return { ok: true };
  }
  const rate = !household.isDemo && household.homeCurrency === "JPY"
    ? await fetchReferenceRate().catch(error => {
      logDailyError("cron_fx_unavailable", hid, error);
      return null; // loadMoneyState reads the latest dated rate already stored for this household.
    })
    : null;
  await pruneAskReceipts(db, hid);
  await db.transaction(async tx => {
    // Serialize the rate and statement updates for overlapping deliveries.
    const [locked] = await tx.select().from(households).where(eq(households.id, hid)).for("update");
    if (!locked || (locked.dailyRanOn !== null && locked.dailyRanOn >= today)) return;
    if (rate) await storeReferenceRate(tx, hid, rate);
    const state = await loadMoneyState(tx, hid, today, locked);
    await observeRunway(tx, hid, state);
    for (const card of state.cards) {
      if (closingOnOrAfter(card, today) !== today) continue;
      const statement = cycle(state, card.id);
      if (statement.openTotal <= 0) continue;
      await tx.insert(cardStatements).values({
        householdId: hid, cardId: card.id, closedOn: today, dueOn: statement.dueOn,
        currency: state.homeCurrency, amountMinor: toMinor(statement.openTotal, state.homeCurrency),
      }).onConflictDoNothing();
    }
  });
  // Keep the committed rate and statements if the suggestion pass needs another attempt.
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(households).where(eq(households.id, hid)).for("update");
    if (!locked || (locked.dailyRanOn !== null && locked.dailyRanOn >= today)) return;
    const updated = await runPass(tx, hid, now);
    await observeRunway(tx, hid, updated);
    await tx.update(households).set({ dailyRanOn: today }).where(eq(households.id, hid));
  });
  await runReminders(db, hid, now);
  await removeExpiredFiles(db, hid, now);
  return { ok: true };
}

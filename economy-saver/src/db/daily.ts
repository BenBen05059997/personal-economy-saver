import { and, eq, sql } from "drizzle-orm";
import { closingOnOrAfter, cycle } from "@/lib/money/runway";
import { clockForHousehold } from "./clock";
import { loadMoneyState, requireHousehold, type Db } from "./household";
import { cardStatements, households, members, reminderSettings } from "./schema";
import { toMinor } from "./money";
import { removeExpiredFiles } from "./document-cleanup";
import { pruneAskReceipts } from "./ask-receipts";
import { fetchReferenceRate, storeReferenceRate } from "./reference-rate";
import { observeRunway } from "./runway-events";
import { runPass } from "./suggestions";

/** The owner's reminder hour schedules the household pass. Select across households only at this scheduler entry point. */
export async function dueHouseholds(db: Db, now = new Date()) {
  const local = sql`timezone(${households.timeZone}, ${now.toISOString()}::timestamptz)`;
  const hour = sql`coalesce((
    select min(${reminderSettings.hour}) from ${reminderSettings}
    join ${members} on ${members.householdId} = ${reminderSettings.householdId} and ${members.id} = ${reminderSettings.memberId}
    where ${reminderSettings.householdId} = ${households.id} and ${members.role} = 'owner'
  ), 8)`;
  const rows = await db.select({ id: households.id }).from(households).where(and(
    eq(households.isDemo, false),
    sql`(${households.dailyRanOn} is null or ${households.dailyRanOn} < ${local}::date)`,
    sql`extract(hour from ${local}) >= ${hour}`,
  )).orderBy(sql`${households.dailyRanOn} asc nulls first`, households.createdAt, households.id).limit(100);
  return rows.map(row => row.id);
}

export async function runDaily(db: Db, id: string, now = new Date()) {
  const hid = requireHousehold(id);
  const [household] = await db.select().from(households).where(eq(households.id, hid));
  if (!household) throw new Error("Scheduled household not found");
  const { today } = clockForHousehold(household, now);
  if (household.dailyRanOn !== null && household.dailyRanOn >= today) return { ok: true };
  const rate = !household.isDemo && household.homeCurrency === "JPY" ? await fetchReferenceRate() : null;
  await pruneAskReceipts(db, hid);
  await db.transaction(async tx => {
    // Serialize overlapping deliveries. The date advances only with a successful pass.
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
    const updated = await runPass(tx, hid, now);
    await observeRunway(tx, hid, updated);
    await tx.update(households).set({ dailyRanOn: today }).where(eq(households.id, hid));
  });
  await removeExpiredFiles(db, hid, now);
  return { ok: true };
}

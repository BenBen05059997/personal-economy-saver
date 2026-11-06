import { eq, sql } from "drizzle-orm";
import { clockForHousehold } from "./clock";
import { balanceUpdates, bills, charges, households, members, pots, readings } from "./schema";
import { readerInbox } from "./reader-inbox";
import type { refreshPayPal } from "./paypal-refresh";
import { observeRunway } from "./runway-events";
import { eventFeed } from "./event-feed";
import { CHARGE_LOOKBACK_DAYS, householdOwnerName, loadMoneyState, requireHousehold, type Db } from "./household";

import { addDays } from "@/lib/money/runway";
import { confirmedGaps } from "@/lib/money/gaps";
import { toCheck } from "@/lib/money/to-check";

/** Navigation needs counts, not money conversions or reader payloads. Caller owns the read transaction. */
export async function loadNavigationData(tx: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  const [household] = await tx.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone })
    .from(households).where(eq(households.id, hid));
  if (!household) throw new Error("Household not found");
  const { today, timeZone } = clockForHousehold(household);
  const [name, feed, [totals]] = await Promise.all([
    householdOwnerName(tx, hid), eventFeed(tx, hid),
    tx.select({ pending: sql<number>`
      (select count(*) from ${bills} where ${bills.householdId} = ${hid} and ${bills.status} = 'pending')
      + (select count(*) from ${charges} where ${charges.householdId} = ${hid} and ${charges.status} = 'pending'
        and ${charges.date} >= ${addDays(today, -CHARGE_LOOKBACK_DAYS)})
      + (select count(*) from ${balanceUpdates} where ${balanceUpdates.householdId} = ${hid} and ${balanceUpdates.status} = 'pending')
      + (select count(*) from ${pots} where ${pots.householdId} = ${hid} and ${pots.status} = 'pending')
      + (select count(*) from ${readings} where ${readings.householdId} = ${hid} and ${readings.status} = 'to_check')
      + (select count(*) from ${bills} where ${bills.householdId} = ${hid} and ${bills.status} = 'confirmed' and (${bills.amountMinor} is null or ${bills.due} is null))
    `.mapWith(Number) }).from(households).where(eq(households.id, hid)),
  ]);
  return { name, feed, pending: totals.pending, timeZone };
}

/** The caller owns the transaction; Home must use a writable transaction. */
export async function loadWorkspaceData(tx: Db, hid: string, home = false,
  freshness: Awaited<ReturnType<typeof refreshPayPal>> | null = null) {
  const query = tx.select().from(households).where(eq(households.id, requireHousehold(hid)));
  const [household] = await (home ? query.for("update") : query);
  if (!household) throw new Error("Household not found");
  const { today, timeZone } = clockForHousehold(household);
  const [state, name, inbox, people] = await Promise.all([
    loadMoneyState(tx, hid, today, household), householdOwnerName(tx, hid), readerInbox(tx, hid),
    tx.select({ id: members.id, name: members.displayName }).from(members).where(eq(members.householdId, hid)).orderBy(members.createdAt),
  ]);
  if (home) await observeRunway(tx, hid, state, household);
  const feed = await eventFeed(tx, hid);
  return { state, people, name, feed, timeZone, inbox, freshness, demo: household.isDemo, tryIt: household.fixedToday !== null, pending: toCheck(state).length + inbox.readings.length + confirmedGaps(state).length };
}

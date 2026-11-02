import { eq } from "drizzle-orm";
import { householdClock } from "./account";
import { type Db, loadMoneyState, recordEvent, requireHousehold } from "./household";
import { households } from "./schema";
import { low, series } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import type { MoneyState } from "@/lib/money/types";

/** All money writers lock the household before its invoice, connection or document rows. */
export async function lockRunway(db: Db, id: string) {
  const [row] = await db.select({ previous: households.runwayShort }).from(households)
    .where(eq(households.id, requireHousehold(id))).for("update");
  if (!row) throw new Error("Household not found");
  return row.previous;
}

/** A first mutation through a direct API still gets a before/after comparison. */
export async function beginMoneyChange(db: Db, id: string) {
  if (await lockRunway(db, id) === null) await observeRunway(db, id);
}

/** Run in the same transaction as the money change. The first observation establishes the baseline. */
export async function observeRunway(db: Db, id: string, state?: MoneyState) {
  const hid = requireHousehold(id);
  const previous = await lockRunway(db, hid);
  const money = state ?? await loadMoneyState(db, hid, (await householdClock(db, hid)).today);
  const short = low(series(money, "worst")).amount < 0;
  if (short === previous) return;
  await db.update(households).set({ runwayShort: short }).where(eq(households.id, hid));
  if (previous !== null) {
    const sentence = homeSentence(money);
    await recordEvent(db, hid, { kind: short ? "runway_short" : "runway_clear", title: short ? "A shortfall is ahead" : "Your next 30 days are covered",
      body: sentence.lead + " " + sentence.emphasis, notify: true });
  }
}

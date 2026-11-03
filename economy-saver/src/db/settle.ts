// Mark settled (D45): records the transfers that bring everyone to zero, each with a through date and the instant it happened,
// so the next balance counts only shared items dated after it, or dated that day and created after the settlement. The balance is recomputed here, under the household lock, from the stored
// rows, so what is recorded is what is owed now, never a number the browser sent. The split moves no money in the engine.
import { eq, sql } from "drizzle-orm";
import { householdClock } from "./account";
import { loadSplitState, recordEvent, requireHousehold, usdRateMicro, type Db } from "./household";
import { convertMinor, fromMinor, fromRateMicro } from "./money";
import { households, settlements } from "./schema";
import { InputError } from "./input-error";
import { Currency } from "@/lib/catalogue/types";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { splitBalance } from "@/lib/money/split";

/**
 * Settles what is owed as of the household's today. Returns the transfers it recorded; an empty list (nothing owed, or a
 * second tap after the first) records nothing, so a double submit settles once.
 */
export async function settleUp(db: Db, householdId: string): Promise<{ fromId: string; toId: string; amountMinor: number }[]> {
  const hid = requireHousehold(householdId);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, home: households.homeCurrency, splitSince: households.splitSince })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const today = (await householdClock(tx, hid)).today;
    const home = Currency.parse(household.home);
    const fxPerUsd = fromRateMicro(await usdRateMicro(tx, hid, home, today));
    const split = await loadSplitState(tx, hid, household.splitSince, today, (minor, currency) => convertMinor(minor, currency, home, fxPerUsd));
    if (split.members.length < 2) throw new InputError("Settling needs a second person; add one in Settings, People");
    const { transfers } = splitBalance(split, today);
    for (const t of transfers) {
      const [row] = await tx.insert(settlements).values({
        householdId: hid, fromMemberId: t.fromId, toMemberId: t.toId, amountMinor: t.amountMinor, currency: home, through: today, settledAt: sql`now()`, // the database clock, the one that stamps created_at
      }).returning({ id: settlements.id });
      await recordEvent(tx, hid, {
        kind: "settled", title: `${t.fromName} paid ${t.toName} ${minorMoney(t.amountMinor, home)}`, body: `Shared costs settled through ${dayLabel(today)}`,
        amount: { value: fromMinor(t.amountMinor, home), currency: home }, ref: { type: "settlement", id: row.id },
      });
    }
    return transfers.map(t => ({ fromId: t.fromId, toId: t.toId, amountMinor: t.amountMinor }));
  });
}

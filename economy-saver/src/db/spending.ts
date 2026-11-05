// Where did the money go (D53): the rows the spending rule reads for a date range, scoped to one household. Read only.
import { and, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";
import { Currency } from "@/lib/catalogue/types";
import { CategoryKeySchema as CategoryKey } from "@/lib/money/categories";
import { RepeatUnitSchema } from "@/lib/money/repeat";
import type { SpendingInput } from "@/lib/money/spending";
import { requireHousehold, usdRate, type Db } from "./household";
import { convertMinor, fromMinor, fromRateMicro } from "./money";
import * as s from "./schema";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every confirmed bill that can fall in `from`..`to` (a one-off due in it; a repeating one, whole, when its series starts by `to`:
 * the rule picks its occurrences; a real bill linked to an amount-varies series due by `to`), the confirmed charges dated in it, the cards with their owners, the members and the home
 * currency. A row in another currency is converted at the household's USD rate on or before `to`. One read-only transaction.
 */
export async function loadSpending(db: Db, householdId: string, range: { from: string; to: string }): Promise<SpendingInput> {
  const hid = requireHousehold(householdId);
  const { from, to } = range;
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new Error("A spending range is two YYYY-MM-DD dates, from on or before to");
  return db.transaction(async tx => {
    const [household] = await tx.select({ homeCurrency: s.households.homeCurrency }).from(s.households).where(eq(s.households.id, hid));
    if (!household) throw new Error("Household not found");
    const home = Currency.parse(household.homeCurrency);
    const [members, cards, billRows, chargeRows] = await Promise.all([
      tx.select({ id: s.members.id }).from(s.members).where(eq(s.members.householdId, hid))
        .orderBy(sql`(${s.members.role} = 'owner') desc`, s.members.createdAt, s.members.id),
      tx.select({ id: s.cards.id, memberId: s.cards.memberId }).from(s.cards).where(eq(s.cards.householdId, hid)).orderBy(s.cards.createdAt, s.cards.label),
      // A real bill linked to an amount-varies series (D54) is read before `from` too: the series' estimate in range averages it.
      tx.select().from(s.bills).where(and(eq(s.bills.householdId, hid), eq(s.bills.status, "confirmed"), lte(s.bills.due, to),
        or(isNotNull(s.bills.repeatUnit), isNotNull(s.bills.seriesBillId), gte(s.bills.due, from)))).orderBy(s.bills.due, s.bills.biller, s.bills.id),
      tx.select().from(s.charges).where(and(eq(s.charges.householdId, hid), eq(s.charges.status, "confirmed"), gte(s.charges.date, from), lte(s.charges.date, to)))
        .orderBy(s.charges.date, s.charges.merchant, s.charges.id),
    ]);
    // The rate is read only when a row is in another currency; a household with none may have no rate stored.
    const foreign = [...billRows, ...chargeRows].some(row => row.currency !== home);
    const fxPerUsd = foreign ? fromRateMicro((await usdRate(tx, hid, home, to)).rateMicro) : null;
    const inHome = (minor: number, currency: string) => {
      if (currency === home) return fromMinor(minor, home);
      if (fxPerUsd === null) throw new Error("A row in another currency needs the USD rate");
      return fromMinor(convertMinor(minor, currency, home, fxPerUsd), home);
    };
    return {
      homeCurrency: home,
      split: { members },
      cards: cards.map(c => ({ id: c.id, ...(c.memberId !== null && { ownerId: c.memberId }) })),
      bills: billRows.map(b => ({
        id: b.id, biller: b.biller, amount: inHome(b.amountMinor, b.currency), due: b.due, category: CategoryKey.parse(b.category), businessBp: b.businessBp, status: b.status,
        ...(b.repeatUnit !== null && { repeatUnit: RepeatUnitSchema.parse(b.repeatUnit) }),
        ...(b.repeatDay !== null && { repeatDay: b.repeatDay }),
        ...(b.nextAmountMinor !== null && b.nextAmountFrom !== null && { nextAmount: inHome(b.nextAmountMinor, b.currency), nextAmountFrom: b.nextAmountFrom }),
        ...(b.amountVaries && { amountVaries: true as const }),
        ...(b.seriesBillId !== null && { seriesBillId: b.seriesBillId }),
        ...(b.memberId !== null && { ownerId: b.memberId }),
        ...(b.documentId !== null && { documentId: b.documentId }),
      })),
      charges: chargeRows.map(c => ({
        id: c.id, cardId: c.cardId, merchant: c.merchant, amount: inHome(c.amountMinor, c.currency), date: c.date, category: CategoryKey.parse(c.category),
        businessBp: c.businessBp, source: c.source, status: c.status,
        ...(c.shared && { shared: true as const }),
        ...(c.documentId !== null && { documentId: c.documentId }),
      })),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

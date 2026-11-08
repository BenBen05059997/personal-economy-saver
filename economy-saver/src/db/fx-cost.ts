// What foreign money costs (D62): the rows the fx-cost rule reads, scoped to one household. Read only.
import { and, eq, isNotNull } from "drizzle-orm";
import { foreignCosts as engine, type FxCosts, type FxInput } from "@/lib/money/fx-cost";
import { householdDate } from "./account";
import { requireHousehold, withHousehold, type Db } from "./household";
import { fromRateMicro } from "./money";
import * as s from "./schema";

/** Paid USD invoices, charges with an original amount, the cards and the household's reference-rate history, in one read-only transaction. */
export async function foreignCostInputs(db: Db, householdId: string, today: string): Promise<FxInput> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const [household] = await tx.select({ homeCurrency: s.households.homeCurrency }).from(s.households).where(eq(s.households.id, hid));
    if (!household) throw new Error("Household not found");
    const home = household.homeCurrency;
    const [rateRows, cards, chargeRows, invoiceRows] = await Promise.all([
      tx.select({ date: s.fxRates.date, rateMicro: s.fxRates.rateMicro }).from(s.fxRates)
        .where(and(eq(s.fxRates.householdId, hid), eq(s.fxRates.base, "USD"), eq(s.fxRates.quote, home === "USD" ? "JPY" : home))),
      tx.select({ id: s.cards.id, label: s.cards.label, currency: s.cards.currency, foreignFeeBp: s.cards.foreignFeeBp }).from(s.cards).where(eq(s.cards.householdId, hid)).orderBy(s.cards.createdAt, s.cards.label),
      tx.select().from(s.charges).where(and(eq(s.charges.householdId, hid), eq(s.charges.status, "confirmed"), isNotNull(s.charges.originalAmountMinor), isNotNull(s.charges.originalCurrency)))
        .orderBy(s.charges.date, s.charges.id),
      tx.select({ id: s.invoices.id, clientId: s.invoices.clientId, clientName: s.clients.name, amountMinor: s.invoices.amountMinor, paidOn: s.invoices.paidOn, fxRateMicro: s.invoices.fxRateMicro })
        .from(s.invoices).innerJoin(s.clients, and(eq(s.clients.householdId, s.invoices.householdId), eq(s.clients.id, s.invoices.clientId)))
        .where(and(eq(s.invoices.householdId, hid), eq(s.invoices.status, "paid"), eq(s.invoices.currency, "USD"), isNotNull(s.invoices.paidOn)))
        .orderBy(s.invoices.paidOn, s.invoices.id),
    ]);
    const rates = rateRows.map(r => ({ date: r.date, perUsd: fromRateMicro(r.rateMicro) }));
    const rateOnDay = (date: string) => {
      const best = rates.filter(r => r.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
      return best?.perUsd ?? null;
    };
    return {
      today, homeCurrency: home, rates, cards,
      charges: chargeRows.map(c => ({
        id: c.id, cardId: c.cardId, merchant: c.merchant, date: c.date, amountMinor: c.amountMinor,
        original: { amountMinor: c.originalAmountMinor!, currency: c.originalCurrency! }, fxEstimated: c.fxEstimated,
      })),
      // The rate on the row is what the payout was converted at; a paid invoice without one uses the reference rate of its day, and none without a rate either.
      invoices: invoiceRows.flatMap(i => {
        const perUsd = i.fxRateMicro !== null ? fromRateMicro(i.fxRateMicro) : rateOnDay(i.paidOn!);
        return perUsd === null ? [] : [{ id: i.id, clientId: i.clientId, clientName: i.clientName, amountUsdMinor: i.amountMinor, paidOn: i.paidOn!, perUsd }];
      }),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** The last twelve months of foreign costs at the household's own date. */
export async function foreignCosts(db: Db, householdId: string): Promise<FxCosts> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => engine(await foreignCostInputs(tx, hid, await householdDate(tx, hid))),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}

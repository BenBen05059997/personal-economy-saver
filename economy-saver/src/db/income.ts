// Money in (D77): the paid client invoices of one household in a date range, as the home currency's minor units. Read only.
import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { convertMinor, fromRateMicro } from "./money";
import type { IncomeRow } from "@/lib/money/types";
import { requireHousehold, withHousehold, type Db } from "./household";
import * as s from "./schema";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The paid client invoices paid from `from` to `to` (both included), oldest first. A member's request (no client) is left out; a payment read from a connected PayPal is in,
 * with no sent day. The value is the invoice converted at the rate on the row, else the reference rate on the paid day; with neither rate it is `null` (named, never counted as zero).
 */
export async function loadIncome(db: Db, householdId: string, range: { from: string; to: string }): Promise<IncomeRow[]> {
  const hid = requireHousehold(householdId);
  const { from, to } = range;
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new Error("An income range is two YYYY-MM-DD dates, from on or before to");
  return withHousehold(db, hid, async tx => {
    const [household] = await tx.select({ homeCurrency: s.households.homeCurrency }).from(s.households).where(eq(s.households.id, hid));
    if (!household) throw new Error("Household not found");
    const home = household.homeCurrency;
    const [rateRows, rows] = await Promise.all([
      tx.select({ date: s.fxRates.date, rateMicro: s.fxRates.rateMicro }).from(s.fxRates)
        .where(and(eq(s.fxRates.householdId, hid), eq(s.fxRates.base, "USD"), eq(s.fxRates.quote, home === "USD" ? "JPY" : home))),
      tx.select({ id: s.invoices.id, clientId: s.clients.id, clientName: s.clients.name, amountMinor: s.invoices.amountMinor, currency: s.invoices.currency, sentOn: s.invoices.sentOn, paidOn: s.invoices.paidOn, fxRateMicro: s.invoices.fxRateMicro })
        .from(s.invoices).innerJoin(s.clients, and(eq(s.clients.householdId, s.invoices.householdId), eq(s.clients.id, s.invoices.clientId)))
        .where(and(eq(s.invoices.householdId, hid), eq(s.invoices.status, "paid"), isNotNull(s.invoices.paidOn), gte(s.invoices.paidOn, from), lte(s.invoices.paidOn, to)))
        .orderBy(asc(s.invoices.paidOn), asc(s.invoices.id)),
    ]);
    const rateOnDay = (date: string): number | null => {
      const best = rateRows.filter(r => r.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
      return best ? fromRateMicro(best.rateMicro) : null;
    };
    return rows.map((row): IncomeRow => {
      const paidOn = row.paidOn!;
      let homeMinor: number | null = null;
      if (row.currency === home) homeMinor = row.amountMinor;
      else if (row.currency === "USD") {
        const perUsd = row.fxRateMicro !== null ? fromRateMicro(row.fxRateMicro) : rateOnDay(paidOn);
        if (perUsd !== null) homeMinor = convertMinor(row.amountMinor, "USD", home, perUsd);
      }
      return { id: row.id, clientId: row.clientId, clientName: row.clientName, paidOn, sentOn: row.sentOn, homeMinor };
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

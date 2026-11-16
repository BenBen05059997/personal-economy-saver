// Money in (D77): the paid client invoices of one household in a date range, as the home currency's minor units. Read only.
import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { convertMinor } from "./money";
import { paidInvoicePerUsd, referenceRates } from "./reference-rate";
import type { IncomeRow } from "@/lib/money/types";
import { requireDateRange, requireHousehold, withHousehold, type Db } from "./household";
import * as s from "./schema";

/**
 * The paid client invoices paid from `from` to `to` (both included), oldest first. A member's request (no client) is left out; a payment read from a connected PayPal is in,
 * with no sent day. The value is the invoice converted at the rate on the row, else the reference rate on the paid day; with neither rate it is `null` (named, never counted as zero).
 */
export async function loadIncome(db: Db, householdId: string, range: { from: string; to: string }): Promise<IncomeRow[]> {
  const hid = requireHousehold(householdId);
  const { from, to } = requireDateRange(range, "An income");
  return withHousehold(db, hid, async tx => {
    const [household] = await tx.select({ homeCurrency: s.households.homeCurrency }).from(s.households).where(eq(s.households.id, hid));
    if (!household) throw new Error("Household not found");
    const home = household.homeCurrency;
    const [rates, rows] = await Promise.all([
      referenceRates(tx, hid, home),
      tx.select({ id: s.invoices.id, clientId: s.clients.id, clientName: s.clients.name, amountMinor: s.invoices.amountMinor, currency: s.invoices.currency, sentOn: s.invoices.sentOn, paidOn: s.invoices.paidOn, fxRateMicro: s.invoices.fxRateMicro })
        .from(s.invoices).innerJoin(s.clients, and(eq(s.clients.householdId, s.invoices.householdId), eq(s.clients.id, s.invoices.clientId)))
        .where(and(eq(s.invoices.householdId, hid), eq(s.invoices.status, "paid"), isNotNull(s.invoices.paidOn), gte(s.invoices.paidOn, from), lte(s.invoices.paidOn, to)))
        .orderBy(asc(s.invoices.paidOn), asc(s.invoices.id)),
    ]);
    return rows.map((row): IncomeRow => {
      const paidOn = row.paidOn!;
      let homeMinor: number | null = null;
      if (row.currency === home) homeMinor = row.amountMinor;
      else if (row.currency === "USD") {
        const perUsd = paidInvoicePerUsd({ fxRateMicro: row.fxRateMicro, paidOn }, rates);
        if (perUsd !== null) homeMinor = convertMinor(row.amountMinor, "USD", home, perUsd);
      }
      return { id: row.id, clientId: row.clientId, clientName: row.clientName, paidOn, sentOn: row.sentOn, homeMinor };
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

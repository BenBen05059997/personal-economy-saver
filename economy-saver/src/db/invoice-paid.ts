import { refreshSuggestions } from "./suggestions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { paidTitle } from "@/lib/money/paid-title";
import { recordEvent, requireHousehold, withHousehold, usdRateMicro, type Db } from "./household";
import { convertMinor, fromMinor, fromRateMicro } from "./money";
import { fillPots } from "./pots";
import { observeRunway } from "./runway-events";
import { clients, households, invoices } from "./schema";

const OUTSIDE_STATUSES = ["draft", "unbilled", "sent"] as const;

/**
 * Lock order, as in every money writer: the household row, then the invoice row. The invoice is read after its lock, so a
 * capture that a webhook just landed (which holds the same locks) is seen and refused below.
 *
 * Marks an invoice the user was paid for outside PayPal: sets it paid today and credits the bank balance with its
 * value in the home currency at the latest rate on or before `today`. A payment PayPal captured is only ever
 * marked paid by the verified webhook (D15), so that throws. Returns false when nothing changed (no such invoice in
 * this household, or it is already paid or closed), so a repeat never credits twice.
 */
export async function markPaidOutside(db: Db, householdId: string, invoiceId: string, today: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const day = z.string().date().parse(today);
  const id = z.string().uuid().parse(invoiceId);
  const saved = await withHousehold(db, hid, async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, bank: households.bankBalanceMinor, previous: households.runwayShort })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) return false;
    const [row] = await tx.select({ invoice: invoices, client: clients.name }).from(invoices)
      .innerJoin(clients, and(eq(clients.householdId, hid), eq(clients.id, invoices.clientId)))
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, id))).for("update", { of: invoices });
    if (!row) return false;
    const { invoice } = row;
    if (invoice.paypalCaptureId !== null) throw new InputError("PayPal took this payment; it is already marked paid");
    if (!(OUTSIDE_STATUSES as readonly string[]).includes(invoice.status)) return false;
    if (household.previous === null) await observeRunway(tx, hid);
    const rateMicro = await usdRateMicro(tx, hid, household.currency, day);
    const credit = convertMinor(invoice.amountMinor, invoice.currency, household.currency, fromRateMicro(rateMicro));
    const updated = await tx.update(invoices).set({ status: "paid", paidOn: day, fxRateMicro: rateMicro })
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, id), isNull(invoices.paypalCaptureId), inArray(invoices.status, [...OUTSIDE_STATUSES])))
      .returning({ id: invoices.id });
    if (!updated.length) return false;
    await tx.update(households).set({ bankBalanceMinor: household.bank + credit }).where(eq(households.id, hid));
    await recordEvent(tx, hid, { madeBy: "form",
      kind: "invoice_paid_outside", title: paidTitle(row.client, invoice.amountMinor, invoice.currency, "outside"),
      amount: { value: fromMinor(invoice.amountMinor, invoice.currency), currency: invoice.currency },
      ref: { type: "invoice", id }, notify: false,
    });
    await fillPots(tx, hid, credit, `${row.client}'s payment`);
    await observeRunway(tx, hid);
    return true;
  });
  if (saved) await refreshSuggestions(db, hid, "markPaidOutside");
  return saved;
}

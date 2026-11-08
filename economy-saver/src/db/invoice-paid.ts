import { runPass } from "./suggestions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, usdRateMicro, type Db } from "./household";
import { convertMinor, fromMinor, fromRateMicro } from "./money";
import { fillPots } from "./pots";
import { observeRunway } from "./runway-events";
import { clients, households, invoices } from "./schema";

const OUTSIDE_STATUSES = ["draft", "unbilled", "sent"] as const;

/**
 * Marks an invoice the user was paid for outside PayPal: sets it paid today and credits the bank balance with its
 * value in the home currency at the latest rate on or before `today`. An invoice sent through PayPal is only ever
 * marked paid by the verified webhook (D15), so it throws. Returns false when nothing changed (no such invoice in
 * this household, or it is already paid or closed), so a repeat never credits twice.
 */
export async function markPaidOutside(db: Db, householdId: string, invoiceId: string, today: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const day = z.string().date().parse(today);
  const id = z.string().uuid().parse(invoiceId);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, bank: households.bankBalanceMinor, previous: households.runwayShort })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) return false;
    const [row] = await tx.select({ invoice: invoices, client: clients.name }).from(invoices)
      .innerJoin(clients, and(eq(clients.householdId, hid), eq(clients.id, invoices.clientId)))
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, id)));
    if (!row) return false;
    const { invoice } = row;
    if (invoice.paypalInvoiceId !== null) throw new InputError("This invoice was sent through PayPal; PayPal marks it paid");
    if (!(OUTSIDE_STATUSES as readonly string[]).includes(invoice.status)) return false;
    if (household.previous === null) await observeRunway(tx, hid);
    const rateMicro = await usdRateMicro(tx, hid, household.currency, day);
    const credit = convertMinor(invoice.amountMinor, invoice.currency, household.currency, fromRateMicro(rateMicro));
    const updated = await tx.update(invoices).set({ status: "paid", paidOn: day, fxRateMicro: rateMicro })
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, id), isNull(invoices.paypalInvoiceId), inArray(invoices.status, [...OUTSIDE_STATUSES])))
      .returning({ id: invoices.id });
    if (!updated.length) return false;
    await tx.update(households).set({ bankBalanceMinor: household.bank + credit }).where(eq(households.id, hid));
    await recordEvent(tx, hid, { madeBy: "paypal",
      kind: "invoice_paid_outside", title: `${row.client} marked paid outside PayPal`,
      amount: { value: fromMinor(invoice.amountMinor, invoice.currency), currency: invoice.currency },
      ref: { type: "invoice", id }, notify: false,
    });
    await fillPots(tx, hid, credit, `${row.client}'s payment`);
    await observeRunway(tx, hid);
    await runPass(tx, hid);
    return true;
  });
}

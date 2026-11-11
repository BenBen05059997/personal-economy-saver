import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { fromMinor } from "./money";
import { clients, invoices } from "./schema";
import { closeByRef } from "./suggestions";

/**
 * The person copied the payment link of a sent invoice to send it (again). Writes no invoice column: it records a
 * `link_offered` Activity event and closes the invoice's open "send the link again" suggestion. Returns false when the
 * invoice is not in this household or is not a sent one with a link.
 */
export async function recordLinkOffered(db: Db, householdId: string, invoiceId: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const id = z.string().uuid().parse(invoiceId);
  return withHousehold(db, hid, async tx => {
    const [row] = await tx.select({ invoice: invoices, client: clients.name }).from(invoices)
      .innerJoin(clients, and(eq(clients.householdId, hid), eq(clients.id, invoices.clientId)))
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, id)));
    if (!row || row.invoice.status !== "sent" || row.invoice.payToken === null) return false;
    await recordEvent(tx, hid, { madeBy: "form", kind: "link_offered", title: `Payment link for ${row.client} offered`,
      amount: { value: fromMinor(row.invoice.amountMinor, row.invoice.currency), currency: row.invoice.currency },
      ref: { type: "invoice", id }, notify: false });
    await closeByRef(tx, hid, id, ["remind"]);
    return true;
  });
}

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lockHousehold, recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { clients, invoices } from "./schema";
import { closeByRef, refreshSuggestions } from "./suggestions";

/**
 * Ends the payment link of a sent invoice: the invoice becomes closed, so it leaves the forecast, its open "send the link
 * again" suggestion is closed and the public pay page says the link has ended. Returns false when there is no such sent
 * invoice in this household, so a repeat changes nothing.
 */
export async function endPaymentLink(db: Db, householdId: string, invoiceId: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const id = z.string().uuid().parse(invoiceId);
  const ended = await withHousehold(db, hid, async tx => {
    // Lock order, as in every money writer: the household row, then the invoice row; the status is read after the lock.
    await lockHousehold(tx, hid);
    const [row] = await tx.select({ client: clients.name }).from(invoices)
      .innerJoin(clients, and(eq(clients.householdId, hid), eq(clients.id, invoices.clientId)))
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, id))).for("update", { of: invoices });
    if (!row) return false;
    const updated = await tx.update(invoices).set({ status: "closed" })
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, id), eq(invoices.status, "sent"))).returning({ id: invoices.id });
    if (!updated.length) return false;
    await recordEvent(tx, hid, { madeBy: "form", kind: "link_ended", title: `Payment link for ${row.client} ended`,
      ref: { type: "invoice", id }, notify: false });
    await closeByRef(tx, hid, id, ["remind"]);
    return true;
  });
  if (ended) await refreshSuggestions(db, hid, "endPaymentLink");
  return ended;
}

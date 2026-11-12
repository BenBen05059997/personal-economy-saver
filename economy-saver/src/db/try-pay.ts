// A Try it judge plays the client without a PayPal login (D12): fipa pays the sent invoice with PayPal's sandbox test card.
// The payment is only taken here; the invoice is marked paid by the verified webhook alone (D15).
import { and, eq } from "drizzle-orm";
import { ApprovalError } from "./approval";
import { lockHousehold, requireHousehold, withHousehold, type Db } from "./household";
import { orderRequestFor } from "./payment-link";
import { households, invoices } from "./schema";
import type { PayWithTestCard } from "@/lib/paypal/contracts";

export type TryPayContext = {
  db: Db;
  householdId: string;
  invoiceId: string;
  /** Only the pay-as-the-client route supplies the real one; tests inject theirs. */
  pay: PayWithTestCard;
};

/** Whether the capture PayPal answered took the money or may still. */
const TAKING = ["COMPLETED", "PENDING"];

/**
 * Pays a Try it household's sent, unpaid invoice as the client, with the sandbox test card:
 * 1. Under the household lock, then the invoice's, the household must be a Try it one and the invoice sent with its link,
 *    not paid and holding no capture.
 * 2. With no lock held PayPal is asked, with a PayPal-Request-Id made from the invoice, so two taps get the same order.
 * 3. Under the same locks the order and its capture id are kept on the invoice (it stays sent: "processing" until the
 *    completed-payment event marks it paid). A declined capture keeps nothing.
 * The webhook may settle the invoice before step 3; then step 3 changes nothing.
 */
export async function payInvoiceAsTestClient(ctx: TryPayContext): Promise<string> {
  const hid = requireHousehold(ctx.householdId);
  const checked = await withHousehold(ctx.db, hid, tx => lockedInvoice(tx, hid, ctx.invoiceId));
  if (checked.refusal) throw checked.refusal;
  const { invoice } = checked;
  const payee = invoice.paypalPayeeId!;
  const paid = await ctx.pay(orderRequestFor(invoice, payee, invoice.payToken!, "T-" + invoice.id));
  const taking = paid.captureId !== null && paid.captureStatus !== null && TAKING.includes(paid.captureStatus);
  return withHousehold(ctx.db, hid, async tx => {
    const now = await lockedInvoice(tx, hid, invoice.id, paid.captureId);
    if (now.refusal === "settled") return invoice.id;
    if (now.refusal) throw now.refusal;
    if (!taking) {
      if (paid.captureStatus === "DECLINED" || paid.captureStatus === "FAILED") throw new ApprovalError("PayPal declined the test card. Try again.", 402);
      throw new ApprovalError("PayPal did not confirm the test-card payment. Open the invoice again to check its status or retry.", 502);
    }
    await tx.update(invoices).set({ paypalOrderId: paid.orderId, paypalCaptureId: paid.captureId })
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, invoice.id)));
    return invoice.id;
  });
}

/**
 * Locks the household row, then the invoice row, and says whether the test card may pay it now. `settled` is the answer when the
 * invoice is already paid or already holds `ownCapture` (the webhook or a second tap got there first).
 */
async function lockedInvoice(tx: Db, hid: string, invoiceId: string, ownCapture?: string | null) {
  await lockHousehold(tx, hid);
  const [household] = await tx.select({ isDemo: households.isDemo }).from(households).where(eq(households.id, hid));
  if (!household?.isDemo) return { invoice: null as never, refusal: new ApprovalError("Paying as the client is only for a Try it household.", 403) };
  const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.householdId, hid), eq(invoices.id, invoiceId))).for("update");
  if (!invoice) return { invoice: null as never, refusal: new ApprovalError("Invoice not found", 404) };
  if (ownCapture !== undefined) {
    if (invoice.status === "paid" || (ownCapture !== null && invoice.paypalCaptureId === ownCapture)) return { invoice, refusal: "settled" as const };
  }
  const refusal = invoice.status === "paid" ? new ApprovalError("This invoice is already paid.")
    : invoice.status !== "sent" || !invoice.payToken || !invoice.paypalPayeeId ? new ApprovalError("Only a sent invoice with a payment link can be paid as the client.")
    : invoice.paypalCaptureId ? new ApprovalError("This invoice's payment is already being confirmed.")
    : null;
  return { invoice, refusal };
}

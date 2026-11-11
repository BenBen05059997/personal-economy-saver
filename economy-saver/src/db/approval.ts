import { beginMoneyChange, observeRunway } from "./runway-events";
import { and, eq } from "drizzle-orm";
import { recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { fromMinor, toRateMicro } from "./money";
import { orderRequestFor } from "./payment-link";
import { payeeFor } from "./paypal-connection";
import { clients, invoices } from "./schema";
import { addDays } from "@/lib/money/dates";
import { NotConnected, type CreateOrder } from "@/lib/paypal/contracts";
import { canHavePayLink, newPayToken, payLinkUrl } from "@/lib/paypal/pay-link";

export class ApprovalError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

/** What the invoice page shows: the invoice, its client and the fipa link once Approve has made one. */
export async function invoiceReview(db: Db, householdId: string, invoiceId: string) {
  const hid = requireHousehold(householdId);
  const [row] = await db.select({ invoice: invoices, client: clients.name })
    .from(invoices).innerJoin(clients, and(eq(clients.householdId, hid), eq(clients.id, invoices.clientId)))
    .where(and(eq(invoices.householdId, hid), eq(invoices.id, invoiceId)));
  if (!row) return undefined;
  return { ...row, payLink: row.invoice.payToken ? payLinkUrl(row.invoice.payToken) : null };
}

export type ApprovalContext = {
  db: Db;
  householdId: string;
  approveKey: string;
  today: string;
  usdRate: number;
  /** Only the approve route supplies the real one; tests inject theirs. */
  createOrder: CreateOrder;
};

/**
 * Approve (D12): asks PayPal for an order for the invoice's amount, paid to the household's PayPal, and gives the invoice its
 * permanent fipa link. No lock is held while PayPal is asked, so webhooks and reads of the household never wait on it:
 * 1. Under the invoice's row lock, the draft is checked and its link token kept (so a retry's order returns to the same link).
 * 2. PayPal is asked with a PayPal-Request-Id made of the draft's approve key and what the order is for, so a second tap or a
 *    retry after a timeout gets the same order back, and a draft edited since gets a new one.
 * 3. Under the household lock, then the invoice's (the order every money writer locks in), the invoice is sent with that
 *    order, unless a tap got there first or the draft changed while PayPal was asked.
 */
export async function approvePaymentLink(ctx: ApprovalContext): Promise<string> {
  const hid = requireHousehold(ctx.householdId);
  const draft = await withHousehold(ctx.db, hid, async tx => {
    const [invoice] = await tx.select().from(invoices)
      .where(and(eq(invoices.householdId, hid), eq(invoices.approveKey, ctx.approveKey))).for("update");
    if (!invoice) throw new ApprovalError("Invoice not found", 404);
    if (refusal(invoice)) return { invoice, payee: null };
    const payee = await payeeOf(tx, hid);
    if (invoice.payToken) return { invoice, payee };
    const [kept] = await tx.update(invoices).set({ payToken: newPayToken() })
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, invoice.id))).returning();
    return { invoice: kept, payee };
  });
  const sentAlready = refusal(draft.invoice);
  if (sentAlready === "sent") return draft.invoice.id;
  if (sentAlready) throw sentAlready;
  const payee = draft.payee!;
  const token = draft.invoice.payToken!;
  const requestId = `O-${ctx.approveKey}-${await orderFingerprint(draft.invoice, payee)}`;
  const order = await ctx.createOrder(orderRequestFor(draft.invoice, payee, token, requestId));
  return withHousehold(ctx.db, hid, async tx => {
    await beginMoneyChange(tx, hid);
    const [invoice] = await tx.select().from(invoices)
      .where(and(eq(invoices.householdId, hid), eq(invoices.id, draft.invoice.id))).for("update");
    if (!invoice) throw new ApprovalError("Invoice not found", 404);
    const now = refusal(invoice);
    if (now === "sent") return invoice.id;
    if (now) throw now;
    if (invoice.item !== draft.invoice.item || invoice.amountMinor !== draft.invoice.amountMinor || invoice.currency !== draft.invoice.currency
      || invoice.payToken !== token || await payeeOf(tx, hid) !== payee) {
      throw new ApprovalError("This invoice changed while its link was being made. Tap Approve again.");
    }
    const [client] = await tx.select({ name: clients.name, termsDays: clients.termsDays }).from(clients)
      .where(and(eq(clients.householdId, hid), eq(clients.id, invoice.clientId)));
    await tx.update(invoices).set({
      status: "sent", sentOn: ctx.today, dueOn: invoice.dueOn ?? addDays(ctx.today, client.termsDays),
      fxRateMicro: toRateMicro(ctx.usdRate), paypalOrderId: order.orderId, paypalOrderCreatedAt: order.createdAt,
      paypalApproveUrl: order.approveUrl, paypalPayeeId: payee,
    }).where(and(eq(invoices.householdId, hid), eq(invoices.id, invoice.id)));
    await recordEvent(tx, hid, { madeBy: "form", kind: "invoice_sent", title: `Payment link made for ${client.name}`,
      amount: { value: fromMinor(invoice.amountMinor, invoice.currency), currency: invoice.currency }, ref: { type: "invoice", id: invoice.id } });
    await observeRunway(tx, hid);
    return invoice.id;
  });
}

/** Why this invoice cannot be approved now: "sent" when it already has its link, an ApprovalError, or null when it can. */
function refusal(invoice: { status: string; currency: string; amountMinor: number }): "sent" | ApprovalError | null {
  if (invoice.status === "closed") return new ApprovalError("This invoice is closed.");
  if (invoice.status === "paid") return new ApprovalError("This invoice is already paid.");
  if (invoice.status === "sent") return "sent";
  if (!canHavePayLink(invoice)) return new ApprovalError("A positive USD invoice amount is required.");
  return null;
}

async function payeeOf(tx: Db, hid: string): Promise<string> {
  try { return await payeeFor(tx, hid); } catch (error) {
    if (error instanceof NotConnected) throw new ApprovalError(error.message, 409);
    throw error;
  }
}

/** A short digest of what an order is for, so the PayPal-Request-Id changes when the draft does. */
async function orderFingerprint(invoice: { item: string; amountMinor: number; currency: string }, payee: string): Promise<string> {
  const text = JSON.stringify([invoice.item, invoice.amountMinor, invoice.currency, payee]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Buffer.from(digest.slice(0, 12)).toString("base64url");
}

// The client's side of a payment link (D12, D37): a random token in a fipa address, read without any household session.
import { and, eq, isNull } from "drizzle-orm";
import { requireHousehold, withHousehold, type Db } from "./household";
import { payeeFor } from "./paypal-connection";
import { invoices } from "./schema";
import { PayPalError } from "@/lib/paypal/client";
import { NotConnected, type CreateOrder, type OrderRequest, type PayPalCall } from "@/lib/paypal/contracts";
import { payLinkRefusal, payLinkUrl } from "@/lib/paypal/pay-link";
import { isPayPalApproveUrl } from "@/lib/paypal/send";

/** PayPal lets an order lapse three hours after it is made; a link opened after this long makes a fresh order. */
export const ORDER_REUSE_MS = (2 * 60 + 50) * 60 * 1000;

export type PaymentLinkView =
  | { state: "open"; item: string; amountMinor: number; currency: string }
  | { state: "processing" }
  | { state: "paid" }
  | { state: "ended" };

/** The invoice number PayPal is given for an order: the whole fipa invoice id in its field, never the person's visible number. */
export const paypalInvoiceNumber = (id: string) => "P-" + Buffer.from(id.replaceAll("-", ""), "hex").toString("base64url");

/** The one order request for an invoice, made by Approve and by the link's Pay alike. Only a USD amount is asked for. */
export function orderRequestFor(
  invoice: { id: string; item: string; amountMinor: number; currency: string }, payee: string, token: string, requestId: string,
): OrderRequest {
  const refusal = payLinkRefusal(invoice);
  if (refusal) throw new Error(`A payment link needs a positive USD amount (${refusal})`);
  const link = payLinkUrl(token);
  return {
    payee, requestId, invoiceId: invoice.id, number: paypalInvoiceNumber(invoice.id), item: invoice.item,
    amountMinor: invoice.amountMinor, currency: "USD", returnUrl: link + "/done", cancelUrl: link,
  };
}

/** The invoice a token belongs to. A PayPal-facing link carries no household, so the token alone resolves it. */
async function invoiceByToken(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
  const [row] = await db.select({
    id: invoices.id, hid: invoices.householdId, status: invoices.status, item: invoices.item,
    amountMinor: invoices.amountMinor, currency: invoices.currency, captureId: invoices.paypalCaptureId,
    orderId: invoices.paypalOrderId, orderAt: invoices.paypalOrderCreatedAt, approveUrl: invoices.paypalApproveUrl,
    payee: invoices.paypalPayeeId, approveKey: invoices.approveKey,
  }).from(invoices).where(eq(invoices.payToken, token));
  return row;
}
type LinkRow = NonNullable<Awaited<ReturnType<typeof invoiceByToken>>>;

/**
 * A paid invoice is "paid", however it was paid. A sent invoice whose payment fipa already took is "processing" until PayPal's
 * completed-payment event marks it paid. Closed and a household no longer connected are "ended".
 */
async function stateOf(db: Db, row: LinkRow): Promise<"open" | "processing" | "paid" | "ended"> {
  if (row.status === "paid") return "paid";
  if (row.status !== "sent") return "ended";
  if (row.captureId) return "processing";
  try { await payeeFor(db, row.hid); } catch (error) {
    if (error instanceof NotConnected) return "ended";
    throw error;
  }
  return "open";
}

/** What the public page shows (D12, D37): the item and the amount, or that the link has ended. Nothing about the household. */
export async function paymentLinkView(db: Db, token: string): Promise<PaymentLinkView> {
  const row = await invoiceByToken(db, token);
  if (!row) return { state: "ended" };
  const state = await stateOf(db, row);
  if (state !== "open") return { state };
  return { state, item: row.item, amountMinor: row.amountMinor, currency: row.currency };
}

export type OpenedLink =
  | { kind: "redirect"; url: string }
  | { kind: "paid" }
  | { kind: "processing" }
  | { kind: "ended" }
  | { kind: "unknown" };

/**
 * The client tapped Pay. PayPal is always asked where the stored order stands before anything replaces it, whatever its age:
 * one the client approved or paid is never replaced (the page says the payment is being confirmed), one still waiting and
 * young enough is reused, and only one that has lapsed, was voided, was declined, is about to lapse or pays an account the
 * household no longer uses gets a fresh order for the approved amount. A link preview never reaches here (D37).
 *
 * No lock is held across the PayPal calls: a fresh order's PayPal-Request-Id is derived from the order it replaces, so two
 * taps get the same order from PayPal, and it is stored only if the invoice still holds the order it replaces.
 */
export async function openPaymentLink(db: Db, token: string, create: CreateOrder, read: PayPalCall, now: Date): Promise<OpenedLink> {
  const row = await invoiceByToken(db, token);
  if (!row) return { kind: "unknown" };
  const state = await stateOf(db, row);
  if (state !== "open") return { kind: state };
  const payee = await payeeFor(db, row.hid);
  const current = await storedOrder(read, row, payee, now);
  if (current.kind !== "replace") return current;
  const order = await create(orderRequestFor(row, payee, token, "N-" + (row.orderId ?? row.approveKey)));
  const hid = requireHousehold(row.hid);
  const stored = await withHousehold(db, hid, tx => tx.update(invoices).set({
    paypalOrderId: order.orderId, paypalOrderCreatedAt: order.createdAt, paypalApproveUrl: order.approveUrl, paypalPayeeId: payee,
  }).where(and(eq(invoices.householdId, hid), eq(invoices.id, row.id), eq(invoices.status, "sent"), isNull(invoices.paypalCaptureId),
    row.orderId ? eq(invoices.paypalOrderId, row.orderId) : isNull(invoices.paypalOrderId)))
    .returning({ id: invoices.id }));
  if (stored.length) return { kind: "redirect", url: order.approveUrl };
  // Something changed the invoice meanwhile: another tap stored an order, or the payment was taken, or the link ended.
  const latest = await invoiceByToken(db, token);
  if (!latest) return { kind: "unknown" };
  const after = await stateOf(db, latest);
  if (after !== "open") return { kind: after };
  if (latest.orderId === order.orderId) return { kind: "redirect", url: order.approveUrl };
  if (latest.approveUrl && isPayPalApproveUrl(latest.approveUrl)) return { kind: "redirect", url: latest.approveUrl };
  return { kind: "processing" };
}

/** What to do with the invoice's stored order: send the client to it, say the payment is being confirmed, or replace it. */
async function storedOrder(read: PayPalCall, row: LinkRow, payee: string, now: Date): Promise<{ kind: "redirect"; url: string } | { kind: "processing" } | { kind: "replace" }> {
  // No order yet, or one fipa already knows took no money (a declined capture): nothing to ask.
  if (!row.orderId || !row.approveUrl) return { kind: "replace" };
  const live = await orderStatus(read, row.orderId, row.payee ?? payee, row.payee !== null && row.payee !== payee);
  if (live === "taking") return { kind: "processing" };
  const young = row.orderAt !== null && now.getTime() - row.orderAt.getTime() < ORDER_REUSE_MS;
  if (live === "waiting" && young && row.payee === payee && isPayPalApproveUrl(row.approveUrl)) return { kind: "redirect", url: row.approveUrl };
  return { kind: "replace" };
}

type OrderRead = { status?: string; purchase_units?: { payments?: { captures?: { status?: string }[] } }[] } | undefined;

/**
 * Where an order stands at PayPal: still waiting for the client, approved or paid (taking), or gone. A completed order whose
 * capture was declined or failed took no money and is gone. `oldPayee` is an order for an account the household no longer
 * uses: if PayPal no longer lets fipa act for it, fipa cannot take that order's payment either, so it is gone.
 */
async function orderStatus(read: PayPalCall, orderId: string, actAs: string, oldPayee: boolean): Promise<"waiting" | "taking" | "gone"> {
  let order: OrderRead;
  try {
    order = await read({ method: "GET", path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`, actAs }) as OrderRead;
  } catch (error) {
    if (error instanceof PayPalError && (error.status === 404 || (oldPayee && error.status === 403))) return "gone";
    throw error;
  }
  if (order?.status === "CREATED" || order?.status === "PAYER_ACTION_REQUIRED") return "waiting";
  if (order?.status === "APPROVED") return "taking";
  if (order?.status === "COMPLETED") {
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0]?.status;
    return capture === "DECLINED" || capture === "FAILED" ? "gone" : "taking";
  }
  return "gone";
}

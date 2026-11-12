// An open invoice and a payment the PayPal read found (D15, D64): the same money seen twice. The read row came from PayPal's own
// transaction report for the connected seller, so it already counted the money once (balance and pots); matching it to the
// invoice only moves that payment onto the invoice. It credits nothing.
import { and, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { requireHousehold, withHousehold, type Db } from "./household";
import { beginMoneyChange, observeRunway } from "./runway-events";
import { clients, events, invoices, paypalConnections } from "./schema";
import { settleUpInTx } from "./settle";
import { refreshSuggestions } from "./suggestions";

export class InvoiceMatchError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = "InvoiceMatchError"; }
}

/** A payment the read found that could be the invoice: what a screen needs to ask "Acme paid $200 on PayPal on Nov 9. Is this that invoice?" */
export type ReadPaymentCandidate = {
  paymentId: string; paidOn: string; amountMinor: number; currency: string;
  /** The payer as PayPal reported them (the name the read gave its client; the email when PayPal gave no name). */
  payer: string; payerEmail: string;
  /** True when the payer is the invoice's own client. */
  ownClient: boolean;
};

/** A row the PayPal read made: paid, never sent, no fipa link or order, holding PayPal's transaction id as its capture id. */
const isReadPayment = and(eq(invoices.madeBy, "paypal"), eq(invoices.status, "paid"), isNull(invoices.sentOn), isNull(invoices.payToken),
  isNull(invoices.paypalOrderId), isNotNull(invoices.paypalCaptureId), isNotNull(invoices.paidOn));

/**
 * The payments the read found that could be this open invoice: same currency and amount, paid on or after the day its link was
 * made, from the invoice's own client first and then any other payer, earliest first. A client may pay from an address that is
 * not on file, and the read makes a client for it, so the payer is not required to be the invoice's client. Empty when the
 * invoice is not sent, has no link, or the household's PayPal is not connected.
 */
export async function readPaymentCandidates(db: Db, householdId: string, invoiceId: string): Promise<ReadPaymentCandidate[]> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const [connected] = await tx.select({ id: paypalConnections.id }).from(paypalConnections)
      .where(and(eq(paypalConnections.householdId, hid), eq(paypalConnections.connectionStatus, "connected")));
    if (!connected) return [];
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.householdId, hid), eq(invoices.id, invoiceId)));
    if (!invoice || invoice.clientId === null || invoice.status !== "sent" || !invoice.sentOn || invoice.paypalCaptureId) return [];
    const own = eq(invoices.clientId, invoice.clientId);
    const rows = await tx.select({ paymentId: invoices.id, paidOn: invoices.paidOn, amountMinor: invoices.amountMinor, currency: invoices.currency,
      payer: clients.name, payerEmail: clients.email, ownClient: sql<boolean>`${own}` })
      .from(invoices).innerJoin(clients, and(eq(clients.householdId, hid), eq(clients.id, invoices.clientId)))
      .where(and(eq(invoices.householdId, hid), isReadPayment,
        eq(invoices.currency, invoice.currency), eq(invoices.amountMinor, invoice.amountMinor), gte(invoices.paidOn, invoice.sentOn)))
      .orderBy(sql`${own} desc`, invoices.paidOn, invoices.id);
    return rows as ReadPaymentCandidate[];
  });
}

/**
 * After a read payment is settled onto an invoice of another client, tidies what the read made for its payer. The read makes a
 * client for a payer email not on file (same transaction as the payment row, so the same created_at). If that client has nothing
 * else, it goes with its "added as a client" entry, and the payer's email is remembered on the invoice's client when that client
 * has none, so the read recognises the next payment from that address. A client that already has an email keeps it (the read
 * recognises a payer by one email per client), and a read-made client that still has other invoices stays as it is.
 */
async function tidyReadClient(tx: Db, hid: string, payment: typeof invoices.$inferSelect, invoiceClientId: string | null) {
  if (invoiceClientId === null || payment.clientId === null || payment.clientId === invoiceClientId) return; // a member's request has no client to learn the payer's email
  const [made] = await tx.select().from(clients).where(and(eq(clients.householdId, hid), eq(clients.id, payment.clientId)));
  if (!made || made.createdAt.getTime() !== payment.createdAt.getTime()) return;
  const [other] = await tx.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.householdId, hid), eq(invoices.clientId, made.id), ne(invoices.id, payment.id))).limit(1);
  if (other) return;
  await tx.delete(clients).where(and(eq(clients.householdId, hid), eq(clients.id, made.id)));
  await tx.delete(events).where(and(eq(events.householdId, hid), eq(events.kind, "client_added"), eq(events.refType, "client"), eq(events.refId, made.id)));
  await tx.update(clients).set({ email: made.email })
    .where(and(eq(clients.householdId, hid), eq(clients.id, invoiceClientId), eq(clients.email, "")));
}

/**
 * Settles an open invoice with a payment the read found, inside the caller's household transaction. The invoice becomes paid on
 * the read's date with its capture id, the read row is deleted and Activity's entry for it points at the invoice. The caller
 * runs refreshSuggestions after commit, which resolves the invoice's "send the link again" suggestion as any paid invoice does.
 *
 * Lock order, as in every money writer: the household row (beginMoneyChange), then the invoice row, then the read row. The invoice
 * is read after its lock, so a capture that just landed is seen.
 *
 * `by: "person"` is a person's own "Yes": amount, currency and date must match and the invoice must be sent. The payer need not
 * be the invoice's client (a client may pay from another address); the person has seen the payer's name in the question.
 * `by: "capture"` is the webhook's completed payment for this invoice's own order whose capture id the read already holds: the
 * capture id is the match, so the payer the read named may differ from the client, and an ended (closed) link still settles,
 * because the money did arrive. Amount and currency must match either way.
 */
export async function settleReadPaymentInTx(tx: Db, householdId: string, invoiceId: string, paymentId: string, by: "person" | "capture"): Promise<void> {
  const hid = requireHousehold(householdId);
  await beginMoneyChange(tx, hid);
  const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.householdId, hid), eq(invoices.id, invoiceId))).for("update");
  if (!invoice) throw new InvoiceMatchError("Invoice not found", 404);
  const [payment] = await tx.select().from(invoices)
    .where(and(eq(invoices.householdId, hid), eq(invoices.id, paymentId), isReadPayment)).for("update");
  if (!payment || !payment.paidOn || !payment.paypalCaptureId) throw new InvoiceMatchError("That is not a payment PayPal reported to this household.", 404);
  const open = invoice.status === "sent" || (by === "capture" && invoice.status === "closed");
  if (!open) throw new InvoiceMatchError("This invoice is not waiting for a payment.");
  if (payment.amountMinor !== invoice.amountMinor || payment.currency !== invoice.currency) throw new InvoiceMatchError("That payment is a different amount.");
  if (by === "person") {
    if (!invoice.sentOn || payment.paidOn < invoice.sentOn) throw new InvoiceMatchError("That payment came before the link was made.");
  }
  if (invoice.paypalCaptureId && invoice.paypalCaptureId !== payment.paypalCaptureId) throw new InvoiceMatchError("This invoice's payment is already on its way.");

  // The read row goes first, so its capture id is free for the invoice under the unique index.
  await tx.delete(invoices).where(and(eq(invoices.householdId, hid), eq(invoices.id, payment.id)));
  await tx.update(invoices).set({ status: "paid", paidOn: payment.paidOn, paypalCaptureId: payment.paypalCaptureId })
    .where(and(eq(invoices.householdId, hid), eq(invoices.id, invoice.id)));
  await tx.update(events).set({ refId: invoice.id })
    .where(and(eq(events.householdId, hid), eq(events.refType, "invoice"), eq(events.refId, payment.id)));
  // The payment row is gone, so a read-made client for another payer can now be seen to have nothing left.
  await tidyReadClient(tx, hid, payment, invoice.clientId);
  if (invoice.payerMemberId !== null) await settleUpInTx(tx, hid); // a member's request (D45) settles the transfers when it is paid
  await observeRunway(tx, hid);
}

/** A person's "Yes, that is this invoice": settles it with the payment the read found (see settleReadPaymentInTx). Throws InvoiceMatchError on a refusal. */
export async function settleReadPayment(db: Db, householdId: string, invoiceId: string, paymentId: string): Promise<void> {
  const hid = requireHousehold(householdId);
  await withHousehold(db, hid, tx => settleReadPaymentInTx(tx, hid, invoiceId, paymentId, "person"));
  await refreshSuggestions(db, hid, "settleReadPayment");
}

/** The read row of this household that holds a capture id, if any. */
export async function readPaymentByCapture(tx: Db, householdId: string, captureId: string): Promise<string | undefined> {
  const hid = requireHousehold(householdId);
  const [row] = await tx.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.householdId, hid), eq(invoices.paypalCaptureId, captureId), isReadPayment));
  return row?.id;
}

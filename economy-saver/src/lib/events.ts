import { refreshSuggestions } from "@/db/suggestions";
import { and, desc, eq, inArray, isNotNull, isNull, lte, max, or, sql, type SQL } from "drizzle-orm";
import { type Db, recordEvent, recordWebhookDelivery, usdRateMicro, withHousehold } from "@/db/household";
import { beginMoneyChange, lockRunway, observeRunway } from "@/db/runway-events";
import { convertMinor, fromMinor, fromRateMicro, parseMinor } from "@/db/money";
import { householdMoment } from "@/db/clock";
import { fillPots } from "@/db/pots";
import { clients, events, fxRates, households, invoices, members, paypalConnections, webhookDeliveries } from "@/db/schema";
import { settleUpInTx } from "@/db/settle";
import { applyMerchantEvent, ownerPayPal } from "@/db/paypal-connection";
import { InvoiceMatchError, readPaymentByCapture, settleReadPaymentInTx } from "@/db/invoice-match";
import { paidTitle } from "@/lib/money/paid-title";
import { PayPalError, paypalRead } from "@/lib/paypal/client";
import type { CaptureOrder } from "@/lib/paypal/contracts";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhook";

/** What a delivery keeps of PayPal's event: the resource id and the time, the only fields this app reads back. Never the whole event (27E). */
export const storedPayload = (event: PayPalWebhookEvent, resourceId: string | undefined) => ({ resourceId, createdAt: event.create_time });

type Money = { currency_code?: string; value?: string };
type Resource = {
  id?: string; status?: string; custom_id?: string;
  amount?: Money;
  payee?: { merchant_id?: string };
  supplementary_data?: { related_ids?: { order_id?: string } };
  purchase_units?: { custom_id?: string; amount?: Money; payee?: { merchant_id?: string } }[];
};

/**
 * PayPal's named answers to a capture that will be the same however often the delivery is retried: the client's payment
 * method was refused, the order cannot be captured, or it is gone. Every other failure (a 401 after the fresh-token retry,
 * a 403, a timeout, PayPal's own errors, an issue not named here) refuses the delivery so PayPal sends it again.
 * ORDER_ALREADY_CAPTURED is not here: captureOrder answers it as taken.
 */
const FINAL_ISSUES = new Set([
  "INSTRUMENT_DECLINED", "ORDER_NOT_APPROVED", "PAYER_ACTION_REQUIRED", "TRANSACTION_REFUSED", "PAYER_CANNOT_PAY",
  "MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED", "ORDER_EXPIRED", "ORDER_COMPLETED_OR_VOIDED", "ORDER_ALREADY_COMPLETED",
  "DUPLICATE_INVOICE_ID", "PAYEE_ACCOUNT_RESTRICTED", "PAYEE_ACCOUNT_LOCKED_OR_CLOSED", "COMPLIANCE_VIOLATION",
  "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID",
]);

function isFinal(error: unknown): error is PayPalError {
  if (!(error instanceof PayPalError)) return false;
  if (error.issue && FINAL_ISSUES.has(error.issue)) return error.status === 400 || error.status === 404 || error.status === 422;
  return error.status === 404;
}

/** An amount PayPal wrote ("1234.00") in minor units, or null when it is not one. */
function minorOf(amount: Money | undefined): number | null {
  if (!amount?.value || !/^\d+(\.\d{1,2})?$/.test(amount.value) || amount.currency_code !== "USD") return null;
  return parseMinor(amount.value, "USD");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids that let a payment be found by hand from the log: PayPal's event, its type and the order. No amounts, no people. */
const trace = (event: PayPalWebhookEvent, orderId: string | undefined) => `event ${event.id} ${event.event_type} order ${orderId ?? "none"}`;

/**
 * The signature has already been verified. Receipt, invoice transition and notification commit together.
 * `capture` is the only way a payment is taken; the webhook route supplies the real one and every test its own (D12).
 */
export async function applyVerifiedDelivery(db: Db, event: PayPalWebhookEvent, capture: CaptureOrder): Promise<void> {
  // A seller's onboarding or revoked consent (D76) is the household's PayPal connection, not an invoice.
  if (event.event_type.startsWith("MERCHANT.")) return applyMerchantEvent(db, event, paypalRead);
  const resource = (event.resource ?? {}) as Resource;
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") return orderApproved(db, event, resource, capture);
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") return captureCompleted(db, event, resource);
  if (event.event_type === "PAYMENT.CAPTURE.DENIED" || event.event_type === "PAYMENT.CAPTURE.DECLINED") return captureDenied(db, event, resource);
  // A verified event of another kind still gets a global deduplication receipt.
  await recordWebhookDelivery(db, null, { paypalEventId: event.id, eventType: event.event_type, verified: true, payload: storedPayload(event, resource.id) });
}

const receiptOf = (event: PayPalWebhookEvent, resourceId: string | undefined) =>
  ({ paypalEventId: event.id, eventType: event.event_type, verified: true, payload: storedPayload(event, resourceId) });

type LinkInvoice = { hid: string; id: string; amount: number; currency: string; payee: string | null; current: boolean };

/**
 * The invoice a verified event's order belongs to. First the invoice that holds the order now. An order the link's Pay has
 * since replaced is found by the invoice id fipa put in it (`custom_id`), never on that id alone: the event's amount,
 * currency and payee must be the invoice's own, the payee being the account fipa stored when it made the order.
 */
async function invoiceForOrder(db: Db, event: PayPalWebhookEvent, orderId: string,
  claim: { customId: string | undefined; minor: number | null; payee: string | undefined }): Promise<LinkInvoice | undefined> {
  const columns = { hid: invoices.householdId, id: invoices.id, amount: invoices.amountMinor, currency: invoices.currency, payee: invoices.paypalPayeeId };
  const [held] = await db.select(columns).from(invoices).where(eq(invoices.paypalOrderId, orderId));
  if (held) return { ...held, current: true };
  if (!claim.customId || !UUID.test(claim.customId)) return undefined;
  const [named] = await db.select(columns).from(invoices).where(and(eq(invoices.id, claim.customId), isNotNull(invoices.payToken)));
  if (!named) return undefined;
  if (claim.minor === null || claim.minor !== named.amount || named.currency !== "USD" || !claim.payee || claim.payee !== named.payee) {
    console.error(`[webhook] an earlier order of an invoice does not match its amount, currency or payee: ${trace(event, orderId)}`);
    return undefined;
  }
  return { ...named, current: false };
}

/**
 * The client approved an order: take the payment, once, and keep PayPal's capture id on the invoice (still sent: only the
 * completed-payment event marks it paid), so the PayPal transaction read knows the payment is this link's.
 *
 * The invoice row is held from the check to the stored capture, so "Paid another way", End this link and a person's Yes wait
 * and then see the capture. Only the invoice is locked, never the household, so this cannot deadlock with those writers,
 * which lock the household first. No payment is taken for an invoice that is paid, ended, or already holds a capture (from
 * this order or an earlier one), so a client is never charged twice for one invoice. A failure that may pass throws before
 * any receipt is kept, so PayPal sends the delivery again. A capture that took no money (declined, or PayPal's final refusal)
 * drops the order so the client's next Pay makes a fresh one.
 */
async function orderApproved(db: Db, event: PayPalWebhookEvent, resource: Resource, capture: CaptureOrder) {
  const receipt = receiptOf(event, resource.id);
  const orderId = resource.id;
  const unit = resource.purchase_units?.[0];
  const found = orderId
    ? await invoiceForOrder(db, event, orderId, { customId: unit?.custom_id, minor: minorOf(unit?.amount), payee: unit?.payee?.merchant_id })
    : undefined;
  if (!found || !orderId) return void await recordWebhookDelivery(db, null, receipt);
  const ownId = !unit?.custom_id || unit.custom_id === found.id;
  let settleWith: string | undefined;
  await withHousehold(db, found.hid, async tx => {
    const [row] = await tx.select({ status: invoices.status, captureId: invoices.paypalCaptureId, payee: invoices.paypalPayeeId })
      .from(invoices).where(and(eq(invoices.householdId, found.hid), eq(invoices.id, found.id))).for("update");
    const [seen] = await tx.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(eq(webhookDeliveries.paypalEventId, event.id));
    if (seen) return;
    let taken: Awaited<ReturnType<CaptureOrder>> = { captureId: null };
    let refused = false;
    if (row && row.status === "sent" && row.captureId === null && row.payee && ownId) {
      try {
        taken = await capture(orderId, row.payee);
      } catch (error) {
        if (!isFinal(error)) throw error;
        refused = true;
        console.error(`[webhook] PayPal refused the capture of an approved order, no money taken: ${trace(event, orderId)} ${error.status} ${error.issue ?? ""} ${error.debugId ?? ""}`.trim());
      }
    }
    await recordWebhookDelivery(tx, found.hid, receipt);
    if (taken.captureId) {
      // The read got there first and holds this capture: the payment is already counted, so it settles the invoice (below).
      settleWith = await readPaymentByCapture(tx, found.hid, taken.captureId);
      if (settleWith) return;
      await tx.update(invoices).set({ paypalCaptureId: taken.captureId })
        .where(and(eq(invoices.householdId, found.hid), eq(invoices.id, found.id), eq(invoices.status, "sent"), isNull(invoices.paypalCaptureId)));
    } else if (taken.declined || refused) {
      if (taken.declined) console.error(`[webhook] PayPal declined the capture of an approved order, no money taken: ${trace(event, orderId)}`);
      await dropOrder(tx, found.hid, found.id, orderId);
    }
  });
  // Settling takes the household lock, so it runs after the invoice lock is let go; a failure here is redone by the
  // completed-payment event, which settles against the same read payment.
  if (settleWith) {
    const settled = await withHousehold(db, found.hid, tx => settleByRead(tx, found.hid, found.id, settleWith!));
    if (settled) await refreshSuggestions(db, found.hid, "applyVerifiedDelivery");
  }
}

/** An order that took no money and cannot be paid again: the link's next Pay makes a fresh one without asking about it. */
async function dropOrder(tx: Db, hid: string, invoiceId: string, orderId: string) {
  await tx.update(invoices).set({ paypalApproveUrl: null })
    .where(and(eq(invoices.householdId, hid), eq(invoices.id, invoiceId), eq(invoices.paypalOrderId, orderId), isNull(invoices.paypalCaptureId)));
}

/**
 * A capture fipa stored as pending was denied (or declined): no money arrived. The invoice lets go of the capture and its
 * order, so the link is open again and the client's next Pay makes a fresh order.
 */
async function captureDenied(db: Db, event: PayPalWebhookEvent, resource: Resource) {
  const receipt = receiptOf(event, resource.id);
  const orderId = resource.supplementary_data?.related_ids?.order_id;
  const [row] = resource.id ? await db.select({ hid: invoices.householdId, id: invoices.id }).from(invoices)
    .where(and(eq(invoices.paypalCaptureId, resource.id), eq(invoices.status, "sent"))) : [];
  if (!row || !resource.id) return void await recordWebhookDelivery(db, null, receipt);
  const captureId = resource.id;
  await withHousehold(db, row.hid, async tx => {
    await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.householdId, row.hid), eq(invoices.id, row.id))).for("update");
    if (!await recordWebhookDelivery(tx, row.hid, receipt)) return;
    const [freed] = await tx.update(invoices).set({ paypalCaptureId: null, paypalApproveUrl: null })
      .where(and(eq(invoices.householdId, row.hid), eq(invoices.id, row.id), eq(invoices.status, "sent"), eq(invoices.paypalCaptureId, captureId)))
      .returning({ id: invoices.id });
    if (freed) console.error(`[webhook] PayPal denied a pending payment, the link is open again: ${trace(event, orderId)}`);
  });
}

/**
 * A completed capture marks the invoice paid only when it is for that invoice's order (or an earlier order of it, see
 * invoiceForOrder), its own invoice id and its amount. An ended (closed) link's invoice is still marked paid, because the
 * money did arrive. When the PayPal read already holds this capture as a payment of its own, that payment settles the
 * invoice instead: it was counted once already.
 */
async function captureCompleted(db: Db, event: PayPalWebhookEvent, resource: Resource) {
  const orderId = resource.supplementary_data?.related_ids?.order_id;
  const minor = minorOf(resource.amount);
  const receipt = receiptOf(event, resource.id);
  const match = orderId && resource.id
    ? await invoiceForOrder(db, event, orderId, { customId: resource.custom_id, minor, payee: resource.payee?.merchant_id })
    : undefined;
  if (!match || !orderId || !resource.id) return void await recordWebhookDelivery(db, null, receipt);
  const captureId = resource.id;
  const matches = resource.status === "COMPLETED" && resource.custom_id === match.id && minor === match.amount && match.currency === "USD";
  if (!matches && resource.status === "COMPLETED") console.error(`[webhook] a completed payment does not match its invoice, left open: ${trace(event, orderId)}`);
  let settledByRead = false;
  const paid = await settle(db, match.hid, event, receipt, matches ? async (tx, paidOn) => {
    const read = await readPaymentByCapture(tx, match.hid, captureId);
    if (read) {
      const [open] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.householdId, match.hid), eq(invoices.id, match.id),
        inArray(invoices.status, OPEN)));
      if (open) settledByRead = await settleByRead(tx, match.hid, match.id, read);
      return undefined;
    }
    const [row] = await tx.update(invoices).set({ status: "paid", paidOn, sentOn: sql`coalesce(${invoices.sentOn}, ${paidOn})`, paypalCaptureId: captureId })
      .where(and(eq(invoices.householdId, match.hid), eq(invoices.id, match.id), inArray(invoices.status, OPEN),
        or(isNull(invoices.paypalCaptureId), eq(invoices.paypalCaptureId, captureId))))
      .returning(PAID);
    if (!row) {
      const [now] = await tx.select({ status: invoices.status }).from(invoices).where(and(eq(invoices.householdId, match.hid), eq(invoices.id, match.id)));
      if (now?.status !== "paid") console.error(`[webhook] a completed payment did not mark its invoice paid, check it by hand: ${trace(event, orderId)}`);
    }
    return row;
  } : undefined);
  if (paid || settledByRead) await refreshSuggestions(db, match.hid, "applyVerifiedDelivery");
}

/**
 * Settles the invoice with the read's payment of the same capture. A refusal (the read's amount differs) is logged and the
 * delivery kept, so PayPal does not resend it for ever; the invoice stays open for the person to see.
 */
async function settleByRead(tx: Db, hid: string, invoiceId: string, paymentId: string): Promise<boolean> {
  try {
    await settleReadPaymentInTx(tx, hid, invoiceId, paymentId, "capture");
    return true;
  } catch (error) {
    if (!(error instanceof InvoiceMatchError)) throw error;
    console.error(`[webhook] a PayPal-read payment holds this capture but does not match the invoice: ${error.message}`);
    return false;
  }
}

/**
 * The moment Activity shows for a payment. An ordinary household shows PayPal's instant. A Try it household shows its own
 * clock (D34), and never earlier than the invoice's last event, so the payment sorts after "Payment link made".
 */
async function shownAt(tx: Db, owner: { householdId: string; timeZone: string; fixedToday: string | null }, invoiceId: string, paypalAt: Date): Promise<Date> {
  if (!owner.fixedToday) return paypalAt;
  const moment = householdMoment({ isDemo: true, ...owner }, paypalAt);
  const [last] = await tx.select({ at: max(events.occurredAt) }).from(events)
    .where(and(eq(events.householdId, owner.householdId), eq(events.refType, "invoice"), eq(events.refId, invoiceId)));
  return last?.at && last.at >= moment ? new Date(last.at.getTime() + 1) : moment;
}

/** The states a completed payment for the invoice's own order may still mark paid. */
const OPEN: ("sent" | "draft" | "closed")[] = ["sent", "draft", "closed"];

const PAID = { id: invoices.id, clientId: invoices.clientId, payerMemberId: invoices.payerMemberId, amount: invoices.amountMinor, currency: invoices.currency, rate: invoices.fxRateMicro, businessDate: invoices.paidOn };

/**
 * Keeps the receipt and, when `mark` is given and the delivery is new, the paid transition with its balance credit, pots,
 * notification and runway check, in one transaction. True when an invoice became paid.
 */
async function settle(
  db: Db, hid: string, event: PayPalWebhookEvent, receipt: ReturnType<typeof receiptOf>,
  mark: ((tx: Db, paidOn: SQL<string>) => Promise<{ id: string; clientId: string | null; payerMemberId: string | null; amount: number; currency: string; rate: number | null; businessDate: string | null } | undefined>) | undefined,
): Promise<boolean> {
  return withHousehold(db, hid, async tx => {
    await lockRunway(tx, hid);
    const [owner] = await tx.select({ householdId: households.id, timeZone: households.timeZone, fixedToday: households.fixedToday, home: households.homeCurrency })
      .from(households).where(eq(households.id, hid));
    const inserted = await recordWebhookDelivery(tx, hid, receipt);
    if (!inserted || !mark) return false;
    if (!event.create_time || !Number.isFinite(Date.parse(event.create_time))) {
      throw new Error("Paid invoice delivery is missing a valid create_time");
    }

    await beginMoneyChange(tx, owner.householdId);
    const actualPaidOn = sql<string>`timezone(${owner.timeZone}, ${event.create_time}::timestamptz)::date`;
    // D34: a Try it household runs on its fixed date, so a payment is dated that day (never before the link was made), whenever the sandbox client pays.
    const paidOn = owner.fixedToday ? sql<string>`greatest(${owner.fixedToday}::date, ${invoices.sentOn})` : actualPaidOn;
    const paid = await mark(tx, paidOn);
    if (!paid) return false;
    // The household owner's PayPal connection holds the balance (D31). A payment is credited at its gross amount.
    const connection = await ownerPayPal(tx, owner.householdId);
    if (!connection) throw new Error("Expected one household owner PayPal connection");
    let credit = paid.amount;
    if (connection.balanceCurrency !== paid.currency) {
      let rate = paid.rate;
      if (!rate) {
        const [reference] = await tx.select({ rate: fxRates.rateMicro }).from(fxRates)
          .where(and(eq(fxRates.householdId, owner.householdId), eq(fxRates.base, "USD"), eq(fxRates.quote, paid.currency === "USD" ? connection.balanceCurrency : paid.currency), lte(fxRates.date, paid.businessDate!)))
          .orderBy(desc(fxRates.date)).limit(1);
        if (!reference) throw new Error("Missing FX rate for the payment date");
        rate = reference.rate;
        await tx.update(invoices).set({ fxRateMicro: rate }).where(and(eq(invoices.householdId, owner.householdId), eq(invoices.id, paid.id)));
      }
      credit = convertMinor(paid.amount, paid.currency, connection.balanceCurrency, fromRateMicro(rate));
    }
    // `effective` is PayPal's own instant: it is compared with the balance read's instant, which is PayPal's clock too.
    const effective = new Date(event.create_time);
    const [client] = paid.clientId !== null
      ? await tx.select({ name: clients.name }).from(clients).where(and(eq(clients.householdId, owner.householdId), eq(clients.id, paid.clientId)))
      : await tx.select({ name: members.displayName }).from(members).where(and(eq(members.householdId, owner.householdId), eq(members.id, paid.payerMemberId!)));
    const increment = connection.balanceAsOf && connection.balanceAsOf >= effective ? 0 : credit;
    await tx.update(paypalConnections).set({
      balanceMinor: sql`${paypalConnections.balanceMinor} + ${increment}`,
      latestCreditAt: sql`greatest(${paypalConnections.latestCreditAt}, ${event.create_time}::timestamptz)`,
    })
      .where(and(eq(paypalConnections.householdId, owner.householdId), eq(paypalConnections.id, connection.id)));
    await recordEvent(tx, owner.householdId, { madeBy: "form",
      kind: "invoice_paid",
      title: paidTitle(client.name, paid.amount, paid.currency),
      amount: { value: fromMinor(paid.amount, paid.currency), currency: paid.currency },
      ref: { type: "invoice", id: paid.id },
      notify: true, occurredAt: await shownAt(tx, owner, paid.id, effective),
    });
    // D43: a payment that credits the balance also fills the pots that have a rule; the credit is counted in the home currency.
    if (increment > 0 && paid.payerMemberId === null) { // a member's share is not income: it fills no pot
      const homeCredit = connection.balanceCurrency === owner.home ? increment
        : convertMinor(increment, connection.balanceCurrency, owner.home, fromRateMicro(await usdRateMicro(tx, owner.householdId, owner.home, paid.businessDate!)));
      await fillPots(tx, owner.householdId, homeCredit, `${client.name}'s payment`);
    }
    // D45: a member's request that is paid records the transfers as settled, exactly as Mark settled does, in this same transaction.
    if (paid.payerMemberId !== null) await settleUpInTx(tx, owner.householdId);
    await observeRunway(tx, owner.householdId);
    return true;
  });
}

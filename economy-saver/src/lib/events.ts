import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { type Db, recordEvent, recordWebhookDelivery, requireHousehold } from "@/db/household";
import { beginMoneyChange, lockRunway, observeRunway } from "@/db/runway-events";
import { DEMO_DATE } from "@/db/demo";
import { convertMinor, fromMinor, fromRateMicro } from "@/db/money";
import { fxRates, households, invoices, members, paypalConnections, webhookDeliveries } from "@/db/schema";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhook";

/** The signature has already been verified. Receipt, invoice transition and notification commit together. */
export async function applyVerifiedDelivery(db: Db, event: PayPalWebhookEvent): Promise<void> {
  await db.transaction(async (tx) => {
    const resource = event.resource;
    const invoiceId = event.event_type.startsWith("INVOICING.INVOICE.") ? resource?.id : undefined;
    // PayPal sends its globally unique invoice id, not our household id. Resolve only its owning household.
    const [owner] = invoiceId
      ? await tx.select({ householdId: invoices.householdId, timeZone: households.timeZone, demo: households.isDemo }).from(invoices)
          .innerJoin(households, eq(households.id, invoices.householdId))
          .where(eq(invoices.paypalInvoiceId, invoiceId))
      : [];
    if (owner) await lockRunway(tx, owner.householdId);
    const inserted = await recordWebhookDelivery(tx, owner?.householdId ?? null, {
      paypalEventId: event.id,
      eventType: event.event_type,
      verified: true,
      payload: { invoiceId, createdAt: event.create_time },
    });
    // PayPal also emits INVOICE.PAID for partial and pending payments.
    if (!inserted || !owner || !invoiceId || event.event_type !== "INVOICING.INVOICE.PAID" || resource?.status !== "PAID") return;
    if (!event.create_time || !Number.isFinite(Date.parse(event.create_time))) {
      throw new Error("Paid invoice delivery is missing a valid create_time");
    }

    await beginMoneyChange(tx, owner.householdId);
    const actualPaidOn = sql`timezone(${owner.timeZone}, ${event.create_time}::timestamptz)::date`;
    // A demo runs on its seeded business date even when the sandbox is paid earlier.
    const paidOn = owner.demo ? sql`greatest(${actualPaidOn}, ${DEMO_DATE}::date, ${invoices.sentOn})` : actualPaidOn;
    const [paid] = await tx.update(invoices).set({
      status: "paid",
      paidOn,
      sentOn: sql`coalesce(${invoices.sentOn}, ${paidOn})`,
    }).where(and(
      eq(invoices.householdId, owner.householdId),
      eq(invoices.paypalInvoiceId, invoiceId),
      inArray(invoices.status, ["sent", "draft"]),
    )).returning({ id: invoices.id, number: invoices.number, item: invoices.item, amount: invoices.amountMinor, currency: invoices.currency, rate: invoices.fxRateMicro, businessDate: invoices.paidOn });
    if (paid) {
      // The Nov 12 merchant is the household owner's sandbox connection (D31).
      const connections = await tx.select({ id: paypalConnections.id, currency: paypalConnections.balanceCurrency, asOf: paypalConnections.balanceAsOf })
        .from(paypalConnections).innerJoin(members, and(eq(members.id, paypalConnections.memberId), eq(members.householdId, owner.householdId)))
        .where(and(eq(paypalConnections.householdId, owner.householdId), eq(members.role, "owner")));
      if (connections.length !== 1) throw new Error("Expected one household owner PayPal connection");
      const connection = connections[0];
      let credit = paid.amount;
      if (connection.currency !== paid.currency) {
        let rate = paid.rate;
        if (!rate) {
          const [reference] = await tx.select({ rate: fxRates.rateMicro }).from(fxRates)
            .where(and(eq(fxRates.householdId, owner.householdId), eq(fxRates.base, "USD"), eq(fxRates.quote, paid.currency === "USD" ? connection.currency : paid.currency), lte(fxRates.date, paid.businessDate!)))
            .orderBy(desc(fxRates.date)).limit(1);
          if (!reference) throw new Error("Missing FX rate for the payment date");
          rate = reference.rate;
          await tx.update(invoices).set({ fxRateMicro: rate }).where(and(eq(invoices.householdId, owner.householdId), eq(invoices.id, paid.id)));
        }
        credit = convertMinor(paid.amount, paid.currency, connection.currency, fromRateMicro(rate));
      }
      const effective = new Date(event.create_time);
      const increment = connection.asOf && connection.asOf >= effective ? 0 : credit;
      await tx.update(paypalConnections).set({
        balanceMinor: sql`${paypalConnections.balanceMinor} + ${increment}`,
        latestCreditAt: sql`greatest(${paypalConnections.latestCreditAt}, ${event.create_time}::timestamptz)`,
      })
        .where(and(eq(paypalConnections.householdId, owner.householdId), eq(paypalConnections.id, connection.id)));
      await recordEvent(tx, owner.householdId, {
        kind: "invoice_paid",
        title: `Invoice ${paid.number ?? paid.item} paid`,
        amount: { value: fromMinor(paid.amount, paid.currency), currency: paid.currency },
        ref: { type: "invoice", id: paid.id },
        notify: true, occurredAt: effective,
      });
      await observeRunway(tx, owner.householdId);
    }
  });
}

export function recentDeliveries(db: Db, householdId: string) {
  return db.select({
    id: webhookDeliveries.paypalEventId,
    type: webhookDeliveries.eventType,
    verified: webhookDeliveries.verified,
    receivedAt: webhookDeliveries.receivedAt,
  }).from(webhookDeliveries)
    .where(eq(webhookDeliveries.householdId, requireHousehold(householdId)))
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(50);
}

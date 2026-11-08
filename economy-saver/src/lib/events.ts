import { refreshSuggestions } from "@/db/suggestions";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { type Db, recordEvent, recordWebhookDelivery, requireHousehold, usdRateMicro } from "@/db/household";
import { beginMoneyChange, lockRunway, observeRunway } from "@/db/runway-events";
import { convertMinor, fromMinor, fromRateMicro } from "@/db/money";
import { fillPots } from "@/db/pots";
import { clients, fxRates, households, invoices, members, paypalConnections, webhookDeliveries } from "@/db/schema";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhook";

/** What a delivery keeps of PayPal's event: the invoice id and the time, the only fields this app reads back. Never the whole event (27E). */
export const storedPayload = (event: PayPalWebhookEvent, invoiceId: string | undefined) => ({ invoiceId, createdAt: event.create_time });

/** The signature has already been verified. Receipt, invoice transition and notification commit together. */
export async function applyVerifiedDelivery(db: Db, event: PayPalWebhookEvent): Promise<void> {
  const hid = await db.transaction(async (tx) => {
    const resource = event.resource;
    const invoiceId = event.event_type.startsWith("INVOICING.INVOICE.") ? resource?.id : undefined;
    // PayPal sends its globally unique invoice id, not our household id. Resolve only its owning household.
    const [owner] = invoiceId
      ? await tx.select({ householdId: invoices.householdId, timeZone: households.timeZone, fixedToday: households.fixedToday, home: households.homeCurrency }).from(invoices)
          .innerJoin(households, eq(households.id, invoices.householdId))
          .where(eq(invoices.paypalInvoiceId, invoiceId))
      : [];
    if (owner) await lockRunway(tx, owner.householdId);
    const inserted = await recordWebhookDelivery(tx, owner?.householdId ?? null, {
      paypalEventId: event.id,
      eventType: event.event_type,
      verified: true,
      payload: storedPayload(event, invoiceId),
    });
    // PayPal also emits INVOICE.PAID for partial and pending payments.
    if (!inserted || !owner || !invoiceId || event.event_type !== "INVOICING.INVOICE.PAID" || resource?.status !== "PAID") return;
    if (!event.create_time || !Number.isFinite(Date.parse(event.create_time))) {
      throw new Error("Paid invoice delivery is missing a valid create_time");
    }

    await beginMoneyChange(tx, owner.householdId);
    const actualPaidOn = sql`timezone(${owner.timeZone}, ${event.create_time}::timestamptz)::date`;
    // A Try it household runs on its fixed business date even when the sandbox is paid earlier.
    const paidOn = owner.fixedToday ? sql`greatest(${actualPaidOn}, ${owner.fixedToday}::date, ${invoices.sentOn})` : actualPaidOn;
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
      await recordEvent(tx, owner.householdId, { madeBy: "form",
        kind: "invoice_paid",
        title: `Invoice ${paid.number ?? paid.item} paid`,
        amount: { value: fromMinor(paid.amount, paid.currency), currency: paid.currency },
        ref: { type: "invoice", id: paid.id },
        notify: true, occurredAt: effective,
      });
      // D43: a payment that credits the balance also fills the pots that have a rule; the credit is counted in the home currency.
      if (increment > 0) {
        const homeCredit = connection.currency === owner.home ? increment
          : convertMinor(increment, connection.currency, owner.home, fromRateMicro(await usdRateMicro(tx, owner.householdId, owner.home, paid.businessDate!)));
        const [client] = await tx.select({ name: clients.name }).from(invoices)
          .innerJoin(clients, and(eq(clients.householdId, invoices.householdId), eq(clients.id, invoices.clientId)))
          .where(and(eq(invoices.householdId, owner.householdId), eq(invoices.id, paid.id)));
        await fillPots(tx, owner.householdId, homeCredit, `${client.name}'s payment`);
      }
      await observeRunway(tx, owner.householdId);
      return owner.householdId;
    }
  });
  if (hid) await refreshSuggestions(db, hid, "applyVerifiedDelivery");
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

import { and, count, desc, eq, isNull, max, sql } from "drizzle-orm";
import { type Db, requireHousehold } from "./household";
import { documents, events, invoices } from "./schema";

/** The browser may see event fields, never the bearer household identifier. */
export function publicEvent(row: typeof events.$inferSelect) {
  return {
    id: row.id, kind: row.kind, title: row.title, body: row.body,
    amountMinor: row.amountMinor, currency: row.currency, refType: row.refType, refId: row.refId,
    madeBy: row.madeBy, occurredAt: row.occurredAt.toISOString(), notify: row.notify, readAt: row.readAt?.toISOString() ?? null,
  };
}

export async function eventFeed(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  const [totals, notifications] = await Promise.all([
    db.select({
      total: count(), latest: max(events.occurredAt),
      unread: sql<number>`count(*) filter (where ${events.notify} and ${events.readAt} is null)`.mapWith(Number),
      inFlight: sql<boolean>`exists (select 1 from ${invoices} where ${invoices.householdId} = ${hid} and ${invoices.status} = 'sent' and ${invoices.paypalInvoiceId} is not null)
        or exists (select 1 from ${documents} where ${documents.householdId} = ${hid} and ${documents.status} in ('queued', 'reading'))`,
    }).from(events).where(eq(events.householdId, hid)),
    db.select({ id: events.id, title: events.title, body: events.body, refType: events.refType, refId: events.refId }).from(events)
      .where(and(eq(events.householdId, hid), eq(events.notify, true), isNull(events.readAt)))
      .orderBy(desc(events.occurredAt), desc(events.id)).limit(20),
  ]);
  const { total, latest, unread, inFlight } = totals[0];
  return { total, since: latest?.toISOString() ?? null, unread, notifications, inFlight };
}

export type EventFeed = Awaited<ReturnType<typeof eventFeed>>;

// Builds the HouseholdSnapshot (D44) for one household. One read transaction; every query is filtered by
// household_id; every select names its columns, so a column that holds a secret or a pointer (the AI key's Vault id
// and hint, auth user ids, MCP token hashes, webhook payloads, storage paths, an invoice's approve key) is never read.
// The result is parsed with the schema before it is returned, so the shape is enforced at the source.
import { desc, eq } from "drizzle-orm";
import { HouseholdSnapshot } from "@/lib/schema/household";
import { clockForHousehold } from "./clock";
import { fromRateMicro } from "./money";
import { paypalTotalMinor, requireHousehold, usdRate, type Db } from "./household";
import * as s from "./schema";

export type SnapshotOptions = {
  /** The household's events (the audit trail). The export includes them; the agent tool does not. */
  events: boolean;
  /** Keep only this many most recent rows of each long list and flag it in `truncated`. Omit for everything. */
  recent?: number;
  now?: Date;
};

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** The newest `limit` rows (the query returns newest first and asks for one more), oldest first, and whether any were cut. */
function window<T>(rows: T[], limit: number | undefined): { rows: T[]; cut: boolean } {
  if (limit === undefined) return { rows: [...rows].reverse(), cut: false };
  return { rows: rows.slice(0, limit).reverse(), cut: rows.length > limit };
}

export async function loadHouseholdSnapshot(db: Db, householdId: string, options: SnapshotOptions): Promise<HouseholdSnapshot> {
  const hid = requireHousehold(householdId);
  const { recent } = options;
  if (recent !== undefined && (!Number.isInteger(recent) || recent < 1)) throw new Error("recent must be a positive integer");
  const now = options.now ?? new Date();
  const fetchLimit = recent === undefined ? undefined : recent + 1;
  const cap = <Q extends { limit(n: number): Q }>(query: Q) => (fetchLimit === undefined ? query : query.limit(fetchLimit));

  return db.transaction(async tx => {
    const [household] = await tx.select({
      id: s.households.id, name: s.households.name, homeCurrency: s.households.homeCurrency, timeZone: s.households.timeZone,
      isDemo: s.households.isDemo, bankBalanceMinor: s.households.bankBalanceMinor, splitSince: s.households.splitSince,
    }).from(s.households).where(eq(s.households.id, hid));
    if (!household) throw new Error("Household not found");

    const today = clockForHousehold(household, now).today;
    const rate = await usdRate(tx, hid, household.homeCurrency, today);
    const [paypalRows, members, cards, statements, charges, bills, clients, invoices, pots, settlements, balanceUpdates, documents, events] = await Promise.all([
      tx.select({ balanceMinor: s.paypalConnections.balanceMinor, balanceCurrency: s.paypalConnections.balanceCurrency }).from(s.paypalConnections)
        .where(eq(s.paypalConnections.householdId, hid)),
      tx.select({ id: s.members.id, displayName: s.members.displayName, role: s.members.role, shareBp: s.members.shareBp }).from(s.members)
        .where(eq(s.members.householdId, hid)).orderBy(s.members.createdAt, s.members.id),
      tx.select({
        id: s.cards.id, memberId: s.cards.memberId, label: s.cards.label, closingDay: s.cards.closingDay, dueDay: s.cards.dueDay,
        limitMinor: s.cards.limitMinor, currency: s.cards.currency, revolving: s.cards.revolving,
      }).from(s.cards).where(eq(s.cards.householdId, hid)).orderBy(s.cards.createdAt, s.cards.id),
      cap(tx.select({
        id: s.cardStatements.id, cardId: s.cardStatements.cardId, amountMinor: s.cardStatements.amountMinor, currency: s.cardStatements.currency,
        closedOn: s.cardStatements.closedOn, dueOn: s.cardStatements.dueOn, paidOn: s.cardStatements.paidOn,
      }).from(s.cardStatements).where(eq(s.cardStatements.householdId, hid)).orderBy(desc(s.cardStatements.closedOn), desc(s.cardStatements.id)).$dynamic()),
      cap(tx.select({
        id: s.charges.id, cardId: s.charges.cardId, merchant: s.charges.merchant, amountMinor: s.charges.amountMinor, currency: s.charges.currency,
        originalAmountMinor: s.charges.originalAmountMinor, originalCurrency: s.charges.originalCurrency, fxRateMicro: s.charges.fxRateMicro,
        date: s.charges.date, shared: s.charges.shared, source: s.charges.source, status: s.charges.status, place: s.charges.place, documentId: s.charges.documentId,
      }).from(s.charges).where(eq(s.charges.householdId, hid)).orderBy(desc(s.charges.date), desc(s.charges.createdAt), desc(s.charges.id)).$dynamic()),
      cap(tx.select({
        id: s.bills.id, memberId: s.bills.memberId, paidByMemberId: s.bills.paidByMemberId, biller: s.bills.biller, amountMinor: s.bills.amountMinor, currency: s.bills.currency,
        due: s.bills.due, category: s.bills.category, status: s.bills.status, previousAmountMinor: s.bills.previousAmountMinor,
        fxRateMicro: s.bills.fxRateMicro, repeatDay: s.bills.repeatDay, documentId: s.bills.documentId,
      }).from(s.bills).where(eq(s.bills.householdId, hid)).orderBy(desc(s.bills.due), desc(s.bills.createdAt), desc(s.bills.id)).$dynamic()),
      tx.select({ id: s.clients.id, name: s.clients.name, email: s.clients.email, termsDays: s.clients.termsDays }).from(s.clients)
        .where(eq(s.clients.householdId, hid)).orderBy(s.clients.createdAt, s.clients.id),
      cap(tx.select({
        id: s.invoices.id, clientId: s.invoices.clientId, status: s.invoices.status, number: s.invoices.number, item: s.invoices.item,
        note: s.invoices.note, amountMinor: s.invoices.amountMinor, currency: s.invoices.currency, fxRateMicro: s.invoices.fxRateMicro,
        sentOn: s.invoices.sentOn, dueOn: s.invoices.dueOn, paidOn: s.invoices.paidOn, paypalInvoiceId: s.invoices.paypalInvoiceId,
        paypalStatus: s.invoices.paypalStatus, remindedAt: s.invoices.remindedAt,
      }).from(s.invoices).where(eq(s.invoices.householdId, hid)).orderBy(desc(s.invoices.createdAt), desc(s.invoices.id)).$dynamic()),
      tx.select({
        id: s.pots.id, memberId: s.pots.memberId, name: s.pots.name, targetMinor: s.pots.targetMinor, targetDate: s.pots.targetDate,
        savedMinor: s.pots.savedMinor, fillBp: s.pots.fillBp, currency: s.pots.currency, status: s.pots.status,
      }).from(s.pots).where(eq(s.pots.householdId, hid)).orderBy(s.pots.createdAt, s.pots.id),
      tx.select({
        id: s.settlements.id, fromMemberId: s.settlements.fromMemberId, toMemberId: s.settlements.toMemberId, amountMinor: s.settlements.amountMinor,
        currency: s.settlements.currency, through: s.settlements.through, settledAt: s.settlements.settledAt, createdAt: s.settlements.createdAt,
      }).from(s.settlements).where(eq(s.settlements.householdId, hid)).orderBy(s.settlements.createdAt, s.settlements.id),
      cap(tx.select({
        id: s.balanceUpdates.id, amountMinor: s.balanceUpdates.amountMinor, currency: s.balanceUpdates.currency,
        status: s.balanceUpdates.status, createdAt: s.balanceUpdates.createdAt,
      }).from(s.balanceUpdates).where(eq(s.balanceUpdates.householdId, hid)).orderBy(desc(s.balanceUpdates.createdAt), desc(s.balanceUpdates.id)).$dynamic()),
      cap(tx.select({ id: s.documents.id, kind: s.documents.kind, status: s.documents.status, createdAt: s.documents.createdAt })
        .from(s.documents).where(eq(s.documents.householdId, hid)).orderBy(desc(s.documents.createdAt), desc(s.documents.id)).$dynamic()),
      options.events
        ? tx.select({
          id: s.events.id, kind: s.events.kind, title: s.events.title, body: s.events.body, amountMinor: s.events.amountMinor,
          currency: s.events.currency, refType: s.events.refType, refId: s.events.refId, notify: s.events.notify,
          readAt: s.events.readAt, occurredAt: s.events.occurredAt,
        }).from(s.events).where(eq(s.events.householdId, hid)).orderBy(desc(s.events.occurredAt), desc(s.events.id))
        : Promise.resolve(undefined),
    ]);

    const st = window(statements, recent), ch = window(charges, recent), bi = window(bills, recent);
    const inv = window(invoices, recent), bu = window(balanceUpdates, recent), doc = window(documents, recent);
    return HouseholdSnapshot.parse({
      version: 1,
      generatedAt: iso(now),
      household: {
        id: household.id, name: household.name, homeCurrency: household.homeCurrency, timeZone: household.timeZone,
        today, isDemo: household.isDemo, bankBalanceMinor: household.bankBalanceMinor,
        paypalBalanceMinor: paypalTotalMinor(paypalRows, household.homeCurrency, fromRateMicro(rate.rateMicro)),
        usdRateMicro: rate.rateMicro, usdRateDate: rate.date, splitSince: household.splitSince,
      },
      members, cards, statements: st.rows, charges: ch.rows, bills: bi.rows, clients,
      invoices: inv.rows.map(i => ({ ...i, remindedAt: isoOrNull(i.remindedAt) })),
      pots,
      settlements: settlements.map(x => ({ ...x, settledAt: iso(x.settledAt), createdAt: iso(x.createdAt) })),
      balanceUpdates: bu.rows.map(u => ({ ...u, createdAt: iso(u.createdAt) })),
      documents: doc.rows.map(d => ({ ...d, createdAt: iso(d.createdAt) })),
      truncated: { bills: bi.cut, charges: ch.cut, statements: st.cut, invoices: inv.cut, balanceUpdates: bu.cut, documents: doc.cut },
      ...(events && { events: events.map(e => ({ ...e, readAt: isoOrNull(e.readAt), occurredAt: iso(e.occurredAt) })) }),
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

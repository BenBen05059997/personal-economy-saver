// The household-scoped data layer. Every function takes the household id first and throws without one,
// and every query filters on it, so a route cannot read another household's rows by forgetting a clause.

import { and, count, desc, eq, gt, gte, inArray, isNull, isNotNull, lte, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Currency } from "@/lib/catalogue/types";
import { CategoryKeySchema as CategoryKey } from "@/lib/money/categories";
import { cancelNotices, expandBills, RepeatUnitSchema } from "@/lib/money/repeat";
import { countingFrom } from "@/lib/money/split";
import { addDays, planWindow } from "@/lib/money/runway";
import type { Card, Charge, Client, ClosedStatement, Invoice, MoneyState, Pot, SplitState, StoredBill } from "@/lib/money/types";
import { convertMinor, fromMinor, fromRateMicro, toMinor, toRateMicro } from "./money";
import * as s from "./schema";
import { deleteHouseholdKey } from "./ai-key";
import { removeHouseholdDocuments } from "./document-cleanup";
import { householdMoment } from "./clock";

// Both the postgres.js client and PGlite (tests) fit this.
export type Db = PgDatabase<PgQueryResultHKT, typeof s>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireHousehold(householdId: string | null | undefined): string {
  if (!householdId || !UUID.test(householdId)) throw new Error("A household id is required");
  return householdId;
}

export async function householdOwnerName(db: Db, householdId: string): Promise<string> {
  const [owner] = await db.select({ name: s.members.displayName }).from(s.members)
    .where(and(eq(s.members.householdId, requireHousehold(householdId)), eq(s.members.role, "owner")));
  if (!owner) throw new Error("Household owner not found");
  return owner.name;
}

// A closed cycle is at most a month, so charges older than this cannot belong to an open cycle.
export const CHARGE_LOOKBACK_DAYS = 62;
// Invoices paid this recently stay in the state (for the Activity view); older paid ones only feed days to pay.
const PAID_KEEP_DAYS = 7;

/** The household's latest USD rate on or before `today`, scaled by 1e6, and the day it is from (exactly 1e6 and no day when the home currency is USD). */
export async function usdRate(db: Db, householdId: string, home: string, today: string): Promise<{ rateMicro: number; date: string | null }> {
  const hid = requireHousehold(householdId);
  if (home === "USD") return { rateMicro: toRateMicro(1), date: null };
  const [rate] = await db
    .select()
    .from(s.fxRates)
    .where(and(eq(s.fxRates.householdId, hid), eq(s.fxRates.base, "USD"), eq(s.fxRates.quote, home), lte(s.fxRates.date, today)))
    .orderBy(desc(s.fxRates.date))
    .limit(1);
  if (!rate) throw new Error(`No USD/${home} rate on or before ${today}`);
  return { rateMicro: rate.rateMicro, date: rate.date };
}

/** The household's latest USD rate on or before `today`, scaled by 1e6 (exactly 1e6 when the home currency is USD). */
export async function usdRateMicro(db: Db, householdId: string, home: string, today: string): Promise<number> {
  return (await usdRate(db, householdId, home, today)).rateMicro;
}

/** The household's PayPal connection balances added up in the home currency (the engine's `paypal`, in minor units). */
export function paypalTotalMinor(connections: { balanceMinor: number; balanceCurrency: string }[], home: string, fxPerUsd: number): number {
  return connections.reduce((sum, c) => sum + convertMinor(c.balanceMinor, c.balanceCurrency, home, fxPerUsd), 0);
}

/**
 * The inputs of "who owes whom" (D45), in whole minor units of the home currency: the members with their shares, the day the
 * split began, the latest settlement's through date and the confirmed shared bills and charges that can still count. Only
 * charges from the first counting day on are read; a repeating bill is one stored row. A household with one member has none.
 * An amount-varies bill (D54) carries every confirmed real bill linked to it, whoever's, for its estimate and its months.
 */
export async function loadSplitState(
  db: Db, householdId: string, splitSince: string | null, today: string, toHome: (minor: number, currency: string) => number,
): Promise<SplitState> {
  const hid = requireHousehold(householdId);
  const [memberRows, [latest]] = await Promise.all([
    db.select({ id: s.members.id, name: s.members.displayName, shareBp: s.members.shareBp }).from(s.members)
      .where(eq(s.members.householdId, hid)).orderBy(sql`(${s.members.role} = 'owner') desc`, s.members.createdAt, s.members.id),
    db.select({ through: s.settlements.through, settledAt: s.settlements.settledAt }).from(s.settlements).where(eq(s.settlements.householdId, hid))
      .orderBy(desc(s.settlements.through), desc(s.settlements.settledAt)).limit(1),
  ]);
  const split: SplitState = { members: memberRows, since: splitSince, settledThrough: latest?.through ?? null, settledAt: latest?.settledAt.toISOString() ?? null, bills: [], charges: [] };
  const from = countingFrom(split);
  if (from === null) return split;
  const [billRows, chargeRows] = await Promise.all([
    db.select().from(s.bills).where(and(eq(s.bills.householdId, hid), eq(s.bills.status, "confirmed"), isNull(s.bills.memberId), isNotNull(s.bills.paidByMemberId)))
      .orderBy(s.bills.due, s.bills.biller, s.bills.id),
    db.select({ charge: s.charges, payer: s.cards.memberId }).from(s.charges)
      .innerJoin(s.cards, and(eq(s.cards.householdId, s.charges.householdId), eq(s.cards.id, s.charges.cardId)))
      .where(and(eq(s.charges.householdId, hid), eq(s.charges.status, "confirmed"), eq(s.charges.shared, true), gte(s.charges.date, from), lte(s.charges.date, today)))
      .orderBy(s.charges.date, s.charges.merchant, s.charges.id),
  ]);
  const variesIds = billRows.filter(b => b.amountVaries).map(b => b.id);
  const realRows = variesIds.length === 0 ? [] : await db.select({ seriesBillId: s.bills.seriesBillId, due: s.bills.due, amountMinor: s.bills.amountMinor, currency: s.bills.currency })
    .from(s.bills).where(and(eq(s.bills.householdId, hid), eq(s.bills.status, "confirmed"), inArray(s.bills.seriesBillId, variesIds))).orderBy(s.bills.due, s.bills.id);
  // D55: an amount not known is null (it splits nothing); a date not known is today. A linked real bill without an amount takes its month but is no part of the estimate.
  split.bills = billRows.map(b => ({ id: b.id, biller: b.biller, amountMinor: b.amountMinor === null ? null : toHome(b.amountMinor, b.currency), due: b.due ?? today, paidBy: b.paidByMemberId!, createdAt: b.createdAt.toISOString(),
    repeatUnit: b.repeatUnit === null ? null : RepeatUnitSchema.parse(b.repeatUnit), repeatDay: b.repeatDay, repeatUntil: b.repeatUntil,
    nextAmountMinor: b.nextAmountMinor === null ? null : toHome(b.nextAmountMinor, b.currency), nextAmountFrom: b.nextAmountFrom,
    ...(b.amountVaries && {
      varies: realRows.flatMap(r => (r.seriesBillId === b.id && r.due !== null && r.amountMinor !== null ? [{ due: r.due, amountMinor: toHome(r.amountMinor, r.currency) }] : [])),
      variesUnpriced: realRows.flatMap(r => (r.seriesBillId === b.id && r.due !== null && r.amountMinor === null ? [r.due] : [])),
    }) }));
  split.charges = chargeRows.map(({ charge: c, payer }) => {
    if (payer === null) throw new Error(`The shared charge ${c.merchant} is on a card that belongs to no member`);
    return { id: c.id, merchant: c.merchant, amountMinor: toHome(c.amountMinor, c.currency), date: c.date, paidBy: payer, createdAt: c.createdAt.toISOString() };
  });
  return split;
}

/** Reads the household's rows and returns the MoneyState the engine consumes. `today` is the household's own date. */
export async function loadMoneyState(db: Db, householdId: string, today: string, snapshot?: typeof s.households.$inferSelect): Promise<MoneyState> {
  const hid = requireHousehold(householdId);
  if (snapshot && snapshot.id !== hid) throw new Error("Household snapshot does not match household id");
  const household = snapshot ?? (await db.select().from(s.households).where(eq(s.households.id, hid)))[0];
  if (!household) throw new Error("Household not found");
  const home = Currency.parse(household.homeCurrency);

  const fxPerUsd = fromRateMicro(await usdRateMicro(db, hid, home, today));
  // Rows may be in another currency (a USD balance, say); the engine wants the home currency throughout.
  const inHome = (minor: number, currency: string) => fromMinor(convertMinor(minor, currency, home, fxPerUsd), home);
  const inUsd = (minor: number, currency: string) => fromMinor(convertMinor(minor, currency, "USD", fxPerUsd), "USD");
  const toHome = (minor: number, currency: string) => convertMinor(minor, currency, home, fxPerUsd);

  // D50: only while the standing rule is on. A nudge counts while its invoice is still sent, unreminded and linked to PayPal.
  const nudged = household.nudgeAfterDays === null ? undefined : db.select({ id: s.invoices.id }).from(s.events)
    .innerJoin(s.invoices, and(eq(s.invoices.householdId, hid), eq(s.invoices.id, s.events.refId)))
    .where(and(eq(s.events.householdId, hid), eq(s.events.kind, "nudge_suggested"), eq(s.events.refType, "invoice"),
      eq(s.invoices.status, "sent"), isNull(s.invoices.remindedAt), isNull(s.invoices.reminderAttemptedAt), isNotNull(s.invoices.paypalInvoiceId)))
    .orderBy(s.events.occurredAt, s.events.id);
  const [connections, billRows, cardRows, chargeRows, statementRows, clientRows, invoiceRows, balanceRows, potRows, split, nudgedRows] = await Promise.all([
    db.select().from(s.paypalConnections).where(eq(s.paypalConnections.householdId, hid)),
    db.select().from(s.bills).where(eq(s.bills.householdId, hid)).orderBy(s.bills.due, s.bills.biller),
    db.select().from(s.cards).where(eq(s.cards.householdId, hid)).orderBy(s.cards.createdAt, s.cards.label),
    db
      .select()
      .from(s.charges)
      .where(and(eq(s.charges.householdId, hid), gte(s.charges.date, addDays(today, -CHARGE_LOOKBACK_DAYS))))
      .orderBy(s.charges.date, s.charges.merchant),
    db
      .select()
      .from(s.cardStatements)
      .where(and(eq(s.cardStatements.householdId, hid), isNull(s.cardStatements.paidOn)))
      .orderBy(s.cardStatements.dueOn),
    db.select().from(s.clients).where(eq(s.clients.householdId, hid)).orderBy(s.clients.createdAt, s.clients.name),
    db.select().from(s.invoices).where(eq(s.invoices.householdId, hid)).orderBy(s.invoices.sentOn, s.invoices.createdAt),
    db.select().from(s.balanceUpdates).where(and(eq(s.balanceUpdates.householdId, hid), eq(s.balanceUpdates.status, "pending"))).orderBy(s.balanceUpdates.createdAt, s.balanceUpdates.id),
    db.select().from(s.pots).where(eq(s.pots.householdId, hid)).orderBy(s.pots.createdAt, s.pots.name, s.pots.id),
    loadSplitState(db, hid, household.splitSince, today, toHome),
    nudged ?? Promise.resolve(undefined),
  ]);

  const paypalMinor = paypalTotalMinor(connections, home, fxPerUsd);

  const storedBills: StoredBill[] = billRows.map((b) => ({
    id: b.id,
    biller: b.biller,
    amount: b.amountMinor === null ? null : inHome(b.amountMinor, b.currency),
    due: b.due,
    category: CategoryKey.parse(b.category),
    businessBp: b.businessBp,
    status: b.status,
    ...(b.previousAmountMinor !== null && { previousAmount: inHome(b.previousAmountMinor, b.currency) }),
    ...(b.repeatUnit !== null && { repeatUnit: RepeatUnitSchema.parse(b.repeatUnit) }),
    ...(b.repeatDay !== null && { repeatDay: b.repeatDay }),
    ...(b.nextAmountMinor !== null && b.nextAmountFrom !== null && { nextAmount: inHome(b.nextAmountMinor, b.currency), nextAmountFrom: b.nextAmountFrom }),
    ...(b.cancelBy !== null && { cancelBy: b.cancelBy }),
    ...(b.repeatUntil !== null && { repeatUntil: b.repeatUntil }),
    ...(b.amountVaries && { amountVaries: true as const }),
    ...(b.seriesBillId !== null && { seriesBillId: b.seriesBillId }),
    ...(b.periodStart !== null && b.periodEnd !== null && { periodStart: b.periodStart, periodEnd: b.periodEnd }),
    ...(b.memberId !== null && { ownerId: b.memberId }),
    ...(b.paidByMemberId !== null && { paidBy: b.paidByMemberId }),
    ...(b.madeBy !== "form" && { madeBy: b.madeBy }),
  }));

  const cards: Card[] = cardRows.map((c) => ({
    id: c.id,
    label: c.label,
    closingDay: c.closingDay,
    dueDay: c.dueDay,
    ...(c.limitMinor !== null && { limit: inHome(c.limitMinor, c.currency) }),
    revolving: c.revolving,
    ...(c.memberId !== null && { ownerId: c.memberId }),
    ...(c.foreignFeeBp !== null && { foreignFeeBp: c.foreignFeeBp }),
  }));

  const charges: Charge[] = chargeRows.map((c) => ({
    id: c.id,
    cardId: c.cardId,
    merchant: c.merchant,
    amount: inHome(c.amountMinor, c.currency),
    ...(c.originalAmountMinor !== null && c.originalCurrency !== null && {
      original: { amount: fromMinor(c.originalAmountMinor, c.originalCurrency), currency: c.originalCurrency },
    }),
    date: c.date,
    category: CategoryKey.parse(c.category),
    businessBp: c.businessBp,
    source: c.source,
    status: c.status,
    ...(c.place !== null && { place: c.place }),
    ...(c.shared && { shared: true as const }),
    ...(c.madeBy !== "form" && { madeBy: c.madeBy }),
  }));

  const statements: ClosedStatement[] = statementRows.map((st) => ({
    cardId: st.cardId,
    amount: inHome(st.amountMinor, st.currency),
    closedOn: st.closedOn,
    dueOn: st.dueOn,
  }));

  // Days to pay comes from paid invoices, oldest first.
  const daysToPay = new Map<string, number[]>();
  for (const i of invoiceRows) {
    if (i.status !== "paid" || !i.sentOn || !i.paidOn) continue;
    const days = Math.round((Date.parse(i.paidOn) - Date.parse(i.sentOn)) / 86_400_000);
    daysToPay.set(i.clientId, [...(daysToPay.get(i.clientId) ?? []), days]);
  }
  const clients: Client[] = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    termsDays: c.termsDays,
    daysToPay: daysToPay.get(c.id) ?? [],
  }));

  const keepPaidFrom = addDays(today, -PAID_KEEP_DAYS);
  const invoices: Invoice[] = invoiceRows
    .filter((i) => i.status !== "paid" || (i.paidOn !== null && i.paidOn >= keepPaidFrom))
    .map((i) => ({
      id: i.id,
      clientId: i.clientId,
      ...(i.number !== null && { number: i.number }),
      item: i.item,
      amountUsd: inUsd(i.amountMinor, i.currency),
      status: i.status,
      ...(i.paypalStatus && { paypalStatus: i.paypalStatus }),
      ...(i.sentOn !== null && { sentOn: i.sentOn }),
      ...(i.dueOn !== null && { dueOn: i.dueOn }),
      ...(i.note !== null && { note: i.note }),
    }));

  const toPot = (p: typeof potRows[number]): Pot => ({
    id: p.id,
    name: p.name,
    saved: inHome(p.savedMinor, p.currency),
    ...(p.targetMinor !== null && { target: inHome(p.targetMinor, p.currency) }),
    ...(p.targetDate !== null && { targetDate: p.targetDate }),
    ...(p.fillBp !== null && { fillPct: p.fillBp / 100 }),
    ...(p.madeBy !== "form" && { madeBy: p.madeBy }),
  });

  const state: MoneyState = {
    today,
    homeCurrency: home,
    fxPerUsd,
    paypal: fromMinor(paypalMinor, home),
    bank: fromMinor(household.bankBalanceMinor, home),
    bills: [],
    cards,
    charges,
    statements,
    clients,
    invoices,
    pots: potRows.filter((p) => p.status === "confirmed").map(toPot),
    pendingPots: potRows.filter((p) => p.status === "pending").map(toPot),
    cancelNotices: cancelNotices(storedBills, today, home),
    storedBills,
    balanceUpdates: balanceRows.map((u) => ({ id: u.id, amount: inHome(u.amountMinor, u.currency), ...(u.madeBy !== "form" && { madeBy: u.madeBy }) })),
    ...(nudgedRows && { nudgedInvoiceIds: nudgedRows.map(row => row.id) }),
    split,
  };
  // D41: monthly bills become their occurrences up to the last day the engine looks at. planWindow reads only cards,
  // charges and statements, so it can be computed before any bill is in the state.
  state.bills = expandBills(storedBills, today, addDays(today, planWindow(state) - 1), home);
  return state;
}

// ---------------------------------------------------------------- events (D35)

type MadeBy = (typeof s.madeBy.enumValues)[number];
/** D50: who made a row or event; `askId` ties an Ask-made one to its question. Required wherever a row is written. */
export type Maker = { madeBy: MadeBy; askId?: string };

type NewEvent = {
  madeBy: MadeBy;
  askId?: string;
  kind: string;
  title: string;
  body?: string;
  amount?: { value: number; currency: string };
  ref?: { type: string; id: string };
  notify?: boolean;
  occurredAt?: Date;
};

export async function recordEvent(db: Db, householdId: string, e: NewEvent): Promise<string> {
  const hid = requireHousehold(householdId);
  let notify = e.notify === true;
  if (notify && e.kind !== "invoice_paid") {
    const today = sql`timezone(${s.households.timeZone}, now())::date`;
    const claimed = await db.update(s.households).set({ notificationDay: today }).where(and(
      eq(s.households.id, hid), sql`${s.households.notificationDay} is distinct from ${today}`,
    )).returning({ id: s.households.id });
    notify = claimed.length > 0;
  }
  // D34: a demo household's events carry its clock, so Activity dates and sorts with the scenario. An explicit
  // occurredAt (a provider's timestamp, D37) is kept as given; a real household keeps the database's now().
  const [household] = await db.select({ isDemo: s.households.isDemo, fixedToday: s.households.fixedToday, timeZone: s.households.timeZone })
    .from(s.households).where(eq(s.households.id, hid));
  if (!household) throw new Error("Household no longer exists");
  const occurredAt = e.occurredAt ?? (household.fixedToday ? householdMoment(household) : undefined);
  const [row] = await db
    .insert(s.events)
    .values({
      householdId: hid,
      kind: e.kind,
      title: e.title,
      body: e.body ?? null,
      amountMinor: e.amount ? toMinor(e.amount.value, e.amount.currency) : null,
      currency: e.amount?.currency ?? null,
      refType: e.ref?.type ?? null,
      refId: e.ref?.id ?? null,
      notify,
      madeBy: e.madeBy,
      askId: e.askId ?? null,
      ...(occurredAt && { occurredAt }),
    })
    .returning({ id: s.events.id });
  return row.id;
}

/** Newest first. `since` returns only events that happened after it (the 5-second poll). */
export async function listEvents(db: Db, householdId: string, since?: Date, limit = 100, offset = 0) {
  const hid = requireHousehold(householdId);
  return db
    .select()
    .from(s.events)
    .where(and(eq(s.events.householdId, hid), since ? gt(s.events.occurredAt, since) : undefined))
    .orderBy(desc(s.events.occurredAt), desc(s.events.id))
    .limit(limit).offset(offset);
}

export async function unreadCount(db: Db, householdId: string): Promise<number> {
  const hid = requireHousehold(householdId);
  const [row] = await db
    .select({ n: count() })
    .from(s.events)
    .where(and(eq(s.events.householdId, hid), eq(s.events.notify, true), isNull(s.events.readAt)));
  return row.n;
}

/** Marks the given events read, or every unread notification when no ids are given. Returns how many changed. */
export async function markRead(db: Db, householdId: string, ids?: string[]): Promise<number> {
  const hid = requireHousehold(householdId);
  if (ids && ids.length === 0) return 0;
  const rows = await db
    .update(s.events)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(s.events.householdId, hid),
        eq(s.events.notify, true),
        isNull(s.events.readAt),
        ids ? inArray(s.events.id, ids) : undefined,
      ),
    )
    .returning({ id: s.events.id });
  return rows.length;
}

// ---------------------------------------------------------------- webhooks (D15, D31)

/**
 * Stores a delivery once. Returns false when PayPal's event id was already seen, so the caller skips it.
 * The household is null when the event matches none of ours; it is still recorded so a redelivery is caught.
 */
export async function recordWebhookDelivery(
  db: Db,
  householdId: string | null,
  d: { paypalEventId: string; eventType: string; verified: boolean; payload: unknown },
): Promise<boolean> {
  const hid = householdId === null ? null : requireHousehold(householdId);
  const rows = await db
    .insert(s.webhookDeliveries)
    .values({ householdId: hid, paypalEventId: d.paypalEventId, eventType: d.eventType, verified: d.verified, payload: d.payload })
    .onConflictDoNothing({ target: s.webhookDeliveries.paypalEventId })
    .returning({ id: s.webhookDeliveries.id });
  return rows.length === 1;
}

// ---------------------------------------------------------------- delete my household

/** Everything cascades from the households row. */
export async function deleteHousehold(db: Db, householdId: string): Promise<void> {
  const hid = requireHousehold(householdId);
  await db.transaction(async tx => {
    const [household] = await tx.select({ id: s.households.id }).from(s.households).where(eq(s.households.id, hid)).for("update");
    if (!household) return;
    await deleteHouseholdKey(tx, hid);
    await removeHouseholdDocuments(tx, hid);
    await tx.delete(s.households).where(eq(s.households.id, hid));
  });
}

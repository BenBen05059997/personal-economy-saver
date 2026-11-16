// The household-scoped data layer validates the id and filters by it. The tenant role also enforces the scope in Postgres.

import { and, desc, eq, getTableColumns, gt, gte, inArray, isNull, isNotNull, lte, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransactionConfig } from "drizzle-orm/pg-core";
import { Currency } from "@/lib/catalogue/types";
import { CategoryKeySchema as CategoryKey } from "@/lib/money/categories";
import { cancelNotices, expandBills, RepeatUnitSchema } from "@/lib/money/repeat";
import { countingFrom } from "@/lib/money/split";
import { planWindow } from "@/lib/money/runway";
import type { Card, Charge, Client, ClosedStatement, Invoice, MoneyState, Pot, SplitState, StoredBill } from "@/lib/money/types";
import { convertMinor, fromMinor, fromRateMicro, toMinor, toRateMicro } from "./money";
import * as s from "./schema";
import { InputError } from "./input-error";
import { deleteHouseholdKey } from "./ai-key";
import { removeHouseholdDocuments } from "./document-cleanup";
import { clockForHousehold, householdMoment, type ClockHousehold } from "./clock";
import { addDays, daysBetween } from "@/lib/money/dates";
import { Uuid } from "@/lib/stable-id";

// Both the postgres.js client and PGlite (tests) fit this.
export type Db = PgDatabase<PgQueryResultHKT, typeof s>;

export function requireHousehold(householdId: string | null | undefined): string {
  if (!householdId || !Uuid.safeParse(householdId).success) throw new Error("A household id is required");
  return householdId;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A loader's date range: two YYYY-MM-DD dates, `from` on or before `to`. `label` begins the refusal ("A spending", "An income"). */
export function requireDateRange(range: { from: string; to: string }, label: string): { from: string; to: string } {
  if (!DATE.test(range.from) || !DATE.test(range.to) || range.from > range.to) throw new Error(`${label} range is two YYYY-MM-DD dates, from on or before to`);
  return range;
}

const householdTransactions = new WeakMap<Db, string>();

/** Both the role and the household id expire at the transaction boundary, including on a pooled connection. */
export async function withHousehold<T>(db: Db, id: string, work: (tx: Db) => Promise<T>, options?: PgTransactionConfig): Promise<T> {
  const hid = requireHousehold(id).toLowerCase();
  const scoped = householdTransactions.get(db);
  if (scoped !== undefined) {
    if (scoped !== hid) throw new Error("Cannot change households inside a household transaction");
    return work(db);
  }
  return db.transaction(async tx => {
    await tx.execute(sql`set local role pes_app`);
    await tx.execute(sql`select set_config('app.household_id', ${hid}, true)`);
    householdTransactions.set(tx, hid);
    try {
      return await work(tx);
    } finally {
      householdTransactions.delete(tx);
    }
  }, options);
}

/** The three columns a household's clock reads, or undefined when the household is gone. The caller words what to do about that. */
export async function householdClockRow(db: Db, householdId: string): Promise<ClockHousehold | undefined> {
  const [household] = await db.select({ isDemo: s.households.isDemo, fixedToday: s.households.fixedToday, timeZone: s.households.timeZone })
    .from(s.households).where(eq(s.households.id, requireHousehold(householdId)));
  return household;
}

/** Locks the household row for the rest of the transaction (so two writers of one household take turns) and returns what its writers read: the last runway reading, the home currency and bank balance, the split's start day, the clock and the places of memory, canvases and journal. Throws InputError when the household is gone. */
export async function lockHousehold(tx: Db, householdId: string) {
  const [household] = await tx.select({
    id: s.households.id, previous: s.households.runwayShort, currency: s.households.homeCurrency, bank: s.households.bankBalanceMinor, splitSince: s.households.splitSince,
    isDemo: s.households.isDemo, fixedToday: s.households.fixedToday, timeZone: s.households.timeZone,
    memoryPlace: s.households.memoryPlace, canvasPlace: s.households.canvasPlace, journalPlace: s.households.journalPlace,
  }).from(s.households)
    .where(eq(s.households.id, requireHousehold(householdId))).for("update");
  if (!household) throw new InputError("Household not found");
  return household;
}

/** The order every list of a household's people uses: the owner first, then by when they joined. */
export const ownerFirst = [sql`(${s.members.role} = 'owner') desc`, s.members.createdAt, s.members.id] as const;

/** The household's owner member, or undefined when it has none. The caller words what to do about that. */
export async function householdOwner(db: Db, householdId: string): Promise<{ id: string; name: string } | undefined> {
  const [owner] = await db.select({ id: s.members.id, name: s.members.displayName }).from(s.members)
    .where(and(eq(s.members.householdId, requireHousehold(householdId)), eq(s.members.role, "owner")));
  return owner;
}

export async function householdOwnerName(db: Db, householdId: string): Promise<string> {
  const owner = await householdOwner(db, householdId);
  if (!owner) throw new Error("Household owner not found");
  return owner.name;
}

// A closed cycle whose statement is still unpaid can be old: a cycle runs up to 31 days, the close-to-due gap up to about 61
// (close on the 1st, due on the 31st of the next month), so 31 + 61 = 92 days, plus a margin. Older charges cannot belong to an unpaid cycle.
export const CHARGE_LOOKBACK_DAYS = 100;
// Invoices paid this recently stay in the state (for the Activity view); older paid ones only feed days to pay.
const PAID_KEEP_DAYS = 7;

/** The household's latest USD rate into `quote` on or before `date`, scaled by 1e6, and the day it is from; undefined when it has none. The caller words what to do about that. */
export async function latestUsdRate(db: Db, householdId: string, quote: string, date: string): Promise<{ rateMicro: number; date: string } | undefined> {
  const [rate] = await db.select({ rateMicro: s.fxRates.rateMicro, date: s.fxRates.date }).from(s.fxRates)
    .where(and(eq(s.fxRates.householdId, requireHousehold(householdId)), eq(s.fxRates.base, "USD"), eq(s.fxRates.quote, quote), lte(s.fxRates.date, date)))
    .orderBy(desc(s.fxRates.date)).limit(1);
  return rate;
}

/** The household's latest USD rate on or before `today`, scaled by 1e6, and the day it is from (exactly 1e6 and no day when the home currency is USD). */
export async function usdRate(db: Db, householdId: string, home: string, today: string): Promise<{ rateMicro: number; date: string | null }> {
  const hid = requireHousehold(householdId);
  if (home === "USD") return { rateMicro: toRateMicro(1), date: null };
  const rate = await latestUsdRate(db, hid, home, today);
  if (!rate) throw new Error(`No USD/${home} rate on or before ${today}`);
  return rate;
}

/** The household's latest USD rate on or before `today`, scaled by 1e6 (exactly 1e6 when the home currency is USD). */
export async function usdRateMicro(db: Db, householdId: string, home: string, today: string): Promise<number> {
  return (await usdRate(db, householdId, home, today)).rateMicro;
}

/** One stored bill row as the engine reads it: amounts converted to the home currency by `inHome`; the own category's name comes from the join the loader made, when it made one. */
export function storedBillOf(b: typeof s.bills.$inferSelect & { ownName?: string | null }, inHome: (minor: number, currency: string) => number): StoredBill {
  return {
    id: b.id,
    biller: b.biller,
    amount: b.amountMinor === null ? null : inHome(b.amountMinor, b.currency),
    due: b.due,
    category: CategoryKey.parse(b.category),
    businessBp: b.businessBp,
    ...(b.ownCategoryId !== null && b.ownName != null && { own: { id: b.ownCategoryId, name: b.ownName } }),
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
  };
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
      .where(eq(s.members.householdId, hid)).orderBy(...ownerFirst),
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

/** The split's inputs as of the household's own today, in its home currency; `household` is what `lockHousehold` returned, so the caller holds the lock. */
export async function splitNow(tx: Db, hid: string, household: Awaited<ReturnType<typeof lockHousehold>>): Promise<{ home: Currency; today: string; fxPerUsd: number; split: SplitState }> {
  const { today } = clockForHousehold(household);
  const home = Currency.parse(household.currency);
  const fxPerUsd = fromRateMicro(await usdRateMicro(tx, hid, home, today));
  const split = await loadSplitState(tx, hid, household.splitSince, today, (minor, currency) => convertMinor(minor, currency, home, fxPerUsd));
  return { home, today, fxPerUsd, split };
}

/** Reads the household's rows and returns the MoneyState the engine consumes. `today` is the household's own date. */
export async function loadMoneyState(db: Db, householdId: string, today: string, snapshot?: typeof s.households.$inferSelect, chargesFrom = addDays(today, -CHARGE_LOOKBACK_DAYS)): Promise<MoneyState> {
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

  const [connections, billRows, cardRows, chargeRows, statementRows, clientRows, invoiceRows, balanceRows, potRows, split] = await Promise.all([
    db.select().from(s.paypalConnections).where(eq(s.paypalConnections.householdId, hid)),
    // D75: the own category by a join scoped to the household (the same composite key the foreign key uses), so it costs no query of its own.
    db.select({ ...getTableColumns(s.bills), ownName: s.ownCategories.name }).from(s.bills)
      .leftJoin(s.ownCategories, and(eq(s.ownCategories.householdId, s.bills.householdId), eq(s.ownCategories.id, s.bills.ownCategoryId)))
      .where(eq(s.bills.householdId, hid)).orderBy(s.bills.due, s.bills.biller),
    db.select().from(s.cards).where(eq(s.cards.householdId, hid)).orderBy(s.cards.createdAt, s.cards.label),
    db
      .select({ ...getTableColumns(s.charges), ownName: s.ownCategories.name })
      .from(s.charges)
      .leftJoin(s.ownCategories, and(eq(s.ownCategories.householdId, s.charges.householdId), eq(s.ownCategories.id, s.charges.ownCategoryId)))
      .where(and(eq(s.charges.householdId, hid), gte(s.charges.date, chargesFrom)))
      .orderBy(s.charges.date, s.charges.merchant),
    db
      .select()
      .from(s.cardStatements)
      .where(eq(s.cardStatements.householdId, hid))
      .orderBy(s.cardStatements.dueOn),
    db.select().from(s.clients).where(eq(s.clients.householdId, hid)).orderBy(s.clients.createdAt, s.clients.name),
    // A member request (D45) is not client income: the forecast never sees it.
    db.select().from(s.invoices).where(and(eq(s.invoices.householdId, hid), isNotNull(s.invoices.clientId))).orderBy(s.invoices.sentOn, s.invoices.createdAt),
    db.select().from(s.balanceUpdates).where(and(eq(s.balanceUpdates.householdId, hid), eq(s.balanceUpdates.status, "pending"))).orderBy(s.balanceUpdates.createdAt, s.balanceUpdates.id),
    db.select().from(s.pots).where(eq(s.pots.householdId, hid)).orderBy(s.pots.createdAt, s.pots.name, s.pots.id),
    loadSplitState(db, hid, household.splitSince, today, toHome),
  ]);

  const paypalMinor = paypalTotalMinor(connections, home, fxPerUsd);

  const storedBills = billRows.map(b => storedBillOf(b, inHome));

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
    ...(c.ownCategoryId !== null && c.ownName !== null && { own: { id: c.ownCategoryId, name: c.ownName } }),
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
    ...(st.paidOn !== null && { paid: true as const }),
  }));

  // Days to pay comes from paid invoices, oldest first.
  const daysToPay = new Map<string, number[]>();
  for (const i of invoiceRows) {
    if (i.status !== "paid" || !i.sentOn || !i.paidOn) continue;
    const days = Math.max(0, daysBetween(i.sentOn, i.paidOn));
    daysToPay.set(i.clientId!, [...(daysToPay.get(i.clientId!) ?? []), days]);
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
      clientId: i.clientId!, // the query keeps client invoices only
      ...(i.number !== null && { number: i.number }),
      item: i.item,
      amountUsd: inUsd(i.amountMinor, i.currency),
      status: i.status,
      hasLink: i.payToken !== null,
      ...(i.sentOn !== null && { sentOn: i.sentOn }),
      ...(i.dueOn !== null && { dueOn: i.dueOn }),
      ...(i.note !== null && { note: i.note }),
    }));

  const toPot = (p: typeof potRows[number]): Pot => ({
    id: p.id,
    name: p.name,
    saved: inHome(p.savedMinor, p.currency),
    ...(p.targetMinor !== null && { target: inHome(p.targetMinor, p.currency) }),
    ...(p.targetDate !== null && {
      targetDate: p.targetDate, startedOn: clockForHousehold({ ...household, fixedToday: null }, p.createdAt).today,
    }),
    ...(p.fillBp !== null && { fillPct: p.fillBp / 100 }),
    ...(p.madeBy !== "form" && { madeBy: p.madeBy }),
  });

  const state: MoneyState = {
    today,
    homeCurrency: home,
    fxPerUsd,
    paypal: fromMinor(paypalMinor, home),
    ...(connections.length > 0 && { paypalHeld: { amount: fromMinor(connections[0].balanceMinor, connections[0].balanceCurrency), currency: Currency.parse(connections[0].balanceCurrency) } }),
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
  if (notify && e.kind !== "invoice_paid" && e.kind !== "payment_received") {
    const today = sql`timezone(${s.households.timeZone}, now())::date`;
    const claimed = await db.update(s.households).set({ notificationDay: today }).where(and(
      eq(s.households.id, hid), sql`${s.households.notificationDay} is distinct from ${today}`,
    )).returning({ id: s.households.id });
    notify = claimed.length > 0;
  }
  // D34: a demo household's events carry its clock, so Activity dates and sorts with the scenario. An explicit
  // occurredAt (a provider's timestamp, D37) is kept as given; a real household keeps the database's now().
  const household = await householdClockRow(db, hid);
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

/** Newest first. `since` returns only events that happened after it (the 5-second poll); `before` is an event id and returns only the events older than that one (Show older). */
export async function listEvents(db: Db, householdId: string, since?: Date, limit = 100, before?: string) {
  const hid = requireHousehold(householdId);
  const anchor = before ? sql`(select ${s.events.occurredAt} from ${s.events} where ${s.events.householdId} = ${hid} and ${s.events.id} = ${before})` : undefined;
  return db
    .select()
    .from(s.events)
    .where(and(eq(s.events.householdId, hid), since ? gt(s.events.occurredAt, since) : undefined,
      before ? sql`(${s.events.occurredAt} < ${anchor} or (${s.events.occurredAt} = ${anchor} and ${s.events.id} < ${before}))` : undefined))
    .orderBy(desc(s.events.occurredAt), desc(s.events.id))
    .limit(limit);
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

/**
 * The one deletion of a household: lock the row (with is_demo re-checked when `isDemo` is given), delete its AI key and Storage documents, then the row;
 * the schema's cascades remove everything else. Call it inside a transaction. Returns false when there is no such household.
 */
export async function removeHousehold(tx: Db, householdId: string, isDemo?: boolean): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const where = isDemo === undefined ? eq(s.households.id, hid) : and(eq(s.households.id, hid), eq(s.households.isDemo, isDemo));
  const [existing] = await tx.select({ id: s.households.id }).from(s.households).where(where).for("update");
  if (!existing) return false;
  await deleteHouseholdKey(tx, hid);
  await removeHouseholdDocuments(tx, hid);
  const deleted = await tx.delete(s.households).where(where).returning({ id: s.households.id });
  return deleted.length === 1;
}

/** Deletes a household of any kind with everything of it. */
export async function deleteHousehold(db: Db, householdId: string): Promise<void> {
  await db.transaction(tx => removeHousehold(tx, householdId));
}

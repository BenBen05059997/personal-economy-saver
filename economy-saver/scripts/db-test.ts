// Database layer check against in-process Postgres (PGlite): no credential needed.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/db-test.ts
import assert from "node:assert/strict";
import "./forecast-causes-test";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq, getTableName, is, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { db as clientDb } from "@/db/client";
import { deleteHousehold, listEvents, loadMoneyState, markRead, recordEvent, recordWebhookDelivery, unreadCount, type Db } from "@/db/household";
import { householdMoment } from "@/db/clock";
import { convertMinor, fromMinor, toMinor } from "@/db/money";
import * as schema from "@/db/schema";
import { randomUUID } from "node:crypto";
import { accountHousehold, createHousehold, deleteOwnedHousehold, finishSetup, householdClock, setupForm } from "@/db/account";
import { runDaily } from "@/db/daily";
import { parseReferenceRate } from "@/db/reference-rate";
import { confirmPending } from "@/db/confirm";
import { insertBill } from "@/db/bills";
import { homeSentence } from "@/lib/money/sentence";
/** The two strings a sentence is made of (its other parts are tested in pots-test). */
const lines = (sentence: ReturnType<typeof homeSentence>) => ({ lead: sentence.lead, emphasis: sentence.emphasis });
import { findDemoHousehold, resetDemoHousehold } from "@/db/demo";
import { seedBen } from "@/db/seed";
import { eventFeed, publicEvent } from "@/db/event-feed";
import { applyVerifiedDelivery, recentDeliveries } from "@/lib/events";
import { benMoney, benStoredBills } from "@/lib/sample/ben";
import { expandBills } from "@/lib/money/repeat";
import { ladder, low, paybackFor, planWindow, roomOnCard, safeToSpend, series, dueItems, timeline } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";
import { loadNavigationData, loadWorkspaceData } from "@/db/workspace";
import { addDays } from "@/lib/money/runway";

// Compile-time check that the postgres.js instance fits the same Db type PGlite does.
type _ClientFitsDb = ReturnType<typeof clientDb> extends Db ? true : never;
const _fits: _ClientFitsDb = true;
void _fits;

let passed = 0;
let total = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  total += 1;
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 12).join("\n    ")}`);
  }
}

// The database mints its own uuids, so ids are rewritten to natural keys and arrays sorted before comparing.
function normalise(state: MoneyState): MoneyState {
  const cardLabel = new Map(state.cards.map((c) => [c.id, c.label]));
  const memberName = new Map(state.split.members.map((m) => [m.id, m.name]));
  const clientName = new Map(state.clients.map((c) => [c.id, c.name]));
  const billId = (b: { biller: string }) => `bill:${b.biller}`;
  const invoiceId = (i: { clientId: string; item: string }) => `inv:${clientName.get(i.clientId)}:${i.item}`;
  const own = <T extends { own?: { id: string; name: string } }>(row: T): T => (row.own ? { ...row, own: { id: `own:${row.own.name}`, name: row.own.name } } : row); // D75: an own category by its name
  const by = <T,>(key: (t: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));
  const storedName = new Map(state.storedBills.map((b) => [b.id, b.biller]));
  return {
    ...state,
    storedBills: state.storedBills
      .map((b) => ({ ...own(b), id: billId(b), ...(b.seriesBillId !== undefined && { seriesBillId: billId({ biller: storedName.get(b.seriesBillId)! }) }) }))
      .sort(by((b) => (b.due ?? "") + b.biller)),
    bills: state.bills.map((b) => ({ ...own(b), id: billId(b) })).sort(by((b) => b.due + b.biller)),
    cards: state.cards.map((c) => ({ ...c, id: `card:${c.label}`, ...(c.ownerId && { ownerId: `member:${memberName.get(c.ownerId)}` }) })).sort(by((c) => c.label)),
    charges: state.charges
      .map((c) => ({ ...own(c), id: `ch:${cardLabel.get(c.cardId)}:${c.merchant}:${c.date}`, cardId: `card:${cardLabel.get(c.cardId)}` }))
      .sort(by((c) => c.date + c.id)),
    statements: state.statements
      .map((st) => ({ ...st, cardId: `card:${cardLabel.get(st.cardId)}` }))
      .sort(by((st) => st.dueOn + st.cardId)),
    clients: state.clients.map((c) => ({ ...c, id: `client:${c.name}` })).sort(by((c) => c.name)),
    invoices: state.invoices
      .map((i) => ({ ...i, id: invoiceId(i), clientId: `client:${clientName.get(i.clientId)}` }))
      .sort(by((i) => i.id)),
    split: { ...state.split, members: state.split.members.map((m) => ({ ...m, id: `member:${m.name}` })) },
  };
}

// Everything the engine exports that takes a state, on one state.
function engine(state: MoneyState) {
  const expected = Array.from(series(state, "expected"));
  const worst = Array.from(series(state, "worst"));
  return {
    expected,
    worst,
    lowExpected: low(series(state, "expected")),
    lowWorst: low(series(state, "worst")),
    rooms: state.cards.map((c) => [c.label, roomOnCard(state, c.id)] as const).sort((a, b) => a[0].localeCompare(b[0])),
    paybacks: state.cards.map((c) => [c.label, paybackFor(state, c.id)] as const).sort((a, b) => a[0].localeCompare(b[0])),
    ladder: ladder(state),
    due: dueItems(state),
    safe: safeToSpend(state, 210_000),
    timeline: timeline(state, "worst"),
  };
}

const allTables = () => Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];

async function rows(db: Db, table: PgTable, householdId: string) {
  const col = (table as unknown as Record<string, never>)["householdId"];
  return db.select().from(table).where(sql`${col} = ${householdId}`);
}

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });

  const a = await seedBen(db, { isDemo: true });
  const b = await seedBen(db);
  const today = benMoney.today;

  const refState = normalise(benMoney);
  const refEngine = engine(refState);

  await check("seedBen makes a fresh household each call, one demo", async () => {
    assert.notEqual(a, b);
    const hs = await db.select().from(schema.households);
    assert.equal(hs.length, 2);
    assert.equal(hs.find((h) => h.id === a)?.isDemo, true);
    assert.equal(hs.find((h) => h.id === b)?.isDemo, false);
    for (const hid of [a, b]) assert.equal((await rows(db, schema.fxRates, hid)).length, 1, "one household reference rate");
  });

  for (const [label, hid] of [["A (demo)", a], ["B (copy)", b]] as const) {
    const state = await loadMoneyState(db, hid, today);
    await check(`household ${label}: MoneyState deep-equals benMoney (ids and order normalised)`, () => {
      assert.deepStrictEqual(normalise(state), refState);
    });
    await check(`household ${label}: days to pay reproduced in order from paid invoices`, () => {
      const byName = Object.fromEntries(state.clients.map((c) => [c.name, c.daysToPay]));
      for (const c of benMoney.clients) assert.deepStrictEqual(byName[c.name], c.daysToPay);
    });
    await check(`household ${label}: engine outputs on the loaded state match benMoney`, () => {
      assert.deepStrictEqual(engine(normalise(state)), refEngine);
    });
    await check(`household ${label}: series, low, roomOnCard, ladder match on the raw loaded state`, () => {
      assert.deepStrictEqual(Array.from(series(state, "expected")), Array.from(series(benMoney, "expected")));
      assert.deepStrictEqual(Array.from(series(state, "worst")), Array.from(series(benMoney, "worst")));
      assert.deepStrictEqual(low(series(state, "worst")), low(series(benMoney, "worst")));
      for (const c of benMoney.cards) {
        const mine = state.cards.find((x) => x.label === c.label)!;
        assert.deepStrictEqual(roomOnCard(state, mine.id), roomOnCard(benMoney, c.id));
      }
      assert.deepStrictEqual(ladder(state), ladder(benMoney));
    });
  }

  await check("navigation matches full workspace counts at the charge boundary and isolates households", async () => {
    const hid = await seedBen(db, { isDemo: true });
    const other = await seedBen(db, { isDemo: true });
    const beforeOther = await loadNavigationData(db, other);
    const [card] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, hid));
    await db.insert(schema.charges).values([
      { date: addDays(today, -63), status: "pending" as const },
      { date: addDays(today, -62), status: "pending" as const },
      { date: addDays(today, 20), status: "pending" as const },
      { date: today, status: "confirmed" as const },
    ].map(row => ({ householdId: hid, cardId: card.id, merchant: "Fictional test shop",
      amountMinor: 100, currency: "JPY", source: "manual" as const, ...row })));
    await db.insert(schema.bills).values({ householdId: hid, biller: "Fictional test utility",
      amountMinor: 100, currency: "JPY", due: addDays(today, -90), category: "utilities", status: "pending" });
    const [document] = await db.insert(schema.documents).values({ householdId: hid, kind: "upload",
      storagePath: `${hid}/fictional-test`, mime: "application/pdf", status: "failed" }).returning();
    const proposed = { kind: "bill", name: "Fictional test utility", date: today, amountMinor: 100,
      currency: "JPY", category: "utilities", cardId: null };
    await db.insert(schema.readings).values([
      { householdId: hid, documentId: document.id, extracted: { proposed }, target: "bill", status: "to_check" },
      { householdId: hid, documentId: document.id, extracted: { proposed }, target: "bill", status: "confirmed" },
    ]);
    const full = await loadWorkspaceData(db, hid);
    const narrow = await db.transaction(tx => loadNavigationData(tx, hid),
      { isolationLevel: "repeatable read", accessMode: "read only" });
    assert.deepEqual(narrow, { name: full.name, feed: full.feed, pending: full.pending, timeZone: full.timeZone, today: full.state.today, tryIt: full.tryIt });
    assert.equal(narrow.pending, beforeOther.pending + 4, "two recent pending charges, one bill and one reading count");
    assert.deepEqual(await loadNavigationData(db, other), beforeOther);
    await db.delete(schema.fxRates).where(eq(schema.fxRates.householdId, hid));
    assert.deepEqual(await loadNavigationData(db, hid), narrow, "navigation does not need an FX snapshot");
    await assert.rejects(loadWorkspaceData(db, hid), /No USD\/JPY rate/);
    await db.delete(schema.households).where(eq(schema.households.id, hid));
    await db.delete(schema.households).where(eq(schema.households.id, other));
  });

  await check("navigation requires a valid household and its owner", async () => {
    await assert.rejects(loadNavigationData(db, randomUUID()), /Household not found/);
    for (const bad of ["", "not-a-uuid", null, undefined] as unknown as string[]) {
      await assert.rejects(loadNavigationData(db, bad), /household id is required/);
    }
    const [household] = await db.insert(schema.households).values({ name: "Fictional empty household", homeCurrency: "JPY" }).returning();
    await assert.rejects(loadNavigationData(db, household.id), /Household owner not found/);
    await db.delete(schema.households).where(eq(schema.households.id, household.id));
  });

  await check("the worst case is the known ¥18,780 short on Nov 27 before Hikari", async () => {
    const state = await loadMoneyState(db, a, today);
    const confirmed = { ...state, bills: state.bills.filter((x) => x.status === "confirmed") };
    const lw = low(series(confirmed, "worst"));
    assert.equal(lw.amount, -18_780);
    assert.equal(lw.date, "2026-11-27");
  });

  await check("the sample's repeating bills expand across the plan window and the engine counts them (pure, no database)", () => {
    const window = planWindow({ ...benMoney, bills: [] });
    assert.equal(window, 43, "Card A's later statement sets the window");
    const end = addDays(benMoney.today, window - 1);
    assert.deepEqual(benMoney.bills.map((x) => `${x.biller} ${x.due}`).sort(),
      ["CloudBox Plus 2026-11-18", "CloudBox Plus 2026-12-18", "Hikari Denki 2026-09-25", "Hikari Denki 2026-10-25", "Hikari Denki 2026-11-27", "Mobaile Tsushin 2026-11-20", "Mobaile Tsushin 2026-12-20", "Rent 2026-11-27"]);
    assert.deepEqual(expandBills(benStoredBills, benMoney.today, end), benMoney.bills);
    assert.ok(benMoney.bills.filter((x) => x.biller === "Hikari Denki").every((x) => x.repeatDay === undefined), "the electricity bills are one-offs");
    // Without the repeats, only the Nov occurrences exist: the two Dec bills are what lowers the cards' room.
    const oneOff = { ...benMoney, bills: benMoney.bills.filter((x) => x.due < "2026-12-01") };
    const [cardA] = benMoney.cards;
    assert.equal(roomOnCard(oneOff, cardA.id).room - roomOnCard(benMoney, cardA.id).room, 1_980 + 4_800);
    assert.equal(roomOnCard(benMoney, cardA.id).room, 173_770);
    assert.deepEqual(low(series(oneOff, "worst")), low(series(benMoney, "worst")), "the 30-day low is unchanged");
  });

  await check("households do not see each other's rows", async () => {
    for (const table of [schema.members, schema.paypalConnections, schema.clients, schema.invoices, schema.cards, schema.cardStatements, schema.charges, schema.bills, schema.events]) {
      const ra = await rows(db, table, a);
      const rb = await rows(db, table, b);
      assert.ok(ra.length > 0 && ra.length === rb.length, `${getTableName(table)}: ${ra.length} vs ${rb.length}`);
      const ids = new Set(ra.map((r) => (r as { id: string }).id));
      assert.ok(rb.every((r) => !ids.has((r as { id: string }).id)));
      assert.ok(ra.every((r) => (r as { householdId: string }).householdId === a));
    }
    const stateA = await loadMoneyState(db, a, today);
    const stateB = await loadMoneyState(db, b, today);
    const idsA = new Set([...stateA.bills, ...stateA.cards, ...stateA.charges, ...stateA.clients, ...stateA.invoices].map((x) => x.id));
    assert.ok([...stateB.bills, ...stateB.cards, ...stateB.charges, ...stateB.clients, ...stateB.invoices].every((x) => !idsA.has(x.id)));
  });

  await check("events: list, unread count and markRead are household-scoped", async () => {
    assert.equal(await unreadCount(db, a), 1);
    assert.equal(await unreadCount(db, b), 1);
    const ea = await listEvents(db, a);
    const eb = await listEvents(db, b);
    assert.equal(ea.length, 2);
    assert.ok(ea[0].occurredAt >= ea[1].occurredAt, "newest first");
    assert.equal((await listEvents(db, a, ea[0].occurredAt)).length, 0, "since is exclusive");
    const unreadB = eb.find((e) => e.notify)!;
    assert.equal(await markRead(db, a, [unreadB.id]), 0, "A cannot mark B's event read");
    assert.equal(await unreadCount(db, b), 1);
    assert.equal(await markRead(db, a), 1);
    assert.equal(await unreadCount(db, a), 0);
    assert.equal(await unreadCount(db, b), 1);
  });

  await check("every data-layer function throws without a household id", async () => {
    for (const bad of ["", undefined, null, "not-a-uuid"] as unknown as string[]) {
      await assert.rejects(loadMoneyState(db, bad, today), /household id is required/);
      await assert.rejects(listEvents(db, bad), /household id is required/);
      await assert.rejects(unreadCount(db, bad), /household id is required/);
      await assert.rejects(markRead(db, bad), /household id is required/);
      await assert.rejects(deleteHousehold(db, bad), /household id is required/);
    }
  });

  await check("a duplicate PayPal webhook event id is rejected", async () => {
    const d = { paypalEventId: "WH-TEST-1", eventType: "INVOICING.INVOICE.PAID", verified: true, payload: { resource: { id: "INV2-FAKE" } } };
    assert.equal(await recordWebhookDelivery(db, a, d), true);
    assert.equal(await recordWebhookDelivery(db, a, d), false, "replay skipped");
    assert.equal(await recordWebhookDelivery(db, b, d), false, "same id from another household is also a replay");
    await assert.rejects(
      db.insert(schema.webhookDeliveries).values({ householdId: a, ...d, payload: {} }),
      (e: unknown) => /duplicate key|unique/i.test(String((e as Error).cause ?? e)),
    );
  });

  await check("verified paid webhook: one delivery, one paid transition, one household notification on replay", async () => {
    const paypalId = "INV2-FICTIONAL";
    const [sent] = await db.select().from(schema.invoices)
      .where(and(eq(schema.invoices.householdId, a), eq(schema.invoices.status, "sent"))).limit(1);
    const target = and(eq(schema.invoices.householdId, a), eq(schema.invoices.id, sent.id));
    await db.update(schema.invoices).set({ paypalInvoiceId: paypalId }).where(target);
    const event = {
      id: "WH-TEST-PAID",
      event_type: "INVOICING.INVOICE.PAID",
      create_time: "2026-11-14T16:00:00Z",
      resource: { id: paypalId, status: "PAID" },
    };

    await applyVerifiedDelivery(db, { ...event, id: "WH-TEST-PARTIAL", resource: { id: paypalId, status: "PARTIALLY_PAID" } });
    assert.equal((await db.select().from(schema.invoices).where(target))[0].status, "sent");

    // A failure after writing the receipt must allow PayPal to retry the whole transaction.
    await assert.rejects(applyVerifiedDelivery(db, { ...event, create_time: undefined }), /create_time/);
    assert.ok(!(await recentDeliveries(db, a)).some((e) => e.id === event.id));
    await applyVerifiedDelivery(db, event);
    await applyVerifiedDelivery(db, event);
    const [invoice] = await db.select().from(schema.invoices).where(target);
    assert.equal(invoice.status, "paid");
    assert.equal(invoice.paidOn, "2026-11-15", "paid date uses Tokyo, not UTC");
    const deliveries = (await recentDeliveries(db, a)).filter((d) => d.id === event.id);
    assert.equal(deliveries.length, 1);
    assert.ok(!("payload" in deliveries[0]));
    const paid = (await listEvents(db, a)).filter((e) => e.kind === "invoice_paid");
    assert.equal(paid.length, 1);
    assert.equal(paid[0].notify, true);
    assert.equal(paid[0].refId, sent.id);
    assert.equal(paid[0].amountMinor, sent.amountMinor);
    assert.equal((await listEvents(db, b)).filter((e) => e.kind === "invoice_paid").length, 0);
    assert.equal((await recentDeliveries(db, b)).length, 0);
  });

  await check("verified delivery for an unknown invoice is deduplicated without notifying any household", async () => {
    const event = { id: "WH-UNMATCHED", event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-UNKNOWN", status: "PAID" } };
    await applyVerifiedDelivery(db, event);
    await applyVerifiedDelivery(db, event);
    const deliveries = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.paypalEventId, event.id));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].householdId, null);
    assert.ok(!(await recentDeliveries(db, a)).some((d) => d.id === event.id));
  });

  await check("bell polling stays idle for seed invoices and tracks only my PayPal invoices, reader jobs and read markers", async () => {
    const visitor = await seedBen(db, { isDemo: true });
    const otherVisitor = await seedBen(db, { isDemo: true });
    const [otherInvoice] = await db.select({ id: schema.invoices.id }).from(schema.invoices)
      .where(and(eq(schema.invoices.householdId, otherVisitor), eq(schema.invoices.status, "sent"))).limit(1);
    await db.update(schema.invoices).set({ paypalInvoiceId: "INV2-OTHER-VISITOR" })
      .where(and(eq(schema.invoices.householdId, otherVisitor), eq(schema.invoices.id, otherInvoice.id)));
    assert.equal((await eventFeed(db, otherVisitor)).inFlight, true);
    assert.equal((await eventFeed(db, visitor)).inFlight, false, "another household's invoice must not trigger polling");
    const [otherDoc] = await db.insert(schema.documents).values({
      householdId: otherVisitor, storagePath: otherVisitor + "/fictional-receipt", mime: "image/png", kind: "upload", status: "queued",
    }).returning({ id: schema.documents.id });
    const feed = await eventFeed(db, visitor);
    assert.equal(feed.inFlight, false, "fictional seed invoices cannot receive a webhook");
    assert.equal((await eventFeed(db, otherVisitor)).inFlight, true);
    assert.equal(feed.total, 2);
    assert.equal(feed.unread, 1);
    assert.equal(feed.notifications.length, 1);
    const [invoice] = await db.select({ id: schema.invoices.id }).from(schema.invoices)
      .where(and(eq(schema.invoices.householdId, visitor), eq(schema.invoices.status, "sent"))).limit(1);
    const invoiceFilter = and(eq(schema.invoices.householdId, visitor), eq(schema.invoices.id, invoice.id));
    await db.update(schema.invoices).set({ paypalInvoiceId: "INV2-TRACKED-VISITOR" }).where(invoiceFilter);
    assert.equal((await eventFeed(db, visitor)).inFlight, true);
    await db.update(schema.invoices).set({ status: "paid", paidOn: today }).where(invoiceFilter);
    assert.equal((await eventFeed(db, visitor)).inFlight, false);
    const [doc] = await db.insert(schema.documents).values({
      householdId: visitor, storagePath: visitor + "/fictional-receipt", mime: "image/png", kind: "upload", status: "queued",
    }).returning({ id: schema.documents.id });
    assert.equal((await eventFeed(db, visitor)).inFlight, true);
    await db.update(schema.documents).set({ status: "reading" }).where(and(eq(schema.documents.householdId, visitor), eq(schema.documents.id, doc.id)));
    assert.equal((await eventFeed(db, visitor)).inFlight, true);
    await db.update(schema.documents).set({ status: "read" }).where(and(eq(schema.documents.householdId, visitor), eq(schema.documents.id, doc.id)));
    assert.equal((await eventFeed(db, visitor)).inFlight, false);
    assert.equal(await markRead(db, b, [feed.notifications[0].id]), 0);
    assert.equal((await eventFeed(db, visitor)).unread, 1);
    assert.equal(await markRead(db, visitor, [feed.notifications[0].id]), 1);
    assert.equal((await eventFeed(db, visitor)).unread, 0);
    assert.equal((await eventFeed(db, visitor)).notifications.length, 0);
    assert.ok(!(await listEvents(db, visitor)).map(publicEvent).some(row => JSON.stringify(row).includes(visitor)));
    // This synthetic metadata row never had a Storage object.
    await db.delete(schema.documents).where(and(eq(schema.documents.householdId, visitor), eq(schema.documents.id, doc.id)));
    await db.delete(schema.documents).where(and(eq(schema.documents.householdId, otherVisitor), eq(schema.documents.id, otherDoc.id)));
    await deleteHousehold(db, visitor);
    await deleteHousehold(db, otherVisitor);
  });

  await check("a card from another household cannot be referenced", async () => {
    const [cardOfA] = await db.select().from(schema.cards).where(sql`${schema.cards.householdId} = ${a}`);
    await assert.rejects(
      db.insert(schema.charges).values({ householdId: b, cardId: cardOfA.id, merchant: "X", amountMinor: 100, currency: "JPY", date: today, source: "manual" }),
      (e: unknown) => /foreign key/i.test(String((e as Error).cause ?? e)),
    );
  });

  await check("money columns are integers; no numeric or float column anywhere", async () => {
    const cols = (await pg.query<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`,
    )).rows;
    const moneyish = cols.filter((c) => /_minor$|_micro$/.test(c.column_name));
    assert.ok(moneyish.length >= 13, `found ${moneyish.length} money columns`);
    for (const c of moneyish) assert.equal(c.data_type, "bigint", `${c.table_name}.${c.column_name}`);
    const bad = cols.filter((c) => ["numeric", "real", "double precision", "money"].includes(c.data_type));
    assert.deepStrictEqual(bad, []);
    await assert.rejects(
      db.update(schema.households).set({ bankBalanceMinor: 1.5 }).where(sql`${schema.households.id} = ${a}`),
      "a fractional amount is refused by the database",
    );
    assert.equal(toMinor(1200, "USD"), 120_000);
    assert.equal(toMinor(1980, "JPY"), 1_980);
    assert.equal(fromMinor(120_000, "USD"), 1200);
    assert.equal(convertMinor(120_000, "USD", "JPY", 150), 180_000);
    assert.equal(convertMinor(180_000, "JPY", "USD", 150), 120_000);
  });

  await check("PayPal connections are sandbox-only (CHECK)", async () => {
    const [m] = await db.select().from(schema.members).where(sql`${schema.members.householdId} = ${b}`);
    await assert.rejects(
      db.insert(schema.paypalConnections).values({ householdId: b, memberId: m.id, environment: "LIVE", balanceCurrency: "JPY" }),
    );
  });

  await check("row level security is on for every table and only pes_app has household policies", async () => {
    const tables = allTables().map((t) => getTableConfig(t).name);
    assert.equal(tables.length, 36);
    const on = (await pg.query<{ relname: string }>(`select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relrowsecurity`)).rows.map((r) => r.relname);
    assert.deepStrictEqual(on.sort(), tables.sort());
    const policies = (await pg.query<{ tablename: string; roles: string; cmd: string; qual: string; with_check: string }>(
      "select tablename, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename",
    )).rows;
    assert.deepStrictEqual(policies.map(row => row.tablename), tables.filter(table => table !== "ai_global_usage" && table !== "ip_buckets"));
    for (const policy of policies) {
      const tenantColumn = policy.tablename === "households" ? "id" : "household_id";
      assert.equal(policy.roles, "{pes_app}");
      assert.equal(policy.cmd, "ALL");
      assert.ok(policy.qual.includes(tenantColumn + " =") && policy.qual.includes("'app.household_id'"));
      assert.equal(policy.with_check, policy.qual);
    }
  });

  await check("every table but households has household_id (not null except webhook_deliveries, cascade, indexed)", async () => {
    const tables = allTables();
    for (const t of tables) {
      const cfg = getTableConfig(t);
      if (cfg.name === "households") continue;
      if (cfg.name === "ip_buckets" || cfg.name === "ai_global_usage") continue; // per-address and app-wide counters: they exist outside any household
      const col = cfg.columns.find((c) => c.name === "household_id");
      if (cfg.name === "webhook_deliveries") assert.ok(col && !col.notNull, "webhook_deliveries.household_id nullable");
      else assert.ok(col?.notNull, `${cfg.name}.household_id not null`);
      const fk = cfg.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "household_id") && f.reference().foreignTable === schema.households);
      assert.equal(fk?.onDelete, "cascade", `${cfg.name} cascade`);
      assert.ok(cfg.primaryKeys.some(key => key.columns[0].name === "household_id") || cfg.uniqueConstraints.some(key => key.columns[0].name === "household_id") || cfg.indexes.some((i) => i.config.columns.some((c) => (c as { name?: string }).name === "household_id")), `${cfg.name} index`);
    }
  });

  await check("Home reads ¥18,780 short, then ¥30,000 short after confirming Hikari exactly once", async () => {
    const demo = await seedBen(db, { isDemo: true });
    const initial = await loadMoneyState(db, demo, today);
    const bill = initial.bills.find(row => row.biller === "Hikari Denki" && row.status === "pending")!;
    assert.deepEqual(lines(homeSentence(initial)), {
      lead: "You're fine if Acme and Northwind pay as usual. If they're late, you're",
      emphasis: "¥18,780 short on the 27th.",
    });
    assert.equal(await confirmPending(db, b, "bill", bill.id), false);
    assert.equal(await confirmPending(db, demo, "bill", bill.id), true);
    assert.equal(await confirmPending(db, demo, "bill", bill.id), false);
    assert.equal(homeSentence(await loadMoneyState(db, demo, today)).emphasis, "¥30,000 short on the 27th.");
    assert.equal((await listEvents(db, demo)).filter(e => e.kind === "bill_confirmed").length, 1);
  });

  await check("first sign-in upgrades only the requesting demo, with real balances and an idempotent membership", async () => {
    const fromDemo = await seedBen(db, { isDemo: true });
    const uid = randomUUID();
    const setup = setupForm.parse({
      name: "Kiko", currency: "USD", timeZone: "Asia/Tokyo", bank: "-12.37",
      card: "Card C", limit: "501.10", closingDay: "15", dueDay: "10",
    });
    assert.equal(await accountHousehold(db, uid), null);
    await Promise.all([finishSetup(db, uid, setup, fromDemo), finishSetup(db, uid, setup, fromDemo)]);
    assert.equal(await findDemoHousehold(db, fromDemo), null);
    assert.equal(await findDemoHousehold(db, uid), null);
    assert.equal(await accountHousehold(db, uid), uid);
    const state = await loadMoneyState(db, uid, today);
    assert.equal(state.cards.length, 1);
    assert.equal(state.cards[0].limit, 501.10);
    assert.equal(state.bank, -12.37);
    assert.equal(state.invoices.length + state.bills.length + state.charges.length, 0);
    assert.equal((await householdClock(db, uid, new Date("2026-11-02T16:00:00Z"))).today, "2026-11-03");
    assert.equal((await householdClock(db, a, new Date("2026-11-02T16:00:00Z"))).today, "2026-11-14");
    assert.equal(await deleteOwnedHousehold(db, a), false);
    assert.equal(await deleteOwnedHousehold(db, randomUUID()), false);
    assert.equal(await deleteOwnedHousehold(db, uid), true);
    assert.equal(await accountHousehold(db, uid), null);
    assert.equal(await findDemoHousehold(db, a), a);
  });

  await check("a blank demo says what to add, never that it is fine; a pending bill changes nothing, a confirmed one gives the normal sentence (D47)", async () => {
    const blank = await createHousehold(db, randomUUID(), setupForm.parse({
      name: "Mika", currency: "USD", timeZone: "Asia/Tokyo", bank: "1,200", card: "Card D", limit: "", closingDay: "20", dueDay: "10",
    }), { isDemo: true });
    assert.equal(await findDemoHousehold(db, blank), blank);
    assert.equal(await accountHousehold(db, blank), null);
    assert.notEqual((await householdClock(db, blank)).today, today, "a blank demo lives on the real date (D51)");
    const empty = await loadMoneyState(db, blank, today);
    assert.equal(empty.cards.length, 1);
    assert.equal(empty.bills.length + empty.charges.length + empty.invoices.length + empty.clients.length + empty.pots.length, 0, "no Ben data");
    assert.deepEqual(lines(homeSentence(empty)), { lead: "Add your rent, your bills and the clients who pay you to see your next 30 days.", emphasis: "Bank balance $1,200." });
    const bill = { id: randomUUID(), biller: "Fictional rent", amount: "300", due: "2026-11-20", category: "housing" as const, businessBp: 0, memberId: null, paidByMemberId: null, repeat: null, nextAmount: null, nextAmountFrom: null, cancelBy: null };
    await insertBill(db, blank, bill, "pending", { madeBy: "form" });
    assert.equal(homeSentence(await loadMoneyState(db, blank, today)).emphasis, "Bank balance $1,200.", "a pending bill alone is still nothing to forecast");
    await confirmPending(db, blank, "bill", bill.id);
    const after = homeSentence(await loadMoneyState(db, blank, today));
    assert.match(after.lead, /You're fine for the next 30 days/);
    assert.equal(after.emphasis, "$900 on the 20th.");
    assert.equal(await deleteOwnedHousehold(db, blank), false, "a blank demo is not an account");
  });

  await check("anonymous sessions isolate visitors and only reset their own demo household", async () => {
    const first = await seedBen(db, { isDemo: true });
    const second = await seedBen(db, { isDemo: true });
    assert.notEqual(first, second);
    assert.equal(await findDemoHousehold(db, first), first);
    assert.equal(await findDemoHousehold(db, b), null);
    assert.equal(await findDemoHousehold(db, "invalid"), null);
    assert.equal(await resetDemoHousehold(db, b), null);
    const fresh = await resetDemoHousehold(db, first);
    assert.ok(fresh && fresh !== first && fresh !== second);
    assert.equal(await findDemoHousehold(db, first), null);
    assert.equal(await resetDemoHousehold(db, first), null);
    assert.equal(await findDemoHousehold(db, second), second);
    assert.deepEqual(normalise(await loadMoneyState(db, fresh, today)), normalise(benMoney));
  });

  await check("published FX dates, scoped snapshots, and one daily statement and no duplicate suggestions on retry", async () => {
    assert.deepEqual(parseReferenceRate("<Cube time='2026-11-13'><Cube currency='USD' rate='2'/><Cube currency='JPY' rate='320'/></Cube>"),
      { date: "2026-11-13", rateMicro: 160000000 });
    const demo = await seedBen(db, { isDemo: true });
    const [card] = await db.select().from(schema.cards).where(and(eq(schema.cards.householdId, demo), eq(schema.cards.label, "Card B")));
    await db.update(schema.cards).set({closingDay: 14}).where(and(eq(schema.cards.householdId, demo), eq(schema.cards.id, card.id)));
    await db.update(schema.fxRates).set({rateMicro: 160000000}).where(eq(schema.fxRates.householdId, demo));
    assert.equal((await loadMoneyState(db, a, today)).fxPerUsd, 150);
    const before = series(await loadMoneyState(db, demo, today), "worst");
    await runDaily(db, demo);
    await runDaily(db, demo);
    assert.deepEqual(series(await loadMoneyState(db, demo, today), "worst"), before);
    assert.equal((await listEvents(db, demo)).filter(row => row.kind === "suggestion_made").length, 0);
    const statements = await db.select().from(schema.cardStatements).where(and(eq(schema.cardStatements.householdId, demo), eq(schema.cardStatements.cardId, card.id)));
    assert.equal(statements.length, 1);
    assert.equal(statements[0].amountMinor, 61000);
  });

  await check("events: a demo household stamps new events on its clock, a real one on real time (D34)", async () => {
    // The moment is the demo date at the current time of day in the household's zone; the zone's offset is the one on that date.
    const tokyo = { isDemo: true, fixedToday: "2026-11-14", timeZone: "Asia/Tokyo" };
    assert.equal(householdMoment(tokyo, new Date("2026-11-03T05:30:15.250Z")).toISOString(), "2026-11-14T05:30:15.250Z");
    assert.equal(householdMoment({ isDemo: true, fixedToday: "2026-11-14", timeZone: "America/New_York" }, new Date("2026-07-01T12:00:00Z")).toISOString(), "2026-11-14T13:00:00.000Z");
    const real = new Date("2026-11-03T05:30:15Z");
    assert.equal(householdMoment({ isDemo: false, fixedToday: null, timeZone: "Asia/Tokyo" }, real), real);

    const demo = await seedBen(db, { isDemo: true });
    const real2 = await seedBen(db);
    const seeded = await listEvents(db, demo);
    const feedBefore = await eventFeed(db, demo);
    await recordEvent(db, demo, { madeBy: "form", kind: "bank_balance_set", title: "Bank balance set to ¥100,000 (was ¥67,000)" });
    await recordEvent(db, real2, { madeBy: "form", kind: "bank_balance_set", title: "Bank balance set" });
    const [fresh, ...older] = await listEvents(db, demo);
    assert.equal(fresh.title, "Bank balance set to ¥100,000 (was ¥67,000)", "newest demo event sorts above the seeded ones, whatever the time of day");
    assert.deepEqual(older.map(e => e.id), seeded.map(e => e.id));
    const tokyoDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    assert.equal(tokyoDay(fresh.occurredAt), "2026-11-14");
    const secondOfDay = (d: Date) => { const [h, m, s] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d).split(":").map(Number); return h * 3600 + m * 60 + s; };
    const apart = Math.abs(secondOfDay(fresh.occurredAt) - secondOfDay(new Date()));
    assert.ok(Math.min(apart, 86_400 - apart) < 60, "keeps the real time of day");
    const realRow = (await listEvents(db, real2)).find(e => e.title === "Bank balance set")!;
    assert.ok(Math.abs(realRow.occurredAt.getTime() - Date.now()) < 60_000, "a real household stamps real time");
    assert.equal(tokyoDay(realRow.occurredAt), tokyoDay(new Date()));

    // An explicit timestamp (a provider's, D37) is kept as given.
    const provider = new Date("2026-11-03T01:02:03Z");
    await recordEvent(db, demo, { madeBy: "form", kind: "invoice_paid", title: "Paid", occurredAt: provider });
    assert.ok((await listEvents(db, demo)).some(e => e.occurredAt.getTime() === provider.getTime()));

    // The poll's cursor is the household's latest event time from the server, so the feed sees a new demo event
    // as a new total and a later cursor, and the since query returns exactly the new event.
    const feedAfter = await eventFeed(db, demo);
    assert.equal(feedAfter.total, feedBefore.total + 2);
    assert.ok(feedAfter.since! > feedBefore.since!);
    assert.deepEqual((await listEvents(db, demo, new Date(feedBefore.since!))).map(e => e.id), [fresh.id]);
  });

  await check("deleting a household removes everything of it and nothing of the other", async () => {
    const before = await loadMoneyState(db, a, today);
    await deleteHousehold(db, b);
    for (const t of allTables()) {
      if (!("householdId" in (t as object))) continue;
      assert.equal((await rows(db, t, b)).length, 0, getTableName(t));
    }
    assert.deepStrictEqual(await loadMoneyState(db, a, today), before);
  });

  console.log(`\n${passed}/${total} passed`);
  await pg.close();
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

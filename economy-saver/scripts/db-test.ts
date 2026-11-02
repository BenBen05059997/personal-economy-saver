// Database layer check against in-process Postgres (PGlite): no credential needed.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/db-test.ts
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, getTableName, is, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { db as clientDb } from "@/db/client";
import { deleteHousehold, listEvents, loadMoneyState, markRead, recordWebhookDelivery, unreadCount, type Db } from "@/db/household";
import { convertMinor, fromMinor, toMinor } from "@/db/money";
import * as schema from "@/db/schema";
import { randomUUID } from "node:crypto";
import { accountHousehold, deleteOwnedHousehold, finishSetup, householdClock, setupForm } from "@/db/account";
import { runDaily } from "@/db/daily";
import { parseReferenceRate } from "@/db/reference-rate";
import { confirmPending } from "@/db/confirm";
import { homeSentence } from "@/lib/money/sentence";
import { findDemoHousehold, resetDemoHousehold } from "@/db/demo";
import { seedBen } from "@/db/seed";
import { eventFeed, publicEvent } from "@/db/event-feed";
import { applyVerifiedDelivery, recentDeliveries } from "@/lib/events";
import { benMoney } from "@/lib/sample/ben";
import { ladder, low, paybackFor, roomOnCard, safeToSpend, series, dueItems, timeline } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";

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
  const clientName = new Map(state.clients.map((c) => [c.id, c.name]));
  const billId = (b: { biller: string }) => `bill:${b.biller}`;
  const invoiceId = (i: { clientId: string; item: string }) => `inv:${clientName.get(i.clientId)}:${i.item}`;
  const by = <T,>(key: (t: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));
  return {
    ...state,
    bills: state.bills.map((b) => ({ ...b, id: billId(b) })).sort(by((b) => b.due + b.biller)),
    cards: state.cards.map((c) => ({ ...c, id: `card:${c.label}` })).sort(by((c) => c.label)),
    charges: state.charges
      .map((c) => ({ ...c, id: `ch:${cardLabel.get(c.cardId)}:${c.merchant}:${c.date}`, cardId: `card:${cardLabel.get(c.cardId)}` }))
      .sort(by((c) => c.date + c.id)),
    statements: state.statements
      .map((st) => ({ ...st, cardId: `card:${cardLabel.get(st.cardId)}` }))
      .sort(by((st) => st.dueOn + st.cardId)),
    clients: state.clients.map((c) => ({ ...c, id: `client:${c.name}` })).sort(by((c) => c.name)),
    invoices: state.invoices
      .map((i) => ({ ...i, id: invoiceId(i), clientId: `client:${clientName.get(i.clientId)}` }))
      .sort(by((i) => i.id)),
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
  const pg = new PGlite();
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

  await check("the worst case is the known ¥18,780 short on Nov 27 before Hikari", async () => {
    const state = await loadMoneyState(db, a, today);
    const confirmed = { ...state, bills: state.bills.filter((x) => x.status === "confirmed") };
    const lw = low(series(confirmed, "worst"));
    assert.equal(lw.amount, -18_780);
    assert.equal(lw.date, "2026-11-27");
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

  await check("bell and poll state use only my household, including queued documents, sent invoices and read markers", async () => {
    const visitor = await seedBen(db, { isDemo: true });
    const invoiceFilter = and(eq(schema.invoices.householdId, visitor), eq(schema.invoices.status, "sent"));
    const feed = await eventFeed(db, visitor);
    assert.equal(feed.inFlight, true);
    assert.equal(feed.total, 2);
    assert.equal(feed.unread, 1);
    assert.equal(feed.notifications.length, 1);
    await db.update(schema.invoices).set({ status: "draft" }).where(invoiceFilter);
    assert.equal((await eventFeed(db, visitor)).inFlight, false);
    const [doc] = await db.insert(schema.documents).values({
      householdId: visitor, storagePath: visitor + "/fictional-receipt", mime: "image/png", kind: "upload", status: "queued",
    }).returning({ id: schema.documents.id });
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
    await deleteHousehold(db, visitor);
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

  await check("row level security is on for every table, with no policies", async () => {
    const tables = allTables().map((t) => getTableConfig(t).name);
    assert.equal(tables.length, 18);
    const on = (await pg.query<{ relname: string }>(`select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relrowsecurity`)).rows.map((r) => r.relname);
    assert.deepStrictEqual(on.sort(), tables.sort());
    assert.equal((await pg.query(`select 1 from pg_policies`)).rows.length, 0);
  });

  await check("every table but households has household_id (not null except webhook_deliveries, cascade, indexed)", async () => {
    const tables = allTables();
    for (const t of tables) {
      const cfg = getTableConfig(t);
      if (cfg.name === "households") continue;
      const col = cfg.columns.find((c) => c.name === "household_id");
      if (cfg.name === "webhook_deliveries") assert.ok(col && !col.notNull, "webhook_deliveries.household_id nullable");
      else assert.ok(col?.notNull, `${cfg.name}.household_id not null`);
      const fk = cfg.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "household_id") && f.reference().foreignTable === schema.households);
      assert.equal(fk?.onDelete, "cascade", `${cfg.name} cascade`);
      assert.ok(cfg.primaryKeys.some(key => key.columns[0].name === "household_id") || cfg.indexes.some((i) => i.config.columns.some((c) => (c as { name?: string }).name === "household_id")), `${cfg.name} index`);
    }
  });

  await check("Home reads ¥18,780 short, then ¥30,000 short after confirming Hikari exactly once", async () => {
    const demo = await seedBen(db, { isDemo: true });
    const initial = await loadMoneyState(db, demo, today);
    const bill = initial.bills.find(row => row.biller === "Hikari Denki")!;
    assert.deepEqual(homeSentence(initial), {
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

  await check("published FX dates, scoped snapshots, and one daily statement and notification on retry", async () => {
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
    assert.equal((await listEvents(db, demo)).filter(row => row.kind === "daily_reminder" && row.notify).length, 1);
    const statements = await db.select().from(schema.cardStatements).where(and(eq(schema.cardStatements.householdId, demo), eq(schema.cardStatements.cardId, card.id)));
    assert.equal(statements.length, 1);
    assert.equal(statements[0].amountMinor, 61000);
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

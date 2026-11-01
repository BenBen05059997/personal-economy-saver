// Database layer check against in-process Postgres (PGlite): no credential needed.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/db-test.ts
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { getTableName, is, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { db as clientDb } from "@/db/client";
import { deleteHousehold, listEvents, loadMoneyState, markRead, recordWebhookDelivery, unreadCount, type Db } from "@/db/household";
import { convertMinor, fromMinor, toMinor } from "@/db/money";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
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
    assert.equal((await db.select().from(schema.fxRates)).length, 1, "one shared fx row for 2026-11-14");
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
    assert.equal(tables.length, 17);
    const on = (await pg.query<{ relname: string }>(`select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relrowsecurity`)).rows.map((r) => r.relname);
    assert.deepStrictEqual(on.sort(), tables.sort());
    assert.equal((await pg.query(`select 1 from pg_policies`)).rows.length, 0);
  });

  await check("every table but households and fx_rates has household_id (not null except webhook_deliveries, cascade, indexed)", async () => {
    const tables = allTables();
    for (const t of tables) {
      const cfg = getTableConfig(t);
      if (cfg.name === "households" || cfg.name === "fx_rates") continue;
      const col = cfg.columns.find((c) => c.name === "household_id");
      if (cfg.name === "webhook_deliveries") assert.ok(col && !col.notNull, "webhook_deliveries.household_id nullable");
      else assert.ok(col?.notNull, `${cfg.name}.household_id not null`);
      const fk = cfg.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "household_id") && f.reference().foreignTable === schema.households);
      assert.equal(fk?.onDelete, "cascade", `${cfg.name} cascade`);
      assert.ok(cfg.indexes.some((i) => i.config.columns.some((c) => (c as { name?: string }).name === "household_id")), `${cfg.name} index`);
    }
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

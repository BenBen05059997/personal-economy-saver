// The daily job's one standing rule (D50): suggest a nudge once an unreminded sent invoice is N days past due.
// PGlite, no credentials, no network (the reference-rate fetch is answered locally). Run from the project root:
// npx tsx --tsconfig ./tsconfig.json scripts/cron-test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { runDaily } from "@/db/daily";
import { loadMoneyState } from "@/db/household";
import { seedBen } from "@/db/seed";
import { expectedPayDate } from "@/lib/money/pace";

const at = (day: string) => new Date(`${day}T04:00:00Z`); // 13:00 in Tokyo, the same calendar day

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(`<Cube time='2026-11-20'><Cube currency='USD' rate='1.1'/><Cube currency='JPY' rate='165'/></Cube>`)) as typeof fetch;
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const nudges = (hid: string) => db.select().from(schema.events)
      .where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, "nudge_suggested"))).orderBy(schema.events.createdAt, schema.events.id);
    const invoiceOf = async (hid: string, number: string) => (await db.select().from(schema.invoices)
      .where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.number, number))))[0];
    const clientName = async (id: string) => (await db.select().from(schema.clients).where(eq(schema.clients.id, id)))[0].name;
    const setNudge = (hid: string, days: number | null) => db.update(schema.households).set({ nudgeAfterDays: days }).where(eq(schema.households.id, hid));
    // observeRunway reads the real calendar, so each household also gets a rate dated well before it.
    const seed = async () => {
      const id = await seedBen(db);
      await db.insert(schema.fxRates).values({ householdId: id, date: "2026-01-01", base: "USD", quote: "JPY", rateMicro: 150_000_000 });
      return id;
    };
    // Ben's sent invoices: 1042 (Acme) due Nov 18 and 1038 (Northwind) due Nov 20.
    const hid = await seed();

    await check("off by default: the daily job suggests nothing, however late an invoice is", async () => {
      await runDaily(db, hid, at("2026-12-20"));
      assert.equal((await nudges(hid)).length, 0);
    });

    await check("on at 2 days: 1042 is two days past due on Nov 20 and gets one event (bell, made by cron, ref the invoice); 1038 is not late enough", async () => {
      await setNudge(hid, 2);
      await db.update(schema.households).set({ notificationDay: null }).where(eq(schema.households.id, hid)); // the bell rings once a day; free it
      await runDaily(db, hid, at("2026-11-20"));
      const rows = await nudges(hid);
      const acme = await invoiceOf(hid, "1042");
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].madeBy, rows[0].notify, rows[0].refType, rows[0].refId, rows[0].askId], ["cron", true, "invoice", acme.id, null]);
      assert.equal(rows[0].title, `Nudge ${await clientName(acme.clientId)}: 2 days past due`);
    });

    await check("never a second event for the same invoice: the same day again, and the next day", async () => {
      await runDaily(db, hid, at("2026-11-20"));
      await runDaily(db, hid, at("2026-11-21"));
      assert.equal((await nudges(hid)).length, 1);
    });

    await check("a reminded invoice, or one with a reminder attempt, never gets a nudge; clearing both lets 1038 fire two days after its due date", async () => {
      const northwind = await invoiceOf(hid, "1038");
      const mark = (set: Partial<typeof schema.invoices.$inferInsert>) => db.update(schema.invoices).set(set).where(eq(schema.invoices.id, northwind.id));
      await mark({ remindedAt: new Date("2026-11-21T00:00:00Z") });
      await runDaily(db, hid, at("2026-11-22"));
      assert.equal((await nudges(hid)).length, 1, "reminded");
      await mark({ remindedAt: null, reminderAttemptedAt: new Date("2026-11-21T00:00:00Z") });
      await runDaily(db, hid, at("2026-11-22"));
      assert.equal((await nudges(hid)).length, 1, "reminder attempted");
      await mark({ reminderAttemptedAt: null });
      await runDaily(db, hid, at("2026-11-22"));
      const rows = await nudges(hid);
      assert.equal(rows.length, 2);
      assert.equal(rows[1].refId, northwind.id);
    });

    await check("turning the rule off stops new suggestions; a paid invoice is not nudged", async () => {
      const other = await seed();
      await setNudge(other, 1);
      const acme = await invoiceOf(other, "1042");
      await db.update(schema.invoices).set({ status: "paid", paidOn: "2026-11-19" }).where(eq(schema.invoices.id, acme.id));
      await setNudge(other, null);
      await runDaily(db, other, at("2026-11-30"));
      assert.equal((await nudges(other)).length, 0, "off");
      await setNudge(other, 1);
      await runDaily(db, other, at("2026-11-21"));
      const rows = await nudges(other);
      assert.deepEqual(rows.map(row => row.refId), [(await invoiceOf(other, "1038")).id], "only the unpaid, late one");
    });

    await check("an invoice with no due date uses its expected date: sent date plus the client's usual days to pay, else their terms", async () => {
      const lone = await seed();
      await setNudge(lone, 2);
      const northwind = await invoiceOf(lone, "1038");
      await db.update(schema.invoices).set({ dueOn: null }).where(eq(schema.invoices.id, northwind.id));
      await db.update(schema.invoices).set({ status: "closed" }).where(eq(schema.invoices.id, (await invoiceOf(lone, "1042")).id));
      const state = await loadMoneyState(db, lone, "2026-11-20");
      const client = state.clients.find(c => c.id === northwind.clientId)!;
      const expected = expectedPayDate(client, northwind.sentOn!);
      const early = new Date(Date.parse(`${expected}T04:00:00Z`) + 86_400_000);
      await runDaily(db, lone, early);
      assert.equal((await nudges(lone)).length, 0, "one day past the expected date is not yet two");
      await runDaily(db, lone, new Date(Date.parse(`${expected}T04:00:00Z`) + 2 * 86_400_000));
      const rows = await nudges(lone);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].title, `Nudge ${client.name}: 2 days past due`);
    });

    await check("Home's one action: the state lists the nudged invoice only while the rule is on, the invoice is sent and unreminded, and PayPal knows it", async () => {
      const acme = await invoiceOf(hid, "1042");
      assert.equal((await loadMoneyState(db, hid, "2026-11-22")).nudgedInvoiceIds?.length ?? 0, 0, "no PayPal invoice linked: a reminder cannot leave");
      await db.update(schema.invoices).set({ paypalInvoiceId: "INV2-FICTIONAL-1" }).where(eq(schema.invoices.id, acme.id));
      assert.deepEqual((await loadMoneyState(db, hid, "2026-11-22")).nudgedInvoiceIds, [acme.id]);
      await db.update(schema.invoices).set({ remindedAt: new Date() }).where(eq(schema.invoices.id, acme.id));
      assert.deepEqual((await loadMoneyState(db, hid, "2026-11-22")).nudgedInvoiceIds, []);
      await setNudge(hid, null);
      assert.equal((await loadMoneyState(db, hid, "2026-11-22")).nudgedInvoiceIds, undefined, "off: the field is absent");
    });

    await check("the rule never calls PayPal: the daily job imports nothing that sends", async () => {
      const source = readFileSync("src/db/daily.ts", "utf8");
      assert.doesNotMatch(source, /paypal|runTool|send_invoice/i);
    });
  } finally {
    globalThis.fetch = realFetch;
    await pg.close();
  }
  console.log(`${passed} cron checks passed`);
}

main().catch(error => { console.error(error); process.exit(1); });

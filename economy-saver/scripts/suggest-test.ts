import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { approveInvoice } from "@/db/approval";
import { confirmPending } from "@/db/confirm";
import { resetDemoHousehold } from "@/db/demo";
import { defaultRules, rulesFor, setStandingRule } from "@/db/rules";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { dismiss, notNow, openSuggestions, runPass } from "@/db/suggestions";
import { findSuggestions } from "@/lib/money/suggest";
import { benMoney } from "@/lib/sample/ben";
import type { Bill, MoneyState } from "@/lib/money/types";

const day = (date: string) => new Date(date + "T00:00:00Z");
const today = "2026-11-14";
const sampleBill = { id: "fictional-bill", status: "pending", biller: "Kumo Water", due: "2026-11-17", amount: 2_500,
  category: "utilities", businessBp: 0 } satisfies Bill;

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => Promise<void> | void) { await run(); passed++; console.log("✓ " + name); }

  try {
    const steps = readMigrationFiles({ migrationsFolder: "./drizzle" });
    for (const migration of steps.slice(0, -1)) await pg.transaction(async tx => {
      for (const sql of migration.sql) await tx.exec(sql);
    });
    const legacy = crypto.randomUUID(), legacyOff = crypto.randomUUID();
    await pg.query("insert into households (id, name, home_currency, nudge_after_days) values ($1, 'Fictional 60', 'JPY', 60), ($2, 'Fictional off', 'USD', null)", [legacy, legacyOff]);
    await pg.query("insert into rules (household_id, match_biller, patch) values ($1, 'bill:kumo water', '{}'::jsonb)", [legacy]);
    const migration = steps.at(-1)!;
    await pg.transaction(async tx => { for (const sql of migration.sql) await tx.exec(sql); });

    await check("0028 copies both old nudge settings, adds the other defaults and preserves reader corrections", async () => {
      assert.deepEqual((await rulesFor(db, legacy)).nudge_after, { enabled: true, threshold: 60, currency: null });
      assert.deepEqual((await rulesFor(db, legacyOff)).nudge_after, { enabled: false, threshold: null, currency: null });
      assert.deepEqual(await rulesFor(db, legacy), {
        ...defaultRules(), nudge_after: { enabled: true, threshold: 60, currency: null },
      });
      assert.equal((await db.select().from(schema.rules).where(eq(schema.rules.householdId, legacy))).length, 7);
      await pg.query("update households set nudge_after_days = 2 where id = $1", [legacy]);
      assert.equal((await rulesFor(db, legacy)).nudge_after.threshold, 60, "the legacy column is no longer read");
    });

    const quiet: MoneyState = { ...benMoney, bills: [], storedBills: [], invoices: [], statements: [], charges: [], pots: [] };
    const find = (state: MoneyState, rules = defaultRules(), remindable = new Set(state.invoices.map(row => row.id))) =>
      findSuggestions(state, rules, remindable);
    const kinds = (state: MoneyState, rules = defaultRules()) => find(state, rules).map(row => row.kind);
    await check("a sent invoice can be late against both its due date and the client's usual date, with exact day boundaries", () => {
      const invoice = { ...benMoney.invoices[0], sentOn: "2026-10-30", dueOn: "2026-11-11" };
      const state = { ...quiet, invoices: [invoice] };
      assert.deepEqual(kinds(state), ["invoice_nudge", "late_client"]);
      assert.deepEqual(kinds({ ...state, invoices: [{ ...invoice, dueOn: "2026-11-12", sentOn: "2026-10-31" }] }), []);
      assert.deepEqual(find(state, defaultRules(), new Set()).map(row => row.kind), ["late_client"]);
      assert.deepEqual(kinds({ ...state, invoices: [{ ...invoice, status: "paid" }] }), []);
      const rules = defaultRules();
      rules.nudge_after.enabled = false;
      assert.deepEqual(kinds(state, rules), ["late_client"]);
    });

    await check("bill and statement use their own windows, pending bills link to To check, and coverage uses the runway", () => {
      const statement = { ...benMoney.statements[0], dueOn: "2026-11-16" };
      const state = { ...quiet, bills: [sampleBill], statements: [statement] };
      const findings = find(state);
      assert.deepEqual(findings.map(row => row.kind), ["statement_due", "bill_due"]);
      assert.equal(findings[0].reason, "¥58,000, covered even if clients pay late.");
      assert.equal(findings[1].reason, "¥2,500, covered even if clients pay late.");
      assert.equal(findings[1].action, "check_bill");
      assert.equal(find({ ...state, bank: 0, paypal: 0 })[0].reason, "¥58,000, short even if clients pay as usual.");
      const rules = defaultRules();
      rules.statement_ahead.threshold = 1;
      rules.bill_ahead.threshold = 2;
      assert.deepEqual(kinds(state, rules), []);
      assert.deepEqual(kinds({ ...quiet, bills: [{ ...sampleBill, dueUnknown: true }] }), []);
    });

    await check("regular cost increases use last month and exceed the percent strictly", () => {
      const october = { ...sampleBill, status: "confirmed" as const, id: "oct", due: "2026-10-18", amount: 2_000 };
      const november = { ...sampleBill, status: "confirmed" as const, id: "nov", due: "2026-11-18", amount: 2_500 };
      const state = { ...quiet, storedBills: [october, november] };
      const rules = defaultRules();
      assert.deepEqual(kinds(state, rules), []);
      rules.cost_up = { enabled: true, threshold: 25, currency: null };
      assert.deepEqual(kinds(state, rules), []);
      rules.cost_up.threshold = 24;
      assert.deepEqual(kinds(state, rules), ["cost_up"]);
      assert.equal(find(state, rules)[0].reason, "¥500 more than last month.");
      assert.deepEqual(kinds({ ...quiet, storedBills: [october] }, rules), []);
    });

    await check("cancel-by has a three-day window and must have a renewal after it", () => {
      const renewal = { ...sampleBill, status: "confirmed" as const, due: "2026-11-20", cancelBy: "2026-11-17", repeatUnit: "month" as const, repeatDay: 20 };
      assert.deepEqual(kinds({ ...quiet, storedBills: [renewal] }), ["cancel_by"]);
      assert.equal(find({ ...quiet, storedBills: [renewal] })[0].reason, "It renews Nov 20 (¥2,500).");
      assert.deepEqual(kinds({ ...quiet, storedBills: [{ ...renewal, cancelBy: "2026-11-18" }] }), []);
      assert.deepEqual(kinds({ ...quiet, storedBills: [{ ...renewal, due: "2026-10-20", repeatUntil: "2026-10-20" }] }), []);
    });

    await check("only dated incomplete goals can fall behind, and the low-spend rule uses matching currency and a strict minimum", () => {
      const pot = { id: "camera", name: "Camera", saved: 100, target: 2_100, targetDate: "2026-12-14" };
      assert.deepEqual(kinds({ ...quiet, pots: [pot] }), ["goal_behind"]);
      assert.deepEqual(kinds({ ...quiet, pots: [{ ...pot, targetDate: undefined }] }), []);
      assert.deepEqual(kinds({ ...quiet, pots: [{ ...pot, saved: pot.target }] }), []);
      const rules = defaultRules();
      rules.goal_behind.enabled = false;
      rules.safe_below = { enabled: true, threshold: 128_001, currency: "JPY" };
      assert.deepEqual(kinds(quiet, rules), ["safe_below"]);
      assert.deepEqual(kinds({ ...quiet, pots: [pot] }, rules), ["safe_below"]);
      rules.safe_below.threshold = 128_000;
      assert.deepEqual(kinds(quiet, rules), []);
      rules.safe_below = { enabled: true, threshold: 129_000, currency: "USD" };
      assert.deepEqual(kinds(quiet, rules), []);
    });

    const demo = await seedBen(db, { isDemo: true });
    const other = await seedBen(db, { isDemo: true });
    const history = (id: string) => db.select().from(schema.suggestions).where(eq(schema.suggestions.householdId, id));
    const events = (id: string, kind: string) => db.select().from(schema.events).where(and(eq(schema.events.householdId, id), eq(schema.events.kind, kind)));
    const pending = async (id: string, name = sampleBill.biller) => (await db.insert(schema.bills).values({
      householdId: id, biller: name, amountMinor: 2_500, currency: "JPY", due: "2026-11-17", category: "utilities", status: "pending",
    }).returning())[0];
    const run = (id = demo, date = today) => runPass(db, id, day(date));
    const moveDemoDay = (id: string, date: string) => db.update(schema.households).set({ fixedToday: date }).where(eq(schema.households.id, id));

    await check("fresh Try it on Nov 14 and Reset have no suggestions and use the documented rule defaults", async () => {
      assert.deepEqual(await rulesFor(db, demo), defaultRules());
      assert.deepEqual(await openSuggestions(db, demo), []);
      const old = await seedBen(db, { isDemo: true });
      await pending(old);
      await run(old);
      assert.equal((await openSuggestions(db, old)).length, 1);
      const reset = await resetDemoHousehold(db, old);
      assert.ok(reset);
      assert.deepEqual(await openSuggestions(db, reset), []);
      assert.deepEqual(await history(old), []);
    });

    const bill = await pending(demo);
    await check("the pending-bill browser fixture has one suggestion, even across concurrent passes, and is household-scoped", async () => {
      await Promise.all([run(), run()]);
      const [row] = await openSuggestions(db, demo);
      assert.deepEqual([row.kind, row.title, row.reason, row.action, row.refId], [
        "bill_due", "Kumo Water due Nov 17", "¥2,500, covered even if clients pay late.", "check_bill", bill.id,
      ]);
      assert.equal((await history(demo)).length, 1);
      assert.equal((await events(demo, "suggestion_made")).length, 1);
      assert.deepEqual(await openSuggestions(db, other), []);
      assert.equal(await dismiss(db, other, row.id), false);
      assert.equal(await notNow(db, other, row.id), false);
    });

    await check("Not now hides the suggestion through the same day and brings back the same row the next day", async () => {
      const [row] = await openSuggestions(db, demo);
      assert.equal(await notNow(db, demo, row.id, day(today)), true);
      await run();
      assert.deepEqual(await openSuggestions(db, demo), []);
      await setStandingRule(db, demo, "bill_ahead", { enabled: true, threshold: 2, currency: null });
      await moveDemoDay(demo, "2026-11-15");
      await run(demo, "2026-11-15");
      assert.equal((await openSuggestions(db, demo))[0].id, row.id);
      assert.equal((await events(demo, "suggestion_made")).length, 1);
    });

    await check("confirming the pending bill closes the same suggestion as approved in its transaction", async () => {
      assert.equal(await confirmPending(db, other, "bill", bill.id), false);
      assert.equal((await openSuggestions(db, demo)).length, 1);
      assert.equal(await confirmPending(db, demo, "bill", bill.id), true);
      assert.deepEqual(await openSuggestions(db, demo), []);
      assert.equal((await history(demo))[0].status, "approved");
      assert.equal((await events(demo, "suggestion_approved")).length, 1);
      await run(demo, "2026-11-15");
      assert.equal((await history(demo)).length, 1);
    });

    await check("dismissal survives a new day and 90-day pruning without reissuing the same finding", async () => {
      await pending(other);
      await run(other);
      const [row] = await openSuggestions(db, other);
      assert.equal(await dismiss(db, other, row.id, day(today)), true);
      await setStandingRule(db, other, "bill_ahead", { enabled: true, threshold: 2, currency: null });
      await moveDemoDay(other, "2026-11-15");
      await run(other, "2026-11-15");
      assert.deepEqual(await openSuggestions(db, other), []);
      assert.equal((await history(other))[0].status, "dismissed");
      assert.equal((await events(other, "suggestion_dismissed")).length, 1);
      await run(other, "2027-03-01");
      assert.deepEqual(await history(other), []);
      assert.equal((await events(other, "suggestion_made")).length, 1);
    });

    await check("a finding no longer true resolves even while deferred", async () => {
      const item = await pending(other, "Fictional change");
      await run(other);
      const [row] = await openSuggestions(db, other);
      await notNow(db, other, row.id, day(today));
      await db.update(schema.bills).set({ due: "2026-12-17" }).where(and(eq(schema.bills.householdId, other), eq(schema.bills.id, item.id)));
      await run(other);
      assert.deepEqual(await openSuggestions(db, other), []);
      assert.equal((await history(other)).find(saved => saved.id === row.id)?.status, "resolved");
    });

    await check("only successful PayPal approval closes its suggestion, through the simulated existing transport", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const [invoice] = await db.update(schema.invoices).set({ dueOn: "2026-11-10", paypalInvoiceId: "INV2-FICTIONAL" })
        .where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.number, "1042"))).returning();
      await setStandingRule(db, hid, "nudge_after", { enabled: true, threshold: 4, currency: null });
      await run(hid);
      assert.deepEqual((await openSuggestions(db, hid)).map(row => row.kind), ["invoice_nudge"]);
      const calls: string[] = [];
      const ctx = { db, householdId: hid, today, usdRate: 150, approveKey: invoice.approveKey, recipient: "client@example.test", tool: async (name: string) => {
        calls.push(name);
        if (name === "get_invoice") return { id: "INV2-FICTIONAL", status: "SENT", primary_recipients: [{ billing_info: { email_address: "client@example.test" } }] };
      } };
      await approveInvoice(ctx, "remind");
      assert.deepEqual(calls, ["get_invoice", "send_invoice_reminder"]);
      assert.equal((await history(hid))[0].status, "approved");
      assert.deepEqual(await openSuggestions(db, hid), []);
    });
  } finally {
    await pg.close();
  }
  console.log("suggestions: " + passed + " passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });

// Only the sandbox read boundary is simulated, with fictional invoices. No network calls.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as s from "@/db/schema";
import { seedBen } from "@/db/seed";
import { ImportRefused, ImportSetupError, importPayPalHistory } from "@/db/paypal-import";
import { listEvents, loadMoneyState } from "@/db/household";

type Remote = Record<string, unknown>;
const person = (email: string, given: string, surname: string) => ({ billing_info: { email_address: email, name: { given_name: given, surname } } });
const inv = (id: string, status: string, o: Remote = {}) => ({
  id, status,
  detail: { invoice_number: "N-" + id, invoice_date: "2026-09-01", payment_term: { due_date: "2026-09-15" } },
  primary_recipients: [person("mika.sato@example.com", "Mika", "Sato")],
  amount: { currency_code: "USD", value: "120.50" },
  ...o,
});
const paidOn = (...dates: string[]) => ({ payments: { transactions: dates.map(d => ({ payment_date: d })) } });

async function test() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  try {
    const db = drizzle(pg, { schema: s });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const designated = await seedBen(db), other = await seedBen(db), demo = await seedBen(db, { isDemo: true });
    await db.insert(s.fxRates).values({ householdId: designated, base: "USD", quote: "JPY", date: "2020-01-01", rateMicro: 150000000 });
    const bank = async (hid: string) => (await db.select({ b: s.households.bankBalanceMinor }).from(s.households).where(eq(s.households.id, hid)))[0].b;
    const paypalBalance = async (hid: string) => (await db.select().from(s.paypalConnections).where(eq(s.paypalConnections.householdId, hid)))[0].balanceMinor;
    const [existing] = await db.select().from(s.clients).where(eq(s.clients.householdId, designated));

    // Two pages; page 1 items lack recipients/payments for some invoices, so the detail call fills them in.
    const calls: string[] = [];
    const pages: Record<string, Remote> = {
      "1": { total_pages: 2, items: [
        inv("INV2-DRAFT", "DRAFT", { detail: { invoice_number: "D-1", payment_term: {} } }),
        inv("INV2-SENT", "SENT", { primary_recipients: [{ billing_info: { email_address: existing.email.toUpperCase(), business_name: "Not Used Ltd" } }] }),
        inv("INV2-PAID", "PAID", paidOn("2026-09-10", "2026-09-12")), // 11 days after the 1st
        inv("INV2-DETAIL", "PAID", { primary_recipients: undefined }), // detail read supplies recipient and payment
        inv("INV2-EUR", "SENT", { amount: { currency_code: "EUR", value: "10.00" } }),
        inv("INV2-ODD", "VOIDED_BY_PAYPAL"),
      ] },
      "2": { total_pages: 2, items: [
        inv("INV2-CANCEL", "CANCELLED", { primary_recipients: [person("ravi.nair@example.com", "Ravi", "Nair")] }),
        inv("INV2-PART", "PARTIALLY_PAID", { primary_recipients: [{ billing_info: { email_address: "noname@example.com" } }], ...paidOn("2026-09-03") }),
        inv("INV2-MARKED", "MARKED_AS_PAID", { primary_recipients: [person("MIKA.SATO@example.com", "Mika", "Sato")], ...paidOn("2026-09-05") }),
      ] },
    };
    const details: Record<string, Remote> = {
      "INV2-DETAIL": inv("INV2-DETAIL", "PAID", { primary_recipients: [{ billing_info: { email_address: "lena.fox@example.com", business_name: "Fox Studio" } }], ...paidOn("2026-09-20") }),
    };
    const read = async (path: string) => {
      calls.push(path);
      const list = /^\/v2\/invoicing\/invoices\?page=(\d+)&page_size=100&total_required=true$/.exec(path);
      if (list) return pages[list[1]];
      const one = /^\/v2\/invoicing\/invoices\/([^/?]+)$/.exec(path);
      if (one && details[one[1]]) return details[one[1]];
      throw new Error("Unexpected read " + path);
    };

    // Gate.
    delete process.env.PAYPAL_BALANCE_HOUSEHOLD_ID;
    const logged: string[] = [], realError = console.error;
    console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
    try {
      await assert.rejects(importPayPalHistory(db, designated, read), (e: Error) => e instanceof ImportSetupError && !/PAYPAL_BALANCE_HOUSEHOLD_ID/.test(e.message));
    } finally { console.error = realError; }
    assert.ok(logged.some(l => /PAYPAL_BALANCE_HOUSEHOLD_ID is not set/.test(l)));
    process.env.PAYPAL_BALANCE_HOUSEHOLD_ID = designated.toUpperCase();
    await assert.rejects(importPayPalHistory(db, other, read), ImportRefused);
    process.env.PAYPAL_BALANCE_HOUSEHOLD_ID = demo;
    await assert.rejects(importPayPalHistory(db, demo, read), ImportRefused);
    process.env.PAYPAL_BALANCE_HOUSEHOLD_ID = designated;
    assert.equal(calls.length, 0, "refused imports must not read PayPal");
    console.log("✓ Missing setting logged for the operator, not shown; other and demo households refused before any PayPal read");

    // Import.
    const paypalBefore = await paypalBalance(designated), before = await bank(designated), clientsBefore = (await db.select().from(s.clients).where(eq(s.clients.householdId, designated))).length;
    const result = await importPayPalHistory(db, designated, read);
    assert.deepEqual(result, { clients: 4, invoices: 7, skipped: 2 });
    assert.deepEqual(calls.filter(c => !c.includes("?")), ["/v2/invoicing/invoices/INV2-DETAIL"]);
    assert.equal(calls.filter(c => c.includes("?")).length, 2);
    const rows = await db.select().from(s.invoices).where(and(eq(s.invoices.householdId, designated)));
    const byId = new Map(rows.filter(r => r.paypalInvoiceId).map(r => [r.paypalInvoiceId!, r]));
    const clientNames = new Map((await db.select().from(s.clients).where(eq(s.clients.householdId, designated))).map(c => [c.id, c]));
    assert.equal(clientNames.size, clientsBefore + 4);
    const draft = byId.get("INV2-DRAFT")!;
    assert.deepEqual([draft.status, draft.sentOn, draft.dueOn, draft.paidOn, draft.amountMinor, draft.number, draft.paypalStatus], ["draft", null, null, null, 12050, "D-1", "DRAFT"]);
    const sent = byId.get("INV2-SENT")!;
    assert.deepEqual([sent.status, sent.sentOn, sent.dueOn, sent.paidOn, sent.clientId, sent.item], ["sent", "2026-09-01", "2026-09-15", null, existing.id, "N-INV2-SENT"]);
    const paid = byId.get("INV2-PAID")!;
    assert.deepEqual([paid.status, paid.paidOn, paid.paypalStatus], ["paid", "2026-09-12", "PAID"]);
    assert.equal(byId.get("INV2-DETAIL")!.paidOn, "2026-09-20");
    assert.equal(clientNames.get(byId.get("INV2-DETAIL")!.clientId)!.name, "Fox Studio");
    assert.equal(byId.get("INV2-CANCEL")!.status, "closed");
    assert.deepEqual([byId.get("INV2-PART")!.status, byId.get("INV2-PART")!.paidOn], ["sent", null]);
    assert.equal(byId.get("INV2-MARKED")!.status, "paid");
    assert.equal(byId.get("INV2-MARKED")!.clientId, paid.clientId, "email matches case-insensitively");
    const mika = clientNames.get(paid.clientId)!;
    assert.deepEqual([mika.name, mika.email, mika.termsDays], ["Mika Sato", "mika.sato@example.com", 0]); // created from the first invoice, a draft with no due date
    assert.equal([...clientNames.values()].find(c => c.email === "ravi.nair@example.com")!.termsDays, 14);
    assert.equal(clientNames.get(byId.get("INV2-PART")!.clientId)!.name, "noname", "no PayPal name: email local part");
    for (const id of ["INV2-EUR", "INV2-ODD"]) assert.ok(!byId.has(id));
    assert.equal(rows.filter(r => r.fxRateMicro === null && r.paypalInvoiceId).length, 7);
    assert.equal(clientNames.get(existing.id)!.name, existing.name, "existing client untouched");
    console.log("✓ Clients, statuses, dates and minor units imported; existing client matched by email; non-USD and unknown status skipped");

    const state = await loadMoneyState(db, designated, "2026-11-14");
    assert.deepEqual(state.clients.find(c => c.id === mika.id)!.daysToPay.toSorted((a, b) => b - a), [11, 4]);
    assert.deepEqual(state.clients.find(c => c.id === byId.get("INV2-DETAIL")!.clientId)!.daysToPay, [19]);
    assert.ok(state.invoices.some(i => i.id === sent.id && i.status === "sent"));
    assert.equal(await bank(designated), before);
    assert.equal(await paypalBalance(designated), paypalBefore, "PayPal balance comes only from PayPal's own balance report");
    console.log("✓ Days to pay derived from imported paid invoices; bank balance unchanged");

    const events = (await listEvents(db, designated)).filter(e => e.kind === "paypal_imported");
    assert.equal(events.length, 1);
    assert.equal(events[0].title, "Imported 7 invoices and 4 clients from PayPal");
    assert.equal(events[0].notify, false);

    // Re-run.
    const again = await importPayPalHistory(db, designated, read);
    assert.deepEqual(again, { clients: 0, invoices: 0, skipped: 2 });
    assert.equal((await db.select().from(s.invoices).where(eq(s.invoices.householdId, designated))).length, rows.length);
    assert.equal((await listEvents(db, designated)).filter(e => e.kind === "paypal_imported").length, 1);
    console.log("✓ Re-run adds nothing and records no second event");

    // An invoice another household already holds is skipped without leaving an orphan client.
    await db.insert(s.invoices).values({
      householdId: other, clientId: (await db.select().from(s.clients).where(eq(s.clients.householdId, other)))[0].id,
      status: "sent", item: "Theirs", amountMinor: 1000, currency: "USD", paypalInvoiceId: "INV2-THEIRS",
    });
    pages["2"] = { total_pages: 2, items: [inv("INV2-THEIRS", "SENT", { primary_recipients: [person("new.person@example.com", "New", "Person")] })] };
    const clientCount = async () => (await db.select().from(s.clients).where(eq(s.clients.householdId, designated))).length;
    const n = await clientCount();
    assert.deepEqual(await importPayPalHistory(db, designated, read), { clients: 0, invoices: 0, skipped: 3 });
    assert.equal(await clientCount(), n);
    console.log("✓ Another household's invoice is skipped, no orphan client");

    // A failed PayPal read changes nothing.
    await assert.rejects(importPayPalHistory(db, designated, async () => { throw new Error("down"); }));
    assert.equal(await clientCount(), n);
    console.log("✓ PayPal failure leaves data untouched");
  } finally { await pg.close(); }
}
test().catch(e => { console.error("Import tests failed", e instanceof Error ? e.stack : e); process.exitCode = 1; });

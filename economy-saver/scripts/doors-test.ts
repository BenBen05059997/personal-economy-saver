// Typed-in data doors: clients, bills, charges, and marking an invoice paid outside PayPal. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/doors-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { insertBill, billInput } from "@/db/bills";
import { insertCharge } from "@/db/charges";
import { clientInput, insertClient } from "@/db/clients";
import { markPaidOutside } from "@/db/invoice-paid";
import { confirmPending } from "@/db/confirm";
import { InputError } from "@/db/input-error";
import { parseAmountMinor } from "@/db/money";
import { seedBen } from "@/db/seed";

const TODAY = "2026-11-14";

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run(); passed++; console.log(`✓ ${name}`);
  }
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const first = async <T,>(rows: Promise<T[]>) => (await rows)[0];
    const memberA = (await first(db.select().from(schema.members).where(eq(schema.members.householdId, a)))).id;
    const memberB = (await first(db.select().from(schema.members).where(eq(schema.members.householdId, b)))).id;
    const cardsOf = (hid: string) => db.select().from(schema.cards).where(eq(schema.cards.householdId, hid)).orderBy(schema.cards.label);
    const [cardA, cardAB] = await cardsOf(a); // Card A closes on the 31st, Card B on the 15th
    const [cardOfB] = await cardsOf(b);
    const events = (hid: string, kind: string) => db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, kind)));
    const bank = async (hid: string) => (await first(db.select().from(schema.households).where(eq(schema.households.id, hid)))).bankBalanceMinor;
    const bill = (over: Partial<ReturnType<typeof billInput.parse>> = {}) =>
      billInput.parse({ id: randomUUID(), biller: "Fictional landlord", amount: "3800", due: "2026-11-25", category: "rent", ...over });
    const charge = (over: Record<string, unknown> = {}) =>
      ({ id: randomUUID(), cardId: cardA.id, merchant: "Fictional bakery", amount: "540", date: TODAY, ...over });

    await check("parseAmountMinor accepts plain numbers and rejects everything else", async () => {
      assert.equal(parseAmountMinor("3800", "JPY"), 3800);
      assert.equal(parseAmountMinor(" 3800 ", "JPY"), 3800);
      assert.equal(parseAmountMinor("12.5", "USD"), 1250);
      assert.equal(parseAmountMinor("12.05", "USD"), 1205);
      assert.equal(parseAmountMinor("12", "USD"), 1200);
      for (const bad of ["3800.5", "3800.", "0", "00", "-1", "+5", "1,000", "", "abc", "1e3", "0x10", "12 000", "9999999999999"]) {
        assert.throws(() => parseAmountMinor(bad, "JPY"), InputError, `JPY ${bad}`);
      }
      for (const bad of ["12.345", "0.00", "-0.5", "1,000.00", ".5", "12.", "9007199254740993"]) {
        assert.throws(() => parseAmountMinor(bad, "USD"), InputError, `USD ${bad}`);
      }
    });

    await check("insertClient adds a client once, records client_added, and is idempotent on id", async () => {
      const input = clientInput.parse({ id: randomUUID(), name: "Fictional Paper Co", email: "ap@paper.example", termsDays: "14" });
      assert.equal(await insertClient(db, a, input), input.id);
      assert.equal(await insertClient(db, a, input), input.id);
      const rows = await db.select().from(schema.clients).where(eq(schema.clients.id, input.id));
      assert.equal(rows.length, 1); assert.equal(rows[0].termsDays, 14); assert.equal(rows[0].householdId, a);
      assert.equal((await events(a, "client_added")).filter(e => e.refId === input.id).length, 1);
      await assert.rejects(insertClient(db, a, { ...input, name: "Different name" }), InputError);
      await assert.rejects(insertClient(db, b, input), "an id held by another household is refused");
      assert.equal((await db.select().from(schema.clients).where(eq(schema.clients.id, input.id)))[0].name, "Fictional Paper Co");
      assert.equal(clientInput.safeParse({ ...input, email: "not an email" }).success, false);
      assert.equal(clientInput.safeParse({ ...input, termsDays: -1 }).success, false);
      assert.equal(clientInput.safeParse({ ...input, termsDays: 121 }).success, false);
    });

    await check("insertBill confirmed stores home-currency minor units, records bill_added once, and is idempotent", async () => {
      const input = bill({ memberId: memberA });
      assert.equal(await insertBill(db, a, input, "confirmed"), input.id);
      assert.equal(await insertBill(db, a, input, "confirmed"), input.id);
      const rows = await db.select().from(schema.bills).where(eq(schema.bills.id, input.id));
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].amountMinor, rows[0].currency, rows[0].status, rows[0].memberId, rows[0].householdId], [3800, "JPY", "confirmed", memberA, a]);
      const added = (await events(a, "bill_added")).filter(e => e.refId === input.id);
      assert.equal(added.length, 1);
      assert.deepEqual([added[0].title, added[0].amountMinor, added[0].currency, added[0].refType, added[0].notify], ["Fictional landlord added", 3800, "JPY", "bill", false]);
      await assert.rejects(insertBill(db, a, { ...input, amount: "3801" }, "confirmed"), InputError);
      await assert.rejects(insertBill(db, a, { ...input, due: "2026-11-26" }, "confirmed"), InputError);
      await assert.rejects(insertBill(db, a, { ...input, memberId: null }, "confirmed"), InputError);
      await assert.rejects(insertBill(db, b, input, "confirmed"), "an id held by another household is refused");
      const shared = bill();
      await insertBill(db, a, shared, "confirmed");
      assert.equal((await first(db.select().from(schema.bills).where(eq(schema.bills.id, shared.id)))).memberId, null);
    });

    await check("insertBill pending waits in To check with a notified to_check event and no runway observation", async () => {
      await db.update(schema.households).set({ runwayShort: false, notificationDay: null }).where(eq(schema.households.id, a));
      const before = (await events(a, "runway_short")).length;
      const input = bill({ biller: "Fictional agent bill", amount: "999999" });
      await insertBill(db, a, input, "pending");
      await insertBill(db, a, input, "pending");
      const row = await first(db.select().from(schema.bills).where(eq(schema.bills.id, input.id)));
      assert.equal(row.status, "pending");
      const checks = (await events(a, "to_check")).filter(e => e.refId === input.id);
      assert.equal(checks.length, 1); assert.equal(checks[0].notify, true); assert.equal(checks[0].refType, "bill");
      assert.equal((await events(a, "bill_added")).filter(e => e.refId === input.id).length, 0);
      assert.equal((await events(a, "runway_short")).length, before);
      assert.equal((await first(db.select().from(schema.households).where(eq(schema.households.id, a)))).runwayShort, false);
      assert.equal(await confirmPending(db, a, "bill", input.id), true);
      assert.equal((await events(a, "runway_short")).length, before + 1);
    });

    await check("a confirmed bill that creates a shortfall flips the runway once", async () => {
      await db.update(schema.households).set({ runwayShort: false }).where(eq(schema.households.id, b));
      const before = (await events(b, "runway_short")).length;
      await insertBill(db, b, bill({ biller: "Fictional big bill", amount: "900000" }), "confirmed");
      assert.equal((await events(b, "runway_short")).length, before + 1);
      assert.equal((await first(db.select().from(schema.households).where(eq(schema.households.id, b)))).runwayShort, true);
      await insertBill(db, b, bill({ biller: "Fictional second bill", amount: "100" }), "confirmed");
      assert.equal((await events(b, "runway_short")).length, before + 1);
    });

    await check("insertBill rejects bad amounts and a member of another household", async () => {
      for (const amount of ["3800.5", "0", "-1", "1,000", "", "abc"]) {
        const input = bill({ amount });
        await assert.rejects(insertBill(db, a, input, "confirmed"), InputError, amount);
        assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, input.id))).length, 0);
      }
      const foreign = bill({ memberId: memberB });
      await assert.rejects(insertBill(db, a, foreign, "confirmed"), InputError);
      await assert.rejects(insertBill(db, a, foreign, "pending"), InputError);
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, foreign.id))).length, 0);
      assert.equal(billInput.safeParse({ ...bill(), due: "tomorrow" }).success, false);
      assert.equal(billInput.safeParse({ ...bill(), biller: "  " }).success, false);
    });

    await check("insertCharge confirmed stores the card's currency, records charge_added once, and is idempotent", async () => {
      const input = charge({ cardId: cardAB.id });
      assert.equal(await insertCharge(db, a, input as never, "confirmed", "manual"), input.id);
      assert.equal(await insertCharge(db, a, input as never, "confirmed", "manual"), input.id);
      const rows = await db.select().from(schema.charges).where(eq(schema.charges.id, input.id));
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].amountMinor, rows[0].currency, rows[0].status, rows[0].source, rows[0].householdId], [540, "JPY", "confirmed", "manual", a]);
      const added = (await events(a, "charge_added")).filter(e => e.refId === input.id);
      assert.equal(added.length, 1); assert.equal(added[0].title, "Fictional bakery added"); assert.equal(added[0].notify, false);
      await assert.rejects(insertCharge(db, a, { ...input, amount: "541" } as never, "confirmed", "manual"), InputError);
      await assert.rejects(insertCharge(db, a, { ...input, merchant: "Other" } as never, "confirmed", "manual"), InputError);
      await assert.rejects(insertCharge(db, a, { ...input, cardId: cardA.id } as never, "confirmed", "manual"), InputError);
      await assert.rejects(insertCharge(db, b, input as never, "confirmed", "manual"), "an id held by another household is refused");
    });

    await check("insertCharge pending is a notified to_check row with the given source, then confirms through confirmPending", async () => {
      await db.update(schema.households).set({ notificationDay: null }).where(eq(schema.households.id, a)); // one notification per day
      const input = charge({ merchant: "Fictional voice charge", amount: "1200" });
      await insertCharge(db, a, input as never, "pending", "voice");
      await insertCharge(db, a, input as never, "pending", "voice");
      const row = await first(db.select().from(schema.charges).where(eq(schema.charges.id, input.id)));
      assert.deepEqual([row.status, row.source], ["pending", "voice"]);
      const checks = (await events(a, "to_check")).filter(e => e.refId === input.id);
      assert.equal(checks.length, 1); assert.equal(checks[0].notify, true); assert.equal(checks[0].refType, "charge");
      assert.equal((await events(a, "charge_added")).filter(e => e.refId === input.id).length, 0);
      assert.equal(await confirmPending(db, a, "charge", input.id), true);
    });

    await check("insertCharge refuses a card of another household, a currency mismatch and bad amounts", async () => {
      const foreign = charge({ cardId: cardOfB.id });
      await assert.rejects(insertCharge(db, a, foreign as never, "confirmed", "manual"), InputError);
      await assert.rejects(insertCharge(db, a, foreign as never, "pending", "voice"), InputError);
      assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, foreign.id))).length, 0);
      const [usdCard] = await db.insert(schema.cards).values({ householdId: a, label: "Fictional USD card", closingDay: 10, dueDay: 5, currency: "USD" }).returning();
      const mismatch = charge({ cardId: usdCard.id, amount: "12.50" });
      await assert.rejects(insertCharge(db, a, mismatch as never, "confirmed", "manual"), InputError);
      assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, mismatch.id))).length, 0);
      for (const amount of ["540.5", "0", "-1", "1,000", ""]) {
        const bad = charge({ amount });
        await assert.rejects(insertCharge(db, a, bad as never, "confirmed", "manual"), InputError, amount);
        assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, bad.id))).length, 0);
      }
      await assert.rejects(insertCharge(db, a, charge({ date: "11/14" }) as never, "confirmed", "manual"));
    });

    await check("a confirmed charge in a closed cycle updates its statement exactly once; a pending one does not", async () => {
      const statement = () => first(db.select().from(schema.cardStatements).where(and(eq(schema.cardStatements.householdId, a),
        eq(schema.cardStatements.cardId, cardA.id), eq(schema.cardStatements.closedOn, "2026-10-31"))));
      const before = (await statement()).amountMinor;
      const pending = charge({ merchant: "Fictional October pending", amount: "700", date: "2026-10-30" });
      await insertCharge(db, a, pending as never, "pending", "manual");
      assert.equal((await statement()).amountMinor, before);
      const input = charge({ merchant: "Fictional October charge", amount: "2500", date: "2026-10-30" });
      await insertCharge(db, a, input as never, "confirmed", "manual");
      await insertCharge(db, a, input as never, "confirmed", "manual");
      assert.equal((await statement()).amountMinor, before + 2500);
      assert.equal(await confirmPending(db, a, "charge", pending.id), true);
      assert.equal((await statement()).amountMinor, before + 3200);
    });

    await check("markPaidOutside credits the bank once, at the latest rate, and keeps sent_on", async () => {
      const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.householdId, a));
      const beacon = invoices.find(i => i.status === "unbilled")!, acme = invoices.find(i => i.number === "1042")!;
      const start = await bank(a);
      assert.equal(await markPaidOutside(db, a, beacon.id, TODAY), true);
      assert.equal(await bank(a), start + 400 * 150);
      assert.equal(await markPaidOutside(db, a, beacon.id, TODAY), false);
      assert.equal(await bank(a), start + 400 * 150);
      const paid = await first(db.select().from(schema.invoices).where(eq(schema.invoices.id, beacon.id)));
      assert.deepEqual([paid.status, paid.paidOn, paid.fxRateMicro, paid.sentOn, paid.paypalInvoiceId], ["paid", TODAY, 150_000_000, null, null]);
      const logged = (await events(a, "invoice_paid_outside")).filter(e => e.refId === beacon.id);
      assert.equal(logged.length, 1);
      assert.deepEqual([logged[0].notify, logged[0].title, logged[0].amountMinor, logged[0].currency], [false, "Beacon Studio marked paid outside PayPal", 40_000, "USD"]);
      assert.equal(await markPaidOutside(db, a, acme.id, TODAY), true);
      assert.equal(await bank(a), start + (400 + 1200) * 150);
      assert.equal((await first(db.select().from(schema.invoices).where(eq(schema.invoices.id, acme.id)))).sentOn, "2026-11-08");
    });

    await check("markPaidOutside refuses a PayPal-sent invoice, another household's invoice and a closed one", async () => {
      const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.householdId, b));
      const sent = invoices.find(i => i.number === "1038")!;
      await db.update(schema.invoices).set({ paypalInvoiceId: "FICTIONAL-INV2-0001" }).where(eq(schema.invoices.id, sent.id));
      const start = await bank(b);
      await assert.rejects(markPaidOutside(db, b, sent.id, TODAY), InputError);
      assert.equal(await markPaidOutside(db, a, sent.id, TODAY), false);
      assert.equal(await markPaidOutside(db, b, randomUUID(), TODAY), false);
      const after = await first(db.select().from(schema.invoices).where(eq(schema.invoices.id, sent.id)));
      assert.deepEqual([after.status, after.paidOn], ["sent", null]);
      assert.equal(await bank(b), start);
      assert.equal((await events(b, "invoice_paid_outside")).length, 0);
      const closed = invoices.find(i => i.number === "1042")!;
      await db.update(schema.invoices).set({ status: "closed" }).where(eq(schema.invoices.id, closed.id));
      assert.equal(await markPaidOutside(db, b, closed.id, TODAY), false);
      assert.equal(await bank(b), start);
      await assert.rejects(markPaidOutside(db, b, sent.id, "yesterday"));
    });

    await check("every new function throws without a household id", async () => {
      for (const bad of ["", "not-a-uuid", null, undefined] as never[]) {
        await assert.rejects(insertClient(db, bad, clientInput.parse({ id: randomUUID(), name: "X", email: "x@x.example", termsDays: 0 })), /household id is required/);
        await assert.rejects(insertBill(db, bad, bill(), "confirmed"), /household id is required/);
        await assert.rejects(insertCharge(db, bad, charge() as never, "pending", "manual"), /household id is required/);
        await assert.rejects(markPaidOutside(db, bad, randomUUID(), TODAY), /household id is required/);
      }
    });

    console.log(`${passed}/${passed} typed-in data checks passed.`);
  } finally {
    await pg.close();
  }
}
main().catch(error => { console.error("Typed-in data verification failed:", error instanceof Error ? error.message : error); process.exitCode = 1; });

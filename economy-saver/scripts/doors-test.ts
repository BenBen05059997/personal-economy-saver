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
import { bankBalanceInput, setBankBalance } from "@/db/bank-balance";
import { insertCharge } from "@/db/charges";
import { clientInput, insertClient } from "@/db/clients";
import { markPaidOutside } from "@/db/invoice-paid";
import { confirmPending } from "@/db/confirm";
import { InputError } from "@/db/input-error";
import { parseAmountMinor } from "@/db/money";
import { seedBen } from "@/db/seed";
import { loadMoneyState } from "@/db/household";
import { occurrenceDates } from "@/lib/money/repeat";
import { loadNavigationData } from "@/db/workspace";
import { toCheck } from "@/lib/money/to-check";
import { addDays, low, planWindow, roomOnCard, safeToSpend, series } from "@/lib/money/runway";

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

    // ---- monthly bills (D41). Ben is seeded with CloudBox (18th), phone (20th) and rent (27th) repeating; today is Nov 14,
    // the plan window is 43 days (Card A's later statement), so it ends on Dec 26.
    const billsOf = async (hid: string, today: string, biller: string) =>
      (await loadMoneyState(db, hid, today)).bills.filter(row => row.biller === biller);
    const stored = async (id: string) => (await first(db.select().from(schema.bills).where(eq(schema.bills.id, id)))).repeatDay;

    await check("a monthly bill expands inside 30 days and past it up to the end of the plan window", async () => {
      const fresh = await seedBen(db, { isDemo: true });
      const state = await loadMoneyState(db, fresh, TODAY);
      const end = addDays(TODAY, planWindow(state) - 1);
      assert.equal(end, "2026-12-26");
      const dates = async (biller: string) => (await billsOf(fresh, TODAY, biller)).map(row => row.due);
      assert.deepEqual(await dates("CloudBox Plus"), ["2026-11-18", "2026-12-18"], "Dec 18 is past 30 days, inside the window");
      assert.deepEqual(await dates("Mobaile Tsushin"), ["2026-11-20", "2026-12-20"]);
      assert.deepEqual(await dates("Rent"), ["2026-11-27"], "Dec 27 is past the window");
      assert.deepEqual(await dates("Hikari Denki"), ["2026-11-27"], "a one-off stays one");
      const cloudbox = await billsOf(fresh, TODAY, "CloudBox Plus");
      const original = (await first(db.select().from(schema.bills).where(and(eq(schema.bills.householdId, fresh), eq(schema.bills.biller, "CloudBox Plus"))))).id;
      assert.deepEqual(cloudbox.map(row => row.id), [`${original}@2026-11-18`, `${original}@2026-12-18`]);
      assert.ok(cloudbox.every(row => row.repeatDay === 18 && row.amount === 1980 && row.status === "confirmed"));
      assert.equal(new Set(state.bills.map(row => row.id)).size, state.bills.length, "occurrence ids are unique");
      assert.equal((await billsOf(fresh, TODAY, "Hikari Denki"))[0].repeatDay, undefined);
      assert.ok(state.bills.every(row => row.due >= TODAY && row.due <= end));
    });

    await check("a day past the month's end clamps to its last day", async () => {
      assert.deepEqual(occurrenceDates("2027-01-31", 31, "2027-01-20", "2027-04-30"), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
      assert.deepEqual(occurrenceDates("2028-01-31", 31, "2028-01-20", "2028-03-31"), ["2028-01-31", "2028-02-29", "2028-03-31"]);
      assert.deepEqual(occurrenceDates("2026-11-30", 30, "2026-11-01", "2027-03-01"), ["2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28"]);
      const hid = await seedBen(db, { isDemo: true });
      const input = bill({ biller: "Fictional month-end plan", due: "2027-01-31", monthly: true });
      await insertBill(db, hid, input, "confirmed");
      assert.equal(await stored(input.id), 31);
      assert.deepEqual((await billsOf(hid, "2027-01-27", "Fictional month-end plan")).map(row => row.due), ["2027-01-31", "2027-02-28"]);
    });

    await check("an occurrence that has passed drops out and the next one remains", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const dates = async (today: string) => (await billsOf(hid, today, "CloudBox Plus")).map(row => row.due);
      assert.deepEqual(await dates("2026-11-18"), ["2026-11-18", "2026-12-18"], "due today still counts");
      assert.deepEqual(await dates("2026-11-19"), ["2026-12-18"]);
      assert.deepEqual(await dates("2026-12-19"), ["2027-01-18"], "stored due date is long gone, the cycle goes on");
    });

    await check("a pending monthly bill never expands; confirming it keeps the repeat day and expands it", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const input = bill({ biller: "Fictional pending plan", due: "2026-11-25", monthly: true });
      await insertBill(db, hid, input, "pending");
      assert.equal(await stored(input.id), 25);
      const pending = await billsOf(hid, TODAY, "Fictional pending plan");
      assert.deepEqual(pending.map(row => [row.id, row.status, row.repeatDay]), [[input.id, "pending", 25]]);
      assert.equal(await confirmPending(db, hid, "bill", input.id), true);
      assert.equal(await stored(input.id), 25);
      const confirmed = await billsOf(hid, TODAY, "Fictional pending plan");
      assert.deepEqual(confirmed.map(row => [row.id, row.due, row.status]), [
        [`${input.id}@2026-11-25`, "2026-11-25", "confirmed"], [`${input.id}@2026-12-25`, "2026-12-25", "confirmed"]]);
    });

    await check("the form path and the agent's pending path both store the due date's day; unchecked stores a one-off", async () => {
      const form = billInput.parse({ id: randomUUID(), biller: "Fictional form plan", amount: "900", due: "2026-11-09", category: "subscriptions", monthly: true });
      await insertBill(db, a, form, "confirmed");
      assert.equal(await stored(form.id), 9);
      const agent = billInput.parse({ id: randomUUID(), biller: "Fictional agent plan", amount: "900", due: "2026-11-30", category: "subscriptions", monthly: true });
      await insertBill(db, a, agent, "pending");
      assert.equal(await stored(agent.id), 30);
      const once = bill({ biller: "Fictional once" });
      await insertBill(db, a, once, "confirmed");
      assert.equal(await stored(once.id), null);
      assert.equal(billInput.parse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-09", category: "x" }).monthly, false, "monthly defaults to off");
      await assert.rejects(insertBill(db, a, { ...form, monthly: false }, "confirmed"), InputError, "the same id with a different repeat is refused");
      assert.equal(await insertBill(db, a, form, "confirmed"), form.id);
      await assert.rejects(db.insert(schema.bills).values({ householdId: a, biller: "Bad", amountMinor: 1, currency: "JPY", due: "2026-11-20", category: "x", repeatDay: 32 }));
      await assert.rejects(db.insert(schema.bills).values({ householdId: a, biller: "Bad", amountMinor: 1, currency: "JPY", due: "2026-11-20", category: "x", repeatDay: 0 }));
    });

    await check("another household's monthly bill never appears", async () => {
      const mine = await seedBen(db, { isDemo: true }), theirs = await seedBen(db, { isDemo: true });
      await insertBill(db, theirs, bill({ biller: "Fictional neighbour plan", due: "2026-11-21", monthly: true }), "confirmed");
      assert.equal((await billsOf(theirs, TODAY, "Fictional neighbour plan")).length, 2);
      assert.equal((await billsOf(mine, TODAY, "Fictional neighbour plan")).length, 0);
      assert.equal((await loadMoneyState(db, mine, TODAY)).bills.length, (await loadMoneyState(db, mine, TODAY)).bills.filter(row => row.biller !== "Fictional neighbour plan").length);
    });

    await check("card room and safe to spend count a repeating subscription that falls inside the window", async () => {
      const base = await seedBen(db, { isDemo: true }), repeating = await seedBen(db, { isDemo: true }), once = await seedBen(db, { isDemo: true });
      await insertBill(db, repeating, bill({ biller: "Fictional streaming", amount: "5000", due: "2026-11-16", monthly: true }), "confirmed");
      await insertBill(db, once, bill({ biller: "Fictional streaming", amount: "5000", due: "2026-11-16" }), "confirmed");
      const [stateBase, stateRepeating, stateOnce] = await Promise.all([base, repeating, once].map(hid => loadMoneyState(db, hid, TODAY)));
      const roomOf = (state: typeof stateBase, label: string) => roomOnCard(state, state.cards.find(card => card.label === label)!.id).room;
      for (const label of ["Card A", "Card B"]) {
        assert.equal(roomOf(stateBase, label) - roomOf(stateOnce, label), 5000, `${label}: one bill`);
        assert.equal(roomOf(stateBase, label) - roomOf(stateRepeating, label), 10000, `${label}: Dec 16 is past 30 days but inside the window`);
      }
      const lowOf = (state: typeof stateBase) => low(series(state, "worst"));
      assert.equal(lowOf(stateBase).amount - lowOf(stateRepeating).amount, 5000, "the 30-day low sees only the first occurrence");
      assert.equal(safeToSpend(stateBase, 0).shortBy + 5000, safeToSpend(stateRepeating, 0).shortBy);
      assert.equal(series(stateRepeating, "worst").length, 30);
    });

    const balanceRows = (hid: string) => db.select().from(schema.balanceUpdates).where(eq(schema.balanceUpdates.householdId, hid));
    const bankEvents = (hid: string) => events(hid, "bank_balance");
    const stateOf = (hid: string) => loadMoneyState(db, hid, TODAY);

    await check("setBankBalance confirmed writes the balance, records old and new, and is idempotent on id", async () => {
      const old = await bank(a);
      const input = bankBalanceInput.parse({ id: randomUUID(), amount: "182000" });
      assert.equal(await setBankBalance(db, a, input, "confirmed"), input.id);
      assert.equal(await bank(a), 182_000);
      const [event] = (await bankEvents(a)).filter(e => e.refId === input.id);
      assert.deepEqual([event.title, event.amountMinor, event.currency, event.refType, event.notify],
        [`Bank balance set to ¥182,000 (was ¥${old.toLocaleString("en-US")})`, 182_000, "JPY", "balance_update", false]);
      await db.update(schema.households).set({ bankBalanceMinor: 5 }).where(eq(schema.households.id, a));
      assert.equal(await setBankBalance(db, a, input, "confirmed"), input.id);
      assert.equal(await bank(a), 5, "the same id never applies twice");
      assert.equal((await bankEvents(a)).filter(e => e.refId === input.id).length, 1);
      await assert.rejects(setBankBalance(db, a, { ...input, amount: "182001" }, "confirmed"), InputError);
      await assert.rejects(setBankBalance(db, b, input, "confirmed"), "an id held by another household is refused");
      assert.equal((await balanceRows(a)).filter(r => r.id === input.id).length, 1);
      const zero = bankBalanceInput.parse({ id: randomUUID(), amount: "0" });
      await setBankBalance(db, a, zero, "confirmed");
      assert.equal(await bank(a), 0);
      await setBankBalance(db, a, { id: randomUUID(), amount: "-1200" }, "confirmed");
      assert.equal(await bank(a), -1200, "an overdrawn balance is allowed, as in Settings");
      for (const bad of ["", "abc", "1,000", "12.5", "1e3"]) await assert.rejects(setBankBalance(db, a, { id: randomUUID(), amount: bad }, "confirmed"), InputError, bad);
      assert.equal(bankBalanceInput.safeParse({ id: "not-a-uuid", amount: "1" }).success, false);
    });

    await check("setBankBalance with an unchanged value records no event; a confirmed write can flip the runway sentence", async () => {
      await db.update(schema.households).set({ bankBalanceMinor: 67_000, runwayShort: false }).where(eq(schema.households.id, a));
      const before = (await bankEvents(a)).length, flips = (await events(a, "runway_short")).length;
      await setBankBalance(db, a, { id: randomUUID(), amount: "67000" }, "confirmed");
      assert.equal((await bankEvents(a)).length, before);
      await setBankBalance(db, a, { id: randomUUID(), amount: "-900000" }, "confirmed");
      assert.equal((await events(a, "runway_short")).length, flips + 1);
      assert.equal((await first(db.select().from(schema.households).where(eq(schema.households.id, a)))).runwayShort, true);
    });

    await check("setBankBalance pending leaves the balance alone, shows in To check, and confirmPending applies it once", async () => {
      await db.update(schema.households).set({ bankBalanceMinor: 150_000, runwayShort: false, notificationDay: null }).where(eq(schema.households.id, a));
      const input = bankBalanceInput.parse({ id: randomUUID(), amount: "182000" });
      const navBefore = (await loadNavigationData(db, a)).pending;
      await setBankBalance(db, a, input, "pending");
      await setBankBalance(db, a, input, "pending");
      assert.equal(await bank(a), 150_000);
      assert.equal((await loadNavigationData(db, a)).pending, navBefore + 1, "the To check count in the navigation includes it");
      assert.equal((await bankEvents(a)).filter(e => e.refId === input.id).length, 0);
      const checks = (await events(a, "to_check")).filter(e => e.refId === input.id);
      assert.equal(checks.length, 1); assert.equal(checks[0].notify, true); assert.equal(checks[0].refType, "balance_update");
      await assert.rejects(setBankBalance(db, a, { ...input, amount: "1" }, "pending"), InputError);
      const rows = toCheck(await stateOf(a)).filter(r => r.kind === "balance");
      assert.deepEqual(rows.map(r => [r.id, r.title, r.detail, r.amount]), [[input.id, "Bank balance → ¥182,000", "now ¥150,000", null]]);
      assert.equal(await confirmPending(db, a, "balance", input.id), true);
      assert.equal(await bank(a), 182_000);
      const [event] = (await bankEvents(a)).filter(e => e.refId === input.id);
      assert.equal(event.title, "Bank balance set to ¥182,000 (was ¥150,000)");
      assert.equal((await balanceRows(a)).find(r => r.id === input.id)!.status, "confirmed");
      await db.update(schema.households).set({ bankBalanceMinor: 7 }).where(eq(schema.households.id, a));
      assert.equal(await confirmPending(db, a, "balance", input.id), false, "confirming twice does nothing");
      assert.equal(await bank(a), 7);
      assert.equal((await bankEvents(a)).filter(e => e.refId === input.id).length, 1);
      assert.equal(toCheck(await stateOf(a)).some(r => r.kind === "balance"), false);
    });

    await check("another household's pending balance update cannot be confirmed or seen", async () => {
      const input = bankBalanceInput.parse({ id: randomUUID(), amount: "555555" });
      await setBankBalance(db, a, input, "pending");
      const bankB = await bank(b);
      assert.equal(await confirmPending(db, b, "balance", input.id), false);
      assert.equal(await bank(b), bankB);
      assert.equal(await bank(a) === 555_555, false);
      assert.equal(toCheck(await stateOf(b)).some(r => r.kind === "balance"), false);
      assert.equal((await balanceRows(b)).some(r => r.id === input.id), false);
      assert.equal(toCheck(await stateOf(a)).filter(r => r.kind === "balance").length, 1);
      assert.equal(await confirmPending(db, a, "balance", randomUUID()), false);
    });

    await check("every new function throws without a household id", async () => {
      for (const bad of ["", "not-a-uuid", null, undefined] as never[]) {
        await assert.rejects(insertClient(db, bad, clientInput.parse({ id: randomUUID(), name: "X", email: "x@x.example", termsDays: 0 })), /household id is required/);
        await assert.rejects(insertBill(db, bad, bill(), "confirmed"), /household id is required/);
        await assert.rejects(insertCharge(db, bad, charge() as never, "pending", "manual"), /household id is required/);
        await assert.rejects(markPaidOutside(db, bad, randomUUID(), TODAY), /household id is required/);
        await assert.rejects(setBankBalance(db, bad, { id: randomUUID(), amount: "1" }, "confirmed"), /household id is required/);
        await assert.rejects(confirmPending(db, bad, "balance", randomUUID()), /household id is required/);
      }
    });

    console.log(`${passed}/${passed} typed-in data checks passed.`);
  } finally {
    await pg.close();
  }
}
main().catch(error => { console.error("Typed-in data verification failed:", error instanceof Error ? error.message : error); process.exitCode = 1; });

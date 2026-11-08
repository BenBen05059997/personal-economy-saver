// Typed-in data doors: clients, bills, charges, and marking an invoice paid outside PayPal. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/doors-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { createHousehold, householdDate, setupForm } from "@/db/account";
import { tryItKind } from "@/db/demo";
import { insertBill, billInput, removeBill, updateBill, billEditInput } from "@/db/bills";
import { bankBalanceInput, setBankBalance } from "@/db/bank-balance";
import { insertCharge, removeCharge } from "@/db/charges";
import { clientInput, insertClient } from "@/db/clients";
import { markPaidOutside } from "@/db/invoice-paid";
import { confirmPending } from "@/db/confirm";
import { InputError } from "@/db/input-error";
import { parseAmountMinor, parseMinor } from "@/db/money";
import { amountProblem } from "@/lib/money/amount";
import { returnPath } from "@/lib/door";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { rulesFor } from "@/db/rules";
import { seedBen } from "@/db/seed";
import { loadMoneyState } from "@/db/household";
import { cancelNotices, expandBills, lastOneWords, lastPayment, nextOccurrenceAfter, occurrenceDates } from "@/lib/money/repeat";
import { loadNavigationData } from "@/db/workspace";
import { draftedLabel, toCheck } from "@/lib/money/to-check";
import { clientPace, paceLine } from "@/lib/money/pace";
import { publicEvent } from "@/db/event-feed";
import { loadSettings, settingsInput, updateSettings } from "@/db/settings";
import { homeSentence } from "@/lib/money/sentence";
/** The two strings a sentence is made of (its other parts are tested in pots-test). */
const lines = (sentence: ReturnType<typeof homeSentence>) => ({ lead: sentence.lead, emphasis: sentence.emphasis });
import { addDays, low, medianLow, planWindow, roomOnCard, safeToSpend, series } from "@/lib/money/runway";
import { cardSummary } from "@/components/home/card-summary";
import { EVENT_KIND_LABELS, eventKindLabel } from "@/lib/money/event-kinds";

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
    const events = (hid: string, kind: string) => db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, kind))).orderBy(schema.events.createdAt, schema.events.id);
    const bank = async (hid: string) => (await first(db.select().from(schema.households).where(eq(schema.households.id, hid)))).bankBalanceMinor;
    const bill = (over: Partial<ReturnType<typeof billInput.parse>> = {}) =>
      billInput.parse({ id: randomUUID(), biller: "Fictional landlord", amount: "3800", due: "2026-11-25", category: "housing", ...over });
    const charge = (over: Record<string, unknown> = {}) =>
      ({ id: randomUUID(), cardId: cardA.id, merchant: "Fictional bakery", amount: "540", date: TODAY, category: "food", ...over });

    await check("parseAmountMinor accepts plain numbers, thousands separators and full-width digits, and rejects everything else", async () => {
      assert.equal(parseAmountMinor("3800", "JPY"), 3800);
      assert.equal(parseAmountMinor(" 3800 ", "JPY"), 3800);
      assert.equal(parseAmountMinor("1,000", "JPY"), 1000);
      assert.equal(parseAmountMinor("12,345,678", "JPY"), 12_345_678);
      assert.equal(parseAmountMinor("１，０００", "JPY"), 1000, "full-width digits and comma, by NFKC");
      assert.equal(parseAmountMinor("12.5", "USD"), 1250);
      assert.equal(parseAmountMinor("12.05", "USD"), 1205);
      assert.equal(parseAmountMinor("12", "USD"), 1200);
      assert.equal(parseAmountMinor("1,000.50", "USD"), 100_050);
      assert.equal(parseMinor("-1,234", "JPY"), -1234);
      for (const bad of ["3800.5", "3800.", "0", "00", "-1", "+5", "1,00", "1,0000", ",100", "1,000,", "", "abc", "1e3", "0x10", "12 000", "9999999999999"]) {
        assert.throws(() => parseAmountMinor(bad, "JPY"), InputError, `JPY ${bad}`);
      }
      for (const bad of ["12.345", "0.00", "-0.5", "1,00.00", ".5", "12.", "9007199254740993"]) {
        assert.throws(() => parseAmountMinor(bad, "USD"), InputError, `USD ${bad}`);
      }
    });

    await check("amounts above ¥100,000,000 or $1,000,000 are refused with the limit in the message; the limit itself is fine", async () => {
      assert.equal(parseAmountMinor("100,000,000", "JPY"), 100_000_000);
      assert.equal(parseAmountMinor("1,000,000", "USD"), 100_000_000);
      assert.equal(parseMinor("-100000000", "JPY"), -100_000_000);
      assert.throws(() => parseAmountMinor("100000001", "JPY"), (e: unknown) => e instanceof InputError && e.message === "Enter an amount up to ¥100,000,000");
      assert.throws(() => parseAmountMinor("1000000.01", "USD"), (e: unknown) => e instanceof InputError && e.message === "Enter an amount up to $1,000,000");
      assert.throws(() => parseMinor("-100000001", "JPY"), InputError);
      assert.equal(amountProblem("1,000.50", "USD"), "");
      assert.equal(amountProblem("１，０００", "JPY"), "");
      assert.equal(amountProblem("-5", "JPY"), "Enter an amount without a minus sign");
      assert.equal(amountProblem("-5", "JPY", true), "");
      assert.equal(amountProblem("2e5", "JPY"), "Enter a whole number of yen, like 5000 or 5,000");
      for (const text of ["12,000円", "¥12,000", "￥ 12000", "12000 yen", "JPY 12,000", "12,000 jpy", "円12000"]) assert.equal(parseAmountMinor(text, "JPY"), 12_000, text);
      for (const text of ["$400.50", "400.50 USD", "usd 400.50", "400.50$"]) assert.equal(parseAmountMinor(text, "USD"), 40_050, text);
      assert.equal(parseMinor("-¥500", "JPY"), -500);
      assert.match(amountProblem("$400", "JPY"), /in dollars|in yen/);
      assert.match(amountProblem("12,000円", "USD"), /in dollars/);
      assert.equal(amountProblem("¥100,000,001", "JPY"), "Enter an amount up to ¥100,000,000");
      for (const [kind, run] of [
        ["bill", () => insertBill(db, a, bill({ amount: "100,000,001" }), "confirmed", { madeBy: "form" })],
        ["charge", () => insertCharge(db, a, charge({ amount: "100000001" }) as never, "confirmed", "manual", { madeBy: "form" })],
        ["bank balance", () => setBankBalance(db, a, bankBalanceInput.parse({ id: randomUUID(), amount: "100000001" }), "confirmed", { madeBy: "form" })],
      ] as const) await assert.rejects(run(), (e: unknown) => e instanceof InputError && /up to ¥100,000,000/.test(e.message), kind);
    });

    await check("a bill or charge dated more than two years after the household's today is refused; two years to the day is fine", async () => {
      assert.equal(latestDate("2026-11-14"), "2028-11-14");
      assert.equal(latestDate("2028-02-29"), "2030-02-28");
      const far = bill({ due: "2028-11-15" }), edge = bill({ due: "2028-11-14", biller: "Fictional far bill", amount: "777" });
      await assert.rejects(insertBill(db, a, far, "confirmed", { madeBy: "form" }), (e: unknown) => e instanceof InputError && e.message === "Choose a date within the next two years");
      await assert.rejects(insertBill(db, a, far, "pending", { madeBy: "form" }), InputError);
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, far.id))).length, 0);
      const farCharge = charge({ date: "2028-11-15" });
      await assert.rejects(insertCharge(db, a, farCharge as never, "confirmed", "manual", { madeBy: "form" }), (e: unknown) => e instanceof InputError && e.message === "Choose a date within the next two years");
      assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, farCharge.id))).length, 0);
      await insertBill(db, a, edge, "confirmed", { madeBy: "form" });
      const added = (await events(a, "bill_added")).find(e => e.refId === edge.id)!;
      assert.equal(added.title, "Fictional far bill added, due Nov 14, 2028", "the Activity line names the due date, with the year when it is not this year");
      await db.delete(schema.bills).where(eq(schema.bills.id, edge.id));
    });

    await check("a blank household reads the empty sentence, then the normal one after its first confirmed bill (D47)", async () => {
      const blank = await createHousehold(db, randomUUID(), setupForm.parse({ name: "Fictional newcomer", currency: "USD", timeZone: "Asia/Tokyo", bank: "1,200", card: "Card D", limit: "", closingDay: "20", dueDay: "10" }), { isDemo: true });
      const empty = { lead: "Add your rent, your bills and the clients who pay you to see your next 30 days.", emphasis: "Bank balance $1,200." };
      assert.deepEqual(lines(homeSentence(await loadMoneyState(db, blank, TODAY))), empty);
      await insertClient(db, blank, clientInput.parse({ id: randomUUID(), name: "Fictional Paper Co", email: "ap@paper.example", termsDays: "14" }));
      assert.deepEqual(lines(homeSentence(await loadMoneyState(db, blank, TODAY))), empty, "a client alone is nothing to forecast");
      const rent = bill({ biller: "Fictional rent", amount: "300", due: "2026-11-20" });
      await insertBill(db, blank, rent, "pending", { madeBy: "form" });
      assert.deepEqual(lines(homeSentence(await loadMoneyState(db, blank, TODAY))), empty, "a pending bill alone is nothing to forecast");
      await confirmPending(db, blank, "bill", rent.id);
      const after = homeSentence(await loadMoneyState(db, blank, TODAY));
      assert.match(after.lead, /^You're fine for the next 30 days/);
      assert.equal(after.lead, "You're fine for the next 30 days. Lowest point", "one bill and no invoices: nothing to be late, so the sentence does not say 'even if clients pay late'");
      assert.equal(after.emphasis, "$900 on the 20th.");
      // a card charge alone is enough to leave the empty sentence too
      const other = await createHousehold(db, randomUUID(), setupForm.parse({ name: "Fictional newcomer", currency: "USD", timeZone: "Asia/Tokyo", bank: "50", card: "Card E", limit: "", closingDay: "20", dueDay: "10" }), { isDemo: true });
      const [card] = await cardsOf(other);
      await insertCharge(db, other, charge({ cardId: card.id, amount: "20" }) as never, "confirmed", "manual", { madeBy: "form" });
      assert.notDeepEqual(homeSentence(await loadMoneyState(db, other, TODAY)).lead, empty.lead);
    });

    await check("the two-field start makes a household with no card, the real date and the nudge rule at 3 days; Try it keeps Nov 14 with the same rule (D66)", async () => {
      const bare = setupForm.parse({ name: "Fictional newcomer", currency: "JPY", timeZone: "Asia/Tokyo", bank: "250,000" });
      const id = await createHousehold(db, randomUUID(), bare, { isDemo: true });
      const [row] = await db.select().from(schema.households).where(eq(schema.households.id, id));
      assert.equal(row.fixedToday, null); assert.deepEqual((await rulesFor(db, id)).nudge_after, { enabled: true, threshold: 3, currency: null }); assert.equal(row.bankBalanceMinor, 250_000);
      assert.equal((await cardsOf(id)).length, 0, "no card block, no card");
      const real = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      assert.equal(await householdDate(db, id), real, "a blank household lives on the real date in its zone");
      assert.ok((await db.select().from(schema.paypalConnections).where(eq(schema.paypalConnections.householdId, id))).length === 1);
      const withCard = await createHousehold(db, randomUUID(), setupForm.parse({ ...bare, card: "Card D", closingDay: "20", dueDay: "10" }), { isDemo: true });
      assert.equal((await cardsOf(withCard)).length, 1, "the card block makes one card");
      for (const half of [{ card: "Card D" }, { closingDay: "20", dueDay: "10" }, { card: "Card D", closingDay: "20" }]) assert.equal(setupForm.safeParse({ ...bare, ...half }).success, false);
      assert.equal(setupForm.safeParse({ ...bare, card: "", closingDay: "", dueDay: "", limit: "" }).success, true, "blank card fields count as absent");
      assert.equal(await tryItKind(db, id), "blank");
      const ben = await seedBen(db, { isDemo: true });
      const [tryIt] = await db.select().from(schema.households).where(eq(schema.households.id, ben));
      assert.equal(tryIt.fixedToday, "2026-11-14"); assert.equal((await rulesFor(db, ben)).nudge_after.threshold, 3);
      assert.equal(await householdDate(db, ben), "2026-11-14");
      assert.equal(await tryItKind(db, ben), "try-it");
      assert.equal(await tryItKind(db, randomUUID()), null);
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
      assert.equal(await insertBill(db, a, input, "confirmed", { madeBy: "form" }), input.id);
      assert.equal(await insertBill(db, a, input, "confirmed", { madeBy: "form" }), input.id);
      const rows = await db.select().from(schema.bills).where(eq(schema.bills.id, input.id));
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].amountMinor, rows[0].currency, rows[0].status, rows[0].memberId, rows[0].householdId], [3800, "JPY", "confirmed", memberA, a]);
      const added = (await events(a, "bill_added")).filter(e => e.refId === input.id);
      assert.equal(added.length, 1);
      assert.deepEqual([added[0].title, added[0].amountMinor, added[0].currency, added[0].refType, added[0].notify], ["Fictional landlord added, due Nov 25", 3800, "JPY", "bill", false]);
      await assert.rejects(insertBill(db, a, { ...input, amount: "3801" }, "confirmed", { madeBy: "form" }), InputError);
      await assert.rejects(insertBill(db, a, { ...input, due: "2026-11-26" }, "confirmed", { madeBy: "form" }), InputError);
      await assert.rejects(insertBill(db, a, { ...input, memberId: null }, "confirmed", { madeBy: "form" }), InputError);
      await assert.rejects(insertBill(db, b, input, "confirmed", { madeBy: "form" }), "an id held by another household is refused");
      const shared = bill();
      await insertBill(db, a, shared, "confirmed", { madeBy: "form" });
      assert.equal((await first(db.select().from(schema.bills).where(eq(schema.bills.id, shared.id)))).memberId, null);
    });

    await check("insertBill pending waits in To check with a notified to_check event and no runway observation", async () => {
      await db.update(schema.households).set({ runwayShort: false, notificationDay: null }).where(eq(schema.households.id, a));
      const before = (await events(a, "runway_short")).length;
      const input = bill({ biller: "Fictional agent bill", amount: "999999" });
      await insertBill(db, a, input, "pending", { madeBy: "form" });
      await insertBill(db, a, input, "pending", { madeBy: "form" });
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
      await insertBill(db, b, bill({ biller: "Fictional big bill", amount: "900000" }), "confirmed", { madeBy: "form" });
      assert.equal((await events(b, "runway_short")).length, before + 1);
      assert.equal((await first(db.select().from(schema.households).where(eq(schema.households.id, b)))).runwayShort, true);
      await insertBill(db, b, bill({ biller: "Fictional second bill", amount: "100" }), "confirmed", { madeBy: "form" });
      assert.equal((await events(b, "runway_short")).length, before + 1);
    });

    await check("insertBill rejects bad amounts and a member of another household", async () => {
      for (const amount of ["3800.5", "0", "-1", "1,00", "", "abc"]) {
        const input = bill({ amount });
        await assert.rejects(insertBill(db, a, input, "confirmed", { madeBy: "form" }), InputError, amount);
        assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, input.id))).length, 0);
      }
      const foreign = bill({ memberId: memberB });
      await assert.rejects(insertBill(db, a, foreign, "confirmed", { madeBy: "form" }), InputError);
      await assert.rejects(insertBill(db, a, foreign, "pending", { madeBy: "form" }), InputError);
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, foreign.id))).length, 0);
      assert.equal(billInput.safeParse({ ...bill(), due: "tomorrow" }).success, false);
      assert.equal(billInput.safeParse({ ...bill(), biller: "  " }).success, false);
    });

    await check("insertCharge confirmed stores the card's currency, records charge_added once, and is idempotent", async () => {
      const input = charge({ cardId: cardAB.id });
      assert.equal(await insertCharge(db, a, input as never, "confirmed", "manual", { madeBy: "form" }), input.id);
      assert.equal(await insertCharge(db, a, input as never, "confirmed", "manual", { madeBy: "form" }), input.id);
      const rows = await db.select().from(schema.charges).where(eq(schema.charges.id, input.id));
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].amountMinor, rows[0].currency, rows[0].status, rows[0].source, rows[0].householdId], [540, "JPY", "confirmed", "manual", a]);
      const added = (await events(a, "charge_added")).filter(e => e.title === "Fictional bakery added");
      assert.equal(added.length, 1); assert.deepEqual([added[0].refType, added[0].refId], ["card", cardAB.id]); assert.equal(added[0].notify, false);
      await assert.rejects(insertCharge(db, a, { ...input, amount: "541" } as never, "confirmed", "manual", { madeBy: "form" }), InputError);
      await assert.rejects(insertCharge(db, a, { ...input, merchant: "Other" } as never, "confirmed", "manual", { madeBy: "form" }), InputError);
      await assert.rejects(insertCharge(db, a, { ...input, cardId: cardA.id } as never, "confirmed", "manual", { madeBy: "form" }), InputError);
      await assert.rejects(insertCharge(db, b, input as never, "confirmed", "manual", { madeBy: "form" }), "an id held by another household is refused");
    });

    await check("insertCharge pending is a notified to_check row with the given source, then confirms through confirmPending", async () => {
      await db.update(schema.households).set({ notificationDay: null }).where(eq(schema.households.id, a)); // one notification per day
      const input = charge({ merchant: "Fictional voice charge", amount: "1200" });
      await insertCharge(db, a, input as never, "pending", "voice", { madeBy: "form" });
      await insertCharge(db, a, input as never, "pending", "voice", { madeBy: "form" });
      const row = await first(db.select().from(schema.charges).where(eq(schema.charges.id, input.id)));
      assert.deepEqual([row.status, row.source], ["pending", "voice"]);
      const checks = (await events(a, "to_check")).filter(e => e.refId === input.id);
      assert.equal(checks.length, 1); assert.equal(checks[0].notify, true); assert.equal(checks[0].refType, "charge");
      assert.equal((await events(a, "charge_added")).filter(e => e.title === "Fictional voice charge added").length, 0);
      assert.equal(await confirmPending(db, a, "charge", input.id), true);
    });

    await check("insertCharge refuses a card of another household, a currency mismatch and bad amounts", async () => {
      const foreign = charge({ cardId: cardOfB.id });
      await assert.rejects(insertCharge(db, a, foreign as never, "confirmed", "manual", { madeBy: "form" }), InputError);
      await assert.rejects(insertCharge(db, a, foreign as never, "pending", "voice", { madeBy: "form" }), InputError);
      assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, foreign.id))).length, 0);
      const [usdCard] = await db.insert(schema.cards).values({ householdId: a, label: "Fictional USD card", closingDay: 10, dueDay: 5, currency: "USD" }).returning();
      const mismatch = charge({ cardId: usdCard.id, amount: "12.50" });
      await assert.rejects(insertCharge(db, a, mismatch as never, "confirmed", "manual", { madeBy: "form" }), InputError);
      assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, mismatch.id))).length, 0);
      for (const amount of ["540.5", "0", "-1", "1,00", ""]) {
        const bad = charge({ amount });
        await assert.rejects(insertCharge(db, a, bad as never, "confirmed", "manual", { madeBy: "form" }), InputError, amount);
        assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, bad.id))).length, 0);
      }
      await assert.rejects(insertCharge(db, a, charge({ date: "11/14" }) as never, "confirmed", "manual", { madeBy: "form" }));
    });

    await check("a confirmed charge in a closed cycle updates its statement exactly once; a pending one does not", async () => {
      const statement = () => first(db.select().from(schema.cardStatements).where(and(eq(schema.cardStatements.householdId, a),
        eq(schema.cardStatements.cardId, cardA.id), eq(schema.cardStatements.closedOn, "2026-10-31"))));
      const before = (await statement()).amountMinor;
      const pending = charge({ merchant: "Fictional October pending", amount: "700", date: "2026-10-30" });
      await insertCharge(db, a, pending as never, "pending", "manual", { madeBy: "form" });
      assert.equal((await statement()).amountMinor, before);
      const input = charge({ merchant: "Fictional October charge", amount: "2500", date: "2026-10-30" });
      await insertCharge(db, a, input as never, "confirmed", "manual", { madeBy: "form" });
      await insertCharge(db, a, input as never, "confirmed", "manual", { madeBy: "form" });
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
      const hikari = await billsOf(fresh, TODAY, "Hikari Denki"); // Sep and Oct paid one-offs, Nov's waiting in To check
      const hikariStored = await db.select({ id: schema.bills.id, due: schema.bills.due }).from(schema.bills)
        .where(and(eq(schema.bills.householdId, fresh), eq(schema.bills.biller, "Hikari Denki"))).orderBy(schema.bills.due);
      assert.deepEqual(hikari.map(row => [row.id, row.due]), hikariStored.map(row => [row.id, row.due]), "a one-off stays one row, past or future: never expanded");
      const cloudbox = await billsOf(fresh, TODAY, "CloudBox Plus");
      const original = (await first(db.select().from(schema.bills).where(and(eq(schema.bills.householdId, fresh), eq(schema.bills.biller, "CloudBox Plus"))))).id;
      assert.deepEqual(cloudbox.map(row => row.id), [`${original}@2026-11-18`, `${original}@2026-12-18`]);
      assert.ok(cloudbox.every(row => row.repeatDay === 18 && row.amount === 1980 && row.status === "confirmed"));
      assert.equal(new Set(state.bills.map(row => row.id)).size, state.bills.length, "occurrence ids are unique");
      assert.ok(hikari.every(row => row.repeatDay === undefined && row.startsOn === undefined));
      assert.ok(state.bills.filter(row => row.startsOn !== undefined).every(row => row.due >= TODAY && row.due <= end), "occurrences only from today to the window's end");
    });

    await check("a day past the month's end clamps to its last day", async () => {
      assert.deepEqual(occurrenceDates("2027-01-31", "month", 31, "2027-01-20", "2027-04-30"), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
      assert.deepEqual(occurrenceDates("2028-01-31", "month", 31, "2028-01-20", "2028-03-31"), ["2028-01-31", "2028-02-29", "2028-03-31"]);
      assert.deepEqual(occurrenceDates("2026-11-30", "month", 30, "2026-11-01", "2027-03-01"), ["2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28"]);
      const hid = await seedBen(db, { isDemo: true });
      const input = bill({ biller: "Fictional month-end plan", due: "2027-01-31", repeat: "month" });
      await insertBill(db, hid, input, "confirmed", { madeBy: "form" });
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
      const input = bill({ biller: "Fictional pending plan", due: "2026-11-25", repeat: "month" });
      await insertBill(db, hid, input, "pending", { madeBy: "form" });
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
      const form = billInput.parse({ id: randomUUID(), biller: "Fictional form plan", amount: "900", due: "2026-11-09", category: "subscriptions", repeat: "month" });
      await insertBill(db, a, form, "confirmed", { madeBy: "form" });
      assert.equal(await stored(form.id), 9);
      const agent = billInput.parse({ id: randomUUID(), biller: "Fictional agent plan", amount: "900", due: "2026-11-30", category: "subscriptions", repeat: "month" });
      await insertBill(db, a, agent, "pending", { madeBy: "form" });
      assert.equal(await stored(agent.id), 30);
      const once = bill({ biller: "Fictional once" });
      await insertBill(db, a, once, "confirmed", { madeBy: "form" });
      assert.equal(await stored(once.id), null);
      assert.equal(billInput.parse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-09", category: "other" }).repeat, null, "repeat defaults to a one-off");
      await assert.rejects(insertBill(db, a, { ...form, repeat: null }, "confirmed", { madeBy: "form" }), InputError, "the same id with a different repeat is refused");
      assert.equal(await insertBill(db, a, form, "confirmed", { madeBy: "form" }), form.id);
      await assert.rejects(db.insert(schema.bills).values({ householdId: a, biller: "Bad", amountMinor: 1, currency: "JPY", due: "2026-11-20", category: "other", repeatDay: 32 }));
      await assert.rejects(db.insert(schema.bills).values({ householdId: a, biller: "Bad", amountMinor: 1, currency: "JPY", due: "2026-11-20", category: "other", repeatDay: 0 }));
    });

    // ---- yearly bills, an amount that changes, a cancel-by date (D48)
    await check("a yearly bill repeats on its month and day: across a year end, from a past due date, and 29 February falls on the 28th in a common year", async () => {
      assert.deepEqual(occurrenceDates("2026-12-01", "year", null, "2026-11-14", "2029-12-31"), ["2026-12-01", "2027-12-01", "2028-12-01", "2029-12-01"]);
      assert.deepEqual(occurrenceDates("2025-12-31", "year", null, "2026-01-01", "2027-12-31"), ["2026-12-31", "2027-12-31"], "the stored date is before today: the series goes on");
      assert.deepEqual(occurrenceDates("2024-03-10", "year", null, "2026-11-14", "2028-12-31"), ["2027-03-10", "2028-03-10"]);
      assert.deepEqual(occurrenceDates("2028-02-29", "year", null, "2028-01-01", "2033-03-01"), ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29", "2033-02-28"], "the 29th comes back in a leap year");
      assert.deepEqual(occurrenceDates("2026-12-01", "year", null, "2026-12-02", "2027-11-30"), [], "nothing falls inside a window that holds no anniversary");
      assert.throws(() => occurrenceDates("2026-12-01", "month", null, "2026-11-14", "2027-01-01"), /day of the month/);
    });

    await check("an occurrence on or after next_amount_from has the new amount, the day before has the old; a pending or one-off bill passes through", async () => {
      const base = { id: "b", biller: "Fictional rent", amount: 80_000, due: "2026-08-27", category: "housing" as const, businessBp: 0, status: "confirmed" as const };
      const rent = { ...base, repeatUnit: "month" as const, repeatDay: 27, nextAmount: 85_000, nextAmountFrom: "2026-11-27" };
      assert.deepEqual(expandBills([rent], "2026-09-01", "2027-01-31").map(o => [o.due, o.amount, o.startAmount]), [
        ["2026-09-27", 80_000, 80_000], ["2026-10-27", 80_000, 80_000], ["2026-11-27", 85_000, 80_000], ["2026-12-27", 85_000, 80_000], ["2027-01-27", 85_000, 80_000]], "Nov 27 is the boundary date and takes the new amount");
      const yearly = { ...base, due: "2026-12-01", amount: 12_000, repeatUnit: "year" as const, nextAmount: 13_000, nextAmountFrom: "2027-12-01" };
      assert.deepEqual(expandBills([yearly], "2026-11-14", "2028-12-31").map(o => [o.due, o.amount]), [["2026-12-01", 12_000], ["2027-12-01", 13_000], ["2028-12-01", 13_000]]);
      assert.deepEqual(expandBills([{ ...yearly, status: "pending" }], "2026-11-14", "2028-12-31").map(o => o.id), ["b"], "a pending bill never expands");
      assert.deepEqual(expandBills([{ ...base, due: "2026-11-20" }], "2026-11-14", "2028-12-31").map(o => [o.id, o.amount]), [["b", 80_000]]);
    });

    await check("cancel notices: the renewal is the first occurrence after the cancel-by date, at the amount that applies then; past or pending ones make none", async () => {
      const yearly = { id: "y", biller: "Fictional Cloud", amount: 12_000, due: "2026-12-01", category: "subscriptions" as const, businessBp: 0, status: "confirmed" as const, repeatUnit: "year" as const, cancelBy: "2026-11-20" };
      assert.deepEqual(cancelNotices([yearly], TODAY), [{ billId: "y", biller: "Fictional Cloud", category: "subscriptions", cancelBy: "2026-11-20", renewsOn: "2026-12-01", amount: 12_000, repeats: true }]);
      const rise = { ...yearly, id: "r", due: "2025-12-01", cancelBy: "2026-11-30", nextAmount: 15_000, nextAmountFrom: "2026-06-01" };
      assert.deepEqual(cancelNotices([rise], TODAY).map(n => [n.renewsOn, n.amount]), [["2026-12-01", 15_000]], "stored due long past: Dec 1 2026 is the renewal, at the new amount");
      assert.deepEqual(cancelNotices([{ ...yearly, repeatUnit: undefined }], TODAY).map(n => [n.renewsOn, n.repeats]), [["2026-12-01", false]], "a one-off is charged once");
      assert.deepEqual(cancelNotices([{ ...yearly, cancelBy: "2026-11-13" }, { ...yearly, id: "p", status: "pending" }, { ...yearly, id: "n", cancelBy: undefined }], TODAY), [], "a cancel-by in the past, a pending bill, no cancel-by");
      assert.deepEqual(cancelNotices([{ ...yearly, repeatUnit: undefined, due: "2026-11-15", cancelBy: "2026-11-16" }], TODAY), [], "a one-off that was already charged has no renewal");
    });

    await check("a typed-in yearly bill with a new amount and a cancel-by date: stored, expanded with the right amount, one cancel notice, Activity says it", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const before = (await loadMoneyState(db, hid, TODAY)).bills.length;
      const input = bill({ biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", repeat: "year", nextAmount: "13,000", nextAmountFrom: "2027-12-01", cancelBy: "2026-11-20" });
      await insertBill(db, hid, input, "confirmed", { madeBy: "form" });
      const row = await first(db.select().from(schema.bills).where(eq(schema.bills.id, input.id)));
      assert.deepEqual([row.repeatUnit, row.repeatDay, row.amountMinor, row.nextAmountMinor, row.nextAmountFrom, row.cancelBy], ["year", null, 12_000, 13_000, "2027-12-01", "2026-11-20"]);
      const state = await loadMoneyState(db, hid, TODAY);
      const mine = state.bills.filter(x => x.biller === "Fictional Cloud");
      assert.deepEqual(mine.map(x => [x.id, x.due, x.amount, x.repeatUnit, x.repeatDay]), [[`${input.id}@2026-12-01`, "2026-12-01", 12_000, "year", undefined]], "inside the plan window only the Dec 1 anniversary");
      assert.equal(state.bills.length, before + 1);
      assert.deepEqual(state.cancelNotices, [{ billId: input.id, biller: "Fictional Cloud", category: "subscriptions", cancelBy: "2026-11-20", renewsOn: "2026-12-01", amount: 12_000, repeats: true }]);
      const event = await first(db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.refId, input.id))));
      assert.equal(event.title, "Fictional Cloud added, due Dec 1");
      assert.equal(event.body, "Every year · Changes to ¥13,000 from Dec 1, 2027 · Cancel by Nov 20");
      assert.equal(await insertBill(db, hid, input, "confirmed", { madeBy: "form" }), input.id, "the same fields again return the same bill");
      for (const change of [{ nextAmount: "13,500" }, { nextAmountFrom: "2027-12-02" }, { cancelBy: "2026-11-21" }, { repeat: "month" as const }, { repeat: null, nextAmount: null, nextAmountFrom: null }]) {
        await assert.rejects(insertBill(db, hid, { ...input, ...change }, "confirmed", { madeBy: "form" }), InputError, `the same id with ${Object.keys(change)[0]} changed is refused`);
      }
      assert.equal(await removeBill(db, hid, input.id), true);
      assert.equal((await first(db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, "bill_removed"))))).body, "Every year, so every occurrence is gone");
    });

    await check("a monthly bill whose stored due date is long past: the next occurrence has the new amount and the cancel notice names it", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const input = bill({ biller: "Fictional gym", amount: "5000", due: "2026-08-16", category: "health", repeat: "month", nextAmount: "6000", nextAmountFrom: "2026-09-01", cancelBy: "2026-11-15" });
      await insertBill(db, hid, input, "confirmed", { madeBy: "form" });
      const state = await loadMoneyState(db, hid, TODAY);
      assert.deepEqual(state.bills.filter(x => x.biller === "Fictional gym").map(x => [x.due, x.amount]), [["2026-11-16", 6000], ["2026-12-16", 6000]]);
      assert.deepEqual(state.cancelNotices.map(n => [n.cancelBy, n.renewsOn, n.amount]), [["2026-11-15", "2026-11-16", 6000]]);
      assert.equal((await first(db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.refId, input.id))))).body, "Changes to ¥6,000 from Sep 1 · Cancel by Nov 15", "a monthly bill does not say Every year");
    });

    await check("a pending bill with the D48 fields shows them in To check, counts nothing, and confirming keeps them", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const input = bill({ biller: "Fictional domain", amount: "1500", due: "2026-12-10", category: "business_tools", repeat: "year", nextAmount: "1800", nextAmountFrom: "2027-12-10", cancelBy: "2026-12-05" });
      await insertBill(db, hid, input, "pending", { madeBy: "form" });
      const waiting = await loadMoneyState(db, hid, TODAY);
      assert.deepEqual(waiting.cancelNotices, [], "pending: no notice yet");
      assert.equal(toCheck(waiting).find(r => r.title === "Fictional domain")!.detail, "Business tools · Personal · due Dec 10 · every year · ¥1,800 from Dec 10 · cancel by Dec 5");
      assert.equal(await confirmPending(db, hid, "bill", input.id), true);
      const confirmed = await loadMoneyState(db, hid, TODAY);
      assert.deepEqual(confirmed.cancelNotices.map(n => [n.biller, n.cancelBy, n.renewsOn, n.amount]), [["Fictional domain", "2026-12-05", "2026-12-10", 1500]]);
      assert.deepEqual(confirmed.bills.filter(x => x.biller === "Fictional domain").map(x => x.due), ["2026-12-10"]);
    });

    await check("D48 refusals: a next amount without a date (and the reverse), on a one-off, on or before the due date, a cancel-by on or after the next charge, dates past two years, amounts out of range", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const refused = async (over: Parameters<typeof bill>[0], pattern: RegExp) => assert.rejects(insertBill(db, hid, bill({ biller: "Fictional refused", due: "2026-12-01", ...over }), "confirmed", { madeBy: "form" }), (e: unknown) => e instanceof InputError && pattern.test(e.message), JSON.stringify(over));
      await refused({ repeat: "year", nextAmount: "13000" }, /together with the date/);
      await refused({ repeat: "year", nextAmountFrom: "2027-12-01" }, /together with the date/);
      await refused({ nextAmount: "13000", nextAmountFrom: "2027-12-01" }, /needs a bill that repeats/);
      await refused({ repeat: "year", nextAmount: "13000", nextAmountFrom: "2026-12-01" }, /after the due date/);
      await refused({ repeat: "year", nextAmount: "13000", nextAmountFrom: "2026-11-30" }, /after the due date/);
      await refused({ repeat: "year", cancelBy: "2026-12-01" }, /before the bill is next charged on Dec 1/);
      await refused({ repeat: "year", cancelBy: "2026-12-02" }, /before the bill is next charged on Dec 1/);
      await refused({ cancelBy: "2027-01-01" }, /before the bill is next charged on Dec 1/);
      await refused({ repeat: "month", due: "2026-08-16", cancelBy: "2026-11-16" }, /before the bill is next charged on Nov 16/);
      await refused({ repeat: "year", nextAmount: "13000", nextAmountFrom: "2029-01-01" }, new RegExp(HORIZON_MESSAGE));
      await refused({ repeat: "year", cancelBy: "2029-01-01" }, new RegExp(HORIZON_MESSAGE));
      await refused({ repeat: "year", due: "2029-01-01" }, new RegExp(HORIZON_MESSAGE));
      await refused({ repeat: "year", nextAmount: "100,000,001", nextAmountFrom: "2027-12-01" }, /Enter an amount up to ¥100,000,000/);
      await refused({ repeat: "year", nextAmount: "0", nextAmountFrom: "2027-12-01" }, /more than zero/);
      await refused({ repeat: "year", nextAmount: "12.5", nextAmountFrom: "2027-12-01" }, /whole numbers/);
      assert.equal(billInput.safeParse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-09", category: "other", repeat: "week" }).success, false, "only month and year");
      assert.equal(billInput.safeParse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-09", category: "other", cancelBy: "soon" }).success, false);
      assert.equal((await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.biller, "Fictional refused")))).length, 0, "nothing was saved");
      assert.equal(latestDate(TODAY), "2028-11-14");
    });

    await check("the database holds the line too: unit values, the day only for monthly, the new amount and its date together", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const row = { householdId: hid, biller: "Bad", amountMinor: 1, currency: "JPY", due: "2026-11-20", category: "other" };
      await assert.rejects(db.insert(schema.bills).values({ ...row, repeatUnit: "week" }), "an unknown unit");
      await assert.rejects(db.insert(schema.bills).values({ ...row, repeatDay: 20 }), "a day with no unit");
      await assert.rejects(db.insert(schema.bills).values({ ...row, repeatUnit: "month" }), "a monthly bill without its day");
      await assert.rejects(db.insert(schema.bills).values({ ...row, repeatUnit: "year", repeatDay: 20 }), "a yearly bill with a day");
      await assert.rejects(db.insert(schema.bills).values({ ...row, repeatUnit: "year", nextAmountMinor: 5 }), "a new amount without its date");
      await assert.rejects(db.insert(schema.bills).values({ ...row, repeatUnit: "year", nextAmountFrom: "2027-01-01" }), "a date without its new amount");
      await db.insert(schema.bills).values({ ...row, biller: "Fine", repeatUnit: "year", nextAmountMinor: 5, nextAmountFrom: "2027-11-20", cancelBy: "2026-11-19" });
    });

    await check("migration 0013 sets repeat_unit = month for every bill that had a repeat day and leaves one-offs null", async () => {
      const old = new PGlite();
      try {
        const files = readdirSync("./drizzle").filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
        const target = files.find(f => f.startsWith("0013_"))!;
        const statements = (file: string) => readFileSync(`./drizzle/${file}`, "utf8").split("--> statement-breakpoint").map(x => x.trim()).filter(Boolean);
        for (const file of files.slice(0, files.indexOf(target))) for (const statement of statements(file)) await old.exec(statement);
        const household = (await old.query<{ id: string }>("insert into households (name, home_currency) values ('Old', 'JPY') returning id")).rows[0].id;
        for (const [biller, day] of [["Monthly A", 5], ["Monthly B", 31], ["One-off", null]] as const) {
          await old.query("insert into bills (household_id, biller, amount_minor, currency, due, category, repeat_day) values ($1, $2, 100, 'JPY', '2026-11-27', 'other', $3)", [household, biller, day]);
        }
        for (const statement of statements(target)) await old.exec(statement);
        const rows = (await old.query<{ biller: string; repeat_unit: string | null; repeat_day: number | null; next_amount_minor: number | null; cancel_by: string | null }>("select biller, repeat_unit, repeat_day, next_amount_minor, cancel_by from bills order by biller")).rows;
        assert.deepEqual(rows.map(r => [r.biller, r.repeat_unit, r.repeat_day, r.next_amount_minor, r.cancel_by]), [["Monthly A", "month", 5, null, null], ["Monthly B", "month", 31, null, null], ["One-off", null, null, null, null]]);
      } finally {
        await old.close();
      }
    });

    await check("another household's monthly bill never appears", async () => {
      const mine = await seedBen(db, { isDemo: true }), theirs = await seedBen(db, { isDemo: true });
      await insertBill(db, theirs, bill({ biller: "Fictional neighbour plan", due: "2026-11-21", repeat: "month" }), "confirmed", { madeBy: "form" });
      assert.equal((await billsOf(theirs, TODAY, "Fictional neighbour plan")).length, 2);
      assert.equal((await billsOf(mine, TODAY, "Fictional neighbour plan")).length, 0);
      assert.equal((await loadMoneyState(db, mine, TODAY)).bills.length, (await loadMoneyState(db, mine, TODAY)).bills.filter(row => row.biller !== "Fictional neighbour plan").length);
    });

    await check("card room and safe to spend count a repeating subscription that falls inside the window", async () => {
      const base = await seedBen(db, { isDemo: true }), repeating = await seedBen(db, { isDemo: true }), once = await seedBen(db, { isDemo: true });
      await insertBill(db, repeating, bill({ biller: "Fictional streaming", amount: "5000", due: "2026-11-16", repeat: "month" }), "confirmed", { madeBy: "form" });
      await insertBill(db, once, bill({ biller: "Fictional streaming", amount: "5000", due: "2026-11-16" }), "confirmed", { madeBy: "form" });
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
      assert.equal(await setBankBalance(db, a, input, "confirmed", { madeBy: "form" }), input.id);
      assert.equal(await bank(a), 182_000);
      const [event] = (await bankEvents(a)).filter(e => e.refId === input.id);
      assert.deepEqual([event.title, event.amountMinor, event.currency, event.refType, event.notify],
        [`Bank balance set to ¥182,000 (was ¥${old.toLocaleString("en-US")})`, 182_000, "JPY", "balance_update", false]);
      await db.update(schema.households).set({ bankBalanceMinor: 5 }).where(eq(schema.households.id, a));
      assert.equal(await setBankBalance(db, a, input, "confirmed", { madeBy: "form" }), input.id);
      assert.equal(await bank(a), 5, "the same id never applies twice");
      assert.equal((await bankEvents(a)).filter(e => e.refId === input.id).length, 1);
      await assert.rejects(setBankBalance(db, a, { ...input, amount: "182001" }, "confirmed", { madeBy: "form" }), InputError);
      await assert.rejects(setBankBalance(db, b, input, "confirmed", { madeBy: "form" }), "an id held by another household is refused");
      assert.equal((await balanceRows(a)).filter(r => r.id === input.id).length, 1);
      const zero = bankBalanceInput.parse({ id: randomUUID(), amount: "0" });
      await setBankBalance(db, a, zero, "confirmed", { madeBy: "form" });
      assert.equal(await bank(a), 0);
      await setBankBalance(db, a, { id: randomUUID(), amount: "-1200" }, "confirmed", { madeBy: "form" });
      assert.equal(await bank(a), -1200, "an overdrawn balance is allowed, as in Settings");
      for (const bad of ["", "abc", "1,00", "12.5", "1e3"]) await assert.rejects(setBankBalance(db, a, { id: randomUUID(), amount: bad }, "confirmed", { madeBy: "form" }), InputError, bad);
      assert.equal(bankBalanceInput.safeParse({ id: "not-a-uuid", amount: "1" }).success, false);
    });

    await check("setBankBalance with an unchanged value records no event; a confirmed write can flip the runway sentence", async () => {
      await db.update(schema.households).set({ bankBalanceMinor: 67_000, runwayShort: false }).where(eq(schema.households.id, a));
      const before = (await bankEvents(a)).length, flips = (await events(a, "runway_short")).length;
      await setBankBalance(db, a, { id: randomUUID(), amount: "67000" }, "confirmed", { madeBy: "form" });
      assert.equal((await bankEvents(a)).length, before);
      await setBankBalance(db, a, { id: randomUUID(), amount: "-900000" }, "confirmed", { madeBy: "form" });
      assert.equal((await events(a, "runway_short")).length, flips + 1);
      assert.equal((await first(db.select().from(schema.households).where(eq(schema.households.id, a)))).runwayShort, true);
    });

    await check("setBankBalance pending leaves the balance alone, shows in To check, and confirmPending applies it once", async () => {
      await db.update(schema.households).set({ bankBalanceMinor: 150_000, runwayShort: false, notificationDay: null }).where(eq(schema.households.id, a));
      const input = bankBalanceInput.parse({ id: randomUUID(), amount: "182000" });
      const navBefore = (await loadNavigationData(db, a)).pending;
      await setBankBalance(db, a, input, "pending", { madeBy: "form" });
      await setBankBalance(db, a, input, "pending", { madeBy: "form" });
      assert.equal(await bank(a), 150_000);
      assert.equal((await loadNavigationData(db, a)).pending, navBefore + 1, "the To check count in the navigation includes it");
      assert.equal((await bankEvents(a)).filter(e => e.refId === input.id).length, 0);
      const checks = (await events(a, "to_check")).filter(e => e.refId === input.id);
      assert.equal(checks.length, 1); assert.equal(checks[0].notify, true); assert.equal(checks[0].refType, "balance_update");
      await assert.rejects(setBankBalance(db, a, { ...input, amount: "1" }, "pending", { madeBy: "form" }), InputError);
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
      await setBankBalance(db, a, input, "pending", { madeBy: "form" });
      const bankB = await bank(b);
      assert.equal(await confirmPending(db, b, "balance", input.id), false);
      assert.equal(await bank(b), bankB);
      assert.equal(await bank(a) === 555_555, false);
      assert.equal(toCheck(await stateOf(b)).some(r => r.kind === "balance"), false);
      assert.equal((await balanceRows(b)).some(r => r.id === input.id), false);
      assert.equal(toCheck(await stateOf(a)).filter(r => r.kind === "balance").length, 1);
      assert.equal(await confirmPending(db, a, "balance", randomUUID()), false);
    });

    await check("removeBill deletes a bill with its event, a monthly bill as a whole series, and the runway follows", async () => {
      const mine = await seedBen(db, { isDemo: true }), theirs = await seedBen(db, { isDemo: true });
      const before = await loadMoneyState(db, mine, TODAY);
      const once = bill({ biller: "Fictional repair", amount: "30000", due: "2026-11-20" }), monthly = bill({ biller: "Fictional gym", amount: "5000", due: "2026-11-16", repeat: "month" });
      await insertBill(db, mine, once, "confirmed", { madeBy: "form" }); await insertBill(db, mine, monthly, "confirmed", { madeBy: "form" });
      const withBoth = await loadMoneyState(db, mine, TODAY);
      assert.equal(withBoth.bills.filter(row => row.biller === "Fictional gym").length, 2, "Nov 16 and Dec 16 are inside the window");
      assert.equal(low(series(before, "worst")).amount - low(series(withBoth, "worst")).amount, 35_000);
      assert.equal(await removeBill(db, theirs, once.id), false, "another household's bill id removes nothing");
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, once.id))).length, 1);
      assert.equal(await removeBill(db, mine, once.id), true);
      assert.equal(await removeBill(db, mine, once.id), false, "a second tap finds nothing");
      assert.equal(await removeBill(db, mine, monthly.id), true);
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.householdId, mine))).some(row => row.id === once.id || row.id === monthly.id), false);
      const after = await loadMoneyState(db, mine, TODAY);
      assert.equal(after.bills.some(row => row.biller === "Fictional gym" || row.biller === "Fictional repair"), false, "every occurrence is gone with the series");
      assert.deepEqual(series(after, "worst"), series(before, "worst"), "the runway is back to what it was");
      const removed = (await events(mine, "bill_removed")).map(e => [e.title, e.amountMinor, e.refType, e.notify]);
      assert.deepEqual(removed, [["Removed bill Fictional repair ¥30,000", 30_000, "bill", false], ["Removed bill Fictional gym ¥5,000", 5000, "bill", false]]);
      assert.equal((await events(theirs, "bill_removed")).length, 0);
      await assert.rejects(removeBill(db, mine, "not-a-uuid"));
    });

    await check("removeCharge deletes a charge with its event, takes it out of a stored statement, and what is owed follows", async () => {
      const mine = await seedBen(db, { isDemo: true }), theirs = await seedBen(db, { isDemo: true });
      const [card] = await cardsOf(mine), other = (await cardsOf(theirs))[0];
      const owedOf = async (hid: string) => cardSummary(await loadMoneyState(db, hid, TODAY), card.id).owed;
      const owed = await owedOf(mine);
      const open = charge({ cardId: card.id, merchant: "Fictional shoes", amount: "2000", date: "2026-11-13" });
      const closed = charge({ cardId: card.id, merchant: "Fictional October shop", amount: "2500", date: "2026-10-30" });
      await insertCharge(db, mine, open as never, "confirmed", "manual", { madeBy: "form" }); await insertCharge(db, mine, closed as never, "confirmed", "manual", { madeBy: "form" });
      assert.equal(await owedOf(mine), owed + 4500);
      const statement = () => first(db.select().from(schema.cardStatements).where(and(eq(schema.cardStatements.householdId, mine), eq(schema.cardStatements.cardId, card.id), eq(schema.cardStatements.closedOn, "2026-10-31"))));
      assert.equal((await statement()).amountMinor, 58_000 + 2500);
      assert.equal(await removeCharge(db, theirs, open.id as string), false, "another household's charge id removes nothing");
      assert.equal(await removeCharge(db, mine, randomUUID()), false);
      assert.equal(await removeCharge(db, mine, open.id as string), true);
      assert.equal(await removeCharge(db, mine, open.id as string), false);
      assert.equal(await owedOf(mine), owed + 2500);
      assert.equal(await removeCharge(db, mine, closed.id as string), true);
      assert.equal((await statement()).amountMinor, 58_000, "the stored statement gives the charge back");
      assert.equal(await owedOf(mine), owed);
      const pending = charge({ cardId: card.id, merchant: "Fictional pending shop", amount: "900", date: "2026-10-29" });
      await insertCharge(db, mine, pending as never, "pending", "voice", { madeBy: "form" });
      assert.equal(await removeCharge(db, mine, pending.id as string), true);
      assert.equal((await statement()).amountMinor, 58_000, "a pending charge was never in the statement");
      assert.deepEqual((await events(mine, "charge_removed")).map(e => [e.title, e.amountMinor, e.refType]), [
        ["Removed charge Fictional shoes ¥2,000", 2000, "charge"], ["Removed charge Fictional October shop ¥2,500", 2500, "charge"], ["Removed charge Fictional pending shop ¥900", 900, "charge"]]);
      assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.householdId, theirs))).some(row => row.cardId === other.id && row.merchant === "Fictional shoes"), false);
      const stillThere = charge({ cardId: other.id, merchant: "Fictional neighbour shop", amount: "100" });
      await insertCharge(db, theirs, stillThere as never, "confirmed", "manual", { madeBy: "form" });
      assert.equal(await removeCharge(db, mine, stillThere.id as string), false);
      assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, stillThere.id as string))).length, 1);
    });

    await check("D57/D58 doors: /api/canvas/resolve and /api/memory start with the same-origin and session guard, and the return path lists /memory and /canvas", async () => {
      for (const route of ["./src/app/api/canvas/resolve/route.ts", "./src/app/api/memory/route.ts"]) {
        const source = readFileSync(route, "utf8");
        const guard = source.indexOf("await householdRequest(request)");
        assert.ok(guard > 0 && source.includes("hid instanceof Response"), `${route} must call the household guard and return its response`);
        for (const later of ["request.text()", "request.formData()", "formOf(request)", "db()"]) {
          const at = source.indexOf(later);
          assert.ok(at === -1 || at > guard, `${route} reads ${later} before the guard`);
        }
      }
      for (const page of ["/memory", "/canvas", "/settings", "/plan", "/to-check"]) assert.equal(returnPath(page), page);
      assert.equal(returnPath("/api/memory"), "/");
      assert.equal(returnPath("//cross-origin.test"), "/");
      assert.equal(returnPath("/memory/../x"), "/");
      assert.equal(returnPath(null), "/");
    });

    await check("every Activity event kind the app writes has words in the Type column", async () => {
      const { readdirSync, readFileSync } = await import("node:fs");
      const files = [...readdirSync("./src/db").map(f => `./src/db/${f}`), "./src/lib/events.ts"].filter(f => f.endsWith(".ts"));
      const written = new Set<string>();
      for (const file of files) for (const m of readFileSync(file, "utf8").matchAll(/kind: "([a-z_]+)"|kind: [^"\n]*\? "([a-z_]+)" : "([a-z_]+)"|kind \+ "_confirmed"|kind: value\.kind \+ "_confirmed"/g)) {
        for (const kind of [m[1], m[2], m[3]]) if (kind) written.add(kind);
        if (m[0].includes("_confirmed")) { written.add("bill_confirmed"); written.add("charge_confirmed"); }
      }
      assert.ok(written.has("bill_removed") && written.has("settings_updated") && written.has("runway_clear"), "the scan finds the kinds");
      // Kinds that are not events: a reading's own kind, a document source, a snapshot field.
      for (const notEvent of ["bill", "charge", "balance", "pot", "email", "upload", "arrival", "statement", "reading"]) written.delete(notEvent);
      for (const kind of written) assert.ok(Object.hasOwn(EVENT_KIND_LABELS, kind), `no label for the event kind ${kind}`);
      for (const kind of Object.keys(EVENT_KIND_LABELS)) assert.ok(written.has(kind), `the label ${kind} is for a kind nothing writes`);
      assert.equal(eventKindLabel("daily_reminder"), "Daily reminder", "historical Activity keeps its label");
      assert.equal(eventKindLabel("nudge_suggested"), "Nudge suggested", "historical Activity keeps its label");
      assert.equal(eventKindLabel("invoice_paid_outside"), "Invoice paid outside PayPal");
      assert.equal(eventKindLabel("runway_clear"), "Clear for 30 days");
      assert.equal(eventKindLabel("runway_short"), "Short");
      assert.equal(eventKindLabel("settings_updated"), "Settings changed");
      assert.equal(eventKindLabel("to_check"), "Waiting in To check");
    });

    await check("D50: a pending row made by Ask or MCP says so in To check and on its event; a row made by a form says nothing", async () => {
      const byAsk = bill({ biller: "Fictional ask bill" }), byMcp = bill({ biller: "Fictional mcp bill" }), byForm = bill({ biller: "Fictional form bill" });
      const askId = randomUUID();
      await insertBill(db, a, byAsk, "pending", { madeBy: "ask", askId });
      await insertBill(db, a, byMcp, "pending", { madeBy: "mcp" });
      await insertBill(db, a, byForm, "pending", { madeBy: "form" });
      const stored = await first(db.select().from(schema.bills).where(eq(schema.bills.id, byAsk.id)));
      assert.deepEqual([stored.madeBy, stored.askId], ["ask", askId]);
      assert.deepEqual((await first(db.select().from(schema.bills).where(eq(schema.bills.id, byMcp.id)))).askId, null);
      const rows = toCheck(await loadMoneyState(db, a, TODAY));
      const label = (title: string) => draftedLabel(rows.find(row => row.title === title)?.madeBy);
      assert.equal(label("Fictional ask bill"), "Drafted by Ask");
      assert.equal(label("Fictional mcp bill"), "Drafted through MCP");
      assert.equal(label("Fictional form bill"), null);
      const eventRows = (await events(a, "to_check")).filter(e => /^Fictional (ask|mcp|form) bill bill to check$/.test(e.title)).map(e => [e.title, publicEvent(e).madeBy, e.askId]);
      assert.deepEqual(eventRows, [["Fictional ask bill bill to check", "ask", askId], ["Fictional mcp bill bill to check", "mcp", null], ["Fictional form bill bill to check", "form", null]]);
      for (const row of [byAsk, byMcp, byForm]) await removeBill(db, a, row.id);
    });

    await check("D50: clientPace is the usual and slowest days from the paid invoices, null with none", async () => {
      assert.equal(clientPace({ id: "c", name: "N", email: "n@n.example", termsDays: 7, daysToPay: [] }), null);
      assert.deepEqual(clientPace({ id: "c", name: "N", email: "n@n.example", termsDays: 7, daysToPay: [14, 9, 21, 8] }), { usual: 9, slowest: 21 });
      assert.equal(paceLine({ id: "c", name: "N", email: "n@n.example", termsDays: 7, daysToPay: [14, 9, 21, 8] }), "9 days usual · 21 slowest");
      assert.equal(paceLine({ id: "c", name: "N", email: "n@n.example", termsDays: 7, daysToPay: [] }), null);
      const state = await loadMoneyState(db, a, TODAY);
      for (const client of state.clients) assert.equal(clientPace(client)?.usual, client.daysToPay.length ? medianLow(client.daysToPay) : undefined);
    });

    await check("D50: the nudge setting round-trips: empty is off, 1 to 60 is a number, anything else is refused, and Activity says so", async () => {
      const read = async () => (await loadSettings(db, a)).household.nudgeAfterDays;
      assert.equal(await read(), 3, "three days by default");
      await updateSettings(db, a, settingsInput.parse({ kind: "nudge", afterDays: "9" }));
      assert.equal(await read(), 9);
      assert.equal((await events(a, "settings_updated")).at(-1)?.title, "Nudge suggestions on, 9 days past due");
      const count = (await events(a, "settings_updated")).length;
      await updateSettings(db, a, settingsInput.parse({ kind: "nudge", afterDays: "9" }));
      assert.equal((await events(a, "settings_updated")).length, count, "unchanged records nothing");
      await updateSettings(db, a, settingsInput.parse({ kind: "nudge", afterDays: "" }));
      assert.equal(await read(), null);
      assert.equal((await events(a, "settings_updated")).at(-1)?.title, "Nudge suggestions turned off");
      for (const bad of ["0", "61", "2.5", "abc", "-3"]) assert.equal(settingsInput.safeParse({ kind: "nudge", afterDays: bad }).success, false, bad);
      await assert.rejects(pg.query("update households set nudge_after_days = 61 where id = $1", [a]), /households_nudge_after_days_valid/);
      assert.equal(await read(), null);
      assert.equal((await loadSettings(db, b)).household.nudgeAfterDays, 3, "another household is untouched");
    });

    await check("a last payment (D41): the expansion stops after it, the refusals use their words, edits say what changed, and the table refuses a one-off with one", async () => {
      // pure
      assert.deepEqual(occurrenceDates("2026-08-27", "month", 27, "2026-08-27", "2027-03-01", "2026-12-27"), ["2026-08-27", "2026-09-27", "2026-10-27", "2026-11-27", "2026-12-27"], "until on an occurrence keeps it");
      assert.deepEqual(occurrenceDates("2026-08-27", "month", 27, "2026-08-27", "2027-03-01", "2026-12-20"), ["2026-08-27", "2026-09-27", "2026-10-27", "2026-11-27"], "until between two occurrences drops the later one");
      assert.deepEqual(occurrenceDates("2026-08-27", "month", 27, "2026-08-01", "2027-03-01", "2026-08-27"), ["2026-08-27"], "until equal to due is one date");
      assert.deepEqual(occurrenceDates("2025-03-01", "year", null, "2025-03-01", "2030-01-01", "2027-03-01"), ["2025-03-01", "2026-03-01", "2027-03-01"], "yearly");
      assert.equal(lastPayment({ due: "2026-08-27", repeatUnit: "month", repeatDay: 27, repeatUntil: "2026-12-30" }), "2026-12-27");
      assert.equal(lastOneWords({ due: "2026-08-27", repeatUnit: "month", repeatDay: 27, repeatUntil: "2026-12-27" }, "2026-11-14"), "last one Dec 27");
      assert.equal(lastOneWords({ due: "2026-08-27", repeatUnit: "month", repeatDay: 27, repeatUntil: "2027-12-27" }, "2026-11-14"), "last one Dec 27, 2027");
      assert.equal(lastOneWords({ due: "2026-08-27", repeatUnit: "month", repeatDay: 27 }, "2026-11-14"), null);
      const gym = { id: "g", biller: "Kawa Gym", amount: 6000, due: "2026-08-27", category: "other" as const, businessBp: 0, status: "confirmed" as const, repeatUnit: "month" as const, repeatDay: 27, repeatUntil: "2026-12-27", cancelBy: "2026-12-20" };
      const expanded = expandBills([gym], "2026-11-14", "2027-03-31", "JPY").map(x => x.due);
      assert.deepEqual(expanded, ["2026-11-27", "2026-12-27"], "Nov 27 and Dec 27 counted, nothing after");
      assert.equal(nextOccurrenceAfter(gym, "2026-12-27"), null);
      assert.equal(nextOccurrenceAfter(gym, "2026-11-27"), "2026-12-27");
      assert.equal(cancelNotices([gym], "2026-11-14", "JPY").length, 1, "the renewal on Dec 27 is the last payment: a notice");
      assert.deepEqual(cancelNotices([{ ...gym, cancelBy: "2026-12-28" }], "2026-11-14", "JPY"), [], "the renewal would fall after the last payment: no notice");
      assert.equal(cancelNotices([{ ...gym, cancelBy: "2026-12-28", repeatUntil: undefined }], "2026-11-14", "JPY").length, 1);
      // the database
      const before = await loadMoneyState(db, a, TODAY);
      const lowBefore = low(series(before, "worst")).amount;
      const sentenceBefore = lines(homeSentence(before));
      const id = randomUUID();
      const input = bill({ id, biller: "Kawa Gym", amount: "6000", due: "2026-11-27", category: "other", repeat: "month", repeatUntil: "2026-12-27" });
      await insertBill(db, a, input, "confirmed", { madeBy: "form" });
      await insertBill(db, a, input, "confirmed", { madeBy: "form" });
      await assert.rejects(insertBill(db, a, { ...input, repeatUntil: "2026-12-28" }, "confirmed", { madeBy: "form" }), (e: unknown) => e instanceof InputError && e.message === "This bill identifier is already in use");
      assert.match((await events(a, "bill_added")).at(-1)?.body ?? "", /Last one Dec 27$/);
      const state = await loadMoneyState(db, a, TODAY);
      assert.deepEqual(state.bills.filter(x => x.id.startsWith(id)).map(x => x.due), ["2026-11-27", "2026-12-27"]);
      assert.equal(low(series(state, "worst")).amount, lowBefore - 6_000, "the late-case lowest point falls by the gym bill");
      // the refusals
      const refuse = (over: Partial<ReturnType<typeof billInput.parse>>, words: string) => assert.rejects(insertBill(db, a, bill({ biller: "Kawa Refused", ...over }), "confirmed", { madeBy: "form" }), (e: unknown) => e instanceof InputError && e.message === words, words);
      await refuse({ repeat: null, repeatUntil: "2026-12-27" }, "A last payment needs a bill that repeats: choose Every month or Every year");
      await refuse({ repeat: "month", due: "2026-11-27", repeatUntil: "2026-11-26" }, "The last payment must be on or after the first due date");
      await refuse({ repeat: "month", due: "2026-11-27", repeatUntil: latestDate(TODAY).replace(/\d{4}/, y => String(Number(y) + 3)) }, HORIZON_MESSAGE);
      await refuse({ repeat: "month", due: "2026-11-27", repeatUntil: "2026-12-27", nextAmount: "7000", nextAmountFrom: "2027-01-27" }, "The new amount must start on or before the last payment");
      // edits
      const edit = (repeatUntil?: string | null) => billEditInput.parse({ id, biller: "Kawa Gym", amount: "6000", due: "2026-11-27", category: "other", ...(repeatUntil === undefined ? {} : { repeatUntil }) });
      await updateBill(db, a, edit("2027-01-27"), { madeBy: "form" });
      assert.match((await events(a, "bill_changed")).at(-1)?.body ?? "", /^Last payment Dec 27 → Jan 27/);
      const count = (await events(a, "bill_changed")).length;
      await updateBill(db, a, edit(), { madeBy: "form" });
      assert.equal((await events(a, "bill_changed")).length, count, "absent = unchanged");
      await updateBill(db, a, edit(null), { madeBy: "form" });
      assert.equal((await events(a, "bill_changed")).at(-1)?.body, "No last payment");
      await updateBill(db, a, edit("2026-12-27"), { madeBy: "form" });
      assert.match((await events(a, "bill_changed")).at(-1)?.body ?? "", /^Last payment Dec 27$/);
      await assert.rejects(updateBill(db, a, edit("2026-11-01"), { madeBy: "form" }), (e: unknown) => e instanceof InputError && e.message === "The last payment must be on or after the first due date");
      // the table
      const oneOff = randomUUID();
      await insertBill(db, a, bill({ id: oneOff, biller: "Kawa Once", due: "2026-11-27" }), "confirmed", { madeBy: "form" });
      await assert.rejects(pg.query("update bills set repeat_until = '2027-01-01' where id = $1", [oneOff]), /bills_repeat_until_valid/);
      await removeBill(db, a, id); await removeBill(db, a, oneOff);
      const after = await loadMoneyState(db, a, TODAY);
      assert.deepEqual(lines(homeSentence(after)), sentenceBefore, "Ben's sentence is unchanged once the gym is removed");
    });

    await check("every new function throws without a household id", async () => {
      for (const bad of ["", "not-a-uuid", null, undefined] as never[]) {
        await assert.rejects(insertClient(db, bad, clientInput.parse({ id: randomUUID(), name: "X", email: "x@x.example", termsDays: 0 })), /household id is required/);
        await assert.rejects(insertBill(db, bad, bill(), "confirmed", { madeBy: "form" }), /household id is required/);
        await assert.rejects(insertCharge(db, bad, charge() as never, "pending", "manual", { madeBy: "form" }), /household id is required/);
        await assert.rejects(markPaidOutside(db, bad, randomUUID(), TODAY), /household id is required/);
        await assert.rejects(setBankBalance(db, bad, { id: randomUUID(), amount: "1" }, "confirmed", { madeBy: "form" }), /household id is required/);
        await assert.rejects(confirmPending(db, bad, "balance", randomUUID()), /household id is required/);
        await assert.rejects(removeBill(db, bad, randomUUID()), /household id is required/);
        await assert.rejects(removeCharge(db, bad, randomUUID()), /household id is required/);
      }
    });

    console.log(`${passed}/${passed} typed-in data checks passed.`);
  } finally {
    await pg.close();
  }
}
main().catch(error => { console.error("Typed-in data verification failed:", error instanceof Error ? error.message : error); process.exitCode = 1; });

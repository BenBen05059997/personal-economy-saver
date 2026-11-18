// Pots and planning (D43): the maths in plan.ts, the one starting-cash rule in the engine, the pot writes and the
// fill rule on a client payment. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/pots-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createChecks, eventsOf, first, noCapture, openDb, violates } from "./fixtures/harness";
import * as schema from "@/db/schema";
import { DEMO_DATE } from "@/db/clock";
import { confirmPending } from "@/db/confirm";
import { InputError } from "@/db/input-error";
import { markPaidOutside } from "@/db/invoice-paid";
import { loadMoneyState } from "@/db/household";
import { saveChoice, confirmChoice, withdrawChoice, removePendingChoice, loadChoices, keepFoundWin, type ChoiceInput } from "@/db/choices";
import { chargeInput, insertCharge } from "@/db/charges";
import { confirmMove, fillPots, markPotDone, movePot, parseFillBp, potInput, removePendingMove, removePot, savePot, type MoveInput } from "@/db/pots";
import { loadPotMoves } from "@/db/pot-moves";
import { seedBen } from "@/db/seed";
import { loadNavigationData } from "@/db/workspace";
import { applyVerifiedDelivery } from "@/lib/events";
import { leftOverEachMonth, monthsUntil, planFor, planLine, potLine, potSummary, roomLine } from "@/lib/money/plan";
import { availableCash, low, roomOnCard, safeToSpend, series } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { toCheck } from "@/lib/money/to-check";
import { benMoney } from "@/lib/sample/ben";
import type { MoneyState, Pot } from "@/lib/money/types";
import { addMonths } from "@/lib/money/dates";

const pot = (over: Partial<Pot> = {}): Pot => ({ id: "pot-1", name: "Tax", saved: 10_000, ...over });

async function main() {
  const { pg, db } = await openDb();
  const { check, tally } = createChecks();
  try {
    // ------------------------------------------------------------ pure maths
    await check("months: addMonths clamps to the month end; monthsUntil counts whole months, at least 1", () => {
      assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
      assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
      assert.equal(addMonths("2026-11-14", 4), "2027-03-14");
      assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
      assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
      assert.equal(monthsUntil(DEMO_DATE, "2027-03-31"), 4);
      assert.equal(monthsUntil(DEMO_DATE, "2027-03-14"), 4);
      assert.equal(monthsUntil(DEMO_DATE, "2027-03-13"), 3);
      assert.equal(monthsUntil(DEMO_DATE, "2026-12-01"), 1, "under a month rounds up to one");
      assert.equal(monthsUntil(DEMO_DATE, DEMO_DATE), 1);
      assert.equal(monthsUntil(DEMO_DATE, "2026-01-01"), 1, "a date in the past still divides by one");
    });

    await check("leftOverEachMonth is the expected series at day 30 less its start, on Ben ¥92,220", () => {
      const expected = series(benMoney, "expected");
      assert.equal(leftOverEachMonth(benMoney), expected[expected.length - 1] - expected[0]);
      assert.equal(expected.length, 30);
      assert.equal(leftOverEachMonth(benMoney), 92_220);
      assert.equal(roomLine(benMoney), "Left over each month: about ¥92,220 if clients pay as usual. That's what you could put aside.");
      const bare = { ...benMoney, invoices: [] };
      assert.ok(leftOverEachMonth(bare) < 0, "bills and statements with nothing coming in leave nothing over");
      assert.equal(roomLine(bare), "No client payments are expected in the next 30 days, so there's nothing new to put aside yet.");
      const unpaid = { ...benMoney, invoices: benMoney.invoices.filter(invoice => invoice.status !== "sent") };
      assert.ok(leftOverEachMonth(unpaid) < 0, "without a sent invoice the month is a net outflow");
      assert.equal(roomLine(unpaid), "No client payments are expected in the next 30 days, so there's nothing new to put aside yet.");
    });

    await check("planFor: needed, whole months, monthly needed rounded up, fits against the room", () => {
      const goal = planFor({ target: 1_200_000, saved: 0, targetDate: "2027-03-31" }, benMoney);
      assert.deepEqual([goal.needed, goal.months, goal.monthlyNeeded, goal.fits, goal.leftOverEachMonth], [1_200_000, 4, 300_000, false, 92_220]);
      assert.equal(planFor({ target: 1_000_001, saved: 0, targetDate: "2027-03-31" }, benMoney).monthlyNeeded, 250_001, "rounds up to the yen");
      assert.equal(planFor({ target: 1_000_000, saved: 200_000, targetDate: "2027-03-31" }, benMoney).monthlyNeeded, 200_000, "saved counts");
      const fits = planFor({ target: 270_000, saved: 0, targetDate: "2027-02-14" }, benMoney);
      assert.deepEqual([fits.months, fits.monthlyNeeded, fits.fits], [3, 90_000, true]);
      assert.equal(planFor({ target: 276_660, saved: 0, targetDate: "2027-02-14" }, benMoney).fits, true, "exactly the room fits");
      assert.equal(planFor({ target: 276_661, saved: 0, targetDate: "2027-02-14" }, benMoney).fits, false, "one yen more does not");
      const done = planFor({ target: 50_000, saved: 80_000, targetDate: "2027-02-14" }, benMoney);
      assert.deepEqual([done.needed, done.monthlyNeeded, done.fits, done.monthsAtPace, done.reachedOn], [0, 0, true, 0, DEMO_DATE]);
      assert.equal(planFor({ target: 1_200_000, saved: 0 }, benMoney).monthlyNeeded, undefined, "no date, no monthly amount needed");
    });

    await check("planFor: the date at a pace is today plus whole months, clamped to the month end", () => {
      const room = planFor({ target: 1_200_000, saved: 0 }, benMoney);
      assert.deepEqual([room.pace, room.monthsAtPace, room.reachedOn], [92_220, 14, "2028-01-14"]);
      const given = planFor({ target: 250_000, saved: 0, monthly: 100_000 }, benMoney);
      assert.deepEqual([given.pace, given.monthsAtPace, given.reachedOn], [100_000, 3, "2027-02-14"]);
      const endOfMonth = { ...benMoney, today: "2026-11-30" };
      assert.equal(planFor({ target: 250_000, saved: 0, monthly: 100_000 }, endOfMonth).reachedOn, "2027-02-28");
      assert.equal(planFor({ target: 300_000, saved: 0, monthly: 100_000 }, endOfMonth).reachedOn, "2027-02-28", "exact division is not rounded up");
      const none = planFor({ target: 100_000, saved: 0 }, { ...benMoney, invoices: [] });
      assert.deepEqual([none.pace, none.reachedOn, none.fits], [undefined, undefined, undefined]);
      assert.equal(planFor({ target: 100_000, saved: 0, targetDate: "2027-02-14" }, { ...benMoney, invoices: [] }).fits, false, "no room, so nothing fits");
    });

    await check("planFor works in cents for a USD household and the lines are built in code", () => {
      const usd: MoneyState = { ...benMoney, homeCurrency: "USD", fxPerUsd: 1, paypal: 1000, bank: 1000, bills: [], cards: [], charges: [], statements: [], invoices: [], pots: [] };
      assert.equal(leftOverEachMonth(usd), 0);
      const plan = planFor({ target: 100, saved: 0, targetDate: "2027-02-14" }, usd);
      assert.deepEqual([plan.months, plan.monthlyNeeded], [3, 33.34], "$33.34, rounded up to the cent");
      assert.equal(planLine({ target: 100, saved: 0, targetDate: "2027-02-14" }, plan, usd), "$33.34 a month to reach $100 by Feb 2027. Left over each month: nothing if clients pay as usual, so it does not fit.");
      const input = { target: 1_200_000, saved: 0, targetDate: "2027-03-31" };
      assert.equal(planLine(input, planFor(input, benMoney), benMoney),
        "¥300,000 a month to reach ¥1,200,000 by Mar 2027. Left over each month: about ¥92,220 if clients pay as usual, so it does not fit.");
      const pace = { target: 1_200_000, saved: 0 };
      assert.equal(planLine(pace, planFor(pace, benMoney), benMoney), "At ¥92,220 a month (left over each month) you would reach ¥1,200,000 around Jan 2028.");
      assert.equal(planLine({ ...pace, monthly: 100_000 }, planFor({ ...pace, monthly: 100_000 }, benMoney), benMoney), "At ¥100,000 a month you would reach ¥1,200,000 around Nov 2027.");
      assert.equal(planLine(pace, planFor(pace, { ...benMoney, invoices: [] }), { ...benMoney, invoices: [] }), "Left over each month: nothing if clients pay as usual, so there is no date to give for ¥1,200,000.");
      assert.equal(potLine(pot({ target: 1_200_000, targetDate: "2027-03-31", saved: 0 }), benMoney), "¥300,000 a month to reach ¥1,200,000 by Mar 2027. More than what is left over each month.");
      assert.equal(potLine(pot({ target: 270_000, targetDate: "2027-02-14", saved: 0 }), benMoney), "¥90,000 a month to reach ¥270,000 by Feb 2027. Fits within what is left over each month.");
      assert.equal(potLine(pot({ target: 5_000 }), benMoney), "Target reached");
      assert.equal(potLine(pot(), benMoney), undefined);
      assert.equal(potSummary(pot(), benMoney), "Tax ¥10,000 set aside");
      assert.equal(potSummary(pot({ name: "Car", saved: 200_000, target: 1_200_000, targetDate: "2027-03-31" }), benMoney), "Car ¥200,000 of ¥1,200,000 · by Mar 2027");
    });

    await check("availableCash is the one starting cash: pots lower the series, the low point, safe to spend, card room and the sentence together", () => {
      assert.equal(availableCash(benMoney), 128_000);
      const empty = { ...benMoney, pots: [] };
      assert.deepEqual(Array.from(series(empty, "worst")), Array.from(series(benMoney, "worst")));
      const rich = { ...benMoney, bank: benMoney.bank + 40_000 }; // low point +¥21,220
      const potted = { ...rich, pots: [pot({ saved: 10_000 })] };
      assert.equal(availableCash(potted), availableCash(rich) - 10_000);
      assert.equal(safeToSpend(rich).amount, 21_220);
      assert.equal(safeToSpend(potted).amount, 11_220, "safe to spend is ¥10,000 lower");
      assert.equal(low(series(potted, "worst")).amount, low(series(rich, "worst")).amount - 10_000);
      assert.equal(low(series(potted, "expected")).amount, low(series(rich, "expected")).amount - 10_000);
      assert.equal(safeToSpend(potted).cash, 128_000 + 40_000 - 10_000, "cash is bank + PayPal less pots");
      assert.equal(roomOnCard(potted, "card-b").room, roomOnCard(rich, "card-b").room - 10_000);
      assert.match(homeSentence(rich).lead, /fine for the next 30 days/);
      const flipped = { ...rich, pots: [pot({ saved: 30_000 })] };
      assert.match(homeSentence(flipped).lead, /You're fine if Acme and Northwind pay as usual/);
      assert.equal(homeSentence(flipped).emphasis, "¥8,780 short on the 27th.", "a ¥30,000 pot flips the sentence");
      assert.equal(leftOverEachMonth(flipped), leftOverEachMonth(rich), "the room is what the month adds, not what is set aside");
      const pending = { ...rich, pendingPots: [pot({ saved: 30_000 })] };
      assert.equal(safeToSpend(pending).amount, 21_220, "a pending pot counts for nothing");
    });

    await check("the sentence as parts: lead + emphasis + the day, the clients and the short flag", () => {
      const rich = { ...benMoney, bank: benMoney.bank + 40_000 };
      const joined = (state: typeof benMoney) => { const s = homeSentence(state); return [s.text, s.day, s.short, s.clients.map(c => c.id).join(",")]; };
      assert.deepEqual(joined(benMoney), ["You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th.", "2026-11-27", true, "c-acme,c-northwind"]);
      assert.deepEqual(joined(rich), ["You're fine for the next 30 days, even if clients pay late. Lowest point ¥21,220 on the 27th.", "2026-11-27", false, ""]);
      assert.deepEqual(joined({ ...benMoney, bank: benMoney.bank - 300_000 }), ["Even if clients pay as usual, you're ¥178,780 short on the 20th.", "2026-11-20", true, ""]);
      assert.deepEqual(joined({ ...benMoney, bills: [], charges: [], statements: [], invoices: [] }), ["Add your bills and the clients who pay you to see your next 30 days. Bank balance ¥67,000.", null, false, ""]);
      const one = homeSentence({ ...benMoney, invoices: benMoney.invoices.filter(i => i.clientId === "c-acme" || i.status !== "sent") });
      assert.equal(one.text, "You're fine if Acme pays as usual. If that payment is late, you're ¥18,780 short on the 27th.");
      assert.deepEqual(one.leadParts, ["You're fine if ", { id: "c-acme", name: "Acme" }, " pays as usual. If that payment is late, you're"]);
      assert.deepEqual(one.emphasisParts, { before: "¥18,780 short", on: "on the 27th" });
      assert.equal(homeSentence(benMoney).lead, homeSentence(benMoney).leadParts.map(p => typeof p === "string" ? p : p.name).join(""));
      const twin = homeSentence({ ...benMoney, clients: [...benMoney.clients, { ...benMoney.clients.find(c => c.id === "c-acme")!, id: "c-acme-2" }] });
      assert.deepEqual(twin.clients.map(c => c.id), ["c-northwind"], "a first name two clients share is plain text, not a link");
      assert.equal(twin.lead, homeSentence(benMoney).lead);
    });

    await check("a pending pot is a To check row: New pot: Car, ¥1,200,000 by Mar 2027", () => {
      const row = toCheck({ ...benMoney, pendingPots: [pot({ id: "p-car", name: "Car", saved: 0, target: 1_200_000, targetDate: "2027-03-31" })] }).find(r => r.kind === "pot")!;
      assert.deepEqual([row.id, row.title, row.amount], ["p-car", "New pot: Car, ¥1,200,000 by Mar 2027", null]);
      assert.equal(toCheck({ ...benMoney, pendingPots: [pot({ name: "Tax", saved: 0, fillPct: 25 })] }).find(r => r.kind === "pot")!.title, "New pot: Tax");
    });

    await check("fill share parsing: percent text to basis points", () => {
      assert.deepEqual(["25", "12.5", "0.01", "100", "7.25"].map(parseFillBp), [2500, 1250, 1, 10_000, 725]);
      for (const bad of ["0", "100.01", "101", "-5", "abc", "", "12.345", "1,5"]) assert.throws(() => parseFillBp(bad), InputError, bad);
    });

    // ------------------------------------------------------------ database
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const events = eventsOf(db);
    const rowOf = (id: string) => first(db.select().from(schema.pots).where(eq(schema.pots.id, id)));
    const stateOf = (hid: string) => loadMoneyState(db, hid, DEMO_DATE);
    const input = (over: Partial<ReturnType<typeof potInput.parse>> = {}) => potInput.parse({ id: randomUUID(), name: "Fictional trip", ...over });
    const memberB = (await first(db.select().from(schema.members).where(eq(schema.members.householdId, b)))).id;

    await check("Ben starts with no pots, so the loaded state has none", async () => {
      const state = await stateOf(a);
      assert.deepEqual([state.pots, state.pendingPots], [[], []]);
    });

    await check("the pots table refuses bad rows in SQL", async () => {
      const base = { householdId: a, currency: "JPY", name: "Fictional" };
      const refused: [Partial<typeof schema.pots.$inferInsert>, string][] = [
        [{ name: "" }, "pots_name_valid"], [{ name: "x".repeat(61) }, "pots_name_valid"], [{ targetMinor: 0 }, "pots_target_positive"],
        [{ savedMinor: -1 }, "pots_saved_valid"], [{ fillBp: 0 }, "pots_fill_valid"], [{ fillBp: 10_001 }, "pots_fill_valid"],
        [{ memberId: memberB }, "pots_member_household_fk"], // a member of another household cannot be referenced
      ];
      for (const [bad, constraint] of refused) await assert.rejects(db.insert(schema.pots).values({ ...base, ...bad }), violates(constraint), JSON.stringify(bad));
    });

    await check("savePot confirmed: stores home-currency minor units, records pot_added once, idempotent on id", async () => {
      const car = input({ name: "Car", target: "1200000", targetDate: "2027-03-31", saved: "200000", fillPct: "12.5" });
      assert.equal(await savePot(db, a, car, "confirmed", { madeBy: "form" }), car.id);
      assert.equal(await savePot(db, a, car, "confirmed", { madeBy: "form" }), car.id);
      const row = await rowOf(car.id);
      assert.deepEqual([row.householdId, row.name, row.targetMinor, row.targetDate, row.savedMinor, row.fillBp, row.currency, row.status],
        [a, "Car", 1_200_000, "2027-03-31", 200_000, 1250, "JPY", "confirmed"]);
      const added = (await events(a, "pot_added")).filter(e => e.refId === car.id);
      assert.equal(added.length, 1);
      assert.deepEqual([added[0].title, added[0].amountMinor, added[0].refType, added[0].notify], ["Car pot added", 200_000, "pot", false]);
      const state = await stateOf(a);
      assert.deepEqual(state.pots, [{ id: car.id, name: "Car", saved: 200_000, target: 1_200_000, targetDate: "2027-03-31", startedOn: DEMO_DATE, fillPct: 12.5 }]);
      assert.equal(availableCash(state), 128_000 - 200_000);
      await removePot(db, a, car.id);
    });

    await check("savePot refuses a bad amount, a date without a target and a bad share", async () => {
      for (const over of [{ target: "0" }, { target: "12.5" }, { target: "abc" }, { saved: "-1" }, { saved: "1,00" }, { fillPct: "0" }, { fillPct: "101" },
        { targetDate: "2027-03-31" }, { name: "   " }, { name: "x".repeat(61) }]) {
        const bad = potInput.safeParse({ id: randomUUID(), name: "Fictional trip", ...over });
        if (!bad.success) continue;
        await assert.rejects(savePot(db, a, bad.data, "confirmed", { madeBy: "form" }), InputError, JSON.stringify(over));
        assert.equal((await db.select().from(schema.pots).where(eq(schema.pots.id, bad.data.id))).length, 0);
      }
    });

    await check("savePot confirmed again with new fields edits the pot and records the old and new values", async () => {
      const tax = input({ name: "Tax", saved: "10000", fillPct: "25" });
      await savePot(db, a, tax, "confirmed", { madeBy: "form" });
      await savePot(db, a, { ...tax, saved: "15000", target: "100000", fillPct: "30" }, "confirmed", { madeBy: "form" });
      const row = await rowOf(tax.id);
      assert.deepEqual([row.savedMinor, row.targetMinor, row.fillBp], [15_000, 100_000, 3000]);
      const updated = (await events(a, "pot_updated")).filter(e => e.refId === tax.id);
      assert.equal(updated.length, 1);
      assert.equal(updated[0].title, "Tax pot updated");
      assert.equal(updated[0].body, "Saved ¥10,000 → ¥15,000; Target none → ¥100,000; Set aside 25% → 30%");
      await savePot(db, a, { ...tax, saved: "15000", target: "100000", fillPct: "30" }, "confirmed", { madeBy: "form" });
      assert.equal((await events(a, "pot_updated")).filter(e => e.refId === tax.id).length, 1, "the same edit twice records one event");
      await removePot(db, a, tax.id);
    });

    await check("savePot pending waits in To check, counts for nothing, refuses a changed reused id, and confirmPending applies it once", async () => {
      await db.update(schema.households).set({ runwayShort: true, notificationDay: null }).where(eq(schema.households.id, a));
      const before = (await events(a, "runway_clear")).length;
      const car = input({ name: "Car", target: "1200000", targetDate: "2027-03-31" });
      await savePot(db, a, car, "pending", { madeBy: "form" });
      await savePot(db, a, car, "pending", { madeBy: "form" });
      assert.equal((await rowOf(car.id)).status, "pending");
      const checks = (await events(a, "to_check")).filter(e => e.refId === car.id);
      assert.deepEqual([checks.length, checks[0].notify, checks[0].refType], [1, true, "pot"]);
      assert.equal((await events(a, "pot_added")).filter(e => e.refId === car.id).length, 0);
      await assert.rejects(savePot(db, a, { ...car, target: "999999" }, "pending", { madeBy: "form" }), InputError);
      await assert.rejects(savePot(db, a, { ...car, target: "999999" }, "confirmed", { madeBy: "form" }), InputError, "a pending pot is never edited by an id reuse");
      assert.equal((await rowOf(car.id)).targetMinor, 1_200_000);
      const state = await stateOf(a);
      assert.deepEqual([state.pots.length, state.pendingPots.map(p => p.name)], [0, ["Car"]]);
      assert.equal(toCheck(state).find(row => row.kind === "pot")!.title, "New pot: Car, ¥1,200,000 by Mar 2027");
      assert.equal((await loadNavigationData(db, a)).pending, toCheck(state).length, "the nav count includes the pending pot");
      assert.equal(await confirmPending(db, a, "pot", car.id), true);
      assert.equal(await confirmPending(db, a, "pot", car.id), false);
      assert.equal((await rowOf(car.id)).status, "confirmed");
      assert.equal((await events(a, "pot_added")).filter(e => e.refId === car.id).length, 1);
      assert.equal((await stateOf(a)).pots.length, 1);
      assert.equal((await events(a, "runway_clear")).length, before, "a ¥0 pot does not change the runway");
      await removePot(db, a, car.id);
    });

    await check("a confirmed pot that creates a shortfall flips the runway once, and removing it flips it back", async () => {
      const c = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ bankBalanceMinor: 67_000 + 40_000, runwayShort: false }).where(eq(schema.households.id, c));
      const shorts = (await events(c, "runway_short")).length, clears = (await events(c, "runway_clear")).length;
      const reserve = input({ name: "Reserve", saved: "30000" });
      await savePot(db, c, reserve, "confirmed", { madeBy: "form" });
      assert.equal((await events(c, "runway_short")).length, shorts + 1);
      assert.equal((await first(db.select().from(schema.households).where(eq(schema.households.id, c)))).runwayShort, true);
      assert.equal(await removePot(db, c, reserve.id), true);
      assert.equal((await events(c, "runway_clear")).length, clears + 1);
      assert.equal((await first(db.select().from(schema.households).where(eq(schema.households.id, c)))).runwayShort, false);
    });

    await check("removePot deletes this household's pot, and records pot_removed", async () => {
      const gone = input({ name: "Trip", saved: "5000" });
      await savePot(db, a, gone, "confirmed", { madeBy: "form" });
      assert.equal(await removePot(db, a, gone.id), true);
      assert.equal(await removePot(db, a, gone.id), false);
      assert.equal(await removePot(db, a, randomUUID()), false);
      const removed = (await events(a, "pot_removed")).filter(e => e.refId === gone.id);
      assert.deepEqual([removed.length, removed[0].title, removed[0].body], [1, "Trip pot removed", "¥5,000 is cash you can spend again"]);
      await assert.rejects(removePot(db, a, "not-a-uuid"));
      await assert.rejects(removePot(db, "", gone.id), /household id is required/);
    });

    // ---- the fill rule
    const clientOf = async (hid: string, name: string) => (await first(db.select().from(schema.clients).where(and(eq(schema.clients.householdId, hid), eq(schema.clients.name, name))))).id;
    const invoice = async (hid: string, client: string, usdCents: number, over: Partial<typeof schema.invoices.$inferInsert> = {}) =>
      (await first(db.insert(schema.invoices).values({ householdId: hid, clientId: await clientOf(hid, client), status: "sent", item: "Fictional poster", amountMinor: usdCents, currency: "USD", sentOn: DEMO_DATE, ...over }).returning())).id;
    const saved = async (id: string) => (await rowOf(id)).savedMinor;
    const filled = (hid: string) => events(hid, "pot_filled");

    await check("fillPots adds the share to every confirmed pot with a rule, half up, one event each, and nothing for the rest", async () => {
      const c = await seedBen(db, { isDemo: true });
      const tax = input({ name: "Tax", fillPct: "25", saved: "1000" }), tenth = input({ name: "Tenth", fillPct: "10" });
      const car = input({ name: "Car", target: "100000" }), waiting = input({ name: "Waiting", fillPct: "50" });
      for (const p of [tax, tenth, car]) await savePot(db, c, p, "confirmed", { madeBy: "form" });
      await savePot(db, c, waiting, "pending", { madeBy: "form" });
      const fillIn = async (credit: number, label: string) => { const inv = await invoice(c, "Northwind", 100); return db.transaction(tx => fillPots(tx, c, credit, inv, label)); };
      assert.equal(await fillIn(37_500, "Acme Corp's payment"), 2);
      assert.deepEqual([await saved(tax.id), await saved(tenth.id), await saved(car.id), await saved(waiting.id)], [1000 + 9375, 3750, 0, 0]);
      const rows = await filled(c);
      assert.deepEqual(rows.map(r => r.title).sort(), ["Set aside ¥3,750 for Tenth (10% of Acme Corp's payment)", "Set aside ¥9,375 for Tax (25% of Acme Corp's payment)"]);
      assert.ok(rows.every(r => r.refType === "pot" && !r.notify));
      assert.equal(await fillIn(0, "x"), 0);
      await fillIn(5, "tiny"); // 10% of 5 = 0.5 -> 1; 25% of 5 = 1.25 -> 1
      assert.deepEqual([await saved(tax.id), await saved(tenth.id)], [1000 + 9375 + 1, 3750 + 1]);
      await fillIn(4, "tiny"); // 10% of 4 = 0.4 -> 0, skipped; 25% -> 1
      assert.deepEqual([await saved(tax.id), await saved(tenth.id)], [1000 + 9375 + 2, 3751]);
      assert.equal((await filled(c)).length, 5, "a share that rounds to zero records nothing");
      await assert.rejects(fillIn(-1, "x"));
      await assert.rejects(fillIn(1.5, "x"));
    });

    await check("marking an invoice paid outside PayPal fills the pots: 25% of a $250 payment at the stored rate", async () => {
      const c = await seedBen(db, { isDemo: true });
      const tax = input({ name: "Tax", fillPct: "25" }), plain = input({ name: "Car", target: "500000" });
      await savePot(db, c, tax, "confirmed", { madeBy: "form" }); await savePot(db, c, plain, "confirmed", { madeBy: "form" });
      const inv = await invoice(c, "Northwind", 25_000);
      const bank = async () => (await first(db.select().from(schema.households).where(eq(schema.households.id, c)))).bankBalanceMinor;
      const start = await bank();
      assert.equal(await markPaidOutside(db, c, inv, DEMO_DATE), true);
      assert.equal(await bank(), start + 37_500, "the whole payment is credited to the bank");
      assert.equal(await saved(tax.id), 9_375, "$250 x 150 = ¥37,500; a quarter is ¥9,375");
      assert.equal(await saved(plain.id), 0);
      const rows = await filled(c);
      assert.deepEqual(rows.map(r => r.title), ["Set aside ¥9,375 for Tax (25% of Northwind's payment)"]);
      assert.equal(await markPaidOutside(db, c, inv, DEMO_DATE), false);
      assert.equal(await saved(tax.id), 9_375, "a repeat never fills twice");
      assert.equal((await filled(c)).length, 1);
      const state = await stateOf(c);
      assert.equal(availableCash(state), 128_000 + 37_500 - 9_375, "the pot's share is not spendable");
    });

    await check("a verified completed payment fills the pots after the credit, once", async () => {
      const c = await seedBen(db, { isDemo: true });
      const tax = input({ name: "Tax", fillPct: "25" });
      await savePot(db, c, tax, "confirmed", { madeBy: "form" });
      const order = "ORDER-FICTIONAL-POTS";
      const inv = await invoice(c, "Northwind", 25_000, { paypalOrderId: order, paypalPayeeId: "SELLERFICTIONAL" });
      const connection = async (hid: string) => (await first(db.select().from(schema.paypalConnections).where(eq(schema.paypalConnections.householdId, hid)))).balanceMinor;
      const start = await connection(c);
      const event = { id: "WH-POTS-PAID", event_type: "PAYMENT.CAPTURE.COMPLETED", create_time: "2026-11-14T16:00:00Z", resource: { id: "CAP-POTS", status: "COMPLETED",
        amount: { currency_code: "USD", value: "250.00" }, custom_id: inv, supplementary_data: { related_ids: { order_id: order } } } };
      await applyVerifiedDelivery(db, event, noCapture);
      await applyVerifiedDelivery(db, event, noCapture);
      assert.equal(await connection(c), start + 37_500);
      assert.equal(await saved(tax.id), 9_375);
      const rows = await filled(c);
      assert.deepEqual(rows.map(r => [r.title, r.refId]), [["Set aside ¥9,375 for Tax (25% of Northwind's payment)", tax.id]]);
      assert.equal((await events(c, "invoice_paid")).filter(e => e.refId === inv).length, 1);
      // The available cash is the credited balance less the pot.
      const state = await stateOf(c);
      assert.equal(availableCash(state), state.paypal + state.bank - 9_375);
    });


    // ---- the record of moves (D81)
    const OWN = { madeBy: "form" } as const;
    const sumsOf = async (hid: string) => {
      const pots = await db.select().from(schema.pots).where(and(eq(schema.pots.householdId, hid), eq(schema.pots.status, "confirmed")));
      const moves = await db.select().from(schema.potMoves).where(and(eq(schema.potMoves.householdId, hid), eq(schema.potMoves.status, "confirmed")));
      for (const p of pots) assert.equal(moves.filter(m => m.potId === p.id).reduce((n, m) => n + m.amountMinor, 0), p.savedMinor, `${p.name}: its moves add up to what it holds`);
      return pots.length;
    };
    const move = (over: Partial<MoveInput> & Pick<MoveInput, "potId" | "kind">): MoveInput =>
      ({ id: randomUUID(), amountMinor: 1000, toPotId: null, purchase: null, choiceId: null, reason: null, memberId: null, done: false, ...over });
    const refused = (hid: string, m: MoveInput, words: RegExp, status: "confirmed" | "pending" = "confirmed") => assert.rejects(movePot(db, hid, m, status, OWN), (e: unknown) => e instanceof InputError && words.test(e.message), words.source);
    const movesOf = (hid: string, potId: string) => db.select().from(schema.potMoves).where(and(eq(schema.potMoves.householdId, hid), eq(schema.potMoves.potId, potId)));

    await check("every writer keeps a pot's confirmed moves equal to saved_minor: create, edit, confirm, fill, add, take out, spend, carry, confirm a move, remove a pending one", async () => {
      const c = await seedBen(db, { isDemo: true });
      const trip = input({ name: "Trip", saved: "10000" }), spare = input({ name: "Spare", saved: "0", fillPct: "10" }), waiting = input({ name: "Waiting", saved: "700" });
      await savePot(db, c, trip, "confirmed", OWN); await savePot(db, c, spare, "confirmed", OWN);
      assert.deepEqual((await movesOf(c, trip.id)).map(m => [m.kind, m.amountMinor, m.status, m.movedOn]), [["adjust", 10_000, "confirmed", DEMO_DATE]]);
      assert.deepEqual(await movesOf(c, spare.id), [], "a starting amount of zero writes no move");
      await sumsOf(c);
      await savePot(db, c, { ...trip, saved: "12000" }, "confirmed", OWN);
      await savePot(db, c, { ...trip, saved: "9000" }, "confirmed", OWN);
      assert.deepEqual((await movesOf(c, trip.id)).map(m => m.amountMinor).sort((a, b) => a - b), [-3000, 2000, 10_000]);
      assert.equal(await saved(trip.id), 9000); await sumsOf(c);
      await savePot(db, c, waiting, "pending", OWN);
      assert.deepEqual(await movesOf(c, waiting.id), [], "a pending pot has no moves yet");
      await confirmPending(db, c, "pot", waiting.id);
      assert.deepEqual((await movesOf(c, waiting.id)).map(m => [m.kind, m.amountMinor]), [["adjust", 700]]);
      await sumsOf(c);
      const fillInvoice = await invoice(c, "Northwind", 10_000);
      await db.transaction(tx => fillPots(tx, c, 15_000, fillInvoice, "Northwind's payment"));
      const fill = (await movesOf(c, spare.id))[0];
      assert.deepEqual([fill.kind, fill.amountMinor, fill.invoiceId, fill.movedOn], ["fill", 1500, fillInvoice, DEMO_DATE]);
      assert.equal(fill.id, (await filled(c))[0].id, "the fill's id is its pot_filled event's id");
      await sumsOf(c);
      await movePot(db, c, move({ potId: trip.id, kind: "add", amountMinor: 500, reason: "A bonus" }), "confirmed", OWN);
      await movePot(db, c, move({ potId: trip.id, kind: "take_out", amountMinor: 1200 }), "confirmed", OWN);
      await movePot(db, c, move({ potId: trip.id, kind: "spend", amountMinor: 800 }), "confirmed", OWN);
      await sumsOf(c);
      const carry = move({ potId: trip.id, kind: "carry", toPotId: spare.id, amountMinor: 2000 });
      await movePot(db, c, carry, "confirmed", OWN);
      const pair = (await movesOf(c, spare.id)).find(m => m.kind === "carry")!;
      assert.deepEqual([pair.amountMinor, pair.pairId], [2000, (await movesOf(c, trip.id)).find(m => m.kind === "carry")!.pairId]);
      assert.equal(await saved(trip.id), 9000 + 500 - 1200 - 800 - 2000); assert.equal(await saved(spare.id), 1500 + 2000); await sumsOf(c);
      const later = move({ potId: trip.id, kind: "take_out", amountMinor: 100 }), laterCarry = move({ potId: spare.id, kind: "carry", toPotId: trip.id, amountMinor: 50 });
      await movePot(db, c, later, "pending", OWN); await movePot(db, c, laterCarry, "pending", OWN);
      assert.equal(await saved(trip.id), 9000 + 500 - 1200 - 800 - 2000, "a pending move counts for nothing");
      const state = await stateOf(c);
      assert.deepEqual(state.pendingMoves!.map(m => [m.kind, m.minor]).sort(), [["carry", -50], ["carry", 50], ["take_out", -100]]);
      assert.equal((await events(c, "to_check")).filter(e => e.refType === "pot_move").length, 2);
      await db.transaction(tx => confirmMove(tx, c, later.id)); await sumsOf(c);
      assert.equal(await db.transaction(tx => confirmMove(tx, c, later.id)), false, "a move confirms once");
      await db.transaction(tx => confirmMove(tx, c, laterCarry.id)); await sumsOf(c);
      assert.deepEqual([await saved(trip.id), await saved(spare.id)], [9000 + 500 - 1200 - 800 - 2000 - 100 + 50, 1500 + 2000 - 50]);
      const drop = move({ potId: trip.id, kind: "take_out", amountMinor: 10 });
      await movePot(db, c, drop, "pending", OWN);
      assert.equal(await removePendingMove(db, c, drop.id), true);
      assert.equal(await removePendingMove(db, c, drop.id), false);
      const dropCarry = move({ potId: trip.id, kind: "carry", toPotId: spare.id, amountMinor: 10 });
      await movePot(db, c, dropCarry, "pending", OWN);
      assert.equal(await removePendingMove(db, c, dropCarry.id), true);
      assert.deepEqual((await stateOf(c)).pendingMoves, [], "a carry goes with its partner row");
      assert.equal(await removePot(db, c, spare.id), true); await sumsOf(c);
      assert.equal((await db.select().from(schema.potMoves).where(eq(schema.potMoves.potId, spare.id))).length, 0, "removing a pot removes its moves");
      const log = await loadPotMoves(db, c);
      assert.ok(log.every(m => m.potName === "Trip" || m.potName === "Waiting") && log.every(m => /^\d{4}-\d\d-\d\d$/.test(m.on)));
      assert.equal((await events(c, "pot_moved")).length >= 5, true);
      const money = (await stateOf(c)).pots.find(p => p.id === trip.id)!;
      assert.deepEqual([money.became, money.lastMovedOn], [800, DEMO_DATE], "became is what was spent");
    });

    await check("movePot refuses in words: other households' and pending pots, more than a pot holds, the tax pot spent, too much for a purchase, money into a done pot", async () => {
      const c = await seedBen(db, { isDemo: true });
      const small = input({ name: "Small", saved: "1000" }), tax = input({ name: "Tax", saved: "5000", category: "government_tax" }), other = input({ name: "Other", saved: "5000" }), waiting = input({ name: "Later" });
      for (const p of [small, tax, other]) await savePot(db, c, p, "confirmed", OWN);
      await savePot(db, c, waiting, "pending", OWN);
      const foreign = input({ name: "Foreign", saved: "100" }); await savePot(db, b, foreign, "confirmed", OWN);
      await refused(c, move({ potId: foreign.id, kind: "take_out" }), /Choose one of your pots/);
      await refused(c, move({ potId: small.id, kind: "carry", toPotId: foreign.id }), /Choose one of your pots/);
      await refused(c, move({ potId: waiting.id, kind: "add" }), /still waiting in To check/);
      await refused(c, move({ potId: small.id, kind: "carry", toPotId: waiting.id, amountMinor: 10 }), /still waiting in To check/);
      await refused(c, move({ potId: small.id, kind: "take_out", amountMinor: 1001 }), /holds ¥1,000, which is less than that/);
      await refused(c, move({ potId: small.id, kind: "take_out", amountMinor: 1001 }), /holds ¥1,000/, "pending");
      await refused(c, move({ potId: small.id, kind: "take_out", amountMinor: 0 }), /above zero/);
      await refused(c, move({ potId: small.id, kind: "take_out", amountMinor: 1.5 }), /above zero/);
      await refused(c, move({ potId: small.id, kind: "carry", toPotId: small.id }), /different pot/);
      await refused(c, move({ potId: small.id, kind: "add", toPotId: other.id }), /second pot/);
      await refused(c, move({ potId: small.id, kind: "add", purchase: { kind: "charge", id: randomUUID(), on: null } }), /Only money spent/);
      await refused(c, move({ potId: small.id, kind: "take_out", choiceId: randomUUID() }), /Only money added/);
      await refused(c, move({ potId: small.id, kind: "add", done: true }), /marked done at once/);
      await refused(c, move({ potId: small.id, kind: "take_out", done: true }), /for you to do/, "pending");
      await refused(c, move({ potId: small.id, kind: "take_out", reason: "x".repeat(201) }), /200 characters/);
      await refused(c, move({ potId: small.id, kind: "take_out", memberId: memberB }), /member of this household/);
      await refused(c, move({ potId: small.id, kind: "take_out", amountMinor: null }), /Enter an amount/);
      await refused(c, move({ potId: tax.id, kind: "spend", amountMinor: 100 }), /ready for tax, so it can't be marked as spent/);
      await refused(c, move({ potId: tax.id, kind: "carry", toPotId: small.id, amountMinor: 100 }), /never to or from another pot/);
      await refused(c, move({ potId: small.id, kind: "carry", toPotId: tax.id, amountMinor: 100 }), /never to or from another pot/);
      await movePot(db, c, move({ potId: tax.id, kind: "take_out", amountMinor: 100 }), "confirmed", OWN); // taking out is allowed
      const card = (await first(db.select().from(schema.cards).where(eq(schema.cards.householdId, c)))).id;
      const charge = (await first(db.insert(schema.charges).values({ householdId: c, cardId: card, merchant: "Fictional cafe", amountMinor: 1200, currency: "JPY", date: "2026-11-10", source: "manual" }).returning())).id;
      const purchase = { kind: "charge", id: charge, on: null } as const;
      await refused(c, move({ potId: other.id, kind: "spend", amountMinor: 1300, purchase }), /Fictional cafe cost ¥1,200 and pots have already covered ¥0/);
      await refused(c, move({ potId: small.id, kind: "spend", amountMinor: 1200, purchase }), /holds ¥1,000/);
      await movePot(db, c, move({ potId: small.id, kind: "spend", amountMinor: 700, purchase }), "confirmed", OWN);
      await refused(c, move({ potId: other.id, kind: "spend", amountMinor: 600, purchase }), /already covered ¥700/);
      await refused(c, move({ potId: small.id, kind: "spend", amountMinor: 100, purchase: { kind: "charge", id: randomUUID(), on: null } }), /Choose one of your charges/);
      await movePot(db, c, move({ potId: other.id, kind: "spend", amountMinor: null, purchase }), "confirmed", OWN); // takes what is left of the purchase, ¥500
      assert.equal(await saved(other.id), 4500);
      await assert.rejects(movePot(db, c, move({ potId: other.id, kind: "spend", amountMinor: null, purchase }), "confirmed", OWN), /holds nothing to spend|already covered all/);
      await movePot(db, c, move({ potId: small.id, kind: "take_out", amountMinor: 200, done: true }), "confirmed", OWN);
      assert.equal((await rowOf(small.id)).doneOn, DEMO_DATE);
      await refused(c, move({ potId: other.id, kind: "carry", toPotId: small.id, amountMinor: 10 }), /Small is done and takes no more money/);
      await refused(c, move({ potId: small.id, kind: "add" }), /done and takes no more money/);
      await movePot(db, c, move({ potId: small.id, kind: "take_out", amountMinor: 100 }), "confirmed", OWN); // a done pot can still give money
      const dupe = move({ potId: other.id, kind: "add", amountMinor: 10 });
      await movePot(db, c, dupe, "confirmed", OWN); await movePot(db, c, dupe, "confirmed", OWN);
      assert.equal((await movesOf(c, other.id)).filter(m => m.id === dupe.id).length, 1, "the same move again is the same row");
      await assert.rejects(movePot(db, c, { ...dupe, amountMinor: 11 }, "confirmed", OWN), /already in use/);
      await sumsOf(c);
      const mine = (await events(c, "pot_moved")).find(e => e.refId === dupe.id)!;
      assert.deepEqual([mine.refType, mine.title, mine.notify], ["pot_move", "Added ¥10 to Other", false]);
    });

    await check("a move takes its member from the input, else from the maker; a bill is a purchase on one of its days; a done pot never fills; markPotDone sets the day once", async () => {
      const c = await seedBen(db, { isDemo: true });
      const memberC = (await first(db.select().from(schema.members).where(eq(schema.members.householdId, c)))).id;
      const pool = input({ name: "Pool", saved: "5000", fillPct: "50" });
      await savePot(db, c, pool, "confirmed", OWN);
      const a1 = move({ potId: pool.id, kind: "add", amountMinor: 10 }), a2 = move({ potId: pool.id, kind: "add", amountMinor: 20, memberId: memberC }), a3 = move({ potId: pool.id, kind: "add", amountMinor: 30 });
      await movePot(db, c, a1, "confirmed", { madeBy: "form", memberId: memberC });
      await movePot(db, c, a2, "confirmed", OWN); await movePot(db, c, a3, "confirmed", OWN);
      const memberOf = async (id: string) => (await first(db.select().from(schema.potMoves).where(eq(schema.potMoves.id, id)))).memberId;
      assert.deepEqual([await memberOf(a1.id), await memberOf(a2.id), await memberOf(a3.id)], [memberC, memberC, null]);
      const bill = (await first(db.insert(schema.bills).values({ householdId: c, biller: "Fictional power", amountMinor: 3000, currency: "JPY", due: "2026-12-01", category: "utilities" }).returning())).id;
      await refused(c, move({ potId: pool.id, kind: "spend", amountMinor: 100, purchase: { kind: "bill", id: bill, on: null } }), /which day of the bill/);
      const spend = move({ potId: pool.id, kind: "spend", amountMinor: null, purchase: { kind: "bill", id: bill, on: "2026-12-01" } });
      await movePot(db, c, spend, "confirmed", OWN);
      const row = await first(db.select().from(schema.potMoves).where(eq(schema.potMoves.id, spend.id)));
      assert.deepEqual([row.amountMinor, row.billId, row.billOn], [-3000, bill, "2026-12-01"]);
      assert.deepEqual((await loadPotMoves(db, c)).find(m => m.id === spend.id)!.purchase, { kind: "bill", id: bill, on: "2026-12-01", label: "Fictional power" });
      await db.delete(schema.bills).where(eq(schema.bills.id, bill));
      assert.deepEqual((await loadPotMoves(db, c)).find(m => m.id === spend.id)!.purchase, { kind: "bill", id: "", on: "2026-12-01", label: "A removed purchase" });
      assert.equal(await markPotDone(db, c, pool.id), true);
      assert.equal(await markPotDone(db, c, pool.id), false, "done is set once");
      assert.equal(await markPotDone(db, c, randomUUID()), false);
      assert.equal(await (async () => { const inv = await invoice(c, "Northwind", 100); return db.transaction(tx => fillPots(tx, c, 10_000, inv, "x")); })(), 0, "a done pot never fills");
      assert.deepEqual((await movesOf(c, pool.id)).filter(m => m.kind === "fill"), []);
    });

    await check("each partial unique index on the moves refuses a second row", async () => {
      const c = await seedBen(db, { isDemo: true });
      const p = input({ name: "Unique", saved: "100000" }), q = input({ name: "Unique too", saved: "100000" });
      await savePot(db, c, p, "confirmed", OWN); await savePot(db, c, q, "confirmed", OWN);
      const card = (await first(db.select().from(schema.cards).where(eq(schema.cards.householdId, c)))).id;
      const charge = (await first(db.insert(schema.charges).values({ householdId: c, cardId: card, merchant: "Fictional shop", amountMinor: 900, currency: "JPY", date: "2026-11-10", source: "manual" }).returning())).id;
      const bill = (await first(db.insert(schema.bills).values({ householdId: c, biller: "Fictional water", amountMinor: 900, currency: "JPY", due: "2026-12-01", category: "utilities" }).returning())).id;
      const inv = await invoice(c, "Northwind", 100);
      const row = (over: Partial<typeof schema.potMoves.$inferInsert>): typeof schema.potMoves.$inferInsert => ({ householdId: c, potId: p.id, kind: "spend", amountMinor: -1, currency: "JPY", status: "confirmed", movedOn: DEMO_DATE, confirmedAt: new Date(), ...over });
      const twice = async (first_: Partial<typeof schema.potMoves.$inferInsert>, constraint: string, second?: Partial<typeof schema.potMoves.$inferInsert>) => {
        await db.insert(schema.potMoves).values(row(first_));
        await assert.rejects(db.insert(schema.potMoves).values(row(second ?? first_)), violates(constraint), constraint);
      };
      await twice({ kind: "fill", amountMinor: 5, invoiceId: inv }, "pot_moves_fill_invoice_uq");
      await twice({ chargeId: charge }, "pot_moves_spend_charge_uq");
      await twice({ billId: bill, billOn: "2026-12-01" }, "pot_moves_spend_bill_uq");
      const pair = randomUUID();
      await twice({ kind: "carry", amountMinor: -5, pairId: pair }, "pot_moves_carry_uq");
      await db.insert(schema.potMoves).values(row({ potId: q.id, kind: "fill", amountMinor: 5, invoiceId: inv }));
      await db.insert(schema.potMoves).values(row({ billId: bill, billOn: "2027-01-01" }));
      await db.insert(schema.potMoves).values(row({ potId: q.id, kind: "carry", amountMinor: 5, pairId: pair }));
    });

    await check("choices save, confirm, withdraw and remove; a repeat is the same row; refusals are in words", async () => {
      const c = await seedBen(db, { isDemo: true });
      const choice = (over: Partial<ChoiceInput> = {}): ChoiceInput => ({ id: randomUUID(), source: "said", happenedOn: "2026-11-10", aboutMinor: 1800, words: "Skipped the taxi", category: null, foundKey: null, memberId: null, ...over });
      const said = choice({ category: "transport" });
      assert.equal(await saveChoice(db, c, said, "confirmed", OWN), said.id);
      await saveChoice(db, c, said, "confirmed", OWN);
      assert.equal((await events(c, "choice_added")).length, 1);
      await assert.rejects(saveChoice(db, c, { ...said, aboutMinor: 1 }, "confirmed", OWN), /already in use/);
      const found = choice({ source: "found", foundKey: "found:subscription:1", words: "Cancelled an unused subscription" });
      await saveChoice(db, c, found, "pending", OWN);
      assert.deepEqual((await stateOf(c)).pendingChoices!.map(x => [x.id, x.words, x.minor]), [[found.id, found.words, 1800]]);
      assert.deepEqual((await loadChoices(db, c)).map(x => x.id), [said.id], "a pending choice is not on the record");
      assert.equal((await events(c, "to_check")).filter(e => e.refType === "choice").length, 1);
      await assert.rejects(saveChoice(db, c, choice({ source: "found", foundKey: "found:subscription:1" }), "pending", OWN), /already found/);
      assert.equal(await db.transaction(tx => confirmChoice(tx, c, found.id)), true);
      assert.equal(await db.transaction(tx => confirmChoice(tx, c, found.id)), false);
      assert.deepEqual((await stateOf(c)).pendingChoices, []);
      const all = await loadChoices(db, c);
      assert.deepEqual(all.map(x => [x.source, x.category, x.confirmedOn, x.withdrawnOn]), [["said", "transport", DEMO_DATE, null], ["found", null, DEMO_DATE, null]]);
      assert.equal(await withdrawChoice(db, c, said.id), true);
      assert.equal(await withdrawChoice(db, c, said.id), false);
      assert.equal(await withdrawChoice(db, c, randomUUID()), false);
      assert.equal((await loadChoices(db, c)).find(x => x.id === said.id)!.withdrawnOn, DEMO_DATE, "the row stays, with the day");
      const draft = choice({ words: "A draft" });
      await saveChoice(db, c, draft, "pending", OWN);
      assert.equal(await removePendingChoice(db, c, found.id), false, "a confirmed choice is never removed this way");
      assert.equal(await removePendingChoice(db, c, draft.id), true);
      assert.equal(await removePendingChoice(db, c, draft.id), false);
      for (const [bad, words] of [[{ aboutMinor: 0 }, /above zero/], [{ words: "  " }, /what it was about/], [{ words: "x".repeat(161) }, /160/], [{ source: "found" as const }, /needs its key/],
        [{ foundKey: "k" }, /Only something the app found/], [{ memberId: memberB }, /member of this household/]] as const) {
        await assert.rejects(saveChoice(db, c, choice(bad), "confirmed", OWN), (e: unknown) => e instanceof Error && words.test(e.message), JSON.stringify(bad));
      }
      const addChoice = input({ name: "For choices", saved: "1000" });
      await savePot(db, c, addChoice, "confirmed", OWN);
      await movePot(db, c, move({ potId: addChoice.id, kind: "add", amountMinor: 1800, choiceId: said.id }), "confirmed", OWN);
      assert.equal((await loadPotMoves(db, c)).find(m => m.choiceId === said.id)!.minor, 1800);
      await refused(c, move({ potId: addChoice.id, kind: "add", choiceId: randomUUID() }), /Choose one of your choices/);
    });

    await check("keeping a found saving recomputes the amount, refuses a second keep, and with a pot writes the choice and the add together", async () => {
      const c = await seedBen(db, { isDemo: true });
      const [card] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, c));
      for (const [date, amount] of [["2026-07-10", "20000"], ["2026-08-10", "20000"], ["2026-09-10", "20000"], ["2026-10-10", "5000"]] as const) {
        await insertCharge(db, c, chargeInput.parse({ id: randomUUID(), cardId: card.id, merchant: "Fictional clinic", amount, date, category: "health" }), "confirmed", "manual", OWN);
      }
      const key = "2026-10:cost:health:fictional clinic";
      const trip = input({ name: "Keep trip", saved: "0" }), tax = input({ name: "Keep tax", saved: "0", category: "government_tax" });
      await savePot(db, c, trip, "confirmed", OWN); await savePot(db, c, tax, "confirmed", OWN);
      await assert.rejects(keepFoundWin(db, c, { foundKey: "2026-10:cost:food:nothing", potId: null }, OWN), /isn't in your records any more/);
      await assert.rejects(keepFoundWin(db, c, { foundKey: "nonsense", potId: null }, OWN), /isn't in your records any more/);
      await assert.rejects(keepFoundWin(db, c, { foundKey: key, potId: tax.id }, OWN), /ready for tax/);
      await assert.rejects(keepFoundWin(db, c, { foundKey: key, potId: randomUUID() }, OWN), /Choose one of your pots/);
      assert.deepEqual(await loadChoices(db, c), [], "a refusal keeps nothing");
      const id = await keepFoundWin(db, c, { foundKey: key, potId: trip.id }, OWN);
      const [kept] = await loadChoices(db, c);
      assert.deepEqual([kept.id, kept.source, kept.foundKey, kept.minor, kept.category, kept.happenedOn], [id, "found", key, 15_000, "health", "2026-10-31"], "the amount is worked out from the records");
      assert.deepEqual((await loadPotMoves(db, c)).filter(m => m.choiceId === id).map(m => [m.potId, m.kind, m.minor]), [[trip.id, "add", 15_000]]);
      assert.equal(await saved(trip.id), 15_000);
      await sumsOf(c);
      await assert.rejects(keepFoundWin(db, c, { foundKey: key, potId: null }, OWN), /already kept/);
      assert.equal((await loadChoices(db, c)).length, 1);
      assert.equal((await loadPotMoves(db, c)).filter(m => m.choiceId === id).length, 1, "a second keep adds nothing");
    });

    console.log(`Pots checks passed (${tally.passed}).`);
  } finally {
    await pg.close();
  }
}
main().catch(error => { console.error("Pots checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : error); process.exitCode = 1; });

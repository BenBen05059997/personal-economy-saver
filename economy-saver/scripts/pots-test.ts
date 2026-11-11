// Pots and planning (D43): the maths in plan.ts, the one starting-cash rule in the engine, the pot writes and the
// fill rule on a client payment. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/pots-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { confirmPending } from "@/db/confirm";
import { InputError } from "@/db/input-error";
import { markPaidOutside } from "@/db/invoice-paid";
import { loadMoneyState } from "@/db/household";
import { fillPots, parseFillBp, potInput, removePot, savePot } from "@/db/pots";
import { seedBen } from "@/db/seed";
import { loadNavigationData } from "@/db/workspace";
import { applyVerifiedDelivery } from "@/lib/events";
import type { CaptureOrder } from "@/lib/paypal/contracts";
import { addMonths, monthlyRoom, monthsUntil, planFor, planLine, potLine, potSummary, roomLine } from "@/lib/money/plan";
import { availableCash, low, roomOnCard, safeToSpend, series } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { toCheck } from "@/lib/money/to-check";
import { benMoney } from "@/lib/sample/ben";
import type { MoneyState, Pot } from "@/lib/money/types";

const TODAY = "2026-11-14";
const pot = (over: Partial<Pot> = {}): Pot => ({ id: "pot-1", name: "Tax", saved: 10_000, ...over });

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    // ------------------------------------------------------------ pure maths
    await check("months: addMonths clamps to the month end; monthsUntil counts whole months, at least 1", () => {
      assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
      assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
      assert.equal(addMonths("2026-11-14", 4), "2027-03-14");
      assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
      assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
      assert.equal(monthsUntil(TODAY, "2027-03-31"), 4);
      assert.equal(monthsUntil(TODAY, "2027-03-14"), 4);
      assert.equal(monthsUntil(TODAY, "2027-03-13"), 3);
      assert.equal(monthsUntil(TODAY, "2026-12-01"), 1, "under a month rounds up to one");
      assert.equal(monthsUntil(TODAY, TODAY), 1);
      assert.equal(monthsUntil(TODAY, "2026-01-01"), 1, "a date in the past still divides by one");
    });

    await check("monthlyRoom is the expected series at day 30 less its start, on Ben ¥92,220", () => {
      const expected = series(benMoney, "expected");
      assert.equal(monthlyRoom(benMoney), expected[expected.length - 1] - expected[0]);
      assert.equal(expected.length, 30);
      assert.equal(monthlyRoom(benMoney), 92_220);
      assert.equal(roomLine(benMoney), "The next 30 days leave about ¥92,220 if clients pay as usual. That's what you could put aside.");
      const bare = { ...benMoney, invoices: [] };
      assert.ok(monthlyRoom(bare) < 0, "bills and statements with nothing coming in leave nothing over");
      assert.equal(roomLine(bare), "No client payments are expected in the next 30 days, so there's nothing new to put aside yet.");
      const unpaid = { ...benMoney, invoices: benMoney.invoices.filter(invoice => invoice.status !== "sent") };
      assert.ok(monthlyRoom(unpaid) < 0, "without a sent invoice the month is a net outflow");
      assert.equal(roomLine(unpaid), "No client payments are expected in the next 30 days, so there's nothing new to put aside yet.");
    });

    await check("planFor: needed, whole months, monthly needed rounded up, fits against the room", () => {
      const goal = planFor({ target: 1_200_000, saved: 0, targetDate: "2027-03-31" }, benMoney);
      assert.deepEqual([goal.needed, goal.months, goal.monthlyNeeded, goal.fits, goal.monthlyRoom], [1_200_000, 4, 300_000, false, 92_220]);
      assert.equal(planFor({ target: 1_000_001, saved: 0, targetDate: "2027-03-31" }, benMoney).monthlyNeeded, 250_001, "rounds up to the yen");
      assert.equal(planFor({ target: 1_000_000, saved: 200_000, targetDate: "2027-03-31" }, benMoney).monthlyNeeded, 200_000, "saved counts");
      const fits = planFor({ target: 270_000, saved: 0, targetDate: "2027-02-14" }, benMoney);
      assert.deepEqual([fits.months, fits.monthlyNeeded, fits.fits], [3, 90_000, true]);
      assert.equal(planFor({ target: 276_660, saved: 0, targetDate: "2027-02-14" }, benMoney).fits, true, "exactly the room fits");
      assert.equal(planFor({ target: 276_661, saved: 0, targetDate: "2027-02-14" }, benMoney).fits, false, "one yen more does not");
      const done = planFor({ target: 50_000, saved: 80_000, targetDate: "2027-02-14" }, benMoney);
      assert.deepEqual([done.needed, done.monthlyNeeded, done.fits, done.monthsAtPace, done.reachedOn], [0, 0, true, 0, TODAY]);
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
      assert.equal(monthlyRoom(usd), 0);
      const plan = planFor({ target: 100, saved: 0, targetDate: "2027-02-14" }, usd);
      assert.deepEqual([plan.months, plan.monthlyNeeded], [3, 33.34], "$33.34, rounded up to the cent");
      assert.equal(planLine({ target: 100, saved: 0, targetDate: "2027-02-14" }, plan, usd), "$33.34 a month to reach $100 by Feb 2027. The next 30 days leave nothing over if clients pay as usual, so it does not fit.");
      const input = { target: 1_200_000, saved: 0, targetDate: "2027-03-31" };
      assert.equal(planLine(input, planFor(input, benMoney), benMoney),
        "¥300,000 a month to reach ¥1,200,000 by Mar 2027. The next 30 days leave about ¥92,220 if clients pay as usual, so it does not fit.");
      const pace = { target: 1_200_000, saved: 0 };
      assert.equal(planLine(pace, planFor(pace, benMoney), benMoney), "At ¥92,220 a month (what the next 30 days leave) you would reach ¥1,200,000 around Jan 2028.");
      assert.equal(planLine({ ...pace, monthly: 100_000 }, planFor({ ...pace, monthly: 100_000 }, benMoney), benMoney), "At ¥100,000 a month you would reach ¥1,200,000 around Nov 2027.");
      assert.equal(planLine(pace, planFor(pace, { ...benMoney, invoices: [] }), { ...benMoney, invoices: [] }), "The next 30 days leave nothing over if clients pay as usual, so there is no date to give for ¥1,200,000.");
      assert.equal(potLine(pot({ target: 1_200_000, targetDate: "2027-03-31", saved: 0 }), benMoney), "¥300,000 a month to reach ¥1,200,000 by Mar 2027. More than what the next 30 days leave.");
      assert.equal(potLine(pot({ target: 270_000, targetDate: "2027-02-14", saved: 0 }), benMoney), "¥90,000 a month to reach ¥270,000 by Feb 2027. Fits within what the next 30 days leave.");
      assert.equal(potLine(pot({ target: 5_000 }), benMoney), "Target reached");
      assert.equal(potLine(pot(), benMoney), undefined);
      assert.equal(potSummary(pot(), benMoney), "Tax ¥10,000 set aside");
      assert.equal(potSummary(pot({ name: "Car", saved: 200_000, target: 1_200_000, targetDate: "2027-03-31" }), benMoney), "Car ¥200,000 of ¥1,200,000 · by Mar 2027");
    });

    await check("availableCash is the one starting cash: pots lower the series, the low point, safe to spend, card room and the sentence together", () => {
      assert.equal(availableCash(benMoney), 128_000);
      const empty = { ...benMoney, pots: [] };
      assert.deepEqual(Array.from(series(empty, "worst")), Array.from(series(benMoney, "worst")));
      assert.equal(homeSentence(benMoney).emphasis, "¥18,780 short on the 27th.");
      assert.equal(safeToSpend(benMoney, 0).amount, 0);
      assert.equal(roomOnCard(benMoney, "card-b").room, 173_770);
      assert.equal(roomOnCard(benMoney, "card-a").room, 173_770);
      const rich = { ...benMoney, bank: benMoney.bank + 40_000 }; // low point +¥21,220
      const potted = { ...rich, pots: [pot({ saved: 10_000 })] };
      assert.equal(availableCash(potted), availableCash(rich) - 10_000);
      assert.equal(safeToSpend(rich, 0).amount, 21_220);
      assert.equal(safeToSpend(potted, 0).amount, 11_220, "safe to spend is ¥10,000 lower");
      assert.equal(low(series(potted, "worst")).amount, low(series(rich, "worst")).amount - 10_000);
      assert.equal(low(series(potted, "expected")).amount, low(series(rich, "expected")).amount - 10_000);
      assert.equal(safeToSpend(potted, 0).cash, 128_000 + 40_000 - 10_000, "cash is bank + PayPal less pots");
      assert.equal(roomOnCard(potted, "card-b").room, roomOnCard(rich, "card-b").room - 10_000);
      assert.match(homeSentence(rich).lead, /fine for the next 30 days/);
      const flipped = { ...rich, pots: [pot({ saved: 30_000 })] };
      assert.match(homeSentence(flipped).lead, /You're fine if Acme and Northwind pay as usual/);
      assert.equal(homeSentence(flipped).emphasis, "¥8,780 short on the 27th.", "a ¥30,000 pot flips the sentence");
      assert.equal(monthlyRoom(flipped), monthlyRoom(rich), "the room is what the month adds, not what is set aside");
      const pending = { ...rich, pendingPots: [pot({ saved: 30_000 })] };
      assert.equal(safeToSpend(pending, 0).amount, 21_220, "a pending pot counts for nothing");
    });

    await check("the sentence as parts (box 1): lead + emphasis + the day, the clients and the short flag, with the same words as before", () => {
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
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const first = async <T,>(rows: Promise<T[]>) => (await rows)[0];
    const events = (hid: string, kind: string) => db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, kind)));
    const rowOf = (id: string) => first(db.select().from(schema.pots).where(eq(schema.pots.id, id)));
    const stateOf = (hid: string) => loadMoneyState(db, hid, TODAY);
    const input = (over: Partial<ReturnType<typeof potInput.parse>> = {}) => potInput.parse({ id: randomUUID(), name: "Fictional trip", ...over });
    const memberB = (await first(db.select().from(schema.members).where(eq(schema.members.householdId, b)))).id;

    await check("Ben starts with no pots, so the loaded state and every demo number are unchanged", async () => {
      const state = await stateOf(a);
      assert.deepEqual([state.pots, state.pendingPots], [[], []]);
      assert.equal(homeSentence(state).emphasis, "¥18,780 short on the 27th.");
      assert.equal(roomOnCard(state, state.cards[0].id).room, 173_770);
    });

    await check("the pots table refuses bad rows in SQL", async () => {
      const base = { householdId: a, currency: "JPY", name: "Fictional" };
      for (const bad of [{ name: "" }, { name: "x".repeat(61) }, { targetMinor: 0 }, { savedMinor: -1 }, { fillBp: 0 }, { fillBp: 10_001 }]) {
        await assert.rejects(db.insert(schema.pots).values({ ...base, ...bad }), JSON.stringify(bad));
      }
      await assert.rejects(db.insert(schema.pots).values({ ...base, memberId: memberB }), "a member of another household cannot be referenced");
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
      assert.deepEqual(state.pots, [{ id: car.id, name: "Car", saved: 200_000, target: 1_200_000, targetDate: "2027-03-31", startedOn: TODAY, fillPct: 12.5 }]);
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
      (await first(db.insert(schema.invoices).values({ householdId: hid, clientId: await clientOf(hid, client), status: "sent", item: "Fictional poster", amountMinor: usdCents, currency: "USD", sentOn: TODAY, ...over }).returning())).id;
    const saved = async (id: string) => (await rowOf(id)).savedMinor;
    const filled = (hid: string) => events(hid, "pot_filled");

    await check("fillPots adds the share to every confirmed pot with a rule, half up, one event each, and nothing for the rest", async () => {
      const c = await seedBen(db, { isDemo: true });
      const tax = input({ name: "Tax", fillPct: "25", saved: "1000" }), tenth = input({ name: "Tenth", fillPct: "10" });
      const car = input({ name: "Car", target: "100000" }), waiting = input({ name: "Waiting", fillPct: "50" });
      for (const p of [tax, tenth, car]) await savePot(db, c, p, "confirmed", { madeBy: "form" });
      await savePot(db, c, waiting, "pending", { madeBy: "form" });
      assert.equal(await db.transaction(tx => fillPots(tx, c, 37_500, "Acme Corp's payment")), 2);
      assert.deepEqual([await saved(tax.id), await saved(tenth.id), await saved(car.id), await saved(waiting.id)], [1000 + 9375, 3750, 0, 0]);
      const rows = await filled(c);
      assert.deepEqual(rows.map(r => r.title).sort(), ["Set aside ¥3,750 for Tenth (10% of Acme Corp's payment)", "Set aside ¥9,375 for Tax (25% of Acme Corp's payment)"]);
      assert.ok(rows.every(r => r.refType === "pot" && !r.notify));
      assert.equal(await db.transaction(tx => fillPots(tx, c, 0, "x")), 0);
      await db.transaction(tx => fillPots(tx, c, 5, "tiny")); // 10% of 5 = 0.5 -> 1; 25% of 5 = 1.25 -> 1
      assert.deepEqual([await saved(tax.id), await saved(tenth.id)], [1000 + 9375 + 1, 3750 + 1]);
      await db.transaction(tx => fillPots(tx, c, 4, "tiny")); // 10% of 4 = 0.4 -> 0, skipped; 25% -> 1
      assert.deepEqual([await saved(tax.id), await saved(tenth.id)], [1000 + 9375 + 2, 3751]);
      assert.equal((await filled(c)).length, 5, "a share that rounds to zero records nothing");
      await assert.rejects(db.transaction(tx => fillPots(tx, c, -1, "x")));
      await assert.rejects(db.transaction(tx => fillPots(tx, c, 1.5, "x")));
    });

    await check("marking an invoice paid outside PayPal fills the pots: 25% of a $250 payment at the stored rate", async () => {
      const c = await seedBen(db, { isDemo: true });
      const tax = input({ name: "Tax", fillPct: "25" }), plain = input({ name: "Car", target: "500000" });
      await savePot(db, c, tax, "confirmed", { madeBy: "form" }); await savePot(db, c, plain, "confirmed", { madeBy: "form" });
      const inv = await invoice(c, "Northwind", 25_000);
      const bank = async () => (await first(db.select().from(schema.households).where(eq(schema.households.id, c)))).bankBalanceMinor;
      const start = await bank();
      assert.equal(await markPaidOutside(db, c, inv, TODAY), true);
      assert.equal(await bank(), start + 37_500, "the whole payment is credited to the bank");
      assert.equal(await saved(tax.id), 9_375, "$250 x 150 = ¥37,500; a quarter is ¥9,375");
      assert.equal(await saved(plain.id), 0);
      const rows = await filled(c);
      assert.deepEqual(rows.map(r => r.title), ["Set aside ¥9,375 for Tax (25% of Northwind's payment)"]);
      assert.equal(await markPaidOutside(db, c, inv, TODAY), false);
      assert.equal(await saved(tax.id), 9_375, "a repeat never fills twice");
      assert.equal((await filled(c)).length, 1);
      const state = await stateOf(c);
      assert.equal(availableCash(state), 128_000 + 37_500 - 9_375, "the pot's share is not spendable");
    });

    await check("a verified completed payment fills the pots after the credit, once", async () => {
      const c = await seedBen(db, { isDemo: true }), d = await seedBen(db, { isDemo: true });
      const tax = input({ name: "Tax", fillPct: "25" }), other = input({ name: "Other", fillPct: "40" });
      await savePot(db, c, tax, "confirmed", { madeBy: "form" }); await savePot(db, d, other, "confirmed", { madeBy: "form" });
      const order = "ORDER-FICTIONAL-POTS";
      const inv = await invoice(c, "Northwind", 25_000, { paypalOrderId: order, paypalPayeeId: "SELLERFICTIONAL" });
      const connection = async (hid: string) => (await first(db.select().from(schema.paypalConnections).where(eq(schema.paypalConnections.householdId, hid)))).balanceMinor;
      const [start, startD] = [await connection(c), await connection(d)];
      const event = { id: "WH-POTS-PAID", event_type: "PAYMENT.CAPTURE.COMPLETED", create_time: "2026-11-14T16:00:00Z", resource: { id: "CAP-POTS", status: "COMPLETED",
        amount: { currency_code: "USD", value: "250.00" }, custom_id: inv, supplementary_data: { related_ids: { order_id: order } } } };
      const capture: CaptureOrder = async () => { throw new Error("A completed payment is not captured again"); };
      await applyVerifiedDelivery(db, event, capture);
      await applyVerifiedDelivery(db, event, capture);
      assert.equal(await connection(c), start + 37_500);
      assert.equal(await saved(tax.id), 9_375);
      assert.equal(await saved(other.id), 0, "another household's pot is not touched");
      assert.equal(await connection(d), startD);
      const rows = await filled(c);
      assert.deepEqual(rows.map(r => [r.title, r.refId]), [["Set aside ¥9,375 for Tax (25% of Northwind's payment)", tax.id]]);
      assert.equal((await events(c, "invoice_paid")).filter(e => e.refId === inv).length, 1);
      assert.equal((await filled(d)).length, 0);
      // The available cash is the credited balance less the pot.
      const state = await stateOf(c);
      assert.equal(availableCash(state), state.paypal + state.bank - 9_375);
    });

    await check("every pot read and write is scoped by household", async () => {
      const x = await seedBen(db, { isDemo: true }), y = await seedBen(db, { isDemo: true });
      const px = input({ name: "Only X", fillPct: "10", saved: "100" });
      await savePot(db, x, px, "confirmed", { madeBy: "form" });
      assert.deepEqual((await stateOf(y)).pots, []);
      assert.equal((await stateOf(x)).pots.length, 1);
      await db.transaction(tx => fillPots(tx, y, 100_000, "Y's payment"));
      assert.equal(await saved(px.id), 100);
      assert.equal(await removePot(db, y, px.id), false);
      assert.equal(await confirmPending(db, y, "pot", px.id), false);
      await assert.rejects(savePot(db, y, px, "confirmed", { madeBy: "form" }));
      await assert.rejects(savePot(db, "", px, "confirmed", { madeBy: "form" }), /household id is required/);
      await assert.rejects(db.transaction(tx => fillPots(tx, "", 1, "x")), /household id is required/);
      assert.equal(await saved(px.id), 100);
      assert.equal((await loadNavigationData(db, y)).pending, (await loadNavigationData(db, await seedBen(db, { isDemo: true }))).pending);
    });

    console.log(`Pots checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}
main().catch(error => { console.error("Pots checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : error); process.exitCode = 1; });

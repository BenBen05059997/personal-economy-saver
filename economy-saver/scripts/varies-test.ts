// A monthly bill whose amount varies (D54): the estimate (average of the last three real bills, the stored amount before any),
// a month with a real bill counted once, the rule in the runway, the month view, the search items and the split, the linking
// rule (same name key and category, one real bill a month) on every path that saves or confirms a bill (the form's insert, To
// check, the reader), Settings' edit (unlink, relink, varies off) and the database constraints. Fictional data only; PGlite.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/varies-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { billEditInput, billInput, checkSchedule, insertBill, linkToSeries, previewLink, removeBill, updateBill } from "@/db/bills";
import { confirmPending } from "@/db/confirm";
import { loadMoneyState, type Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { readerInbox } from "@/db/reader-inbox";
import { reviewReading } from "@/db/readings";
import { seedBen } from "@/db/seed";
import { loadSpending } from "@/db/spending";
import { tools, type ToolContext } from "@/lib/agent/tools";
import { sharedBillsComing } from "@/lib/money/family";
import { monthByCategory, monthText } from "@/lib/money/month";
import { regularCosts } from "@/lib/money/regular";
import { cancelNotices, expandBills, variesEstimate } from "@/lib/money/repeat";
import { addDays, low, planWindow, series } from "@/lib/money/runway";
import { splitBalance } from "@/lib/money/split";
import { spendingItems, type SpendingInput } from "@/lib/money/spending";
import { linkPreview, seriesToJoin } from "@/lib/money/varies";
import { benMoney, benStoredBills } from "@/lib/sample/ben";
import type { Bill, MoneyState, RealBill, SplitState } from "@/lib/money/types";

const TODAY = "2026-11-14";
const bill = (over: Partial<Bill> & Pick<Bill, "id" | "biller" | "amount" | "due">): Bill => ({ category: "utilities", businessBp: 0, status: "confirmed", ...over });
const gas = bill({ id: "gas", biller: "Fictional Gas", amount: 6_500, due: "2026-08-10", repeatUnit: "month", repeatDay: 10, amountVaries: true });
const real = (id: string, due: string, amount: number, over: Partial<Bill> = {}) => bill({ id, biller: `Fictional Gas ${Number(due.slice(5, 7))}月分`, amount, due, seriesBillId: "gas", ...over });
const r = (due: string, amountMinor: number): RealBill => ({ due, amountMinor });
const occurrences = (bills: Bill[]) => bills.filter(b => b.id.startsWith("gas@")).map(b => [b.due, b.amount, b.estimated ?? false]);

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

  // ---------------------------------------------------------------- the estimate (pure)
  await check("variesEstimate: no real bills → the stored amount; one, two, three and five → the average of the last three before the date, rounded half up", () => {
    assert.equal(variesEstimate([], 6_500, "2026-12-10"), 6_500);
    assert.equal(variesEstimate([r("2026-09-12", 5_400)], 6_500, "2026-12-10"), 5_400);
    assert.equal(variesEstimate([r("2026-09-12", 5_400), r("2026-10-12", 6_600)], 6_500, "2026-12-10"), 6_000);
    assert.equal(variesEstimate([r("2026-10-12", 9_500), r("2026-09-12", 9_000), r("2026-11-12", 9_490)], 6_500, "2026-12-10"), 9_330, "order of the list does not matter");
    const five = [r("2026-06-12", 1_000), r("2026-07-12", 2_000), r("2026-08-12", 9_000), r("2026-09-12", 9_500), r("2026-10-12", 9_501)];
    assert.equal(variesEstimate(five, 6_500, "2026-12-10"), 9_334, "the last three: (9,000 + 9,500 + 9,501) / 3 = 9,333.67");
    assert.equal(variesEstimate([r("2026-09-12", 1), r("2026-10-12", 2)], 0, "2026-12-10"), 2, "1.5 rounds up");
    assert.equal(variesEstimate(five, 6_500, "2026-08-01"), 1_500, "only real bills due before the occurrence count");
    assert.equal(variesEstimate(five, 6_500, "2026-06-01"), 6_500, "none before: the stored amount");
  });

  await check("expandBills: an amount-varies series is estimated in every month without a real bill and has no occurrence in a month with one", () => {
    assert.deepEqual(occurrences(expandBills([gas], TODAY, "2027-01-31", "JPY")), [["2026-12-10", 6_500, true], ["2027-01-10", 6_500, true]], "no real bills: the stored amount, marked estimated");
    const bills = [gas, real("g9", "2026-09-12", 5_400), real("g10", "2026-10-12", 6_600), real("g12", "2026-12-08", 7_100)];
    const out = expandBills(bills, "2026-11-01", "2027-02-28", "JPY");
    assert.deepEqual(occurrences(out), [["2026-11-10", 6_000, true], ["2027-01-10", 6_367, true], ["2027-02-10", 6_367, true]],
      "Nov: (5,400 + 6,600) / 2; Dec has its real bill; Jan and Feb: (5,400 + 6,600 + 7,100) / 3");
    assert.deepEqual(out.filter(b => b.id === "g12").map(b => [b.due, b.amount, b.estimated]), [["2026-12-08", 7_100, undefined]], "the real bill is counted once, on its own date, as itself");
    assert.ok(out.filter(b => b.id.startsWith("gas@")).every(b => b.startsOn === "2026-08-10" && b.startAmount === 6_500 && b.id === `gas@${b.due}`));
    assert.deepEqual(occurrences(expandBills([{ ...gas, status: "pending" }], TODAY, "2027-01-31", "JPY")), [], "a pending series never expands");
    const notLinked = expandBills([gas, { ...real("g12", "2026-12-08", 7_100), seriesBillId: undefined }], TODAY, "2026-12-31", "JPY");
    assert.deepEqual(occurrences(notLinked), [["2026-12-10", 6_500, true]], "a bill with the same name but no link is not the series' real bill");
    const pendingReal = expandBills([gas, real("g12", "2026-12-08", 7_100, { status: "pending" })], TODAY, "2026-12-31", "JPY");
    assert.deepEqual(occurrences(pendingReal), [["2026-12-10", 6_500, true]], "a pending real bill does not replace the estimate");
  });

  await check("a real bill paid after its month still belongs to its own due month; the next month is estimated with it", () => {
    const late = expandBills([gas, real("g11", "2026-11-28", 8_000)], "2026-11-01", "2026-12-31", "JPY");
    assert.deepEqual(occurrences(late), [["2026-12-10", 8_000, true]], "Nov 10 is replaced by the bill due Nov 28; Dec 10 averages it");
    const nextMonth = expandBills([gas, real("g11", "2026-12-02", 8_000)], "2026-11-01", "2026-12-31", "JPY");
    assert.deepEqual(occurrences(nextMonth), [["2026-11-10", 6_500, true]], "a bill due Dec 2 is December's: November keeps its estimate");
  });

  await check("a USD household rounds the estimate to the cent; an estimate without the currency is refused", () => {
    const usd = { ...gas, amount: 65 };
    const out = expandBills([usd, real("u9", "2026-09-12", 54.12), real("u10", "2026-10-12", 60.01)], TODAY, "2026-12-31", "USD");
    assert.deepEqual(occurrences(out), [["2026-12-10", 57.07, true]], "(54.12 + 60.01) / 2 = 57.065 → 57.07");
    assert.throws(() => expandBills([usd], TODAY, "2026-12-31"), /home currency/);
    assert.doesNotThrow(() => expandBills(benStoredBills, TODAY, "2026-12-31"), "no amount-varies bill: no currency needed");
    assert.deepEqual(cancelNotices([{ ...gas, cancelBy: "2026-11-30" }, real("g11", "2026-11-12", 7_000)], TODAY, "JPY").map(n => [n.renewsOn, n.amount]), [["2026-12-10", 7_000]],
      "a cancel-by row names the renewal at its estimate");
  });

  await check("the runway counts a month once: adding December's real bill moves the series by exactly real − estimate after the 10th, never twice", () => {
    const end = addDays(benMoney.today, planWindow(benMoney) - 1);
    const state = (bills: Bill[]): MoneyState => ({ ...benMoney, bills: expandBills([...benStoredBills, ...bills], benMoney.today, end, "JPY") });
    const before = state([gas, real("g9", "2026-09-12", 5_400), real("g10", "2026-10-12", 6_600)]);
    const after = state([gas, real("g9", "2026-09-12", 5_400), real("g10", "2026-10-12", 6_600), real("g12", "2026-12-08", 7_100)]);
    for (const kind of ["worst", "expected"] as const) {
      const a = series(before, kind), b = series(after, kind);
      a.forEach((value, i) => {
        const date = addDays(benMoney.today, i);
        const diff = b[i] - value;
        assert.equal(diff, date < "2026-12-08" ? 0 : date < "2026-12-10" ? -7_100 : -(7_100 - 6_000), `${kind} ${date}`);
      });
    }
    assert.equal(low(series(after, "worst")).amount - low(series(before, "worst")).amount, Math.min(0, low(series(after, "worst")).amount - low(series(before, "worst")).amount), "the low can only fall");
    assert.deepEqual(series(state([]), "worst"), series(benMoney, "worst"), "Ben with no varying bill: his numbers do not move");
  });

  // ---------------------------------------------------------------- the same rule in the month view, the items and the split
  await check("spendingItems and the month view: a month with a real bill counts it alone; other months, past or future, count the estimate (marked)", () => {
    const input: SpendingInput = { homeCurrency: "JPY", cards: [], split: { members: [{ id: "kenji" }] }, bills: [gas, real("g9", "2026-09-12", 5_400), real("g10", "2026-10-12", 6_600)], charges: [] };
    const items = spendingItems(input, "2026-08-01", "2026-12-31").map(i => [i.id, i.date, i.amountMinor, i.estimated ?? false]);
    assert.deepEqual(items, [["gas", "2026-08-10", 6_500, true], ["g9", "2026-09-12", 5_400, false], ["g10", "2026-10-12", 6_600, false], ["gas", "2026-11-10", 6_000, true], ["gas", "2026-12-10", 6_000, true]]);
    assert.deepEqual(spendingItems(input, "2026-11-01", "2026-11-30").map(i => i.amountMinor), [6_000], "the estimate reads real bills outside the range");
    const expanded: SpendingInput = { ...input, bills: expandBills(input.bills, TODAY, "2027-03-31", "JPY") };
    assert.deepEqual(spendingItems(expanded, "2026-08-01", "2026-12-31"), spendingItems(input, "2026-08-01", "2026-12-31"), "the engine's occurrences give the same items");
    assert.equal(monthByCategory(input, TODAY, "2026-10").totalMinor, 6_600, "October: the real bill only");
    assert.equal(monthByCategory(input, TODAY, "2026-11").totalMinor, 6_000, "November: the estimate");
    const [cost] = regularCosts(spendingItems(input, "2026-09-01", "2026-11-30"), "JPY", TODAY).items;
    assert.deepEqual([cost.label, cost.months.map(m => m.amountMinor)], ["Fictional Gas", [5_400, 6_600, 6_000]], "Regular costs: the series and its real bills are one cost, one amount a month");
  });

  await check("the split: a shared amount-varies bill splits the estimate in a month without a real bill and nothing in a month with one", () => {
    const split: SplitState = {
      members: [{ id: "a", name: "Aoi", shareBp: 5_000 }, { id: "b", name: "Ren", shareBp: 5_000 }], since: "2026-09-01", settledThrough: null, settledAt: null, charges: [],
      bills: [
        { id: "gas", biller: "Fictional Gas", amountMinor: 6_500, due: "2026-08-10", paidBy: "a", createdAt: "2026-08-01T00:00:00.000Z", repeatUnit: "month", repeatDay: 10, repeatUntil: null, nextAmountMinor: null, nextAmountFrom: null, varies: [r("2026-10-12", 5_000)] },
        { id: "g10", biller: "Fictional Gas 10月分", amountMinor: 5_000, due: "2026-10-12", paidBy: "a", createdAt: "2026-10-01T00:00:00.000Z", repeatUnit: null, repeatDay: null, repeatUntil: null, nextAmountMinor: null, nextAmountFrom: null },
      ],
    };
    const balance = splitBalance(split, TODAY);
    assert.equal(balance.items, 3, "Sep (estimate 6,500), Oct (the real 5,000), Nov (estimate 5,000)");
    assert.equal(balance.members[0].paidMinor, 6_500 + 5_000 + 5_000);
  });

  // ---------------------------------------------------------------- the linking rule (pure)
  await check("seriesToJoin and linkPreview: one series with the same name key and category, no real bill that month yet", () => {
    const tokyo = { id: "s1", biller: "Fictional Gas", category: "utilities" as const, due: "2026-12-10", repeatDay: 10 };
    assert.equal(seriesToJoin([tokyo], [], { biller: "Fictional Gas (2026年11月分)", category: "utilities", due: "2026-11-12" })?.id, "s1", "date words do not matter");
    assert.equal(seriesToJoin([tokyo], [], { biller: "Fictional Gas", category: "other", due: "2026-11-12" }), null, "another category");
    assert.equal(seriesToJoin([tokyo], [], { biller: "Fictional Gasoline", category: "utilities", due: "2026-11-12" }), null, "another name");
    assert.equal(seriesToJoin([tokyo], [{ seriesBillId: "s1", due: "2026-11-02" }], { biller: "Fictional Gas", category: "utilities", due: "2026-11-30" }), null, "the month has its real bill");
    assert.equal(seriesToJoin([tokyo], [{ seriesBillId: "s1", due: "2026-10-02" }], { biller: "Fictional Gas", category: "utilities", due: "2026-11-30" })?.id, "s1");
    assert.equal(seriesToJoin([tokyo, { ...tokyo, id: "s2" }], [], { biller: "Fictional Gas", category: "utilities", due: "2026-11-12" }), null, "two series match: none is chosen");
    const stored = [{ id: "gas", biller: "Fictional Gas", category: "utilities" as const, due: "2026-08-10", repeatDay: 10, storedMinor: 6_500 }];
    const linked = [{ seriesBillId: "gas", ...r("2026-09-12", 9_000) }, { seriesBillId: "gas", ...r("2026-10-12", 9_500) }, { seriesBillId: "gas", ...r("2026-11-05", 9_490) }];
    assert.deepEqual(linkPreview(stored, linked, { biller: "Fictional Gas 12月分", category: "utilities", due: "2026-12-04" }), { seriesId: "gas", biller: "Fictional Gas", month: "2026-12", estimateMinor: 9_330 });
    assert.equal(linkPreview(stored, linked, { biller: "Fictional Gas", category: "utilities", due: "2026-11-20" }), null, "November has its real bill");
    assert.deepEqual(linkPreview(stored, linked, { biller: "Fictional Gas", category: "utilities", due: "2026-07-20" })?.estimateMinor, null, "before the series starts: no estimate to replace");
    assert.deepEqual(linkPreview(stored, [], { biller: "Fictional Gas", category: "utilities", due: "2026-12-20" })?.estimateMinor, 6_500, "no real bill yet: the stored amount");
  });

  // ---------------------------------------------------------------- the database: constraints, every path, edit
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  const store = db as unknown as Db;
  await migrate(db, { migrationsFolder: "./drizzle" });
  const hid = await seedBen(db, { isDemo: true }); // the demo clock: today is 2026-11-14
  const form = { madeBy: "form" as const };
  const add = (over: Partial<Parameters<typeof billInput.parse>[0]>) => {
    const id = randomUUID();
    return insertBill(store, hid, billInput.parse({ id, biller: "Sakura Gas", amount: "6000", due: "2026-12-10", category: "utilities", ...over }), "confirmed", form);
  };
  const row = async (id: string) => (await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.id, id))))[0];
  const event = async (id: string) => (await db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.refId, id))).orderBy(schema.events.occurredAt)).at(-1)!;
  const gasOccurrences = async (seriesId: string) => (await loadMoneyState(store, hid, TODAY)).bills.filter(b => b.id.startsWith(`${seriesId}@`)).map(b => [b.due, b.amount, b.estimated ?? false]);

  await check("Ben's seeded household has no amount-varies bill and loads the sample's runway", async () => {
    const state = await loadMoneyState(store, hid, TODAY);
    assert.ok(state.bills.every(b => !b.amountVaries && b.seriesBillId === undefined));
    assert.deepEqual(series(state, "worst"), series(benMoney, "worst"));
  });

  await check("D48 and varies together are refused in words, on the form and in the database; a yearly or one-off bill cannot vary", async () => {
    const schedule = { repeat: "month" as const, nextAmountMinor: null, nextAmountFrom: null, cancelBy: null, repeatUntil: null, amountVaries: true };
    assert.doesNotThrow(() => checkSchedule("2026-12-10", TODAY, schedule));
    assert.throws(() => checkSchedule("2026-12-10", TODAY, { ...schedule, nextAmountMinor: 7_000, nextAmountFrom: "2027-01-10" }), /leave the new amount empty/);
    assert.throws(() => checkSchedule("2026-12-10", TODAY, { ...schedule, repeat: "year" }), /repeats every month/);
    await assert.rejects(add({ repeat: "month", amountVaries: true, nextAmount: "7000", nextAmountFrom: "2027-01-10" }), InputError);
    await assert.rejects(add({ repeat: null, amountVaries: true }), /repeats every month/);
    await assert.rejects(pg.query(`insert into bills(household_id, biller, amount_minor, currency, due, category, repeat_unit, amount_varies) values ($1, 'x', 1, 'JPY', '2026-12-01', 'utilities', 'year', true)`, [hid]), /bills_amount_varies_monthly/);
    await assert.rejects(pg.query(`insert into bills(household_id, biller, amount_minor, currency, due, category, repeat_unit, repeat_day, series_bill_id) values ($1, 'x', 1, 'JPY', '2026-12-01', 'utilities', 'month', 1, $2)`, [hid, randomUUID()]), /bills_series_one_off|foreign key/);
  });

  const series1 = await add({ repeat: "month", amountVaries: true, amount: "6500" });
  let oct = "", nov = "", dec = "";
  await check("insertBill (the form): the series says it varies; past one-offs with the same name key link and say so; the estimate is their average", async () => {
    assert.equal((await event(series1)).body, "Amount varies every month");
    assert.deepEqual(await gasOccurrences(series1), [["2026-12-10", 6_500, true]]);
    oct = await add({ biller: "Sakura Gas 10月分", amount: "5400", due: "2026-10-12" });
    nov = await add({ biller: "Sakura Gas 11月分", amount: "6600", due: "2026-11-12" });
    assert.equal((await row(oct)).seriesBillId, series1);
    assert.equal((await row(nov)).seriesBillId, series1);
    assert.equal((await event(nov)).body, "Linked to Sakura Gas: counts toward its estimate", "the series starts in December: November had no estimate");
    assert.deepEqual(await gasOccurrences(series1), [["2026-12-10", 6_000, true]], "(5,400 + 6,600) / 2");
    const other = await add({ biller: "Sakura Gas 11月分", amount: "100", due: "2026-11-20", category: "other" });
    assert.equal((await row(other)).seriesBillId, null, "another category does not link");
  });

  await check("a real bill for December replaces its estimate and is counted once; a second one that month is its own bill", async () => {
    const before = await loadMoneyState(store, hid, TODAY);
    dec = await add({ biller: "Sakura Gas", amount: "7100", due: "2026-12-08" });
    assert.equal((await event(dec)).body, "Linked to Sakura Gas: replaces December’s estimate");
    const after = await loadMoneyState(store, hid, TODAY);
    assert.deepEqual(after.bills.filter(b => b.id.startsWith(`${series1}@`)), [], "December's estimate is gone (January is past the window)");
    const last = (s: number[]) => s[s.length - 1];
    assert.equal(last(series(after, "worst")) - last(series(before, "worst")), -(7_100 - 6_000), "the month moves by the difference, never twice");
    const second = await add({ biller: "Sakura Gas", amount: "300", due: "2026-12-20" });
    assert.equal((await row(second)).seriesBillId, null, "December already has its real bill");
    assert.equal((await event(second)).body, null);
    await removeBill(store, hid, second);
  });

  await check("To check (confirmPending): an agent's pending bill links only once confirmed, and the confirm event says so", async () => {
    const id = randomUUID();
    await insertBill(store, hid, billInput.parse({ id, biller: "Sakura Gas 2027年1月分", amount: "6800", due: "2027-01-12", category: "utilities" }), "pending", { madeBy: "ask" });
    assert.equal((await row(id)).seriesBillId, null);
    assert.equal(await confirmPending(store, hid, "bill", id), true);
    assert.equal((await row(id)).seriesBillId, series1);
    assert.equal((await event(id)).body, "Linked to Sakura Gas: replaces January 2027’s estimate");
    assert.equal(await linkToSeries(store, hid, id), null, "already linked: nothing again");
    await removeBill(store, hid, id);
  });

  await check("the reader: the review line is worked out before confirming, and confirming links the bill", async () => {
    const [document] = await db.insert(schema.documents).values({ householdId: hid, kind: "upload", storagePath: "fictional/varies.pdf", mime: "application/pdf", status: "read" }).returning();
    const value = { kind: "bill" as const, name: "Sakura Gas 2月分", date: "2027-02-12", amountMinor: 7_300, currency: "JPY" as const, category: "utilities" as const, cardId: null, businessBp: null, repeat: null, nextAmountMinor: null, nextAmountFrom: null, cancelBy: null, repeatUntil: null };
    const [reading] = await db.insert(schema.readings).values({ householdId: hid, documentId: document.id, extracted: { original: value, proposed: value }, target: "bill" }).returning();
    const inbox = await readerInbox(store, hid);
    assert.deepEqual(inbox.readings.find(item => item.id === reading.id)!.link,
      { seriesId: series1, biller: "Sakura Gas", month: "2027-02", estimateMinor: Math.round((5_400 + 6_600 + 7_100) / 3) }, "the review card's line, before any series occurrence is in the engine's window");
    assert.equal(await previewLink(store, hid, { biller: "Sakura Gas", category: "utilities", due: "2026-12-30" }), null, "December has its real bill");
    assert.equal(await reviewReading(store, hid, reading.id, value), true);
    const [made] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.biller, "Sakura Gas 2月分")));
    assert.equal(made.seriesBillId, series1);
    assert.equal((await event(made.id)).body, "Linked to Sakura Gas: replaces February 2027’s estimate");
    await removeBill(store, hid, made.id);
  });

  const edit = async (id: string, over: Partial<Parameters<typeof billEditInput.parse>[0]>) => {
    const b = await row(id);
    return updateBill(store, hid, billEditInput.parse({ id, biller: b.biller, amount: String(b.amountMinor), due: b.due, category: b.category, businessBp: b.businessBp, ...over }), form);
  };
  await check("a last payment (D41): a series has no estimate after it and a real bill dated after it does not link", () => {
    const ended = bill({ id: "gas", biller: "Fictional Gas", amount: 6_500, due: "2026-08-10", repeatUnit: "month", repeatDay: 10, amountVaries: true, repeatUntil: "2026-12-10" });
    assert.deepEqual(expandBills([ended], "2026-11-14", "2027-03-31", "JPY").map(b => b.due), ["2026-12-10"], "Dec 10 is the last estimate");
    const s = { id: "gas", biller: "Fictional Gas", category: "utilities" as const, due: "2026-08-10", repeatDay: 10, until: "2026-12-10" };
    assert.equal(seriesToJoin([s], [], { biller: "Fictional Gas", category: "utilities", due: "2026-12-05" })?.id, "gas");
    assert.equal(seriesToJoin([s], [], { biller: "Fictional Gas", category: "utilities", due: "2027-01-05" }), null, "after the last payment it is its own bill");
  });

  await check("Settings → Edit: unlink, relink, a taken month and a category change are refused, varies off frees the real bills", async () => {
    assert.equal(await edit(dec, { seriesBillId: null }), true);
    assert.equal((await row(dec)).seriesBillId, null);
    assert.equal((await event(dec)).body, "No longer part of Sakura Gas");
    assert.deepEqual(await gasOccurrences(series1), [["2026-12-10", 6_000, true]], "December is estimated again");
    assert.equal(await edit(dec, { seriesBillId: series1 }), true);
    assert.equal((await event(dec)).body, "Part of Sakura Gas: replaces December’s estimate");
    assert.equal(await edit(dec, {}), true, "absent fields keep the link");
    assert.equal((await row(dec)).seriesBillId, series1);
    const extra = await add({ biller: "Sakura Gas", amount: "200", due: "2026-12-21" });
    await assert.rejects(edit(extra, { seriesBillId: series1 }), /already has a real bill for December/);
    await assert.rejects(edit(dec, { category: "other" }), /has its category, Utilities/);
    await assert.rejects(edit(series1, { seriesBillId: series1 }), /Only a one-off/);
    await removeBill(store, hid, extra);
    assert.equal(await edit(series1, { amount: "6400" }), true, "a varying bill's amount is its stored amount, with no date");
    assert.equal((await row(series1)).amountMinor, 6_400);
    assert.equal((await row(series1)).nextAmountMinor, null);
    assert.equal(await edit(series1, { amountVaries: false }), true);
    assert.equal((await event(series1)).body, "Amount no longer varies · 3 real bills stay as one-offs");
    for (const id of [oct, nov, dec]) assert.equal((await row(id)).seriesBillId, null);
    assert.deepEqual(await gasOccurrences(series1), [["2026-12-10", 6_400, false]], "a plain monthly bill again");
    assert.equal(await edit(series1, { amountVaries: true }), true);
    assert.equal((await event(series1)).body, "Amount varies every month");
    const fixed = await add({ biller: "Fictional Water", repeat: "month", amount: "3000", due: "2026-12-05", nextAmount: "3200", nextAmountFrom: "2027-01-05" });
    await assert.rejects(edit(fixed, { amountVaries: true }), /already changes to ¥3,200 from Jan 5, 2027/);
  });

  await check("removing a series keeps its real bills as one-offs in the same household (only series_bill_id is cleared)", async () => {
    assert.equal(await edit(dec, { seriesBillId: series1 }), true);
    assert.equal(await removeBill(store, hid, series1), true);
    const kept = await row(dec);
    assert.equal(kept.seriesBillId, null);
    assert.equal(kept.householdId, hid);
  });

  await check("loadSpending reads linked bills before the range", async () => {
    const other = await seedBen(db, { isDemo: true });
    const s2 = randomUUID();
    await insertBill(store, other, billInput.parse({ id: s2, biller: "Sakura Gas", amount: "6000", due: "2026-12-10", category: "utilities", repeat: "month", amountVaries: true }), "confirmed", form);
    const id = randomUUID();
    await insertBill(store, other, billInput.parse({ id, biller: "Sakura Gas 10月分", amount: "5000", due: "2026-10-12", category: "utilities" }), "confirmed", form);
    const spending = await loadSpending(store, other, { from: "2026-12-01", to: "2026-12-31" });
    assert.ok(spending.bills.some(b => b.id === id), "the October bill is read for December's estimate");
    assert.deepEqual(spendingItems(spending, "2026-12-01", "2026-12-31").filter(i => i.label === "Sakura Gas").map(i => [i.id, i.amountMinor, i.estimated]), [[s2, 5_000, true]]);
  });

  await check("the estimate flag travels: the family list, Where the month goes, Regular costs and the timeline, month_by_category and regular_costs tools all say about", async () => {
    const own = await seedBen(db, { isDemo: true });
    await insertBill(store, own, billInput.parse({ id: randomUUID(), biller: "Fictional Water", amount: "6000", due: "2026-11-20", category: "utilities", repeat: "month", amountVaries: true }), "confirmed", form);
    const state = await loadMoneyState(store, own, TODAY);
    assert.deepEqual(sharedBillsComing(state).filter(b => b.biller === "Fictional Water").map(b => [b.date, b.amountMinor, b.estimated]), [["2026-11-20", 6_000, true]]);
    assert.ok(sharedBillsComing(state).filter(b => b.biller !== "Fictional Water").every(b => b.estimated === undefined), "a real bill carries no flag");
    const spending = await loadSpending(store, own, { from: "2026-08-01", to: "2026-11-30" });
    const view = monthByCategory(spending, TODAY);
    assert.deepEqual(view.categories.flatMap(c => c.items).filter(i => i.label === "Fictional Water").map(i => i.estimated), [true]);
    assert.ok(view.categories.flatMap(c => c.items).filter(i => i.label !== "Fictional Water").every(i => i.estimated === undefined));
    assert.match(monthText(view), /Fictional Water Nov 20 about ¥6,000/);
    const regular = regularCosts(spendingItems(spending, "2026-09-01", "2026-11-30"), "JPY", TODAY, 3).items.find(c => c.label === "Fictional Water")!;
    assert.deepEqual([regular.months.at(-1)!.estimated, regular.estimated], [true, true]);
    const ctx: ToolContext = { madeBy: "ask", db: store, householdId: own, state: () => loadMoneyState(store, own, TODAY), appUrl: new URL("http://127.0.0.1:3123") };
    const run = async (name: string, input: unknown) => { const tool = tools.find(t => t.name === name)!; return tool.run(ctx, tool.input.parse(input) as never); };
    assert.match(await run("month_by_category", {}), /Fictional Water Nov 20 about ¥6,000/);
    const timeline = JSON.parse(await run("timeline", { scenario: "as_usual" })) as { events: { label: string; estimated?: true }[] };
    assert.deepEqual(timeline.events.filter(e => e.label === "Fictional Water").map(e => e.estimated), [true]);
    assert.ok(timeline.events.filter(e => e.label !== "Fictional Water").every(e => e.estimated === undefined));
    const regulars = JSON.parse(await run("regular_costs", { months: 3 })) as { items: { label: string; estimated?: true; months: { estimated?: true }[] }[] };
    assert.deepEqual(regulars.items.filter(c => c.label === "Fictional Water").map(c => c.months.at(-1)!.estimated), [true]);
    const first = state.bills.find(b => b.biller === "Fictional Water" && b.estimated)!;
    assert.equal(first.amount, 6_000);
  });

  console.log(`varies-test: ${passed} checks passed`);
}

main().catch(error => { console.error(error); process.exit(1); });

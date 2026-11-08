// Missing data (D55): an amount or a date not known yet. The estimate (average of the last three real bills, low and high), the
// forecast (usual counts the average, late the high, no history counts nothing, an unknown date is today), the list of gaps with
// its urgency and words, the sentence note, the month view, regular costs and the split, then the database: the two CHECKs, adding
// and editing with "not known yet", fillGap, the reader, the agent tools. Fictional data only; PGlite where it needs a database.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/gaps-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { billEditInput, billInput, fillGap, fillGapFromText, insertBill, updateBill } from "@/db/bills";
import { loadMoneyState, type Db } from "@/db/household";
import { loadNavigationData, loadWorkspaceData } from "@/db/workspace";
import { InputError } from "@/db/input-error";
import { reviewReading } from "@/db/readings";
import { seedBen } from "@/db/seed";
import { loadSpending } from "@/db/spending";
import { tools, type ToolContext } from "@/lib/agent/tools";
import { readingForm, readingUnknown } from "@/lib/reader/form";
import { sharedBillsComing } from "@/lib/money/family";
import { GAP_HISTORY, URGENT_DAYS, confirmedGaps, gapAmountWords, gapCountedWords, gapDateWords, gapEstimate, gapMeanwhileWords, gapQuestion, gapUncountedWords, gapUrgencyWords, openGaps, type Gap } from "@/lib/money/gaps";
import { monthByCategory, monthText } from "@/lib/money/month";
import { nameKey, normalise } from "@/lib/money/name-key";
import { regularCosts } from "@/lib/money/regular";
import { cancelNotices, expandBills, variesEstimate } from "@/lib/money/repeat";
import { addDays, dueItems, low, planWindow, series, timeline } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { splitBalance } from "@/lib/money/split";
import { searchLine, searchSpending, spendingItems, type SpendingInput } from "@/lib/money/spending";
import { statusAnswer } from "@/lib/money/ask";
import { toCheck } from "@/lib/money/to-check";
import { benMoney, benStoredBills } from "@/lib/sample/ben";
import type { MoneyState, RealBill, SplitState, StoredBill } from "@/lib/money/types";

const TODAY = "2026-11-14"; // Ben's day, and the demo clock of a seeded household
const END = addDays(TODAY, planWindow(benMoney) - 1);
const r = (due: string, amountMinor: number): RealBill => ({ due, amountMinor });
const stored = (over: Partial<StoredBill> & Pick<StoredBill, "id" | "biller">): StoredBill => ({ amount: null, due: null, category: "utilities", businessBp: 0, status: "confirmed", ...over });
/** Three earlier real bills with the name Minato Gas: 75,000 + 100,000 + 150,000 = an average of 108,333, a high of 150,000. */
const history = [
  stored({ id: "h8", biller: "Minato Gas 8月分", amount: 75_000, due: "2026-08-20" }),
  stored({ id: "h9", biller: "Minato Gas 9月分", amount: 100_000, due: "2026-09-20" }),
  stored({ id: "h10", biller: "Minato Gas 10月分", amount: 150_000, due: "2026-10-20" }),
];
const stateWith = (bills: StoredBill[], base: MoneyState = benMoney): MoneyState => ({ ...base, bills: expandBills([...benStoredBills, ...bills], TODAY, END, "JPY") });
const gasGap = (over: Partial<StoredBill> = {}) => stored({ id: "gap", biller: "Minato Gas", due: "2026-11-20", ...over });

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

  // ---------------------------------------------------------------- the estimate (pure)
  await check("gapEstimate: the last three real amounts, average rounded half up, low and high; 1, 2, 3 and 5 bills; none → null", () => {
    assert.equal(GAP_HISTORY, 3);
    assert.equal(URGENT_DAYS, 3);
    assert.equal(gapEstimate([], "2026-12-10"), null);
    assert.deepEqual(gapEstimate([r("2026-09-12", 8_640)], "2026-12-10"), { averageMinor: 8_640, lowMinor: 8_640, highMinor: 8_640, count: 1 });
    assert.deepEqual(gapEstimate([r("2026-09-12", 8_640), r("2026-10-12", 10_020)], "2026-12-10"), { averageMinor: 9_330, lowMinor: 8_640, highMinor: 10_020, count: 2 });
    assert.deepEqual(gapEstimate([r("2026-10-12", 9_330), r("2026-09-12", 8_640), r("2026-11-12", 10_020)], "2026-12-10"), { averageMinor: 9_330, lowMinor: 8_640, highMinor: 10_020, count: 3 }, "order of the list does not matter");
    const five = [r("2026-06-12", 1_000), r("2026-07-12", 2_000), r("2026-08-12", 9_000), r("2026-09-12", 9_500), r("2026-10-12", 9_501)];
    assert.deepEqual(gapEstimate(five, "2026-12-10"), { averageMinor: 9_334, lowMinor: 9_000, highMinor: 9_501, count: 3 }, "the last three of five: 9,333.67");
    assert.equal(gapEstimate([r("2026-09-12", 1), r("2026-10-12", 2)], null)!.averageMinor, 2, "1.5 rounds up");
    assert.deepEqual(gapEstimate(five, "2026-08-01"), { averageMinor: 1_500, lowMinor: 1_000, highMinor: 2_000, count: 2 }, "only real bills due before its date count");
    assert.equal(gapEstimate(five, "2026-06-12"), null, "a bill due on the same day is not before it");
    assert.equal(gapEstimate(five, null)!.count, 3, "no date: the latest three");
    assert.equal(variesEstimate(five, 6_500, "2026-12-10"), 9_334, "variesEstimate uses the same average");
    assert.equal(variesEstimate([], 6_500, "2026-12-10"), 6_500);
  });

  // ---------------------------------------------------------------- stored → engine bills (pure)
  await check("expandBills: an unknown amount is estimated from the bills with its name key and category (one-offs with a known amount and date), or uncounted", () => {
    const out = stateWith([...history, gasGap()]).bills.find(b => b.id === "gap")!;
    assert.deepEqual([out.amountUnknown, out.estimated, out.amount, out.amountHigh, out.uncounted, out.dueUnknown], [true, true, 108_333, 150_000, undefined, undefined]);
    assert.deepEqual(out.basis, { count: 3, low: 75_000, high: 150_000, from: "bills" });
    const wrongCategory = stateWith([...history.map(h => ({ ...h, category: "food" as const })), gasGap()]).bills.find(b => b.id === "gap")!;
    assert.deepEqual([wrongCategory.uncounted, wrongCategory.amount, wrongCategory.estimated, wrongCategory.basis], [true, 0, undefined, undefined], "another category is not history");
    const otherName = stateWith([...history.map(h => ({ ...h, biller: h.biller.replace("Minato Gas", "Minato Water") })), gasGap()]).bills.find(b => b.id === "gap")!;
    assert.equal(otherName.uncounted, true, "another name key is not history");
    const noHistory = stateWith([gasGap()]).bills.find(b => b.id === "gap")!;
    assert.deepEqual([noHistory.amount, noHistory.uncounted, noHistory.estimated, noHistory.amountHigh, noHistory.basis], [0, true, undefined, undefined, undefined]);
    const repeating = stateWith([...history.map(h => ({ ...h, repeatUnit: "month" as const, repeatDay: 20 })), gasGap()]).bills.find(b => b.id === "gap")!;
    assert.equal(repeating.uncounted, true, "a repeating bill is not a real bill");
    const pendingHistory = stateWith([...history.map(h => ({ ...h, status: "pending" as const })), gasGap()]).bills.find(b => b.id === "gap")!;
    assert.equal(pendingHistory.uncounted, true, "a pending bill is not history");
    const unknownHistory = stateWith([...history.slice(0, 2), stored({ id: "h10", biller: "Minato Gas 10月分", due: "2026-10-20" }), gasGap()]).bills.find(b => b.id === "gap")!;
    assert.deepEqual([unknownHistory.basis!.count, unknownHistory.amount], [2, 87_500], "a bill whose amount is not known is no history");
    const later = stateWith([...history, stored({ id: "h12", biller: "Minato Gas 12月分", amount: 900_000, due: "2026-12-20" }), gasGap()]).bills.find(b => b.id === "gap")!;
    assert.equal(later.amount, 108_333, "a real bill dated after it is not before its date");
    const noDate = stateWith([...history, stored({ id: "h12", biller: "Minato Gas 12月分", amount: 900_000, due: "2026-12-20" }), gasGap({ due: null })]).bills.find(b => b.id === "gap")!;
    assert.deepEqual([noDate.dueUnknown, noDate.due, noDate.basis!.count, noDate.amount], [true, TODAY, 3, Math.round((100_000 + 150_000 + 900_000) / 3)], "no date: today, and the latest three");
    assert.throws(() => expandBills([gasGap()], TODAY, END), /home currency/);
  });

  await check("an amount-varies series: its real bills (D54) are the history; a linked bill without an amount takes its month but is in no average; a series without an amount estimates each month", () => {
    const seriesBill = stored({ id: "gas", biller: "Minato Gas", amount: 6_500, due: "2026-08-10", repeatUnit: "month", repeatDay: 10, amountVaries: true });
    const real = (id: string, due: string, amount: number | null) => stored({ id, biller: `Minato Gas ${Number(due.slice(5, 7))}月分`, amount, due, seriesBillId: "gas" });
    const out = expandBills([seriesBill, real("g9", "2026-09-12", 5_400), real("g10", "2026-10-12", 6_600), real("g12", "2026-12-08", null)], "2026-11-01", "2027-01-31", "JPY");
    assert.deepEqual(out.filter(b => b.id.startsWith("gas@")).map(b => [b.due, b.amount]), [["2026-11-10", 6_000], ["2027-01-10", 6_000]], "December is the linked bill's month; the average is of 5,400 and 6,600 only");
    const gap = out.find(b => b.id === "g12")!;
    assert.deepEqual([gap.amountUnknown, gap.estimated, gap.amount, gap.amountHigh, gap.basis], [true, true, 6_000, 6_600, { count: 2, low: 5_400, high: 6_600, from: "series" }]);
    const bare = stored({ ...seriesBill, id: "bare", amount: null });
    const none = expandBills([bare], "2026-11-01", "2027-01-31", "JPY").filter(b => b.id.startsWith("bare@"));
    assert.deepEqual(none.map(b => [b.due, b.amount, b.uncounted, b.amountUnknown]), [["2026-11-10", 0, true, true], ["2026-12-10", 0, true, true], ["2027-01-10", 0, true, true]], "no history: every month uncounted");
    const some = expandBills([bare, { ...real("b9", "2026-09-12", 5_400), seriesBillId: "bare" }], "2026-11-01", "2027-01-31", "JPY").filter(b => b.id.startsWith("bare@"));
    assert.deepEqual(some.map(b => [b.amount, b.uncounted, b.estimated, b.basis?.from]), [[5_400, undefined, true, "series"], [5_400, undefined, true, "series"], [5_400, undefined, true, "series"]]);
    assert.deepEqual(cancelNotices([{ ...bare, cancelBy: "2026-11-05" }], "2026-11-01", "JPY").map(n => n.amount), [null], "a cancel notice with nothing to estimate from has no amount");
  });

  await check("a new amount-varies Hikari Denki series can estimate from Ben's two earlier one-off bills", () => {
    const hikari = stored({ id: "hikari-series", biller: "Hikari Denki", due: "2026-11-25", repeatUnit: "month", repeatDay: 25, amountVaries: true });
    const gap = openGaps(stateWith([hikari])).find(item => item.id === hikari.id)!;
    assert.equal(gapAmountWords(gap), "about ¥9,330 (¥8,640–¥10,020, from your last 2 bills)");
    assert.equal(gap.estimate?.from, "bills");
    const later = stored({ id: "hikari-later", biller: "Hikari Denki", due: "2026-11-26", amount: 50000 });
    const nextWithoutLink = expandBills([...benStoredBills, hikari, later], "2026-12-01", "2026-12-30", "JPY")
      .find(bill => bill.id === "hikari-series@2026-12-25")!;
    assert.equal(nextWithoutLink.amount, 9330, "only one-offs from before the series can supply its history");
    const linked = stored({ id: "hikari-linked", biller: "Hikari Denki", due: "2026-11-10", amount: 12300, seriesBillId: hikari.id });
    const next = expandBills([...benStoredBills, hikari, linked], "2026-12-01", "2026-12-30", "JPY").find(bill => bill.id === "hikari-series@2026-12-25")!;
    assert.deepEqual([next.amount, next.basis?.count, next.basis?.from], [12300, 1, "series"], "linked history takes precedence");
    const other = stored({ ...hikari, id: "other-series", due: "2026-09-25", amount: 10000 });
    const foreign = { ...linked, seriesBillId: other.id };
    const own = openGaps(stateWith([hikari, other, foreign])).find(item => item.id === hikari.id)!;
    assert.equal(gapAmountWords(own), "about ¥9,330 (¥8,640–¥10,020, from your last 2 bills)", "another series's linked bill is excluded");
  });

  // ---------------------------------------------------------------- the forecast (pure)
  await check("the usual case counts the average and the late case the high end; the two series differ by exactly high − average from the due day", () => {
    const gap = stateWith([...history, gasGap()]);
    const bare = stateWith([]);
    const usual = series(gap, "expected").map((v, i) => v - series(bare, "expected")[i]);
    const late = series(gap, "worst").map((v, i) => v - series(bare, "worst")[i]);
    const due = 6; // Nov 20
    assert.ok(usual.slice(0, due).every(v => v === 0) && late.slice(0, due).every(v => v === 0), "nothing before the due day");
    assert.ok(usual.slice(due).every(v => v === -108_333), "usual: the average");
    assert.ok(late.slice(due).every(v => v === -150_000), "late: the high end");
    assert.equal(late[due] - usual[due], -(150_000 - 108_333), "differ by exactly high − average");
    const events = timeline(gap, "worst").find(e => e.label === "Minato Gas")!;
    assert.deepEqual([events.amount, events.estimated], [-150_000, true], "the late timeline carries the high end and says it is an estimate");
    assert.equal(timeline(gap, "expected").find(e => e.label === "Minato Gas")!.amount, -108_333);
    const item = dueItems(gap).find(i => i.label === "Minato Gas")!;
    assert.deepEqual([item.amount, item.estimated, item.uncounted], [108_333, true, undefined]);
  });

  await check("no history: the bill counts nothing in both cases, is visible as uncounted and is never ¥0 in a total; an unknown date counts today in both", () => {
    const none = stateWith([gasGap()]);
    assert.deepEqual(series(none, "expected"), series(benMoney, "expected"));
    assert.deepEqual(series(none, "worst"), series(benMoney, "worst"));
    const event = timeline(none, "expected").find(e => e.label === "Minato Gas")!;
    assert.deepEqual([event.uncounted, event.amount], [true, -0], "the event is there and says uncounted");
    assert.equal(dueItems(none).find(i => i.label === "Minato Gas")!.uncounted, true);
    const noDate = stateWith([...history, gasGap({ due: null })]);
    const usual = series(noDate, "expected").map((v, i) => v - series(benMoney, "expected")[i]);
    const late = series(noDate, "worst").map((v, i) => v - series(benMoney, "worst")[i]);
    assert.ok(usual.every(v => v === -108_333) && late.every(v => v === -150_000), "from day one, in both cases");
    assert.equal(timeline(noDate, "expected").find(e => e.label === "Minato Gas")!.date, TODAY);
    const both = stateWith([...history, gasGap({ due: null })]);
    assert.equal(both.bills.find(b => b.id === "gap")!.dueUnknown, true);
  });

  await check("Ben's sentence, totals and every series are unchanged and carry no note", () => {
    assert.equal(homeSentence(benMoney).text, "You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th.");
    assert.equal(homeSentence(benMoney).note, null);
    assert.equal(low(series(benMoney, "worst")).amount, -18_780);
    assert.equal(low(series(benMoney, "expected")).amount, 121_220);
    assert.deepEqual(openGaps(benMoney), []);
    assert.deepEqual(stateWith([]).bills, benMoney.bills, "no gap: expandBills returns what it always did");
  });

  // ---------------------------------------------------------------- the sentence note and urgency (pure)
  await check("the sentence note: uncounted bills in the window are named; the high end is named only when it would make the usual case short", () => {
    const one = homeSentence(stateWith([gasGap()]));
    assert.equal(one.note, "Not counted: Minato Gas (amount not known).");
    assert.equal(one.text, homeSentence(benMoney).text, "the sentence itself does not move");
    const two = homeSentence(stateWith([gasGap(), gasGap({ id: "gap2", biller: "Minato Water", due: "2026-11-22" })]));
    assert.equal(two.note, "Not counted: Minato Gas and Minato Water (amounts not known).");
    assert.equal(homeSentence(stateWith([gasGap({ due: null })])).note, "Not counted: Minato Gas (amount not known).", "a date not known counts as today: inside the window");
    assert.equal(homeSentence(stateWith([gasGap({ due: "2027-03-05" })])).note, null, "outside the 30 days: not named");
    assert.equal(homeSentence(stateWith([gasGap({ status: "pending" })])).note, null, "a pending bill counts for nothing anyway");
    const turns = homeSentence(stateWith([...history, gasGap()]));
    assert.equal(turns.note, "Minato Gas is counted at about ¥108,333; at ¥150,000 you'd be short on the 20th.");
    const mild = homeSentence(stateWith([...history.map(h => ({ ...h, amount: 10_000 + h.amount! / 100 })), gasGap()]));
    assert.equal(mild.note, null, "the high end changes nothing: no note");
    const both = homeSentence(stateWith([...history, gasGap(), gasGap({ id: "gap2", biller: "Minato Water", due: "2026-11-22" })]));
    assert.equal(both.note, "Not counted: Minato Water (amount not known). Minato Gas is counted at about ¥108,333; at ¥150,000 you'd be short on the 20th.", "uncounted first, then the high end");
    for (const sentence of [turns, both]) {
      assert.equal(sentence.text, sentence.lead + " " + sentence.emphasis, "text is lead + emphasis");
      assert.match(sentence.lead, /^You're fine if Acme and Northwind pay as usual\. If they're late, you're$/);
    }
  });

  await check("openGaps: one gap per bill with what is missing, urgent first; urgent at 3 days and not at 4; could change the sentence both ways", () => {
    const gaps = openGaps(stateWith([
      ...history, gasGap({ id: "g3", biller: "Minato Gas", due: addDays(TODAY, 3) }),
      stored({ id: "w", biller: "Minato Water", amount: 4_000 }), stored({ id: "b", biller: "Minato Both" }), stored({ id: "p", biller: "Minato Pending", due: "2026-12-30", status: "pending" }),
    ]));
    assert.deepEqual(gaps.map(g => [g.id, g.urgent, g.why]), [
      ["b", true, "due_soon"], ["w", true, "due_soon"], ["g3", true, "due_soon"], ["p", false, null],
    ], "due within 3 days (a date not known is today), and the pending one is neither near nor able to change the sentence");
    const four = openGaps(stateWith([...history, gasGap({ id: "g4", due: addDays(TODAY, 4) })]));
    assert.deepEqual([four[0].urgent, four[0].why], [true, "could_change_sentence"], "four days away is not due soon; urgent only because its high end would make you short");
    const day3 = openGaps(stateWith([gasGap({ id: "d3", due: addDays(TODAY, 3) })])), day4 = openGaps(stateWith([gasGap({ id: "d4", due: addDays(TODAY, 4) })]));
    assert.deepEqual([day3[0].why, day4[0].why], ["due_soon", "could_change_sentence"], "uncounted: due_soon at 3 days, and at 4 it is the window that makes it urgent");
    const byId = (id: string) => gaps.find(g => g.id === id)!;
    assert.deepEqual(byId("b").missing, ["amount", "date"]);
    assert.deepEqual([byId("w").missing, byId("w").due, byId("w").countedOn, byId("w").amountMinor], [["date"], null, TODAY, 4_000]);
    assert.deepEqual([byId("g3").missing, byId("g3").due, byId("g3").estimate], [["amount"], addDays(TODAY, 3), { averageMinor: 108_333, lowMinor: 75_000, highMinor: 150_000, count: 3, from: "bills" }]);
    assert.deepEqual([byId("p").status, byId("p").estimate, byId("p").currency, byId("p").source, byId("p").name], ["pending", null, "JPY", "bill", "Minato Pending"]);
    const noChange = openGaps(stateWith([...history.map(h => ({ ...h, amount: 10_000 + h.amount! / 100 })), gasGap({ due: addDays(TODAY, 4) })]));
    assert.deepEqual([noChange[0].urgent, noChange[0].why], [false, null], "four days away and the high end changes nothing: not urgent");
    const uncounted = openGaps(stateWith([gasGap({ due: addDays(TODAY, 9) })]));
    assert.deepEqual([uncounted[0].urgent, uncounted[0].why], [true, "could_change_sentence"], "uncounted in the window");
    const far = openGaps(stateWith([gasGap({ due: "2027-03-05" })]));
    assert.deepEqual([far[0].urgent, far[0].why], [false, null], "uncounted but outside the window");
    const sorted = openGaps(stateWith([gasGap({ id: "z", biller: "Zed", due: "2027-03-01" }), gasGap({ id: "a", biller: "Aoi", due: "2027-03-01" }), gasGap({ id: "m", biller: "Mid", due: "2027-02-01" })]));
    assert.deepEqual(sorted.map(g => g.id), ["m", "a", "z"], "then by date, then by name");
  });

  await check("openGaps: a reading in To check missing an amount or a date is a gap; a complete one is not; the estimate reads the household's bills", () => {
    const state = stateWith(history);
    const reading = (id: string, over: object) => ({ id, value: { kind: "bill" as const, name: "Minato Gas 11月分", date: "2026-11-24", amountMinor: 8_000, currency: "JPY" as const, category: "utilities" as const, ...over } });
    const gaps = openGaps(state, [reading("r1", { amountMinor: null }), reading("r2", { date: null }), reading("r3", {}), reading("r4", { amountMinor: null, date: null, name: null, category: null, kind: "charge" })]);
    assert.deepEqual(gaps.map(g => [g.id, g.source, g.status, g.missing]).sort(), [["r1", "reading", "to_check", ["amount"]], ["r2", "reading", "to_check", ["date"]], ["r4", "reading", "to_check", ["amount", "date"]]]);
    const r1 = gaps.find(g => g.id === "r1")!;
    assert.deepEqual(r1.estimate, { averageMinor: 108_333, lowMinor: 75_000, highMinor: 150_000, count: 3, from: "bills" });
    assert.equal(r1.countedOn, "2026-11-24");
    assert.equal(gaps.find(g => g.id === "r4")!.estimate, null);
    assert.equal(gaps.find(g => g.id === "r4")!.name, "Charge");
    assert.equal(gaps.find(g => g.id === "r2")!.countedOn, TODAY);
  });

  await check("the words: amount, date and question, exactly", () => {
    const base: Gap = { source: "bill", id: "x", name: "Minato Gas", category: "utilities", status: "confirmed", missing: ["amount"], due: "2026-11-25", countedOn: "2026-11-25", amountMinor: null, estimate: null, urgent: false, why: null, currency: "JPY" };
    const est = (count: number, average: number, lowMinor: number, highMinor: number): Gap => ({ ...base, estimate: { averageMinor: average, lowMinor, highMinor, count, from: "bills" } });
    assert.equal(gapAmountWords(est(3, 9_330, 8_640, 10_020)), "about ¥9,330 (¥8,640–¥10,020, from your last 3 bills)");
    assert.equal(gapAmountWords(est(2, 9_330, 8_640, 10_020)), "about ¥9,330 (¥8,640–¥10,020, from your last 2 bills)");
    assert.equal(gapAmountWords(est(1, 8_640, 8_640, 8_640)), "about ¥8,640 (from your last bill)");
    assert.equal(gapAmountWords(base), "amount not known");
    assert.equal(gapAmountWords({ ...est(3, 1_250, 1_000, 1_500), currency: "USD" }), "about $12.50 ($10–$15, from your last 3 bills)");
    assert.equal(gapDateWords({ missing: ["date"] }), "date not known, counted as due now");
    assert.throws(() => gapDateWords({ missing: ["amount"] }), /not missing its date/);
    assert.equal(gapQuestion(base), "Minato Gas, due Nov 25: how much?");
    assert.equal(gapQuestion({ ...base, missing: ["date"], due: null, countedOn: TODAY, amountMinor: 9_800 }), "Minato Gas, ¥9,800: when is it due?");
    assert.equal(gapQuestion({ ...base, missing: ["amount", "date"], due: null }), "Minato Gas: how much, and when is it due?");
  });

  await check("the words meanwhile, the urgency label, the not-counted line and the confirmed list, exactly", () => {
    const base: Gap = { source: "bill", id: "x", name: "Minato Gas", category: "utilities", status: "confirmed", missing: ["amount"], due: "2026-11-25", countedOn: "2026-11-25", amountMinor: null, estimate: null, urgent: false, why: null, currency: "JPY" };
    const est: Gap = { ...base, estimate: { averageMinor: 9_330, lowMinor: 8_640, highMinor: 10_020, count: 2, from: "bills" } };
    assert.equal(gapCountedWords(est), "Counted at about ¥9,330 (¥8,640–¥10,020, from your last 2 bills)");
    assert.equal(gapCountedWords(base), "Not counted until you enter it");
    assert.throws(() => gapCountedWords({ ...base, missing: ["date"] }), /not missing its amount/);
    assert.equal(gapMeanwhileWords(base), "Not counted until you enter it");
    assert.equal(gapMeanwhileWords({ ...base, missing: ["date"], amountMinor: 9_800 }), "date not known, counted as due now");
    assert.equal(gapMeanwhileWords({ ...est, missing: ["amount", "date"] }), "Counted at about ¥9,330 (¥8,640–¥10,020, from your last 2 bills) · date not known, counted as due now");
    assert.deepEqual([gapUrgencyWords({ why: "due_soon" }), gapUrgencyWords({ why: "could_change_sentence" }), gapUrgencyWords({ why: null })], ["Due soon", "Could change your forecast", null]);
    assert.equal(gapUncountedWords([]), null);
    assert.equal(gapUncountedWords(["Minato Gas"]), "1 bill not counted: Minato Gas (amount not known)");
    assert.equal(gapUncountedWords(["Minato Gas", "Minato Water"]), "2 bills not counted: Minato Gas (amount not known), Minato Water (amount not known)");
    assert.equal(statusAnswer(benMoney), homeSentence(benMoney).text, "no note: the text alone");
    const noted = stateWith([gasGap()]);
    assert.equal(statusAnswer(noted), `${homeSentence(noted).text} Not counted: Minato Gas (amount not known).`, "the sentence tool returns the note beside the text");
    assert.deepEqual(confirmedGaps(stateWith([gasGap({ status: "pending" })])), []);
    assert.deepEqual(confirmedGaps(stateWith([gasGap()])).map(g => g.name), ["Minato Gas"]);
  });

  await check("To check: a pending bill with a gap has no amount (never ¥0) and carries the words and the question", () => {
    const row = toCheck(stateWith([gasGap({ status: "pending" }), stored({ id: "d", biller: "Minato Water", amount: 4_000, status: "pending" })])).filter(item => item.kind === "bill");
    const gas = row.find(item => item.title === "Minato Gas")!, water = row.find(item => item.title === "Minato Water")!;
    assert.deepEqual([gas.amount, gas.kind === "bill" && gas.gap], [null, { question: "Minato Gas, due Nov 20: how much?", amount: "amount not known", date: null }]);
    assert.deepEqual([water.amount, water.kind === "bill" && water.gap?.question, water.detail.includes("date not known")], [4_000, "Minato Water, ¥4,000: when is it due?", true]);
  });

  // ---------------------------------------------------------------- month, search, regular costs, family, split (pure)
  await check("the month view and the search: an estimated gap is an estimated item; an uncounted gap is listed, never summed, and says amount not known", () => {
    const state = stateWith([...history, gasGap(), gasGap({ id: "nope", biller: "Minato Water", due: "2026-11-22" })]);
    const input: SpendingInput = { homeCurrency: "JPY", bills: state.bills, charges: state.charges, cards: state.cards, split: state.split };
    const items = spendingItems(input, "2026-11-01", "2026-11-30");
    const gas = items.find(i => i.label === "Minato Gas")!, water = items.find(i => i.label === "Minato Water")!;
    assert.deepEqual([gas.amountMinor, gas.estimated, gas.uncounted], [108_333, true, undefined]);
    assert.deepEqual([water.amountMinor, water.estimated, water.uncounted], [0, undefined, true]);
    const view = monthByCategory(input, TODAY);
    const without = monthByCategory({ ...input, bills: stateWith([...history]).bills }, TODAY);
    assert.equal(view.totalMinor - without.totalMinor, 108_333, "the uncounted bill adds nothing");
    const listed = view.categories.flatMap(c => c.items);
    assert.equal(listed.find(i => i.label === "Minato Water")!.uncounted, true);
    assert.match(monthText(view), /Minato Gas Nov 20 about ¥108,333/);
    assert.match(monthText(view), /Minato Water Nov 22 amount not known/);
    assert.ok(!/Minato Water Nov 22 ¥0/.test(monthText(view)));
    const regular = regularCosts(spendingItems(input, "2026-09-01", "2026-11-30"), "JPY", TODAY, 3);
    assert.ok(!regular.items.some(c => c.label === "Minato Water"), "an amount not known is no history for a regular cost");
    const shared = sharedBillsComing({ ...state, bills: state.bills.map(b => (b.id === "nope" ? { ...b, paidBy: undefined } : b)) });
    assert.deepEqual(shared.filter(b => b.biller === "Minato Water").map(b => b.uncounted), [true]);
  });

  await check("the search lists a bill whose amount is not known (even due later this month) and never sums it; a category of only such bills says amount not known, not ¥0", () => {
    const state = stateWith([...history, gasGap(), gasGap({ id: "only", biller: "Minato Steam", due: "2026-11-21", category: "other" })]);
    const input: SpendingInput = { homeCurrency: "JPY", bills: state.bills.filter(b => b.biller.startsWith("Minato")), charges: [], cards: state.cards, split: state.split };
    const bare = stateWith([gasGap({ id: "lone", biller: "Minato Lone", category: "other" })]);
    const bareInput: SpendingInput = { homeCurrency: "JPY", bills: bare.bills.filter(b => b.biller === "Minato Lone"), charges: [], cards: bare.cards, split: bare.split };
    const range = { from: "2025-12-01", to: TODAY, uncountedTo: "2026-11-30" };
    const found = searchSpending(spendingItems(bareInput, range.from, range.uncountedTo), "lone", "JPY", range);
    assert.deepEqual([found.months[0].items.map(i => i.label), found.months[0].items[0].uncounted, found.totalMinor, found.uncounted], [["Minato Lone"], true, 0, ["Minato Lone"]]);
    assert.equal(searchLine(found), '"lone": amount not known in November (1 item); nothing in the other 11 months. 1 bill not counted: Minato Lone (amount not known).');
    assert.equal(searchSpending(spendingItems(bareInput, range.from, range.uncountedTo), "lone", "JPY", { from: range.from, to: TODAY }).months[0].items.length, 0, "without uncountedTo the range ends today");
    const mixed = searchSpending(spendingItems(input, range.from, range.uncountedTo), "minato", "JPY", range);
    const mixedWithout = stateWith([...history, gasGap({ id: "only", biller: "Minato Steam", due: "2026-11-12", category: "other", amount: 1 })]);
    assert.equal(mixed.totalMinor, searchSpending(spendingItems({ ...input, bills: mixedWithout.bills.filter(b => b.biller.startsWith("Minato")) }, range.from, range.uncountedTo), "minato", "JPY", range).totalMinor - 1, "the uncounted bill adds nothing to the search's total");
    assert.equal(mixed.months[0].items.some(i => i.label === "Minato Steam" && i.uncounted), true);
    assert.match(searchLine(mixed), /bills? not counted: .*Minato Steam \(amount not known\)/);
    const view = monthByCategory(bareInput, TODAY);
    const other = view.categories.find(c => c.category === "other")!;
    assert.deepEqual([other.totalMinor, other.items.every(i => i.uncounted)], [0, true]);
    assert.match(monthText(view), /^Other amount not known: Minato Lone Nov 20 amount not known\.$/m, "the header never says ¥0 for a category of uncounted bills");
    const withCounted = monthText(monthByCategory(input, TODAY));
    assert.match(withCounted, /Utilities ¥\d[\d,]*: .*Minato Gas/, "a category with counted items keeps its counted sum");
    assert.match(withCounted, /Other amount not known: Minato Steam Nov 21 amount not known\./);
  });

  await check("the split: a bill whose amount is not known creates no debt; D54's estimated occurrences still split", () => {
    const split: SplitState = {
      members: [{ id: "a", name: "Aoi", shareBp: 5_000 }, { id: "b", name: "Ren", shareBp: 5_000 }], since: "2026-09-01", settledThrough: null, settledAt: null, charges: [],
      bills: [
        { id: "x", biller: "Minato Gas", amountMinor: null, due: "2026-10-12", paidBy: "a", createdAt: "2026-10-01T00:00:00.000Z", repeatUnit: null, repeatDay: null, repeatUntil: null, nextAmountMinor: null, nextAmountFrom: null },
        { id: "y", biller: "Minato Rent", amountMinor: 80_000, due: "2026-10-01", paidBy: "a", createdAt: "2026-10-01T00:00:00.000Z", repeatUnit: null, repeatDay: null, repeatUntil: null, nextAmountMinor: null, nextAmountFrom: null },
        { id: "o", biller: "Minato Water 10月分", amountMinor: 5_000, due: "2026-10-05", paidBy: "a", createdAt: "2026-10-01T00:00:00.000Z", repeatUnit: null, repeatDay: null, repeatUntil: null, nextAmountMinor: null, nextAmountFrom: null },
        { id: "s", biller: "Minato Water", amountMinor: null, due: "2026-09-10", paidBy: "a", createdAt: "2026-09-01T00:00:00.000Z", repeatUnit: "month", repeatDay: 10, repeatUntil: null, nextAmountMinor: null, nextAmountFrom: null, varies: [r("2026-10-05", 5_000)], variesUnpriced: ["2026-11-03"] },
      ],
    };
    const balance = splitBalance(split, TODAY);
    assert.equal(balance.items, 2, "the rent, and the water bill's real October bill (September has no estimate; November is a real bill without an amount)");
    assert.equal(balance.members[0].paidMinor, 80_000 + 5_000);
  });

  // ---------------------------------------------------------------- the names (pure)
  await check("normalise and the old rule-key text agree on ASCII, full-width and Japanese names, except for runs of spaces", () => {
    const old = (name: string) => name.normalize("NFKC").trim().toLowerCase();
    for (const name of ["Hikari Denki", "  Hikari Denki  ", "ＨＩＫＡＲＩ　Ｄｅｎｋｉ", "ひかり電気", "ヒカリ電気 11月分", "Café Müller", "STREAMBOX"]) assert.equal(normalise(name), old(name).replace(/\s+/g, " "), name);
    assert.equal(normalise("Hikari  Denki"), "hikari denki");
    assert.equal(old("Hikari  Denki"), "hikari  denki");
    assert.equal(nameKey("Hikari Denki 10月分"), nameKey("Hikari Denki"));
  });

  // ---------------------------------------------------------------- the database
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const store = db as unknown as Db;
  await migrate(db, { migrationsFolder: "./drizzle" });
  const hid = await seedBen(db, { isDemo: true });
  const other = await seedBen(db, { isDemo: true });
  const form = { madeBy: "form" as const };
  const add = async (over: Partial<Parameters<typeof billInput.parse>[0]>) => {
    const id = randomUUID();
    await insertBill(store, hid, billInput.parse({ id, biller: "Minato Gas", amount: "", amountUnknown: true, due: "2026-11-20", category: "utilities", ...over }), "confirmed", form);
    return id;
  };
  const row = async (id: string) => (await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.id, id))))[0];
  const event = async (id: string) => (await db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.refId, id))).orderBy(schema.events.occurredAt)).at(-1)!;

  await check("Ben's seeded household: the sentence, the series and the totals are the sample's, with no gap", async () => {
    const state = await loadMoneyState(store, hid, TODAY);
    assert.equal(homeSentence(state).text, homeSentence(benMoney).text);
    assert.equal(homeSentence(state).note, null);
    assert.deepEqual(series(state, "worst"), series(benMoney, "worst"));
    assert.deepEqual(openGaps(state), []);
  });

  await check("the two CHECKs: a fixed repeating bill with no amount, and a repeating bill, a bill with a last day to cancel or a series member with no date, are refused", async () => {
    const insert = (columns: string, values: string) => pg.query(`insert into bills(household_id, biller, currency, category, ${columns}) values ($1, 'x', 'JPY', 'utilities', ${values})`, [hid]);
    await assert.rejects(insert("amount_minor, due, repeat_unit, repeat_day", "null, '2026-12-01', 'month', 1"), /bills_amount_unknown_shape/);
    await assert.rejects(insert("amount_minor, due, repeat_unit", "null, '2026-12-01', 'year'"), /bills_amount_unknown_shape/);
    await assert.rejects(insert("amount_minor, due, repeat_unit, repeat_day, next_amount_minor, next_amount_from, amount_varies", "null, '2026-12-01', 'month', 1, 5, '2027-01-01', false"), /bills_amount_unknown_shape/);
    await assert.rejects(insert("amount_minor, previous_amount_minor, due", "null, 5, '2026-12-01'"), /bills_amount_unknown_shape/);
    await assert.rejects(insert("amount_minor, due, repeat_unit, repeat_day", "5, null, 'month', 1"), /bills_due_unknown_one_off|bills_repeat_day_monthly/);
    await assert.rejects(insert("amount_minor, due, cancel_by", "5, null, '2026-12-01'"), /bills_due_unknown_one_off/);
    await assert.rejects(insert("amount_minor, due, series_bill_id", `5, null, '${randomUUID()}'`), /bills_due_unknown_one_off|foreign key/);
    await insert("amount_minor, due", "null, null"); // a one-off with neither is allowed
    await insert("amount_minor, due, repeat_unit, repeat_day, amount_varies", "null, '2026-12-01', 'month', 1, true"); // an amount-varies series without an amount is allowed
    await pg.query("delete from bills where household_id = $1 and biller = 'x'", [hid]);
  });

  await check("adding a bill with 'not known yet': the amount and/or the date are stored empty; an empty amount or date without saying so keeps today's errors", async () => {
    const a = await add({}), d = await add({ biller: "Minato Water", amount: "4000", amountUnknown: false, due: null, dueUnknown: true }), both = await add({ biller: "Minato Both", due: null, dueUnknown: true });
    assert.deepEqual([(await row(a)).amountMinor, (await row(a)).due], [null, "2026-11-20"]);
    assert.deepEqual([(await row(d)).amountMinor, (await row(d)).due], [4_000, null]);
    assert.deepEqual([(await row(both)).amountMinor, (await row(both)).due], [null, null]);
    assert.equal((await event(a)).title, "Minato Gas added, due Nov 20");
    assert.equal((await event(a)).body, "Amount not known yet");
    assert.equal((await event(d)).title, "Minato Water added, date not known");
    await assert.rejects(insertBill(store, hid, billInput.parse({ id: randomUUID(), biller: "x", amount: "", due: "2026-11-20", category: "other" }), "confirmed", form), /Enter a whole number of yen/);
    await assert.rejects(insertBill(store, hid, billInput.parse({ id: randomUUID(), biller: "x", amount: "100", due: null, category: "other" }), "confirmed", form), /Enter the due date/);
    await assert.rejects(insertBill(store, hid, billInput.parse({ id: randomUUID(), biller: "x", amount: "", amountUnknown: true, due: "2026-11-20", category: "other", repeat: "month" }), "confirmed", form), /needs its amount/);
    await assert.rejects(insertBill(store, hid, billInput.parse({ id: randomUUID(), biller: "x", amount: "100", due: null, dueUnknown: true, category: "other", repeat: "year" }), "confirmed", form), /needs its due date/);
    await assert.rejects(insertBill(store, hid, billInput.parse({ id: randomUUID(), biller: "x", amount: "100", due: null, dueUnknown: true, category: "other", cancelBy: "2026-11-30" }), "confirmed", form), /needs its due date/);
    const series1 = await add({ biller: "Minato Power", amount: "", amountUnknown: true, repeat: "month", amountVaries: true, due: "2026-12-10" });
    assert.equal((await row(series1)).amountMinor, null, "a monthly bill whose amount varies can start without an amount");
    for (const id of [a, d, both, series1]) await db.delete(schema.bills).where(eq(schema.bills.id, id));
  });

  await check("the loaded state carries the gaps: estimate from earlier real bills, uncounted without, an unknown date as today", async () => {
    for (const [month, amount] of [["08", "75000"], ["09", "100000"], ["10", "150000"]]) await add({ biller: `Minato Gas ${Number(month)}月分`, amount, amountUnknown: false, due: `2026-${month}-20` });
    const gap = await add({});
    const water = await add({ biller: "Minato Water", amount: "", due: null, dueUnknown: true });
    const state = await loadMoneyState(store, hid, TODAY);
    const loaded = state.bills.find(b => b.id === gap)!;
    assert.deepEqual([loaded.amount, loaded.amountHigh, loaded.basis?.count, loaded.estimated], [108_333, 150_000, 3, true]);
    const w = state.bills.find(b => b.id === water)!;
    assert.deepEqual([w.uncounted, w.dueUnknown, w.due, w.amount], [true, true, TODAY, 0]);
    assert.deepEqual(openGaps(state).map(g => g.name).sort(), ["Minato Gas", "Minato Water"]);
    assert.equal(homeSentence(state).note?.startsWith("Not counted: Minato Water (amount not known)."), true);
    const spending = await loadSpending(store, hid, { from: "2026-11-01", to: "2026-11-30" });
    const items = spendingItems(spending, "2026-11-01", "2026-11-30");
    assert.deepEqual([items.find(i => i.label === "Minato Gas")!.amountMinor, items.find(i => i.label === "Minato Gas")!.estimated], [108_333, true], "loadSpending reads the earlier bills too");
    assert.equal(items.find(i => i.label === "Minato Water")!.uncounted, true);
    assert.equal(spending.bills.filter(b => b.biller.startsWith("Minato Gas")).length, 4, "the three earlier bills are read as history, once each");
  });

  await check("fillGap: the amount, the date, both; its events say what changed; a complete bill, a piece already known and an empty call are refused", async () => {
    const gap = (await loadMoneyState(store, hid, TODAY)).bills.find(b => b.biller === "Minato Gas" && b.amountUnknown)!.id;
    assert.equal(await fillGap(store, hid, gap, { amountMinor: 9_800 }), true);
    assert.deepEqual([(await row(gap)).amountMinor, (await row(gap)).due], [9_800, "2026-11-20"]);
    assert.equal((await event(gap)).title, "Minato Gas: ¥9,800 (was about ¥108,333)");
    assert.equal((await event(gap)).kind, "bill_changed");
    await assert.rejects(fillGap(store, hid, gap, { amountMinor: 1 }), InputError);
    await assert.rejects(fillGap(store, hid, gap, {}), /already/);
    const water = (await loadMoneyState(store, hid, TODAY)).bills.find(b => b.biller === "Minato Water")!.id;
    await assert.rejects(fillGap(store, hid, water, {}), /Give the amount or the date/);
    await assert.rejects(fillGap(store, hid, water, { amountMinor: 0 }), /more than zero/);
    await assert.rejects(fillGap(store, hid, water, { amountMinor: 1_000_000_000 }), /up to ¥100,000,000/);
    await assert.rejects(fillGap(store, hid, water, { amountMinor: 1.5 }), /more than zero/);
    await assert.rejects(fillGap(store, hid, water, { due: "2031-01-01" }), /two years|date/);
    await assert.rejects(fillGap(store, hid, water, { due: "soon" }));
    assert.equal(await fillGap(store, hid, water, { due: "2026-11-25" }), true);
    assert.equal((await event(water)).title, "Minato Water: due Nov 25");
    assert.equal((await row(water)).due, "2026-11-25");
    assert.equal(await fillGap(store, hid, water, { amountMinor: 4_500 }), true);
    assert.equal((await event(water)).title, "Minato Water: ¥4,500", "no history for the name: no estimate to compare with");
    const neither = await add({ biller: "Minato Nothing", due: null, dueUnknown: true });
    assert.equal(await fillGapFromText(store, hid, neither, { amount: "1,200", due: "2026-12-02" }), true);
    assert.equal((await event(neither)).title, "Minato Nothing: ¥1,200, due Dec 2");
    assert.equal(await fillGap(store, hid, randomUUID(), { amountMinor: 5 }), false, "a bill of no household");
    assert.equal(await fillGap(store, other, neither, { amountMinor: 5 }), false, "another household's bill is not found");
    await assert.rejects(fillGapFromText(store, hid, neither, { amount: "5" }), /already/);
  });

  await check("fillGap links a bill whose date arrives to its amount-varies series, as the form does", async () => {
    const power = await add({ biller: "Minato Power", amount: "6000", amountUnknown: false, repeat: "month", amountVaries: true, due: "2026-12-10" });
    const real = await add({ biller: "Minato Power 11月分", amount: "", due: null, dueUnknown: true });
    assert.equal((await row(real)).seriesBillId, null, "no date: nothing to link on");
    assert.equal(await fillGap(store, hid, real, { due: "2026-12-04" }), true);
    assert.equal((await row(real)).seriesBillId, power);
    assert.equal((await event(real)).body, "Linked to Minato Power: replaces December’s estimate");
    const state = await loadMoneyState(store, hid, TODAY);
    assert.ok(!state.bills.some(b => b.id === `${power}@2026-12-10`), "December's occurrence is gone: the linked bill (amount not known) is that month's bill");
    assert.equal(state.bills.find(b => b.id === real)!.basis, undefined, "a series with no earlier real bill: nothing to average");
    assert.equal(state.bills.find(b => b.id === real)!.uncounted, true);
    assert.equal(await fillGap(store, hid, real, { amountMinor: 7_100 }), true);
    assert.equal((await event(real)).title, "Minato Power 11月分: ¥7,100", "the estimate of a bill with a series and no history is none");
  });

  await check("editing a bill can leave the amount or the date not known, and typing them in later is one edit", async () => {
    const id = await add({ biller: "Minato Heat", amount: "5000", amountUnknown: false, due: "2026-12-05" });
    const edit = (over: object) => updateBill(store, hid, billEditInput.parse({ id, biller: "Minato Heat", amount: "5000", due: "2026-12-05", category: "utilities", ...over }), form);
    assert.equal(await edit({ amount: "", amountUnknown: true }), true);
    assert.equal((await row(id)).amountMinor, null);
    assert.match((await event(id)).body!, /Amount ¥5,000 → not known yet/);
    assert.equal(await edit({ amount: "5200", due: null, dueUnknown: true }), true);
    assert.deepEqual([(await row(id)).amountMinor, (await row(id)).due], [5_200, null]);
    assert.match((await event(id)).body!, /Amount not known → ¥5,200 · Due Dec 5 → not known yet|Due Dec 5 → not known yet · Amount not known → ¥5,200/);
    assert.equal(await edit({ amount: "5200", due: "2026-12-06" }), true);
    assert.equal((await row(id)).due, "2026-12-06");
    await assert.rejects(edit({ amount: "5200", due: null }), /Enter the due date/);
    const rent = await add({ biller: "Minato Rent", amount: "80000", amountUnknown: false, repeat: "month", due: "2026-12-01" });
    await assert.rejects(updateBill(store, hid, billEditInput.parse({ id: rent, biller: "Minato Rent", amount: "", amountUnknown: true, due: "2026-12-01", category: "utilities" }), form), /needs its amount/);
    await assert.rejects(updateBill(store, hid, billEditInput.parse({ id: rent, biller: "Minato Rent", amount: "80000", due: null, dueUnknown: true, category: "utilities" }), form), /needs its due date/);
  });

  // ---------------------------------------------------------------- the reader
  await check("the reader: a reading confirmed as a bill with no amount or no date stores it that way; a charge needs both; the flags must match the fields", async () => {
    const [document] = await db.insert(schema.documents).values({ householdId: hid, kind: "upload", storagePath: "fictional/gap.pdf", mime: "application/pdf", status: "read" }).returning();
    const value = { kind: "bill" as const, name: "Minato Phone", date: "2026-12-12", amountMinor: null, currency: "JPY" as const, category: "phone_internet" as const, cardId: null, businessBp: null, repeat: null, nextAmountMinor: null, nextAmountFrom: null, cancelBy: null, repeatUntil: null };
    const reading = async (v: object) => {
      const [made] = await db.insert(schema.readings).values({ householdId: hid, documentId: document.id, extracted: { original: v, proposed: v }, target: "bill" }).returning();
      return made.id;
    };
    const noAmount = await reading(value);
    await assert.rejects(reviewReading(store, hid, noAmount, value), /Enter the name, amount, currency and date/, "without saying so, an empty amount is still refused");
    assert.equal(await reviewReading(store, hid, noAmount, value, { amount: true }), true);
    const [bill] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.biller, "Minato Phone")));
    assert.deepEqual([bill.amountMinor, bill.due, bill.status, bill.currency, bill.fxRateMicro], [null, "2026-12-12", "confirmed", "JPY", null]);
    const noDate = { ...value, name: "Minato Cable", amountMinor: 2_500, date: null };
    assert.equal(await reviewReading(store, hid, await reading(noDate), noDate, { date: true }), true);
    const [cable] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.biller, "Minato Cable")));
    assert.deepEqual([cable.amountMinor, cable.due], [2_500, null]);
    const usd = { ...value, name: "Minato Cloud", currency: "USD" as const, amountMinor: null, date: null };
    assert.equal(await reviewReading(store, hid, await reading(usd), usd, { amount: true, date: true }), true, "no amount: no rate needed");
    const card = (await db.select().from(schema.cards).where(eq(schema.cards.householdId, hid)))[0];
    const charge = { ...value, kind: "charge" as const, name: "Minato Cafe", amountMinor: null, cardId: card.id };
    const chargeId = await reading(charge);
    await assert.rejects(reviewReading(store, hid, chargeId, charge, { amount: true }), /card charge needs its amount and its date/);
    const mismatch = { ...value, name: "Minato Mismatch", amountMinor: 900 };
    await assert.rejects(reviewReading(store, hid, await reading(mismatch), mismatch, { amount: true }), /Leave the amount or the date empty/);
    const repeating = { ...value, name: "Minato Repeat", repeat: "month" as const };
    await assert.rejects(reviewReading(store, hid, await reading(repeating), repeating, { amount: true }), /needs its amount/);
    const form1 = new FormData();
    for (const [k, v] of Object.entries({ target: "bill", name: "Minato Form", date: "2026-12-20", amountUnknown: "on", currency: "JPY", category: "utilities" })) form1.set(k, v);
    assert.deepEqual([readingForm(form1).amountMinor, readingUnknown(form1)], [null, { amount: true, date: false }]);
    const form2 = new FormData();
    for (const [k, v] of Object.entries({ target: "bill", name: "Minato Form", dueUnknown: "on", amount: "3,000", currency: "JPY", category: "utilities" })) form2.set(k, v);
    assert.deepEqual([readingForm(form2).date, readingForm(form2).amountMinor, readingUnknown(form2)], [null, 3_000, { amount: false, date: true }]);
    const form3 = new FormData();
    for (const [k, v] of Object.entries({ target: "bill", name: "Minato Form", date: "2026-12-20", currency: "JPY", category: "utilities" })) form3.set(k, v);
    assert.throws(() => readingForm(form3), /Enter a whole number of yen/);
    // The reading in To check is a gap for every face.
    const waiting = await reading({ ...value, name: "Minato Wait" });
    const state = await loadMoneyState(store, hid, TODAY);
    const { readerInbox } = await import("@/db/reader-inbox");
    const inbox = await readerInbox(store, hid);
    assert.ok(openGaps(state, inbox.readings).some(g => g.id === waiting && g.source === "reading" && g.missing.join() === "amount"));
  });

  await check("the two To check counts agree: the navigation SQL and the workspace state give the same number", async () => {
    const cnt = await seedBen(db, { isDemo: true });
    const put = (over: Partial<Parameters<typeof billInput.parse>[0]>, status: "confirmed" | "pending") =>
      insertBill(store, cnt, billInput.parse({ id: randomUUID(), biller: "Minato Count", amount: "5000", due: "2026-11-20", category: "utilities", ...over }), status, form);
    const counts = async () => {
      const nav = await db.transaction(tx => loadNavigationData(tx as unknown as Db, cnt));
      const work = await db.transaction(tx => loadWorkspaceData(tx as unknown as Db, cnt));
      return [nav.pending, work.pending];
    };
    const [seededNav, seededWork] = await counts();
    assert.equal(seededNav, seededWork, "Ben's seeded household: both To check counts are the same");
    await put({ biller: "Minato Pending" }, "pending");
    await put({ biller: "Minato NoAmount", amount: "", amountUnknown: true }, "confirmed");
    await put({ biller: "Minato NoDate", due: null, dueUnknown: true }, "confirmed");
    await put({ biller: "Minato Complete" }, "confirmed");
    await put({ biller: "Minato PendingNoAmount", amount: "", amountUnknown: true }, "pending");
    const [nav, work] = await counts();
    assert.equal(nav, seededNav + 4, "a pending bill, a pending bill with no amount, a confirmed bill with no amount and one with no date add four; a complete confirmed bill adds none");
    assert.equal(nav, work, "the navigation count (SQL) and the workspace count (state) are the same number");
  });

  // ---------------------------------------------------------------- the agent tools
  await check("open_gaps is a read tool that returns each gap with its words; add_bill takes amount null and due null as not known yet", async () => {
    const ctx: ToolContext = { madeBy: "ask", db: store, householdId: hid, state: () => loadMoneyState(store, hid, TODAY), appUrl: new URL("http://127.0.0.1:3123") };
    const tool = (name: string) => tools.find(t => t.name === name)!;
    assert.equal(tool("open_gaps").scope, "read");
    assert.deepEqual(Object.keys(tool("open_gaps").input.shape), []);
    const out = JSON.parse(await tool("open_gaps").run(ctx, {} as never)) as { gaps: { id: string; name: string; question: string; amountWords?: string; dateWords?: string; urgent: boolean; why: string | null }[] };
    const gas = out.gaps.find(g => g.name === "Minato Phone")!;
    assert.deepEqual([gas.question, gas.amountWords, gas.dateWords, gas.urgent, gas.why], ["Minato Phone, due Dec 12: how much?", "amount not known", undefined, true, "could_change_sentence"]);
    const cloud = out.gaps.find(g => g.name === "Minato Cloud")!;
    assert.deepEqual([cloud.question, cloud.dateWords], ["Minato Cloud: how much, and when is it due?", "date not known, counted as due now"]);
    const id = randomUUID();
    const input = tool("add_bill").input.parse({ id, biller: "Minato Drafted", amount: null, due: null, memberId: null, repeat: null, next_amount: null, next_amount_from: null, cancel_by: null, category: "utilities", business_bp: null, shared: null, paidBy: null });
    assert.match(await tool("add_bill").run(ctx, input as never), /waiting in To check/);
    const [drafted] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.id, id)));
    assert.deepEqual([drafted.amountMinor, drafted.due, drafted.status], [null, null, "pending"]);
    const state = await loadMoneyState(store, hid, TODAY);
    assert.equal(state.bills.find(b => b.id === id)!.uncounted, true);
    assert.ok(openGaps(state).some(g => g.id === id && g.status === "pending"));
    assert.match(tool("add_bill").description, /null when the user does not know it yet/);
    const timelineJson = JSON.parse(await tool("timeline").run(ctx, tool("timeline").input.parse({ scenario: "as_usual" }) as never)) as { events: { label: string; uncounted?: true }[] };
    assert.ok(timelineJson.events.filter(e => e.label === "Minato Cloud").every(e => e.uncounted === true));
  });

  console.log(`gaps-test: ${passed} checks passed`);
}

main().catch(error => { console.error(error); process.exit(1); });

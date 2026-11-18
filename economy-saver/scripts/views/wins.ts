// What our choices saved (D81, D77): the found and said wins by month, the medals, the words and the facts. Pure; fictional data only.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import type { CategoryKey } from "@/lib/money/categories";
import { fact } from "@/lib/money/facts";
import { foundWins, monthWins, personalBests, medals } from "@/lib/money/saving";
import type { Charge, Choice } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";
import { resolveView } from "@/lib/views/resolve";
import type { ViewContext, ViewResult } from "@/lib/views/types";
import { reads } from "../fixtures/view-reads";
import { createSyncChecks } from "../fixtures/harness";

const { check, tally } = createSyncChecks();
let seq = 0;
const charge = (merchant: string, date: string, amount: number, category: CategoryKey = "food"): Charge =>
  ({ id: `ch-${++seq}`, cardId: "card-a", merchant, amount, date, category, businessBp: 0, source: "manual", status: "confirmed" });
/** Food, a different shop each month (so none is a regular cost): the usual is ¥30,000 and October came to ¥24,000. */
const food: Charge[] = [charge("Shop A", "2026-07-10", 30_000), charge("Shop B", "2026-08-10", 32_000), charge("Shop C", "2026-09-10", 28_000), charge("Shop D", "2026-10-10", 24_000)];
const choice = (id: string, minor: number, on: string, over: Partial<Choice> = {}): Choice =>
  ({ id, source: "said", happenedOn: on, minor, words: "Took the train, not a taxi", category: null, foundKey: null, memberId: null, confirmedOn: on, withdrawnOn: null, ...over });
const ctxOf = (charges: Charge[], choices: Choice[]): ViewContext => ({ state: benMoney, spending: { ...benMoney, bills: [], charges }, moves: [], choices });
const draw = (ctx: ViewContext, args: { months?: number } = {}) => resolveView("wins", args, ctx) as ViewResult<"stacked_columns">;
const today = benMoney.today;
const is = (period: object | null | undefined, from: string, to: string) => JSON.stringify(period) === JSON.stringify({ from, to });

check("a month's wins: found in your records plus what was said, in the plan's words, never money set aside", () => {
  const view = draw(ctxOf(food, [choice("c1", 3000, "2026-10-12")]));
  assert.equal(view.line, "In October your choices saved about ¥9,000 (2 choices): ¥6,000 found in your records and about ¥3,000 you said.");
  assert.doesNotMatch(view.line!, /set aside/i);
  assert.ok(view.facts.every(item => item.name !== "money_set_aside" && item.name !== "set_aside_for_goals"), "no money set aside among the facts");
  reads(view, today);
  assert.deepEqual(unconfirmedNumbers(view.line!, view.facts, { today }), []);
  const october = view.data!.columns.find(column => column.key === "2026-10")!;
  assert.deepEqual(october.parts, [6000, 3000]);
  assert.equal(october.total, 9000);
  assert.deepEqual(view.data!.segments.map(segment => [segment.legend, segment.tone]), [["Found in your records", "main"], ["You said", "soft"]]);
  assert.equal(view.data!.columns.at(-1)!.current, true);
});

check("the facts equal the engine's: the month, each win, the count and the total", () => {
  const rec = { moves: [], choices: [choice("c1", 3000, "2026-10-12")] };
  const found = foundWins(food.map(c => ({ kind: "charge" as const, id: c.id, label: c.merchant, repeat: null, date: c.date, amountMinor: c.amount, category: c.category, businessBp: 0, own: null, ownerId: null, documentId: null, cardId: c.cardId })), "JPY", "2026-10", rec, today);
  const engine = monthWins(rec, found, "2026-10");
  const view = draw(ctxOf(food, rec.choices));
  const month = { from: "2026-10-01", to: "2026-10-31" };
  const inOctober = (name: "choices_saved" | "found_win" | "said_win") => view.facts.filter(item => item.name === name && is(item.period, month.from, month.to) && item.about === undefined);
  assert.deepEqual([inOctober("choices_saved")[0].value, inOctober("found_win")[0].value, inOctober("said_win")[0].value], [engine.totalMinor, engine.foundMinor, engine.saidMinor]);
  assert.equal(view.facts.find(item => item.name === "found_win" && item.about?.id === "2026-10:cat:food")!.value, 6000);
  assert.equal(view.facts.find(item => item.name === "usual_spending" && item.about?.id === "2026-10:cat:food")!.value, 30_000);
  assert.equal(view.facts.find(item => item.name === "said_win" && item.about?.id === "c1")!.value, 3000);
  assert.equal(fact(view.facts, "win_count")!.value, 2);
  assert.equal(view.facts.find(item => item.name === "choices_saved" && is(item.period, "2026-06-01", "2026-11-30"))!.value, 9000, "the six-month total follows the months");
});

check("a found win already kept counts once, at its stored amount; a withdrawn choice counts for nothing", () => {
  const kept = choice("k1", 5500, "2026-10-31", { source: "found", foundKey: "2026-10:cat:food", words: "Food under your usual" });
  const view = draw(ctxOf(food, [kept, choice("w1", 4000, "2026-10-12", { withdrawnOn: "2026-10-20" })]));
  assert.equal(view.data!.columns.find(column => column.key === "2026-10")!.total, 5500);
  assert.equal(view.line, "In October your choices saved about ¥5,500 (1 choice), all found in your records.");
  assert.equal(view.facts.find(item => item.about?.id === "k1")!.value, 5500);
});

check("this month holds what was said so far, and found wins wait for the month to close", () => {
  const view = draw(ctxOf([], [choice("n1", 2000, "2026-11-05")]));
  assert.equal(view.line, "In November so far your choices saved about ¥2,000 (1 choice), all you said.");
  const column = view.data!.columns.at(-1)!;
  assert.deepEqual([column.key, column.current, column.parts], ["2026-11", true, [0, 2000]]);
});

check("a medal earned in the span is named with its day; the next one says what is still to go", () => {
  const view = draw(ctxOf(food, [choice("c1", 12_000, "2026-10-12")]));
  assert.match(view.line!, / New medal: Bronze for what your choices saved, earned Oct 12\.$/, "the same words as Home's medal");
  assert.deepEqual(unconfirmedNumbers(view.line!, view.facts, { today }), []);
  const earned = view.facts.find(item => item.name === "medal_earned_on")!;
  assert.deepEqual([earned.value, earned.about!.id], ["2026-10-12", "choices:0"]);
  const next = view.facts.find(item => item.name === "next_medal_at")!;
  assert.equal(next.value, medals({ moves: [], choices: [choice("c1", 12_000, "2026-10-12")] }, []).find(medal => medal.toGo !== null)!.toGo);
  assert.equal(next.value, 100_000 - 12_000);
});

check("goals reached and months with something set aside are totals; a best month shows only when it beats two earlier", () => {
  const pot = { id: "cam", name: "Camera", saved: 0, doneOn: "2026-10-20" };
  const move = (id: string, kind: "fill" | "spend", minor: number, on: string) => ({ id, potId: "cam", potName: "Camera", potCategory: null, kind, minor, on, memberId: null, reason: null, invoiceId: null, purchase: null, choiceId: null, pairId: null });
  const moves = [move("a", "fill", 4000, "2026-08-05"), move("b", "fill", 4000, "2026-09-05"), move("c", "fill", 4000, "2026-10-05"), move("d", "spend", -12_000, "2026-10-20")];
  const view = draw({ ...ctxOf(food, [choice("c1", 3000, "2026-10-12")]), state: { ...benMoney, pots: [pot] }, moves });
  assert.equal(fact(view.facts, "goals_reached")!.value, 1);
  assert.equal(fact(view.facts, "months_set_aside")!.value, 3);
  assert.equal(fact(view.facts, "best_month_choices"), null, "one month of choices beats no earlier month");
  const many = [choice("e1", 1000, "2026-08-05"), choice("e2", 1500, "2026-09-05"), choice("e3", 3000, "2026-10-12")];
  const best = fact(draw(ctxOf(food, many)).facts, "best_month_choices")!;
  assert.deepEqual([best.value, best.period], [personalBests({ moves: [], choices: many }, [], "JPY", "2026-10", today).choices!.minor, { from: "2026-10-01", to: "2026-10-31" }]);
  assert.equal(best.value, 3000);
});

check("nothing saved yet draws no chart and says what shows here", () => {
  const view = draw(ctxOf([], []));
  assert.equal(view.data, null);
  assert.equal(view.line, null);
  assert.equal(view.empty!.words, "Choices that save show here: a regular cost that went down, a month under your usual, or a cheaper choice you tell Ask.");
  assert.ok(view.facts.length > 0 && view.facts.every(item => item.name === "next_medal_at" || item.name === "next_medal_count"), "only what is still to go to each first medal");
});

check("a goal reached before any choice still names its medal where Home's See your wins lands", () => {
  const pot = { id: "cam", name: "Camera", saved: 0, doneOn: "2026-10-20" };
  const move = (id: string, kind: "fill" | "spend", minor: number, on: string) => ({ id, potId: "cam", potName: "Camera", potCategory: null, kind, minor, on, memberId: null, reason: null, invoiceId: null, purchase: null, choiceId: null, pairId: null });
  const view = draw({ ...ctxOf([], []), state: { ...benMoney, pots: [pot] }, moves: [move("a", "fill", 12_000, "2026-10-05"), move("b", "spend", -12_000, "2026-10-20")] });
  assert.equal(view.data, null);
  assert.equal(view.empty!.words, "New medal: Bronze for goals reached, earned Oct 20. Choices that save show here: a regular cost that went down, a month under your usual, or a cheaper choice you tell Ask.");
  assert.deepEqual(unconfirmedNumbers(view.empty!.words, view.facts, { today }), []);
  assert.equal(fact(view.facts, "goals_reached")!.value, 1);
});

check("the figure draws, the table twin adds up, and the months argument is bounded", () => {
  const view = draw(ctxOf(food, [choice("c1", 3000, "2026-10-12")]), { months: 3 });
  assert.equal(view.data!.columns.length, 3);
  assert.deepEqual(view.table!.foot, ["Together", "¥6,000", "¥3,000", "¥9,000"]);
  assert.ok(renderToStaticMarkup(createElement(StackedColumns, { result: view })).includes("Found in your records"));
  assert.throws(() => resolveView("wins", { months: 1 }, ctxOf(food, [])), /months/);
  assert.throws(() => resolveView("wins", { months: 13 }, ctxOf(food, [])), /months/);
  assert.throws(() => resolveView("wins", {}, { state: benMoney, spending: ctxOf(food, []).spending }), /not loaded/);
});

check("a regular cost at its lowest in a year is a fact of Regular costs; the most put toward goals is a fact of Where each payment went", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const power = [...months.map(m => charge("Hikari Denki", `${m}-12`, 8000, "utilities")), charge("Hikari Denki", "2026-10-12", 6500, "utilities"), charge("Hikari Denki", "2026-11-12", 6500, "utilities")];
  const lowest = resolveView("fixed_costs", {}, ctxOf(power, [])).facts.filter(item => item.name === "lowest_regular_cost");
  assert.deepEqual(lowest.map(item => [item.value, item.about!.name, item.period]), [[6500, "Hikari Denki", { from: "2026-10-01", to: "2026-10-31" }]]);
  assert.deepEqual(resolveView("fixed_costs", {}, ctxOf(power.map(c => ({ ...c, amount: 8000 })), [])).facts.filter(item => item.name === "lowest_regular_cost"), [], "no best, no fact");
  const move = (id: string, minor: number, on: string) => ({ id, potId: "cam", potName: "Camera", potCategory: null, kind: "fill" as const, minor, on, memberId: null, reason: null, invoiceId: null, purchase: null, choiceId: null, pairId: null });
  const income = [{ id: "p1", clientId: "c1", clientName: "Acme", paidOn: "2026-10-10", sentOn: null, homeMinor: 90_000 }];
  const flow = (moves: ReturnType<typeof move>[]) => resolveView("money_flow", { month: "2026-10" }, { ...ctxOf([], []), income, moves });
  const best = fact(flow([move("a", 1000, "2026-08-05"), move("b", 2000, "2026-09-05"), move("c", 5000, "2026-10-05")]).facts, "best_month_set_aside")!;
  assert.deepEqual([best.value, best.period], [5000, { from: "2026-10-01", to: "2026-10-31" }]);
  assert.equal(fact(flow([move("b", 2000, "2026-09-05"), move("c", 5000, "2026-10-05")]).facts, "best_month_set_aside"), null, "one earlier month is not enough");
});

console.log(`\n${tally.passed} checks passed`);

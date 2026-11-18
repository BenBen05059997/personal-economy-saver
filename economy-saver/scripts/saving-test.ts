// The saving engine (D81): pot stories, set aside, found wins, medals, bests and matches. Pure; fictional names, no database or credentials.
import assert from "node:assert/strict";
import { moneyFlow } from "@/lib/money/flow";
import type { LookByView } from "@/lib/money/look-by";
import { FOUND, MEDALS, MEDAL_NAMES, foundWins, isTaxPot, lastFoundPot, matchCandidates, medals, monthWins, personalBests, potStory, setAside } from "@/lib/money/saving";
import type { SpendItem } from "@/lib/money/spending";
import type { CategoryKey } from "@/lib/money/categories";
import type { Choice, MoneyState, MoveKind, Pot, PotMove, SavingRecord } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";
import { createSyncChecks } from "./fixtures/harness";

const { check, tally } = createSyncChecks();
const JPY = "JPY" as const;
const TODAY = "2026-11-18";

let seq = 0;
const move = (potId: string, kind: MoveKind, minor: number, on: string, over: Partial<PotMove> = {}): PotMove => ({
  id: `m${++seq}`, potId, potName: potId === "tax" ? "Tax pot" : potId === "cam" ? "Camera" : potId === "trip" ? "Trip" : potId, potCategory: potId === "tax" ? "government_tax" : potId === "cam" ? "other" : null,
  kind, minor, on, memberId: null, reason: null, invoiceId: null, purchase: null, choiceId: null, pairId: null, ...over,
});
const choice = (id: string, minor: number, confirmedOn: string, over: Partial<Choice> = {}): Choice => ({
  id, source: "said", happenedOn: confirmedOn, minor, words: "Skipped the taxi", category: null, foundKey: null, memberId: null, confirmedOn, withdrawnOn: null, ...over,
});
const record = (moves: PotMove[] = [], choices: Choice[] = []): SavingRecord => ({ moves, choices });
const pot = (id: string, saved: number, over: Partial<Pot> = {}): Pot => ({ id, name: id === "cam" ? "Camera" : id === "tax" ? "Tax pot" : id, saved, ...over });

let itemSeq = 0;
const item = (label: string, date: string, amountMinor: number, category: CategoryKey = "food", over: Partial<SpendItem> = {}): SpendItem => ({
  kind: "charge", id: `i${++itemSeq}`, label, repeat: null, date, amountMinor, category, businessBp: 0, own: null, ownerId: null, documentId: null, cardId: null, ...over,
});
/** One spending item in each of the four months before November 2026 plus the month asked for, per category. */
const monthly = (label: string, category: CategoryKey, amounts: Record<string, number>, over: Partial<SpendItem> = {}) =>
  Object.entries(amounts).map(([month, amount]) => item(label, `${month}-10`, amount, category, over));

// ---- the story ----

check("a pot's story sums: start + went in - out = what it holds", () => {
  const moves = [move("cam", "adjust", 5000, "2026-07-01"), move("cam", "fill", 3000, "2026-08-05"), move("cam", "add", 2000, "2026-08-20"),
    move("cam", "add", 1000, "2026-09-02", { choiceId: "c1" }), move("cam", "carry", 4000, "2026-09-10", { pairId: "p1" }), move("trip", "carry", -4000, "2026-09-10", { pairId: "p1" }),
    move("cam", "take_out", -500, "2026-09-12"), move("cam", "spend", -9000, "2026-10-01", { purchase: { kind: "charge", id: "x", on: null, label: "Mirrorless body" } }), move("cam", "adjust", -500, "2026-10-02")];
  const story = potStory(record(moves, [choice("c1", 1000, "2026-09-02")]), pot("cam", 5000), JPY);
  assert.deepEqual([story.startMinor, story.fromPaymentsMinor, story.addedMinor, story.fromChoicesMinor, story.carriedInMinor], [4500, 3000, 2000, 1000, 4000]);
  assert.deepEqual([story.wentInMinor, story.takenOutMinor, story.becameMinor, story.carriedOutMinor, story.savedMinor, story.since], [10_000, 500, 9000, 0, 5000, "2026-07-01"]);
  assert.deepEqual(story.carriedFrom, [{ potId: "trip", potName: "Trip", minor: 4000 }]);
  assert.deepEqual(story.purchases.map(row => [row.purchase?.label, row.minor]), [["Mirrorless body", 9000]]);
  assert.equal(story.choices.length, 1);
});

check("a story that does not sum throws, naming the pot", () => {
  assert.throws(() => potStory(record([move("cam", "adjust", 5000, "2026-07-01")]), pot("cam", 5100), JPY), /Camera.*start.*5,?000|Camera:/);
  assert.throws(() => potStory(record([move("cam", "adjust", 5000, "2026-07-01")]), pot("cam", 5100), JPY), /Camera/);
});

check("the tax pot is told by its category", () => {
  assert.equal(isTaxPot({ category: "government_tax" }), true);
  assert.equal(isTaxPot({ category: "other" }), false);
  assert.equal(isTaxPot({}), false);
});

// ---- set aside ----

check("setAside splits goals from tax, ignores adjusts and carries, and counts the month only", () => {
  const moves = [move("cam", "adjust", 9000, "2026-10-01"), move("cam", "fill", 3000, "2026-10-05"), move("cam", "add", 1000, "2026-10-20"), move("tax", "fill", 6000, "2026-10-05"),
    move("cam", "carry", 4000, "2026-10-09", { pairId: "p" }), move("trip", "carry", -4000, "2026-10-09", { pairId: "p" }),
    move("cam", "spend", -2500, "2026-10-12"), move("cam", "take_out", -500, "2026-10-13"), move("cam", "fill", 7000, "2026-11-02")];
  const aside = setAside(moves, "2026-10");
  assert.deepEqual([aside.forGoalsMinor, aside.forTaxMinor, aside.totalMinor, aside.fromPotsMinor], [4000, 6000, 10_000, 3000]);
  assert.deepEqual(aside.byPot.map(row => [row.potId, row.minor, row.tax]), [["tax", 6000, true], ["cam", 4000, false]]);
  assert.deepEqual(aside.fromPots.map(row => [row.potId, row.minor]), [["cam", 3000]]);
  assert.deepEqual(setAside(moves, "2026-09").totalMinor, 0);
});

check("the flow reads the same sum", () => {
  const view = { rows: [], name: "October" } as unknown as LookByView;
  const moves = [move("cam", "fill", 3000, "2026-10-05"), move("tax", "fill", 6000, "2026-10-05"), move("cam", "adjust", 800, "2026-10-06"), move("cam", "spend", -2500, "2026-10-12")];
  const flow = moneyFlow([], moves, view, "2026-10")!;
  assert.deepEqual([flow.setAsideMinor, flow.fromPotsMinor], [setAside(moves, "2026-10").totalMinor, 2500]);
  assert.deepEqual(flow.nodes.filter(node => node.kind === "pot").map(node => node.label), ["Ready for tax: Tax pot", "Set aside: Camera"]);
});

// ---- found wins ----

const NOV = "2026-11", OCT = "2026-10";
/** Months Jun..Sep before October (usual from Jul, Aug, Sep), then October. */
const run = (label: string, category: CategoryKey, jul: number, aug: number, sep: number, oct: number, over: Partial<SpendItem> = {}) =>
  monthly(label, category, { "2026-07": jul, "2026-08": aug, "2026-09": sep, "2026-10": oct }, over);
/** A group needs a different name each month, or it is a regular cost. */
const spread = (category: CategoryKey, jul: number, aug: number, sep: number, oct: number, over: Partial<SpendItem> = {}) => [
  item("Shop A", "2026-07-10", jul, category, over), item("Shop B", "2026-08-10", aug, category, over), item("Shop C", "2026-09-10", sep, category, over), item("Shop D", "2026-10-10", oct, category, over),
];
const found = (items: SpendItem[], rec = record(), month = OCT, today = TODAY) => foundWins(items, JPY, month, rec, today);

check("a category under its usual wins the usual less the month, with the floors", () => {
  const wins = found(spread("food", 30_000, 32_000, 28_000, 24_000));
  assert.deepEqual(wins.map(win => [win.key, win.winMinor, win.baselineMinor, win.monthMinor, win.kind]), [["2026-10:cat:food", 6000, 30_000, 24_000, "under_usual"]]);
  assert.equal(FOUND.minShareBp, 1000);
});

check("the floors: under 10% of the usual or under 500 is no win", () => {
  assert.deepEqual(found(spread("food", 30_000, 30_000, 30_000, 27_100)), [], "2,900 is under 10% of 30,000");
  assert.equal(found(spread("food", 30_000, 30_000, 30_000, 27_000)).length, 1, "exactly 10% is a win");
  assert.deepEqual(found(spread("food", 3000, 3000, 3000, 2700)), [], "300 is under 500");
  assert.equal(found(spread("food", 3000, 3000, 3000, 2500)).length, 1, "500 is a win");
  assert.deepEqual(found(spread("food", 30_000, 30_000, 30_000, 32_000)), [], "over the usual");
});

check("the usual is the middle of the three months before", () => {
  assert.equal(found(spread("food", 10_000, 50_000, 30_000, 20_000))[0].baselineMinor, 30_000);
});

check("only a closed month gives wins", () => {
  const items = [...spread("food", 30_000, 30_000, 30_000, 20_000), item("Shop E", "2026-11-05", 1000, "food")];
  assert.equal(found(items).length, 1);
  assert.deepEqual(found(items, record(), NOV), [], "the current month");
  assert.deepEqual(found(items, record(), "2026-12"), [], "a month to come");
  assert.deepEqual(found(items, record(), OCT, "2026-10-31"), [], "October on its last day is not closed");
});

check("no win from an empty month, and no group missing a month has one", () => {
  assert.deepEqual(found(spread("food", 30_000, 30_000, 30_000, 20_000).slice(0, 3)), []);
  const noAugust = spread("food", 30_000, 30_000, 30_000, 20_000).filter(row => !row.date.startsWith("2026-08"));
  assert.deepEqual(found(noAugust), [], "all four months need items");
  const noOctober = [...spread("food", 30_000, 30_000, 30_000, 20_000).slice(0, 3), ...run("Gym", "health", 5000, 5000, 5000, 5000).slice(0, 3)];
  assert.deepEqual(found(noOctober), [], "a month with no items at all");
});

check("leave-outs: Government & tax, Debt, regular costs, a pot's own spend, unknown amounts", () => {
  assert.deepEqual(found(spread("government_tax", 30_000, 30_000, 30_000, 10_000)), []);
  assert.deepEqual(found(spread("debt", 30_000, 30_000, 30_000, 10_000)), []);
  const spent = spread("food", 30_000, 30_000, 30_000, 20_000);
  const withSpend = record([move("cam", "spend", -9999, "2026-10-10", { purchase: { kind: "charge", id: spent[3].id, on: null, label: "Shop D" } })]);
  assert.deepEqual(found(spent, withSpend), [], "October's only item came out of a pot, so the month is empty of items");
  const unknown = spread("food", 30_000, 30_000, 30_000, 20_000).map((row, i) => i === 1 ? { ...row, uncounted: true as const, amountMinor: 0 } : row);
  assert.deepEqual(found(unknown), [], "an amount not known is no history");
  // A regular rent that dropped is a cost win, never also a category win.
  const rent = run("Kawa Rent", "housing", 90_000, 90_000, 90_000, 80_000);
  const wins = found(rent);
  assert.deepEqual(wins.map(win => [win.key, win.kind, win.winMinor]), [["2026-10:cost:housing:kawa rent", "cost_down", 10_000]]);
});

check("a regular cost that stopped wins last month's amount, and a rise or an estimate wins nothing", () => {
  const stopped = [...monthly("Studio Gym", "health", { "2026-08": 8000, "2026-09": 8000 }), item("Noodle bar", "2026-10-03", 900, "food")];
  const wins = found(stopped);
  assert.deepEqual(wins.map(win => [win.key, win.kind, win.winMinor]), [["2026-10:cost:health:studio gym", "cost_stopped", 8000]]);
  assert.deepEqual(found(run("Studio Gym", "health", 8000, 8000, 8000, 9000)), []);
  assert.deepEqual(found(run("Studio Gym", "health", 8000, 8000, 8000, 5000, { estimated: true })), [], "no estimate in either month");
  assert.deepEqual(found(run("Studio Gym", "health", 8000, 8000, 8000, 7500)), [], "500 of 8,000 is under 10%");
});

check("the said overlap is subtracted from the category's win, and a win under the floor is dropped", () => {
  const items = spread("food", 30_000, 30_000, 30_000, 20_000);
  const said = (minor: number, over: Partial<Choice> = {}) => record([], [choice("s1", minor, "2026-10-12", { category: "food", ...over })]);
  assert.equal(found(items, said(4000))[0].winMinor, 6000);
  assert.deepEqual(found(items, said(9500)), [], "500 left is under 10% of the usual");
  assert.deepEqual(found(items, said(10_000)), []);
  assert.equal(found(items, said(4000, { category: "travel" }))[0].winMinor, 10_000, "another category's choice does not count");
  assert.equal(found(items, said(4000, { withdrawnOn: "2026-10-20" }))[0].winMinor, 10_000, "a withdrawn choice does not count");
  assert.equal(found(items, said(4000, { happenedOn: "2026-09-12" }))[0].winMinor, 10_000, "a choice of another month does not count");
  assert.equal(found(items, record([], [choice("f1", 4000, "2026-10-12", { source: "found", foundKey: "x", category: "food" })]))[0].winMinor, 10_000, "only said choices overlap");
});

check("own categories are groups of their own, keyed by id", () => {
  const own = { id: "own-1", name: "Coffee" };
  const items = [...spread("food", 30_000, 30_000, 30_000, 20_000, { own }), ...spread("food", 10_000, 10_000, 10_000, 10_000).map(row => ({ ...row, label: `Other ${row.label}` }))];
  assert.deepEqual(found(items).map(win => win.key), ["2026-10:own:own-1"]);
});

check("a kept win is not fresh again, a withdrawn one never returns", () => {
  const wins = found(spread("food", 30_000, 30_000, 30_000, 20_000));
  const keptRec = record([], [choice("k1", 10_000, "2026-11-02", { source: "found", foundKey: wins[0].key, happenedOn: "2026-10-31" })]);
  assert.equal(monthWins(keptRec, wins, OCT).fresh.length, 0);
  const withdrawn = record([], [choice("k1", 10_000, "2026-11-02", { source: "found", foundKey: wins[0].key, happenedOn: "2026-10-31", withdrawnOn: "2026-11-03" })]);
  assert.equal(monthWins(withdrawn, wins, OCT).fresh.length, 0);
});

check("monthWins adds said, kept found at their stored amount and fresh found", () => {
  const wins = found(spread("food", 30_000, 30_000, 30_000, 20_000));
  const rec = record([], [choice("s1", 700, "2026-10-12"), choice("s2", 900, "2026-10-14", { withdrawnOn: "2026-10-15" }), choice("k1", 1200, "2026-11-02", { source: "found", foundKey: "2026-10:cost:gym", happenedOn: "2026-10-31" }), choice("s3", 5000, "2026-09-12")]);
  const month = monthWins(rec, wins, OCT);
  assert.deepEqual([month.saidMinor, month.keptMinor, month.freshMinor, month.foundMinor, month.totalMinor, month.count], [700, 1200, 10_000, 11_200, 11_900, 3]);
  assert.equal(monthWins(record(), [], OCT).count, 0);
});

// ---- medals ----

check("choice medals are earned the first day the total reaches each threshold", () => {
  const rec = record([], [choice("a", 6000, "2026-06-01"), choice("b", 4000, "2026-06-20"), choice("c", 95_000, "2026-08-02")]);
  const choices = medals(rec, []).filter(medal => medal.kind === "choices");
  assert.deepEqual(choices.map(medal => [medal.name, medal.threshold, medal.earnedOn, medal.toGo]), [
    ["Bronze", MEDALS.choices[0], "2026-06-20", null], ["Silver", MEDALS.choices[1], "2026-08-02", null], ["Gold", MEDALS.choices[2], null, 395_000], ["Platinum", MEDALS.choices[3], null, null]]);
  assert.deepEqual(MEDAL_NAMES, ["Bronze", "Silver", "Gold", "Platinum"]);
});

check("a withdrawal or a record edit never moves or loses a medal", () => {
  const base = [choice("a", 10_000, "2026-06-01"), choice("b", 95_000, "2026-08-02")];
  const before = medals(record([], base), []);
  const withdrawn = medals(record([], [base[0], { ...base[1], withdrawnOn: "2026-09-01" }]), []);
  assert.deepEqual(withdrawn.filter(medal => medal.kind === "choices" && medal.level < 2).map(medal => medal.earnedOn), ["2026-06-01", "2026-08-02"]);
  assert.equal(withdrawn.find(medal => medal.kind === "choices" && medal.level === 2)!.toGo, 500_000 - 10_000, "the total fell, so more is still to go");
  const edited = medals(record([], [...base, choice("late", 3000, "2026-10-01")]), []);
  assert.deepEqual(edited.slice(0, 4).map(medal => medal.earnedOn), before.slice(0, 4).map(medal => medal.earnedOn));
  // a withdrawal before the level was reached means it never counted
  const earlyWithdrawal = medals(record([], [choice("a", 100_000, "2026-06-01", { withdrawnOn: "2026-06-05" }), choice("b", 20_000, "2026-07-01")]), []);
  assert.equal(earlyWithdrawal.find(medal => medal.kind === "choices" && medal.level === 0)!.earnedOn, "2026-06-01", "it counted while it stood, and that day stays");
  assert.equal(earlyWithdrawal.find(medal => medal.kind === "choices" && medal.level === 1)!.earnedOn, "2026-06-01");
});

check("goal medals count done saving pots that paid for something, on their done day", () => {
  const spend = (potId: string) => move(potId, "spend", -100, "2026-09-01");
  const pots = [pot("cam", 0, { doneOn: "2026-09-02" }), pot("trip", 0, { doneOn: "2026-10-05" }), pot("tax", 0, { doneOn: "2026-10-06", category: "government_tax" }), pot("lamp", 0, { doneOn: "2026-10-09" }), pot("open", 100)];
  const goals = medals(record([spend("cam"), spend("trip"), spend("tax"), spend("open")]), pots).filter(medal => medal.kind === "goals");
  assert.deepEqual(goals.map(medal => [medal.earnedOn, medal.toGo]), [["2026-09-02", null], [null, 1], [null, null], [null, null]], "the tax pot, a pot with no spend and an open pot do not count");
  assert.equal(goals[1].threshold, 3);
  const three = medals(record([spend("cam"), spend("trip"), spend("lamp")]), pots).filter(medal => medal.kind === "goals");
  assert.equal(three[1].earnedOn, "2026-10-09");
});

check("month medals count months in total, never a run", () => {
  const months = ["2026-01", "2026-02", "2026-04", "2026-05"];
  const moves = [...months.map((month, i) => move(i % 2 ? "cam" : "trip", i % 2 ? "fill" : "add", 1000, `${month}-${i === 3 ? "20" : "15"}`)), move("cam", "add", 500, "2026-04-03"), move("tax", "fill", 9000, "2026-03-01"), move("cam", "adjust", 4000, "2026-06-01"), move("cam", "carry", 100, "2026-07-01", { pairId: "z" })];
  const result = medals(record(moves), []).filter(medal => medal.kind === "months");
  assert.deepEqual(result.map(medal => [medal.threshold, medal.earnedOn, medal.toGo]), [[3, "2026-04-03", null], [6, null, 2], [12, null, null], [24, null, null]],
    "January, February and April make three months even with March missing; tax, adjusts and carries add none");
});

check("every medal level is listed, once per kind", () => {
  const all = medals(record(), []);
  assert.equal(all.length, 12);
  assert.deepEqual(all.filter(medal => medal.toGo !== null).map(medal => [medal.kind, medal.level]), [["choices", 0], ["goals", 0], ["months", 0]]);
});

// ---- personal bests ----

check("a best must beat at least two earlier months", () => {
  const rec = (...rows: [string, number][]) => record([], rows.map(([day, minor], i) => choice(`c${i}`, minor, day)));
  assert.equal(personalBests(rec(["2026-08-10", 1000], ["2026-10-10", 5000]), [], JPY, OCT, TODAY).choices, null, "one earlier month");
  const best = personalBests(rec(["2026-07-10", 1000], ["2026-08-10", 3000], ["2026-10-10", 5000]), [], JPY, OCT, TODAY).choices!;
  assert.deepEqual([best.month, best.minor, best.beatMinor, best.earlierMonths], [OCT, 5000, 3000, 2]);
  assert.equal(personalBests(rec(["2026-07-10", 1000], ["2026-08-10", 6000], ["2026-10-10", 5000]), [], JPY, OCT, TODAY).choices, null, "a bigger earlier month");
  assert.equal(personalBests(rec(["2026-07-10", 1000], ["2026-08-10", 3000], ["2026-10-10", 5000]), [], JPY, NOV, TODAY).choices, null, "the current month");
});

check("most put toward goals counts the goals sum only", () => {
  const moves = [move("cam", "fill", 1000, "2026-07-10"), move("cam", "add", 2000, "2026-08-10"), move("cam", "fill", 5000, "2026-10-10"), move("tax", "fill", 90_000, "2026-10-10")];
  const best = personalBests(record(moves), [], JPY, OCT, TODAY).setAside!;
  assert.deepEqual([best.minor, best.beatMinor], [5000, 2000]);
});

check("a regular cost at its lowest of the year needs six recorded months", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const rent = (count: number, last: number) => [...months.slice(0, count).map(m => item("Hikari Denki", `${m}-12`, 8000, "utilities")), item("Hikari Denki", "2026-10-12", last, "utilities")];
  const best = personalBests(record(), rent(9, 6500), JPY, OCT, TODAY).lowestRegular;
  assert.deepEqual(best.map(row => [row.label, row.minor, row.beatMinor]), [["Hikari Denki", 6500, 8000]]);
  assert.deepEqual(personalBests(record(), rent(4, 6500), JPY, OCT, TODAY).lowestRegular, [], "only five recorded months");
  assert.deepEqual(personalBests(record(), rent(9, 8500), JPY, OCT, TODAY).lowestRegular, []);
});

// ---- matches ----

const state = (pots: Pot[]): MoneyState => ({ ...benMoney, today: TODAY, homeCurrency: JPY, pots });
const camera = pot("cam", 100_000, { category: "other" });
const buy = (label: string, date: string, amount: number, category: CategoryKey = "other", over: Partial<SpendItem> = {}) => item(label, date, amount, category, over);

check("a purchase of the last 14 days from an open pot in its category is a match", () => {
  const body = buy("Mirrorless body", "2026-11-10", 60_000);
  const [match] = matchCandidates(state([camera]), record(), [body]);
  assert.deepEqual([match.purchase.kind, match.purchase.id, match.purchase.on, match.purchase.label, match.purchase.amountMinor, match.pots.map(row => row.id)], ["charge", body.id, null, "Mirrorless body", 60_000, ["cam"]]);
});

check("each match rule", () => {
  const find = (items: SpendItem[], pots: Pot[] = [camera], rec = record()) => matchCandidates(state(pots), rec, items);
  assert.equal(find([buy("Lens", "2026-11-04", 30_000)]).length, 1, "14 days back is in");
  assert.equal(find([buy("Lens", "2026-11-03", 30_000)]).length, 0, "15 days back is out");
  assert.equal(find([buy("Lens", "2026-11-19", 30_000)]).length, 0, "a bill dated tomorrow is not bought yet");
  assert.equal(find([buy("Lens", "2026-11-10", 20_000)]).length, 1, "exactly 20% of the balance");
  assert.equal(find([buy("Lens", "2026-11-10", 19_999)]).length, 0, "under 20%");
  assert.equal(find([buy("Lens", "2026-11-10", 30_000, "food")]).length, 0, "another category");
  assert.equal(find([buy("Lens", "2026-11-10", 30_000)], [pot("cam", 100_000)]).length, 0, "a pot with no category");
  assert.equal(find([buy("Lens", "2026-11-10", 30_000)], [{ ...camera, saved: 0 }]).length, 0, "a pot with no money");
  assert.equal(find([buy("Lens", "2026-11-10", 30_000)], [{ ...camera, doneOn: "2026-11-01" }]).length, 0, "a done pot");
  assert.equal(find([buy("Lens", "2026-11-10", 30_000)], [{ ...camera, category: "government_tax" }]).length, 0, "the tax pot");
  const monthlyBill = buy("Camera club", "2026-11-10", 30_000, "other", { kind: "bill", repeat: "month" });
  assert.equal(find([monthlyBill]).length, 0, "a repeating bill is regular");
  const oneOff = buy("Camera strap", "2026-11-10", 30_000, "other", { kind: "bill", id: "b1" });
  assert.equal(find([oneOff]).length, 1, "a one-off bill counts");
  assert.deepEqual([find([oneOff])[0].purchase.kind, find([oneOff])[0].purchase.on], ["bill", "2026-11-10"]);
  const comesBack = [buy("Tea Corner", "2026-10-10", 30_000), buy("Tea Corner", "2026-11-10", 30_000)];
  assert.equal(find(comesBack).length, 0, "a name that comes back is regular");
  const spent = buy("Lens", "2026-11-10", 30_000);
  assert.equal(find([spent], [camera], record([move("trip", "spend", -100, "2026-11-11", { purchase: { kind: "charge", id: spent.id, on: null, label: "Lens" } })])).length, 0, "already spent from a pot (any pot)");
  const oneOff2 = buy("Camera strap", "2026-11-10", 30_000, "other", { kind: "bill", id: "b2@2026-11-10" });
  assert.equal(find([oneOff2], [camera], record([move("cam", "spend", -100, "2026-11-11", { purchase: { kind: "bill", id: "b2", on: "2026-11-10", label: "Camera strap" } })])).length, 0, "a bill occurrence spent from a pot");
  assert.equal(find([buy("Lens", "2026-11-10", 30_000, "other", { uncounted: true, amountMinor: 0 })]).length, 0, "an amount not known");
});

check("a purchase several pots could pay for lists them all, newest purchase first", () => {
  const other = pot("trip", 90_000, { category: "other" });
  const matches = matchCandidates(state([camera, other]), record(), [buy("Lens", "2026-11-09", 30_000), buy("Bag", "2026-11-12", 30_000)]);
  assert.deepEqual(matches.map(row => [row.purchase.label, row.pots.map(p => p.id)]), [["Bag", ["cam", "trip"]], ["Lens", ["cam", "trip"]]]);
});

check("lastFoundPot is the pot of the newest add for a found choice, among open saving pots", () => {
  const choices = [choice("f1", 1000, "2026-09-01", { source: "found", foundKey: "k1" }), choice("f2", 1000, "2026-10-01", { source: "found", foundKey: "k2" }), choice("s1", 1000, "2026-10-05")];
  const moves = [move("cam", "add", 1000, "2026-09-01", { choiceId: "f1" }), move("trip", "add", 1000, "2026-10-01", { choiceId: "f2" }), move("cam", "add", 1000, "2026-10-06", { choiceId: "s1" })];
  const pots = [pot("cam", 1), pot("trip", 1)];
  assert.equal(lastFoundPot(record(moves, choices), pots)?.id, "trip", "a said choice's pot is not learned");
  assert.equal(lastFoundPot(record(moves, choices), [pot("cam", 1), pot("trip", 1, { doneOn: "2026-10-20" })])?.id, "cam", "a done pot is skipped");
  assert.equal(lastFoundPot(record(moves, choices), [pot("trip", 1, { category: "government_tax" })]), null);
  assert.equal(lastFoundPot(record(), pots), null);
});

check("the engine leaves its inputs alone", () => {
  const items = spread("food", 30_000, 30_000, 30_000, 20_000), rec = record([move("cam", "fill", 1000, "2026-10-05")], [choice("a", 1000, "2026-10-12")]);
  const before = JSON.stringify([items, rec]);
  foundWins(items, JPY, OCT, rec, TODAY); medals(rec, []); personalBests(rec, items, JPY, OCT, TODAY); setAside(rec.moves, OCT); matchCandidates(state([camera]), rec, items);
  assert.equal(JSON.stringify([items, rec]), before);
});

console.log(String(tally.passed) + " saving checks passed");

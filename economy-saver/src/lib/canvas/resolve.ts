// The canvas resolver (D57). Pure: a recipe in, one resolved block per block out. A block that shows money holds a query; every
// number here comes from an engine function (runway, sentence, month, spending, regular) run on the state the query's scenario names,
// and is written with the app's own money and date helpers. The only arithmetic is what a query names (the difference in
// compare_months). Throws `CanvasError` with words a person can read when the recipe cannot be drawn.
import { plural } from "@/lib/plural";
import { engineFact, type Fact } from "@/lib/money/facts";
import { dayLabel, minorMoney, minorPerUnit, money, ordinal, aboutMoney } from "@/lib/money/format";
import { goalPaces } from "@/lib/money/goals";
import { AMOUNT_NOT_KNOWN, gapUncountedWords } from "@/lib/money/gaps";
import { CATEGORIES, categoryLabel } from "@/lib/money/categories";
import { splitBalance, splitSummary } from "@/lib/money/split";
import { monthByCategory, type MonthView } from "@/lib/money/month";
import { paceLine } from "@/lib/money/pace";
import { regularCosts, REGULAR_MONTHS, type RegularCost } from "@/lib/money/regular";
import { addDays, availableCash, daysBetween, low, safeToSpend, series, timeline, WINDOW_DAYS } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { billsForMonth, type PeriodBill } from "@/lib/money/period";
import { latestDate } from "@/lib/money/horizon";
import { foreignCostWords, type FxCosts } from "@/lib/money/fx-cost";
import { allUncounted, HISTORY_MONTHS, monthBounds, monthName, monthsBack, searchSpending, spendingItems, type SpendingInput } from "@/lib/money/spending";
import type { MoneyState } from "@/lib/money/types";
import { stateThrough } from "@/lib/money/window";
import { WhatIfError, whatIf } from "@/lib/money/whatif";
import { resolveView } from "@/lib/views/resolve";
import { VIEW_META } from "@/lib/views/catalogue";
import { longDay, stepLine } from "@/lib/views/v/forecast";
import { ViewError, type FormData, type RankedRow, type TableTwin, type Tone, type ViewResult } from "@/lib/views/types";
import type { IncomeRow, PotFill } from "@/lib/money/types";
import { problemWords, RecipeSchema, ScenarioSchema, type Block, type Query, type Recipe, type Scenario, type ScenarioRef } from "./schema";

/** A recipe that cannot be drawn: the message is written for the person (or for the agent to fix its recipe). */
export class CanvasError extends Error {}

/** What the engine needs: the money state as the household's page loads it, and the spending read over the last twelve months through the end of this one. */
export type CanvasContext = { state: MoneyState; spending: SpendingInput; foreignCosts?: FxCosts; periodBills?: PeriodBill[]; income?: IncomeRow[]; potFills?: PotFill[] };

/** Whether any block of the recipe asks for the foreign costs (so the loader reads their inputs only then). */
export const asksForeignCosts = (recipe: { blocks: readonly Block[] }): boolean => recipe.blocks.some(block => "query" in block && block.query.q === "foreign_costs");

/** Whether any block of the recipe asks for the bills of a month (so the loader reads the bills that carry a period only then). */
export const asksPeriodBills = (recipe: { blocks: readonly Block[] }): boolean => recipe.blocks.some(block => "query" in block && block.query.q === "bills_for_month");

// ---------------------------------------------------------------- resolved shapes

export type SentenceData = { text: string; leadParts: (string | { id: string; name: string })[]; before: string; on: string | null; short: boolean; note: string | null };
export type NumberData = { label: string; value: string; sub: string | null; note: string | null; tone: "short" | "plain"; facts: Fact[] };
type FlowMark = { index: number; label: string };
/** The older chart blocks draw through the chart forms (D77): `view` is what the form draws; the other fields are the figures the block's readers (the agent's summary, the tests) use. */
export type FlowData = {
  view: ViewResult<"step_line">; // without the mark: the canvas adds `mark` as a vertical line when it draws
  points: number[]; // the end-of-day balances in the home currency
  lowIndex: number; lowLabel: string; short: boolean; caption: string; aria: string;
  mark: FlowMark | null; // the first day the block's marked bill falls on in the window; null when there is no mark or no such bill in it
};
type TimelineRow = { id: string; date: string; dateLabel: string; label: string; amountLabel: string; incoming: boolean; balanceLabel: string; covered: boolean; flag: string | null; marked: boolean };
export type TimelineData = { caption: string; rows: TimelineRow[]; empty: string | null };
type TableRow = { cells: string[]; tone: "short" | "up" | "down" | "plain" };
export type TableData = { title: string | null; caption: string | null; head: string[]; rows: TableRow[]; foot: string[] | null; empty: string | null };
type CompareRow = { key: string; label: string; aLabel: string; bLabel: string; aMinor: number; bMinor: number; change: string };
export type CompareData = { view: ViewResult<"ranked_bars">; aName: string; bName: string; aTotal: string; bTotal: string; difference: string; rows: CompareRow[]; empty: string | null };
/** D57, D52, D45: the month by category, whose each part is (Shared, then each member), and who owes whom. `rows` draw the chart; `table` is the same figures as a table. */
export type ByPersonData = {
  view: ViewResult<"ranked_bars">;
  month: string;
  rows: { label: string; parts: { name: string; minor: number; label: string }[] }[];
  table: TableData;
  owes: string | null;
  empty: string | null;
};
export type ProgressData = { label: string; valueLabel: string; targetLabel: string; valueMinor: number; targetMinor: number };
type GoalProgressRow = ProgressData & { id: string; targetDate: string; dateLabel: string; summary: string };
export type GoalsProgressData = { rows: GoalProgressRow[]; empty: string | null };
export type NoteData = { text: string; by: "you" | "assistant" };
export type LetterData = { text: string };
export type SlidersData = { controls: { clientId: string; name: string; maxDays: number; days: number; pace: string | null }[] };
export type ActionData = { label: string; href: string };

type Common = { index: number; source: string; live: boolean };
export type ResolvedBlock = Common & (
  | { type: "sentence"; data: SentenceData } | { type: "number"; data: NumberData } | { type: "flow_chart"; data: FlowData }
  | { type: "timeline"; data: TimelineData } | { type: "table"; data: TableData } | { type: "compare"; data: CompareData } | { type: "by_person"; data: ByPersonData }
  | { type: "progress"; data: (ProgressData & { facts: Fact[] }) | GoalsProgressData } | { type: "note"; data: NoteData } | { type: "letter"; data: LetterData }
  | { type: "sliders"; data: SlidersData } | { type: "action"; data: ActionData } | { type: "view"; data: ViewResult }
);

// ---------------------------------------------------------------- scenarios

type Kind = "expected" | "worst";
const kindOf = (scenario: Scenario): Kind => (scenario.case === "usual" ? "expected" : "worst");

/** Home's own picture (the runway, the low point) is the late case; Coming up is the usual one. */
const defaultCase = (query: Query): Scenario["case"] => (query.q === "events" ? "usual" : "late");

function readScenario(ref: ScenarioRef, query: Query, recipe: Recipe, override: Scenario | undefined): Scenario {
  if (ref === "canvas") return override ?? recipe.scenario ?? { case: defaultCase(query), changes: [] };
  return ref ?? { case: defaultCase(query), changes: [] };
}

/** The queries that forecast: they are worked out, and they may carry a scenario. */
const FORECASTS = new Set<Query["q"]>(["sentence", "safe_to_spend", "low_point", "flow", "events"]);

function ownScenario(query: Query): ScenarioRef { return "scenario" in query ? query.scenario : undefined; }

// ---------------------------------------------------------------- the resolver

/** A stored bill's id; an occurrence of a repeating bill is `<id>@<date>`. */
const storedId = (id: string) => id.split("@")[0];
const isMarked = (event: { id: string; kind: string }, mark: string) => event.kind === "bill" && storedId(event.id) === storedId(mark);

export function resolveRecipe(recipeIn: Recipe, context: CanvasContext, canvasScenario?: Scenario): ResolvedBlock[] {
  const parsed = RecipeSchema.safeParse(recipeIn);
  if (!parsed.success) throw new CanvasError(problemWords(parsed.error));
  const recipe = parsed.data;
  let override: Scenario | undefined;
  if (canvasScenario !== undefined) {
    const checked = ScenarioSchema.safeParse(canvasScenario);
    if (!checked.success) throw new CanvasError(problemWords(checked.error));
    override = checked.data;
  }
  const { state, spending } = context;
  if (spending.homeCurrency !== state.homeCurrency) throw new CanvasError("The spending and the money state are in different currencies.");
  const currency = state.homeCurrency;
  const unit = minorPerUnit(currency);
  const format = (n: number) => money(n, currency);
  const minor = (minorUnits: number) => minorMoney(minorUnits, currency);
  const current = state.today.slice(0, 7);
  const oldest = monthsBack(current, HISTORY_MONTHS);

  const states = new Map<string, MoneyState>();
  // `days` is how far a block looks (27D): the bills are expanded to that day first, then the what-if changes are applied to them.
  const stateFor = (scenario: Scenario, days?: number): MoneyState => {
    const base = days === undefined ? state : stateThrough(state, addDays(state.today, days - 1));
    const key = `${base === state ? "" : days}|${JSON.stringify(scenario.changes)}`;
    let found = states.get(key);
    if (!found) {
      try { found = whatIf(base, scenario.changes); } catch (error) {
        if (error instanceof WhatIfError) throw new CanvasError(error.message);
        throw error;
      }
      states.set(key, found);
    }
    return found;
  };
  const checkMonth = (month: string) => {
    if (month < oldest || month > current) throw new CanvasError(`${monthName(month)} ${month.slice(0, 4)} is outside the months your records cover (${monthName(oldest)} ${oldest.slice(0, 4)} to ${monthName(current)}).`);
  };
  const views = new Map<string, MonthView>();
  const viewOf = (month: string): MonthView => {
    checkMonth(month);
    let found = views.get(month);
    if (!found) { found = monthByCategory(spending, state.today, month); views.set(month, found); }
    return found;
  };
  const monthLabel = (month: string) => `${monthName(month)}${month.slice(0, 4) === current.slice(0, 4) ? "" : ` ${month.slice(0, 4)}`}`;
  const totalLabel = (view: MonthView) => (view.categories.length > 0 && view.categories.every(c => allUncounted(c.items)) ? AMOUNT_NOT_KNOWN : minor(view.totalMinor));
  const uncountedNote = (view: MonthView) => gapUncountedWords(view.categories.flatMap(c => c.items.filter(i => i.uncounted).map(i => i.label)));

  const foreignOf = (): FxCosts => {
    if (!context.foreignCosts) throw new CanvasError("The foreign costs were not loaded for this canvas.");
    return context.foreignCosts;
  };

  // ------------------------------------------------ a single measure, for number and progress blocks
  type Measure = { valueMinor: number; value: string; sub: string | null; note: string | null; tone: "short" | "plain"; facts: Fact[] };
  // A measure's numbers come from the engine call that worked it out, each named as a fact (D79).
  const fromCanvas = "canvas", span = (month: string) => ({ from: monthBounds(month).first, to: monthBounds(month).last });
  const moneyFact = (name: Parameters<typeof engineFact>[0], minorUnits: number, options: { case?: "as_usual" | "late"; period?: ReturnType<typeof span> } = {}) => engineFact(name, minorUnits, { from: fromCanvas, currency, ...options });
  const measure = (query: Extract<Query, { q: "safe_to_spend" | "cash" | "low_point" | "month_total" | "foreign_costs" }>): Measure => {
    switch (query.q) {
      case "cash": {
        const cash = availableCash(state);
        const valueMinor = Math.round(cash * unit);
        return { valueMinor, value: format(cash), sub: null, note: null, tone: "plain", facts: [moneyFact("cash", valueMinor)] };
      }
      case "safe_to_spend": {
        const st = stateFor(readScenario(query.scenario, query, recipe, override));
        const safe = safeToSpend(st);
        const valueMinor = Math.round(safe.amount * unit);
        return { valueMinor, value: format(safe.amount), sub: safe.shortBy > 0 ? `Short by ${format(safe.shortBy)} on ${dayLabel(safe.low.date)}` : null, note: null, tone: safe.shortBy > 0 ? "short" : "plain",
          facts: [moneyFact("safe_to_spend", valueMinor), ...(safe.shortBy > 0 ? [moneyFact("short", Math.round(safe.shortBy * unit), { case: "late" }), engineFact("low_point_day", safe.low.date, { from: fromCanvas, case: "late" })] : [])] };
      }
      case "low_point": {
        const scenario = readScenario(query.scenario, query, recipe, override);
        const point = low(series(stateFor(scenario), kindOf(scenario)));
        const valueMinor = Math.round(point.amount * unit), pointCase = scenario.case === "usual" ? "as_usual" as const : "late" as const;
        return { valueMinor, value: format(point.amount), sub: `on ${dayLabel(point.date)}`, note: null, tone: point.amount < 0 ? "short" : "plain", facts: [moneyFact("low_point", valueMinor, { case: pointCase }), engineFact("low_point_day", point.date, { from: fromCanvas, case: pointCase })] };
      }
      case "month_total": {
        const view = viewOf(query.month);
        return { valueMinor: view.totalMinor, value: totalLabel(view), sub: monthLabel(query.month), note: uncountedNote(view), tone: "plain", facts: [moneyFact("month_total", view.totalMinor, { period: span(query.month) })] };
      }
      case "foreign_costs": {
        const costs = foreignOf();
        const total = costs.payoutTotals.costMinor + costs.chargeTotals.exactMinor + costs.chargeTotals.estimatedMinor;
        const words = foreignCostWords(costs);
        return { valueMinor: total, value: costs.chargeTotals.estimatedMinor > 0 ? aboutMoney(total, currency) : minor(total), sub: "in the last 12 months", note: words.unknown, tone: "plain", facts: [moneyFact("foreign_cost", total)] };
      }
    }
  };

  // ------------------------------------------------ the table and compare queries
  const regularRows = (query: Extract<Query, { q: "regular_costs" }>): TableData => {
    const months = query.months ?? REGULAR_MONTHS;
    const from = monthBounds(monthsBack(current, months)).first;
    const result = regularCosts(spendingItems(spending, from, monthBounds(current).last), currency, state.today, months);
    const amount = (minorUnits: number, estimated?: true) => (estimated ? aboutMoney(minorUnits, currency) : minor(minorUnits));
    const change = (cost: RegularCost): { words: string; tone: TableRow["tone"] } => {
      switch (cost.status) {
        case "up": return { words: `up ${amount(cost.changeMinor!, cost.estimated)}`, tone: "up" };
        case "down": return { words: `down ${amount(-cost.changeMinor!, cost.estimated)}`, tone: "down" };
        case "same": return { words: "same", tone: "plain" };
        case "started": return { words: "started this month", tone: "plain" };
        case "stopped": return { words: "stopped", tone: "plain" };
        case "not_yet": return { words: `usually on the ${ordinal(cost.usualDay!)}`, tone: "plain" };
      }
    };
    const last = monthName(monthsBack(current, 2)), now = monthName(current);
    return {
      title: null, caption: result.changedLine, head: ["Cost", last, now, "Change"], foot: null,
      empty: result.items.length === 0 ? "Regular costs show up once a bill repeats or a name comes back two months running." : null,
      rows: result.items.map(cost => {
        const { words, tone } = change(cost);
        const thisCell = cost.status === "not_yet" ? "not in yet" : `${amount(cost.thisMinor, cost.months[cost.months.length - 1].estimated)}${cost.soFar ? " so far" : ""}`;
        return { cells: [`${cost.label} (${cost.categoryLabel})`, cost.status === "started" ? "—" : amount(cost.lastMinor, cost.months[cost.months.length - 2].estimated), thisCell, words], tone };
      }),
    };
  };

  const foreignRows = (title: string | null): TableData => {
    const costs = foreignOf();
    const words = foreignCostWords(costs);
    const cardCost = (card: FxCosts["perCard"][number]): string => {
      const exact = card.exactMinor, estimated = card.estimatedMinor;
      if (estimated > 0) return aboutMoney(exact + estimated, currency);
      if (exact > 0 || card.unknownCount === 0) return minor(exact);
      return "—";
    };
    const clientRows: TableRow[] = costs.perClient.map(client => ({
      cells: [client.clientName, minor(client.costMinor), `${client.count} ${plural(client.count, "invoice")}: ${minor(client.receiveFeeMinor)} in fees, ${minor(client.markupMinor)} in the rate, ${minor(client.landedMinor)} reached your bank`], tone: "plain",
    }));
    const cardRows: TableRow[] = costs.perCard.map(card => ({
      cells: [card.label, cardCost(card), `${card.count} ${plural(card.count, "purchase")} in another currency, ${card.estimatedMinor > 0 ? "estimated from the card's fee" : card.unknownCount > 0 && card.exactMinor === 0 ? "no cost yet" : "statement amount known"}${card.unknownCount > 0 && (card.exactMinor > 0 || card.estimatedMinor > 0) ? `; ${card.unknownCount} with no cost yet` : ""}`], tone: "plain",
    }));
    const total = costs.payoutTotals.costMinor + costs.chargeTotals.exactMinor + costs.chargeTotals.estimatedMinor;
    const rows = [...clientRows, ...cardRows];
    return {
      title, caption: [words.payouts, words.charges, words.unknown].filter(w => w !== null).join(" ") || null, head: ["Who", "Cost", "Detail"],
      foot: rows.length > 0 ? ["Total", costs.chargeTotals.estimatedMinor > 0 ? aboutMoney(total, currency) : minor(total), ""] : null,
      empty: rows.length === 0 ? "No payouts or card purchases in another currency in the last 12 months." : null, rows,
    };
  };

  const compareRows = (query: Extract<Query, { q: "compare_months" }>): Omit<CompareData, "view"> => {
    const a = viewOf(query.a), b = viewOf(query.b);
    const cell = (view: MonthView, key: string) => view.categories.find(c => c.category === key);
    const rows = CATEGORIES.flatMap(({ key }) => {
      const ca = cell(a, key), cb = cell(b, key);
      if (!ca && !cb) return [];
      const unknown = (c: typeof ca) => c !== undefined && allUncounted(c.items);
      const aMinor = ca?.totalMinor ?? 0, bMinor = cb?.totalMinor ?? 0;
      const diff = bMinor - aMinor;
      const change = unknown(ca) || unknown(cb) ? "—" : diff === 0 ? "No change" : `${diff > 0 ? "+" : ""}${minor(diff)}`;
      return [{ key, label: categoryLabel(key), aLabel: unknown(ca) ? AMOUNT_NOT_KNOWN : minor(aMinor), bLabel: unknown(cb) ? AMOUNT_NOT_KNOWN : minor(bMinor), aMinor, bMinor, change, size: unknown(ca) || unknown(cb) ? -1 : Math.abs(diff) }];
    }).sort((x, y) => y.size - x.size);
    const diff = b.totalMinor - a.totalMinor;
    return {
      aName: monthLabel(query.a), bName: monthLabel(query.b), aTotal: totalLabel(a), bTotal: totalLabel(b),
      difference: diff === 0 ? "No change" : `${diff > 0 ? "+" : ""}${minor(diff)}`,
      rows: rows.map(({ key, label, aLabel, bLabel, aMinor, bMinor, change }) => ({ key, label, aLabel, bLabel, aMinor, bMinor, change })),
      empty: rows.length === 0 ? "Nothing confirmed in either month." : null,
    };
  };
  const compareOf = (query: Extract<Query, { q: "compare_months" }>): CompareData => {
    const plain = compareRows(query), a = viewOf(query.a), b = viewOf(query.b);
    const tick = plain.aName, now = plain.bName;
    const table: TableTwin = {
      caption: `${now} against ${tick}, by category`, head: ["Category", tick, now, "Change"], foot: plain.rows.length ? ["Total", plain.aTotal, plain.bTotal, plain.difference] : null,
      rows: plain.rows.map(row => ({ key: row.key, cells: [row.label, row.aLabel, row.bLabel, row.change], ...(row.change.startsWith("+") ? { tone: "short" as const } : row.change.startsWith("−") ? { tone: "in" as const } : {}) })),
    };
    const rows: RankedRow[] = plain.rows.map(row => ({
      key: row.key, label: row.label, note: "", parts: [row.bMinor], total: row.bMinor, totalLabel: row.bLabel, tick: row.aMinor, tickLabel: row.aLabel, sub: row.change,
      aria: `${row.label}: ${now} ${row.bLabel}, ${tick} ${row.aLabel}, ${row.change}.`,
    }));
    const line = `${now} ${plain.bTotal} against ${tick} ${plain.aTotal}: ${plain.difference}.`;
    const base = { view: "month_by_category" as const, args: { a: query.a, b: query.b }, form: "ranked_bars" as const, title: `${now} against ${tick}`, question: VIEW_META.month_by_category.question, hint: VIEW_META.month_by_category.hint, home: null, currency, strip: null, source: "Worked out from your records", facts: [moneyFact("month_total", a.totalMinor, { period: span(query.a) }), moneyFact("month_total", b.totalMinor, { period: span(query.b) }), moneyFact("difference_between_months", b.totalMinor - a.totalMinor, { period: span(query.b) })] };
    const view: ViewResult<"ranked_bars"> = plain.empty
      ? { ...base, data: null, table: null, line: null, facts: [], aria: plain.empty, empty: { words: plain.empty, add: null, addLabel: null } }
      : { ...base, data: { segments: [{ key: "now", legend: now, tone: "main" }], tick: { legend: tick }, rows }, table, line, aria: `${now} against ${tick}, category by category. ${line}`, empty: null };
    return { ...plain, view };
  };

  const byPersonOf = (query: Extract<Block, { type: "by_person" }>["query"]): ByPersonData => {
    const view = viewOf(query.month), month = monthLabel(query.month);
    const members = state.split.members;
    const none = { rows: [], table: { title: null, caption: null, head: [], rows: [], foot: null, empty: null }, owes: null };
    const baseView = { view: "month_by_category" as const, args: { month: query.month, by: "person" }, form: "ranked_bars" as const, title: `${month} by category and whose it is`, question: VIEW_META.month_by_category.question, hint: VIEW_META.month_by_category.hint, home: null, currency, strip: null, source: "Worked out from your records" };
    const emptyOf = (words: string): ByPersonData => ({ month, ...none, empty: words, view: { ...baseView, data: null, table: null, line: null, aria: words, facts: [], empty: { words, add: null, addLabel: null } } });
    if (members.length < 2) return emptyOf(`Only ${members[0]?.name ?? "you"} in this household. Add a person in Household → People to split.`);
    if (view.categories.length === 0) return emptyOf(`Nothing confirmed in ${monthName(query.month)}.`);
    const parts = (whose: { sharedMinor: number; byMember: { id: string; minor: number }[] }) =>
      [{ name: "Shared", minor: whose.sharedMinor }, ...members.map(m => ({ name: m.name, minor: whose.byMember.find(x => x.id === m.id)?.minor ?? 0 }))].map(p => ({ ...p, label: p.minor > 0 ? minor(p.minor) : "—" }));
    const rows = view.categories.map(c => ({ label: c.label, parts: parts(c), total: allUncounted(c.items) ? AMOUNT_NOT_KNOWN : minor(c.totalMinor) }));
    const balance = splitBalance(state.split, state.today), owes = splitSummary(state.split, balance, currency);
    const facts: Fact[] = [
      moneyFact("month_total", view.totalMinor, { period: span(query.month) }),
      ...view.categories.filter(c => !allUncounted(c.items)).map(c => engineFact("category_total", c.totalMinor, { from: fromCanvas, currency, period: span(query.month), about: { type: "category", id: c.category, name: c.label } })),
      ...balance.transfers.flatMap(t => { const about = { type: "person" as const, id: t.fromId, name: t.fromName }; return [engineFact("who_owes_whom", t.amountMinor, { from: fromCanvas, currency, about }), engineFact("owes_to", t.toName, { from: fromCanvas, about })]; }),
    ];
    const table: TableData = {
      title: null, caption: uncountedNote(view), head: ["Category", ...parts(view).map(p => p.name), "Total"], empty: null,
      rows: rows.map(row => ({ cells: [row.label, ...row.parts.map(p => p.label), row.total], tone: "plain" as const })),
      foot: ["Total", ...parts(view).map(p => p.label), totalLabel(view)],
    };
    // Shared is the quiet grey; each person takes the next step of the yellow ramp in a fixed order, never cycled. Past three people the rest fold into "Others".
    const PERSON_TONES = ["main", "soft", "deep"] as const, shown = members.slice(0, PERSON_TONES.length), folded = members.length > shown.length;
    const segments: { key: string; legend: string; tone: Tone }[] = [{ key: "shared", legend: "Shared", tone: "quiet" }, ...shown.map((m, i) => ({ key: m.id, legend: m.name, tone: PERSON_TONES[i] as Tone })), ...(folded ? [{ key: "others", legend: "Others", tone: "pale" as Tone }] : [])];
    const drawn = (own: { minor: number }[]) => [...own.slice(0, 1 + shown.length).map(p => p.minor), ...(folded ? [own.slice(1 + shown.length).reduce((sum, p) => sum + p.minor, 0)] : [])];
    const ranked: RankedRow[] = view.categories.map(c => {
      const own = parts(c), said = own.filter(p => p.minor > 0).map(p => `${p.name} ${p.label}`).join(", ");
      const total = allUncounted(c.items) ? AMOUNT_NOT_KNOWN : minor(c.totalMinor);
      return { key: c.category, label: c.label, note: "", parts: drawn(own), total: c.totalMinor, totalLabel: total, tick: null, tickLabel: null, sub: said, aria: `${c.label}: ${total}. ${said}.` };
    });
    const tableTwin: TableTwin = { caption: `${month} by category, shared and each person`, head: table.head, foot: table.foot, rows: table.rows.map((row, i) => ({ key: view.categories[i].category, cells: row.cells })) };
    const line = owes;
    return {
      month, owes, empty: null,
      rows: rows.map(({ label, parts }) => ({ label, parts: parts.filter(p => p.minor > 0) })), table,
      view: { ...baseView, data: { segments, tick: null, rows: ranked }, table: tableTwin, line, empty: null, aria: `${month} by category and whose it is.${owes ? ` ${owes}` : ""}`, facts },
    };
  };

  const tableOf = (query: Extract<Block, { type: "table" }>["query"], title: string | null): TableData => {
    switch (query.q) {
      case "regular_costs": return { ...regularRows(query), title };
      case "foreign_costs": return foreignRows(title);
      case "bills_for_month": {
        if (!context.periodBills) throw new CanvasError("The bills for a month were not loaded for this canvas.");
        if (query.month > latestDate(state.today).slice(0, 7)) throw new CanvasError(`${monthName(query.month)} ${query.month.slice(0, 4)} is more than two years away.`);
        const result = billsForMonth(context.periodBills, query.month, query.text ?? "");
        const uncounted = result.items.filter(item => item.amountMinor === null).map(item => item.biller);
        return {
          title, caption: [result.note, gapUncountedWords(uncounted)].filter(w => w !== null).join(" "), head: ["Bill", "Amount", "Due"],
          foot: result.totals.length > 0 ? ["Total", result.totals.map(t => minorMoney(t.totalMinor, t.currency)).join(", "), ""] : null,
          empty: result.items.length === 0 ? result.summary : null,
          rows: result.items.map(item => ({
            cells: [`${item.biller} (${item.periodLabel})`, item.amountMinor === null ? AMOUNT_NOT_KNOWN : minorMoney(item.amountMinor, item.currency), `${item.due === null ? "date not known" : dayLabel(item.due)}${item.status === "pending" ? ", waiting in To check" : ""}`],
            tone: "plain" as const,
          })),
        };
      }
      case "events": {
        const scenario = readScenario(query.scenario, query, recipe, override);
        const events = timeline(stateFor(scenario, query.days ?? WINDOW_DAYS), kindOf(scenario), query.days ?? WINDOW_DAYS);
        return {
          title, caption: caseWords(scenario), head: ["Date", "What", "Amount", "Balance"], foot: null, empty: events.length === 0 ? "Nothing is due in this time." : null,
          rows: events.map(event => ({ cells: [dayLabel(event.date), event.label, amountOf(event), format(event.balance)], tone: event.covered ? "plain" : "short" })),
        };
      }
      case "month_by_category": {
        const view = viewOf(query.month);
        return {
          title, caption: uncountedNote(view), head: ["Category", monthLabel(query.month)], foot: view.categories.length ? ["Total", totalLabel(view)] : null,
          empty: view.categories.length === 0 ? `Nothing confirmed in ${monthName(query.month)}.` : null,
          rows: view.categories.map(c => ({ cells: [c.label, allUncounted(c.items) ? AMOUNT_NOT_KNOWN : minor(c.totalMinor)], tone: "plain" as const })),
        };
      }
      case "compare_months": {
        const data = compareOf(query);
        return {
          title, caption: null, head: ["Category", data.aName, data.bName, "Change"], foot: data.rows.length ? ["Total", data.aTotal, data.bTotal, data.difference] : null, empty: data.empty,
          rows: data.rows.map(row => ({ cells: [row.label, row.aLabel, row.bLabel, row.change], tone: row.change.startsWith("+") ? "up" as const : row.change.startsWith("−") ? "down" as const : "plain" as const })),
        };
      }
      case "spending_search": {
        const from = monthBounds(monthsBack(current, query.months)).first, to = monthBounds(current).last;
        const result = searchSpending(spendingItems(spending, from, to), query.text, currency, { from, to: state.today, uncountedTo: to });
        const used = result.months.filter(m => m.items.length > 0);
        const none = `Nothing matched ${query.text.trim() === "" ? "in these months" : `"${result.query}"`}.`;
        return {
          title, caption: gapUncountedWords(result.uncounted), head: ["Month", "Items", "Total"], empty: used.length === 0 ? none : null,
          foot: used.length > 0 && !used.every(m => allUncounted(m.items)) ? ["All", String(used.reduce((n, m) => n + m.items.length, 0)), minor(result.totalMinor)] : null,
          rows: used.map(m => ({ cells: [`${m.name} ${m.month.slice(0, 4)}`, String(m.items.length), allUncounted(m.items) ? AMOUNT_NOT_KNOWN : minor(m.totalMinor)], tone: "plain" as const })),
        };
      }
    }
  };

  const amountOf = (event: { amount: number; estimated?: true; uncounted?: true; kind: string }): string => {
    if (event.uncounted) return AMOUNT_NOT_KNOWN;
    if (event.estimated) return aboutMoney(Math.round(Math.abs(event.amount) * unit), currency);
    return event.amount > 0 ? `+${format(event.amount)}` : format(event.amount);
  };

  // ------------------------------------------------ each block
  return recipe.blocks.map((block, index): ResolvedBlock => {
    const scenarioOf = (): Scenario | null => { const query = block.type === "sliders" || block.type === "view" || !("query" in block) ? null : block.query; return query === null ? null : readScenario(ownScenario(query), query, recipe, override); };
    const live = "query" in block && ownScenario(block.query) === "canvas";
    const changed = "query" in block && FORECASTS.has(block.query.q) && (scenarioOf()?.changes.length ?? 0) > 0;
    const common = (kind: "records" | "worked"): Common => ({ index, live, source: `${kind === "records" ? "From your records" : "Worked out from your records"}${changed ? ", with your what-if changes" : ""}` });
    const worked = (query: Query): "records" | "worked" => (FORECASTS.has(query.q) || query.q === "compare_months" || query.q === "foreign_costs" ? "worked" : "records");

    switch (block.type) {
      case "sentence": {
        const scenario = scenarioOf()!;
        const s = homeSentence(stateFor(scenario));
        return { ...common("worked"), type: "sentence", data: { text: s.text, leadParts: s.leadParts, before: s.emphasisParts.before, on: s.emphasisParts.on, short: s.short, note: s.note } };
      }
      case "number": {
        const m = measure(block.query);
        return { ...common(worked(block.query)), type: "number", data: { label: block.label, value: m.value, sub: m.sub, note: block.note ?? m.note, tone: m.tone, facts: m.facts } };
      }
      case "progress": {
        if (!("targetMinor" in block)) {
          const rows = goalPaces(state).map(goal => ({
            id: goal.id, label: goal.name, valueLabel: minor(goal.savedMinor), targetLabel: minor(goal.targetMinor),
            valueMinor: goal.savedMinor, targetMinor: goal.targetMinor, targetDate: goal.targetDate,
            dateLabel: dayLabel(goal.targetDate) + ", " + goal.targetDate.slice(0, 4), summary: goal.summary,
          }));
          return { ...common("worked"), type: "progress", data: { rows, empty: rows.length ? null : "No dated goals yet." } };
        }
        const m = measure(block.query);
        return { ...common(worked(block.query)), type: "progress", data: { label: block.label, valueLabel: m.value, targetLabel: minor(block.targetMinor), valueMinor: m.valueMinor, targetMinor: block.targetMinor, facts: m.facts } };
      }
      case "flow_chart": {
        const scenario = scenarioOf()!, kind = kindOf(scenario);
        const days = block.query.days ?? WINDOW_DAYS;
        const at = stateFor(scenario, days);
        const balances = series(at, kind, days);
        const point = low(balances);
        const caption = `${format(point.amount)} · ${dayLabel(point.date)}`;
        const events = timeline(at, kind, days);
        const marked = block.mark === undefined ? undefined : events.find(event => isMarked(event, block.mark!));
        const mark: FlowMark | null = marked ? {
          index: daysBetween(state.today, marked.date),
          label: `${marked.label} ${marked.uncounted ? AMOUNT_NOT_KNOWN : marked.estimated ? aboutMoney(Math.round(-marked.amount * unit), currency) : minor(Math.round(-marked.amount * unit))} · ${dayLabel(marked.date)}`,
        } : null;
        // The step line (D77): the scenario's days, and under a what-if the same days as they are now as a ghost.
        const changes = scenario.changes.length > 0, toMinor = (balance: number) => Math.round(balance * unit);
        const words = caseWords(scenario);
        const lines: FormData["step_line"]["lines"] = [{ key: "main", label: changes ? `${words}, with your changes` : words, tone: "main", points: balances.map(toMinor) }];
        if (changes) lines.push({ key: "before", label: `${words}, as it is now`, tone: "ghost", points: series(stateFor({ case: scenario.case, changes: [] }, days), kind, days).map(toMinor) });
        const lineFor = (event: (typeof events)[number]) => event.pending ? `${event.label} waits in To check and is not counted yet` : event.uncounted ? `${event.label}: amount not known` : `${event.label} ${event.amount < 0 ? "−" : "+"}${format(Math.abs(event.amount))}`;
        const dayWords = balances.map((_, i) => { const date = addDays(state.today, i); const lines = events.filter(event => event.date === date).map(lineFor); return { date, label: longDay(date), lines: lines.length ? lines : ["Nothing scheduled"] }; });
        const data = stepLine({ startDate: state.today, currency, lines, band: null, lowLine: "main", sub: [], dayWords, direct: [{ line: "main", text: kind === "worst" ? "If late" : "If as usual" }] });
        const eventDays = new Set(events.map(event => event.date));
        const table: TableTwin = {
          caption: `${words}, day by day`, head: ["Day", "What happens", "Balance"], foot: null, align: ["end", "start", "end"],
          rows: balances.map((_, i) => i).filter(i => i === 0 || eventDays.has(addDays(state.today, i))).map(i => ({ key: dayWords[i].date, cells: [dayWords[i].label, i === 0 && !eventDays.has(dayWords[i].date) ? "Today" : dayWords[i].lines.join("; "), minor(toMinor(balances[i]))] })),
        };
        const meta = VIEW_META.forecast, line = `${words}. ${data.low.label}.`;
        const aria = `${days}-day cash balance. ${words}. Lowest point ${caption}.`;
        const view: ViewResult<"step_line"> = {
          view: "forecast", args: { days }, form: "step_line", title: `Your next ${days} days`, question: meta.question, hint: meta.hint, home: null, currency, strip: null,
          data, table, empty: null, line, aria, source: "Worked out from your records",
          facts: [moneyFact("low_point", data.low.minor, { case: kind === "worst" ? "late" : "as_usual" }), engineFact("low_point_day", point.date, { from: fromCanvas, case: kind === "worst" ? "late" : "as_usual" }), engineFact("days_shown", days, { from: fromCanvas })],
        };
        return { ...common("worked"), type: "flow_chart", data: { view, points: [...balances], lowIndex: point.dayIndex, lowLabel: caption, short: point.amount < 0, caption: words, aria: `${aria}${mark ? ` Marked: ${mark.label}.` : ""}`, mark } };
      }
      case "timeline": {
        const scenario = scenarioOf()!;
        const events = timeline(stateFor(scenario, block.query.days ?? WINDOW_DAYS), kindOf(scenario), block.query.days ?? WINDOW_DAYS);
        return { ...common("worked"), type: "timeline", data: {
          caption: caseWords(scenario), empty: events.length === 0 ? "Nothing is due in this time." : null,
          rows: events.map(event => ({
            id: event.id, date: event.date, dateLabel: dayLabel(event.date), label: event.label, amountLabel: amountOf(event), incoming: event.amount > 0, balanceLabel: format(event.balance), covered: event.covered,
            flag: event.pending ? "Awaiting confirmation" : event.dueUnknown ? "Date not known" : null,
            marked: block.mark !== undefined && isMarked(event, block.mark),
          })),
        } };
      }
      case "table": return { ...common(worked(block.query)), type: "table", data: tableOf(block.query, block.title ?? null) };
      case "compare": return { ...common("worked"), type: "compare", data: compareOf(block.query) };
      case "by_person": return { ...common("worked"), type: "by_person", data: byPersonOf(block.query) };
      case "view": {
        try {
          const data = resolveView(block.view, block.args, context);
          return { index, live: false, source: data.source, type: "view", data };
        } catch (error) {
          if (error instanceof ViewError) throw new CanvasError(error.message);
          throw error;
        }
      }
      case "note": return { index, live: false, source: block.by === "you" ? "Your note" : "Written by the assistant", type: "note", data: { text: block.text, by: block.by } };
      case "letter": return { index, live: false, source: "Written by the assistant", type: "letter", data: { text: block.text } };
      case "action": return { index, live: false, source: "A link to a page in the app", type: "action", data: { label: block.label, href: block.href } };
      case "sliders": {
        const scenario = recipe.scenario ?? { case: "usual" as const, changes: [] };
        const active = override ?? scenario;
        return { index, live: false, source: "Your what-if, not saved", type: "sliders", data: { controls: block.controls.map(control => {
          const client = state.clients.find(c => c.id === control.clientId);
          if (!client) throw new CanvasError("A slider names a client who is not in your records.");
          const set = active.changes.find(change => change.kind === "client_late" && change.clientId === control.clientId);
          return { clientId: control.clientId, name: client.name, maxDays: control.maxDays, days: set && set.kind === "client_late" ? Math.min(set.days, control.maxDays) : 0, pace: paceLine(client) };
        }) } };
      }
    }
  });
}

/** What a case means in words, for the line under a forecast. */
function caseWords(scenario: Scenario): string {
  return scenario.case === "usual" ? "If clients pay as usual" : "If clients pay late";
}

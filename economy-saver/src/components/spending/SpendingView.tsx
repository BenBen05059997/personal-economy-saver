import Link from "next/link";
import type { MoneyState } from "@/lib/money/types";
import { minorMoney } from "@/lib/money/format";
import { lookBy, monthTrend, type LookBy, type LookByView } from "@/lib/money/look-by";
import { monthByCategory } from "@/lib/money/month";
import { HISTORY_MONTHS, monthBounds, monthLabel, monthName, monthsBack, SEARCH_QUERY_MAX, searchSpending, spendingItems, type SpendingInput } from "@/lib/money/spending";
import { AddLink } from "@/components/add/AddLink";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { MonthList } from "./MonthSplit";
import { MonthPanel } from "./MonthPanel";
import { OverTimePanel } from "./OverTimePanel";
import { RegularCosts } from "./RegularCosts";
import { SpendingResults } from "./SpendingSearch";
import "@/components/home/home-views.css";
import "./spending.css";

/** What the address asks Spending for (D53): `?month=YYYY-MM` within the last twelve months and `?q=` a search, both as typed. */
export type SpendingAsk = { today: string; current: string; oldest: string; month: string | string[] | null; query: string | string[] | null };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month to show, or the words that refuse the address's month (then the current month is shown). */
export function chosenMonth(ask: SpendingAsk): { month: string; refusal: string | null } {
  if (ask.month === null || ask.month === ask.current) return { month: ask.current, refusal: null };
  const label = (m: string) => `${monthName(m)} ${m.slice(0, 4)}`;
  if (typeof ask.month !== "string" || !MONTH.test(ask.month) || ask.month < ask.oldest || ask.month > ask.current) {
    return { month: ask.current, refusal: `Spending shows the last ${HISTORY_MONTHS} months, ${label(ask.oldest)} to ${label(ask.current)}. Here is ${monthName(ask.current)}.` };
  }
  return { month: ask.month, refusal: null };
}

/** The search as typed (trimmed), the empty string for none, or the words that refuse it. */
export function chosenQuery(ask: Pick<SpendingAsk, "query">): { query: string; refusal: string | null } {
  if (ask.query === null) return { query: "", refusal: null };
  if (typeof ask.query !== "string") return { query: "", refusal: "Search for one thing at a time." };
  const query = ask.query.trim();
  if (query.length > SEARCH_QUERY_MAX) return { query: "", refusal: `A search is at most ${SEARCH_QUERY_MAX} characters.` };
  return { query, refusal: null };
}

function monthHref(month: string, current: string, query: string): string {
  const params = new URLSearchParams();
  if (month !== current) params.set("month", month);
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `/spending?${search}` : "/spending";
}

/** Spending → This month (D46, D53, D73, D74): the search results when there is a search, then the month's chart or table. */
export function ThisMonth({ state, spending, ask, own }: { state: MoneyState; spending: SpendingInput; ask: SpendingAsk; own: OwnChoices }) {
  const people = state.split.members.map(({ id, name }) => ({ id, name }));
  const { month, refusal: monthRefusal } = chosenMonth(ask);
  const { query, refusal: queryRefusal } = chosenQuery(ask);
  const past = month === ask.current ? undefined : monthLabel(month, ask.today);
  const result = query ? searchSpending(spendingItems(spending, `${ask.oldest}-01`, monthBounds(ask.current).last), query, spending.homeCurrency, { from: `${ask.oldest}-01`, to: ask.today, uncountedTo: monthBounds(ask.current).last }) : null;
  const view = monthByCategory(spending, ask.today, month);
  const previous = month > ask.oldest ? monthsBack(month, 2) : null;
  const next = month < ask.current ? monthsBack(month, 0) : null; // monthsBack(m, 0) is the month after m
  const label = (m: string) => monthLabel(m, ask.today);
  const nav = <nav className="spending-month-nav" aria-label="Months">
    {previous && <Link href={monthHref(previous, ask.current, query)} aria-label={`Previous month, ${label(previous)}`}>‹ {label(previous)}</Link>}
    {next && <Link className="spending-month-next" href={monthHref(next, ask.current, query)} aria-label={`Next month, ${label(next)}`}>{label(next)} ›</Link>}
  </nav>;
  const title = past === undefined ? <>Where the month goes <small className="spending-month-name">· {view.name}</small></> : `Where ${past} went`;
  const looks: Partial<Record<LookBy, LookByView>> = {};
  const choices: LookBy[] = people.length >= 2 ? ["category", "business", "person"] : ["category", "business"];
  for (const by of choices) looks[by] = lookBy(spending, ask.today, by, people, month);
  const waiting = state.bills.filter(bill => bill.status === "pending" && bill.due.slice(0, 7) === month);
  const notes = waiting.map(bill => `${bill.biller} ${minorMoney(bill.amount, state.homeCurrency)} waits in To check and is not counted yet.`);
  return <>
    {queryRefusal && <p className="spending-line" role="alert">{queryRefusal}</p>}
    {result && <SpendingResults result={result} typed={query} people={people} />}
    {monthRefusal && <p className="spending-line" role="alert">{monthRefusal}</p>}
    {view.categories.length === 0
      ? <section className="home-panel hv-panel">
        <header><div><h2>{title}</h2></div></header>
        {nav}
        <p className="hv-empty">{past === undefined ? `Nothing spent in ${view.name} yet. Add a bill or a card charge and it shows here.` : `Nothing spent in ${past}.`}</p>
        {past === undefined && <div className="hv-blank-actions"><AddLink kind="bill" className="ui-button primary">Add a bill</AddLink><AddLink kind="charge" className="ui-button">Add a card charge</AddLink></div>}
        {notes.map(note => <p className="hv-note" key={note}>{note}</p>)}
      </section>
      : <MonthPanel title={title} nav={nav} views={looks} currency={spending.homeCurrency} past={past !== undefined} notes={notes}
        split={<MonthList view={view} people={people} past={past} filing={{ entries: spendingItems(spending, monthBounds(month).first, monthBounds(month).last), own }} />} />}
  </>;
}

/** Spending → Over time (D54, D73): the months side by side, then the regular costs. */
export function OverTime({ state, spending, today }: { state: MoneyState; spending: SpendingInput; today: string }) {
  const months = monthTrend(spending, today);
  const format = (value: number) => minorMoney(value, spending.homeCurrency);
  const past = months.filter(month => !month.current && month.total > 0), high = [...past].sort((a, b) => b.total - a.total)[0];
  const sentence = high && past.length > 1 ? `${high.name} was the highest month (${format(high.total)})${high.biggest ? `, mostly because of ${high.biggest.label} (${format(high.biggest.amount)})` : ""}.` : null;
  return <>
    {months.some(month => month.total > 0)
      ? <OverTimePanel months={months} currency={spending.homeCurrency} sentence={sentence} people={state.split.members.length} />
      : <section className="home-panel hv-panel">
        <header><div><h2>Spending over time</h2></div></header>
        <p className="hv-empty">Nothing to compare yet. Months show here once you have bills or card charges.</p>
        <div className="hv-blank-actions"><AddLink kind="bill" className="ui-button primary">Add a bill</AddLink><AddLink kind="charge" className="ui-button">Add a card charge</AddLink></div>
      </section>}
    <RegularCosts spending={spending} today={today} />
  </>;
}

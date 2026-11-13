import type { ReactNode } from "react";
import Link from "next/link";
import type { MoneyState } from "@/lib/money/types";
import { minorMoney } from "@/lib/money/format";
import type { LookBy } from "@/lib/money/look-by";
import { monthByCategory } from "@/lib/money/month";
import { monthBounds, monthLabel, monthsBack, searchSpending, spendingItems, type SpendingInput } from "@/lib/money/spending";
import { ViewPanel, type PanelQuestion } from "@/components/views/ViewPanel";
import { RankedBars } from "@/components/views/forms/RankedBars";
import { monthByCategoryView } from "@/lib/views/v/month-by-category";
import type { ViewResult } from "@/lib/views/types";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { MonthList } from "./MonthSplit";
import { SpendingResults } from "./SpendingSearch";
import { chosenMonth, chosenQuery, type SpendingAsk } from "./SpendingView";
import "./spending.css";

const LOOK_LABELS: Record<LookBy, string> = { category: "Category", business: "Business or personal", person: "Person" };

function monthHref(month: string, current: string, query: string): string {
  const params = new URLSearchParams();
  if (month !== current) params.set("month", month);
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `/spending?${search}` : "/spending";
}

/** Spending → This month (D46, D53, D73, D74): the search results when there is a search, then the month's chart or table. */
export function ThisMonth({ state, spending, ask, own, device }: { state: MoneyState; spending: SpendingInput; ask: SpendingAsk; own: OwnChoices; device?: { householdId: string } }) {
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
  // Each look is one view of the same month; the current month is left out of the arguments so a pin follows the calendar.
  const choices: LookBy[] = people.length >= 2 ? ["category", "business", "person"] : ["category", "business"];
  const split = <MonthList view={view} people={people} past={past} filing={{ entries: spendingItems(spending, monthBounds(month).first, monthBounds(month).last), own }} />;
  const headings: Record<LookBy, ReactNode> = {
    category: past === undefined ? <>Where this month goes <small className="spending-month-name">· {view.name}</small></> : `Where ${past} went`,
    business: past === undefined ? "Business and personal this month" : `Business and personal in ${past}`,
    person: past === undefined ? "Who this month's spending belongs to" : `Who ${past}'s spending belongs to`,
  };
  const questions: PanelQuestion[] = choices.map(by => {
    const resolved = monthByCategoryView({ ...(past === undefined ? {} : { month }), by }, { state, spending });
    return { key: by, label: LOOK_LABELS[by], heading: headings[by], result: resolved, figure: <RankedBars result={resolved as ViewResult<"ranked_bars">} />, ...(by === "category" ? { tableSlot: split } : {}) };
  });
  const waiting = state.bills.filter(bill => bill.status === "pending" && bill.due.slice(0, 7) === month);
  const notes = waiting.map(bill => `${bill.biller} ${minorMoney(bill.amount, state.homeCurrency)} waits in To check and is not counted yet.`);
  if (questions[0].result.figures.unknown === 1) notes.unshift("Some amounts are not known and are not included in these totals.");
  return <>
    {queryRefusal && <p className="spending-line" role="alert">{queryRefusal}</p>}
    {result && <SpendingResults result={result} typed={query} people={people} device={device} />}
    {monthRefusal && <p className="spending-line" role="alert">{monthRefusal}</p>}
    <ViewPanel id="month" questions={questions} nav={nav} notes={notes} device={device} switchLabel="Look at it by" />
  </>;
}

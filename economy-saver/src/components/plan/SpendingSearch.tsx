import { aboutMoney, dayLabel, minorMoney } from "@/lib/money/format";
import { AMOUNT_NOT_KNOWN } from "@/lib/money/gaps";
import { allUncounted, HISTORY_MONTHS, SEARCH_QUERY_MAX, searchLine, type SpendingSearch as SearchResult } from "@/lib/money/spending";
import { ownLabel } from "@/lib/money/own-category";
import { whoseName, type MonthPerson } from "./MonthSplit";
import "./plan.css";

/**
 * Plan's search box (D53): a plain GET form, so it works with no script. `month` keeps a past month in view while searching.
 */
export function SpendingSearchForm({ query, month }: { query: string; month: string | null }) {
  return <form className="plan-search" action="/plan" method="get" role="search">
    <label className="plan-search-field">
      <span className="plan-search-label">Search spending</span>
      <input name="q" type="search" maxLength={SEARCH_QUERY_MAX} defaultValue={query} placeholder="Search spending: hotel, food, a shop name" />
    </label>
    {month !== null && <input type="hidden" name="month" value={month} />}
    <button className="ui-button">Search</button>
  </form>;
}

/**
 * The Spending panel (D53): the summary line, then each month with something in it, newest first, with its total, its line by
 * category and its items. Months at 0 appear only in the summary line. Server-rendered, no links or buttons.
 */
export function SpendingResults({ result, typed, people }: { result: SearchResult; typed: string; people: MonthPerson[] }) {
  const money = (minor: number) => minorMoney(minor, result.currency);
  const together = people.length >= 2;
  const months = result.months.filter(m => m.items.length > 0);
  const latestYear = result.months[0]?.month.slice(0, 4);
  return <section className="plan-spending" aria-labelledby="plan-spending-title">
    <h2 id="plan-spending-title">Spending</h2>
    {months.length === 0 ? <p className="plan-line">{`Nothing matches “${typed}” in the last ${HISTORY_MONTHS} months.`}</p> : <>
      <p className="plan-line">{searchLine(result)}</p>
      {months.map(m => <section key={m.month} className="plan-spend-month" aria-label={`${m.name} ${m.month.slice(0, 4)}`}>
        <h3><span>{m.month.slice(0, 4) === latestYear ? m.name : `${m.name} ${m.month.slice(0, 4)}`}</span><span className="num">{allUncounted(m.items) ? AMOUNT_NOT_KNOWN : money(m.totalMinor)}</span></h3>
        <p className="ui-hint">{m.byCategory.map(c => `${c.label} ${allUncounted(m.items.filter(i => i.category === c.category)) ? AMOUNT_NOT_KNOWN : money(c.totalMinor)}`).join(" · ")}</p>
        <ul>
          {m.items.map(item => <li key={`${item.kind}-${item.id}-${item.date}`}>
            <span>{item.label}<small>{dayLabel(item.date)}{item.own !== null && ` · ${ownLabel(item.category, item.own)}`}{together && ` · ${whoseName(item.ownerId, people)}`}{item.documentId !== null && " · from a document"}</small></span>
            <span className="num">{item.uncounted ? AMOUNT_NOT_KNOWN : item.estimated ? aboutMoney(item.amountMinor, result.currency) : money(item.amountMinor)}</span>
          </li>)}
        </ul>
      </section>)}
    </>}
  </section>;
}

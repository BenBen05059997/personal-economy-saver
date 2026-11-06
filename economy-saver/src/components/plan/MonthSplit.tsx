import type { ReactNode } from "react";
import { aboutMoney, dayLabel, minorMoney } from "@/lib/money/format";
import { shareLabel } from "@/lib/money/categories";
import { AMOUNT_NOT_KNOWN, gapUncountedWords } from "@/lib/money/gaps";
import { allUncounted } from "@/lib/money/spending";
import { businessLine, monthWhen, splitLine, type MonthView, type WhoseTotals } from "@/lib/money/month";
import "./plan.css";

export type MonthPerson = { id: string; name: string };

/** "Shared ¥38,000 · Ben ¥9,000 · Wife ¥14,000": only the parts that are not zero. */
export function whoseLine(view: MonthView, totals: WhoseTotals, people: MonthPerson[]): string {
  const parts = totals.sharedMinor > 0 ? [`Shared ${minorMoney(totals.sharedMinor, view.currency)}`] : [];
  for (const person of people) {
    const minor = totals.byMember.find(m => m.id === person.id)?.minor ?? 0;
    if (minor > 0) parts.push(`${person.name} ${minorMoney(minor, view.currency)}`);
  }
  return parts.join(" · ");
}

/** D52: the one line on top of a household of two or more: the shared total first, then each person. */
export function togetherLine(view: MonthView, people: MonthPerson[], when = monthWhen()): string {
  const money = (minor: number) => minorMoney(minor, view.currency);
  const parts = [`Together ${money(view.sharedMinor)}`, ...people.map(p => `${p.name} ${money(view.byMember.find(m => m.id === p.id)?.minor ?? 0)}`)];
  return `${parts.join(" · ")} ${when}`;
}

/** D52: whose an item is, in the words the month view uses: "Shared" or the member's name. */
export function whoseName(id: string | null, people: MonthPerson[]): string {
  return id === null ? "Shared" : people.find(p => p.id === id)?.name ?? "Shared";
}

/**
 * Where the month goes (D46, D52): the current month's confirmed bills and card charges by category, split business and personal,
 * and, for two or more people, into Shared and each person. Presentational and server-safe: no buttons or forms of its own, so it
 * works on a page with no session. `past` names a month before the current one ("October", "December 2025"): the heading
 * becomes "Where October went" and the lines say "in October" in place of "this month". `nav` (Plan's month links) sits under the heading.
 */
export function MonthSplit({ view, people, past, nav }: { view: MonthView; people: MonthPerson[]; past?: string; nav?: ReactNode }) {
  const money = (minor: number) => minorMoney(minor, view.currency);
  const together = people.length >= 2;
  const when = monthWhen(past);
  return <section className="plan-month" aria-labelledby="plan-month-title">
    <h2 id="plan-month-title">{past === undefined ? <>Where the month goes <small>{view.name}</small></> : `Where ${past} went`}</h2>
    {nav}
    {view.categories.length === 0 ? <p className="ui-hint">{past === undefined ? "Nothing confirmed yet this month." : `Nothing confirmed ${when}.`}</p> : <>
      {together && <p className="plan-line plan-together">{togetherLine(view, people, when)}</p>}
      <p className="plan-line">{businessLine(view, when)}</p>
      {view.categories.map(category => {
        const split = splitLine(view, category);
        return <details key={category.category} className="plan-cat">
          <summary>
            <span className="plan-cat-name">{category.label}</span>
            <span className="num">{allUncounted(category.items) ? AMOUNT_NOT_KNOWN : money(category.totalMinor)}{split && <small>{split}</small>}</span>
            {together && <span className="plan-whose">{whoseLine(view, category, people)}</span>}
          </summary>
          <ul>
            {category.items.map((item, index) => <li key={`${item.label}-${item.date}-${index}`}>
              <span>{item.label}<small>{dayLabel(item.date)}{together && ` · ${whoseName(item.ownerId, people)}`}</small></span>
              <span className="num">{item.uncounted ? AMOUNT_NOT_KNOWN : item.estimated ? aboutMoney(item.amountMinor, view.currency) : money(item.amountMinor)}{item.businessBp > 0 && <small>{shareLabel(item.businessBp)}</small>}</span>
            </li>)}
          </ul>
          {category.items.some(item => item.uncounted) && <p className="ui-hint plan-uncounted">{gapUncountedWords(category.items.filter(item => item.uncounted).map(item => item.label))}</p>}
        </details>;
      })}
    </>}
  </section>;
}

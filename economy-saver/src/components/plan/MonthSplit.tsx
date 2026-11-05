import { dayLabel, minorMoney } from "@/lib/money/format";
import { shareLabel } from "@/lib/money/categories";
import { businessLine, splitLine, type MonthView, type WhoseTotals } from "@/lib/money/month";
import "./plan.css";

export type MonthPerson = { id: string; name: string };

/** "Shared ¥38,000 · Ben ¥9,000 · Wife ¥14,000": only the parts that are not zero. */
function whoseLine(view: MonthView, totals: WhoseTotals, people: MonthPerson[]): string {
  const parts = totals.sharedMinor > 0 ? [`Shared ${minorMoney(totals.sharedMinor, view.currency)}`] : [];
  for (const person of people) {
    const minor = totals.byMember.find(m => m.id === person.id)?.minor ?? 0;
    if (minor > 0) parts.push(`${person.name} ${minorMoney(minor, view.currency)}`);
  }
  return parts.join(" · ");
}

/** D52: the one line on top of a household of two or more: the shared total first, then each person. */
export function togetherLine(view: MonthView, people: MonthPerson[]): string {
  const money = (minor: number) => minorMoney(minor, view.currency);
  const parts = [`Together ${money(view.sharedMinor)}`, ...people.map(p => `${p.name} ${money(view.byMember.find(m => m.id === p.id)?.minor ?? 0)}`)];
  return `${parts.join(" · ")} this month`;
}

/**
 * Where the month goes (D46, D52): the current month's confirmed bills and card charges by category, split business and personal,
 * and, for two or more people, into Shared and each person. Presentational and server-safe: no buttons, links or forms, so it
 * works on a page with no session.
 */
export function MonthSplit({ view, people }: { view: MonthView; people: MonthPerson[] }) {
  const money = (minor: number) => minorMoney(minor, view.currency);
  const together = people.length >= 2;
  const nameOf = (id: string | null) => id === null ? "Shared" : people.find(p => p.id === id)?.name ?? "Shared";
  return <section className="plan-month" aria-labelledby="plan-month-title">
    <h2 id="plan-month-title">Where the month goes <small>{view.name}</small></h2>
    {view.categories.length === 0 ? <p className="ui-hint">Nothing confirmed yet this month.</p> : <>
      {together && <p className="plan-line plan-together">{togetherLine(view, people)}</p>}
      <p className="plan-line">{businessLine(view)}</p>
      {view.categories.map(category => {
        const split = splitLine(view, category);
        return <details key={category.category} className="plan-cat">
          <summary>
            <span className="plan-cat-name">{category.label}</span>
            <span className="num">{money(category.totalMinor)}{split && <small>{split}</small>}</span>
            {together && <span className="plan-whose">{whoseLine(view, category, people)}</span>}
          </summary>
          <ul>
            {category.items.map((item, index) => <li key={`${item.label}-${item.date}-${index}`}>
              <span>{item.label}<small>{dayLabel(item.date)}{together && ` · ${nameOf(item.ownerId)}`}</small></span>
              <span className="num">{money(item.amountMinor)}{item.businessBp > 0 && <small>{shareLabel(item.businessBp)}</small>}</span>
            </li>)}
          </ul>
        </details>;
      })}
    </>}
  </section>;
}

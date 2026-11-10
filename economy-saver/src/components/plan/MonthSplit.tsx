import type { ReactNode } from "react";
import { aboutMoney, dayLabel, minorMoney } from "@/lib/money/format";
import { shareLabel } from "@/lib/money/categories";
import { AMOUNT_NOT_KNOWN, gapUncountedWords } from "@/lib/money/gaps";
import { allUncounted, type SpendItem } from "@/lib/money/spending";
import { businessLine, monthWhen, splitLine, type MonthItem, type MonthOwn, type MonthView, type WhoseTotals } from "@/lib/money/month";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { FileControl } from "./FileControl";
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
function togetherLine(view: MonthView, people: MonthPerson[], when = monthWhen()): string {
  const money = (minor: number) => minorMoney(minor, view.currency);
  const parts = [`Together ${money(view.sharedMinor)}`, ...people.map(p => `${p.name} ${money(view.byMember.find(m => m.id === p.id)?.minor ?? 0)}`)];
  return `${parts.join(" · ")} ${when}`;
}

/** D52: whose an item is, in the words the month view uses: "Shared" or the member's name. */
export function whoseName(id: string | null, people: MonthPerson[]): string {
  return id === null ? "Shared" : people.find(p => p.id === id)?.name ?? "Shared";
}

/** D75: what the File control needs: the month's items as the engine listed them (`spendingItems` over the same month, so each category's items line up with the view's) and the household's own categories. */
export type Filing = { entries: SpendItem[]; own: OwnChoices };

/**
 * Where the month goes (D46, D52): the current month's confirmed bills and card charges by category, split business and personal,
 * and, for two or more people, into Shared and each person. Presentational and server-safe: no buttons or forms of its own, so it
 * works on a page with no session. Inside a category with own categories (D75), items are grouped under each with its total, then "Everything else in Food". With `filing` each item row has a quiet "File" control; the public family link passes none. `past` names a month before the current one ("October", "December 2025"): the heading
 * becomes "Where October went" and the lines say "in October" in place of "this month". `nav` (Plan's month links) sits under the heading.
 */
export function MonthSplit({ view, people, past, nav, filing }: { view: MonthView; people: MonthPerson[]; past?: string; nav?: ReactNode; filing?: Filing }) {
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
        const sources = filing ? filing.entries.filter(entry => entry.category === category.category) : [];
        const source = new Map<MonthItem, SpendItem>(sources.length === category.items.length ? category.items.map((item, index) => [item, sources[index]]) : []);
        const choices = filing ? filing.own.categories.filter(option => option.kind === category.category) : [];
        const row = (item: MonthItem, index: number, grouped: string | null) => {
          const entry = source.get(item);
          return <li key={`${grouped ?? ""}-${item.label}-${item.date}-${index}`} className={grouped !== null ? "plan-own-item" : undefined}>
            <span>{item.label}<small>{dayLabel(item.date)}{together && ` · ${whoseName(item.ownerId, people)}`}
              {entry && choices.length > 0 && <><span className="plan-file-sep" aria-hidden>·</span><FileControl item={entry.kind} id={entry.id} name={item.label} current={item.own?.id ?? null} options={choices} /></>}</small></span>
            <span className="num">{item.uncounted ? AMOUNT_NOT_KNOWN : item.estimated ? aboutMoney(item.amountMinor, view.currency) : money(item.amountMinor)}{item.businessBp > 0 && <small>{shareLabel(item.businessBp)}</small>}</span>
          </li>;
        };
        const head = (group: MonthOwn, name: string) => <li key={`own-${group.id ?? "rest"}`} className="plan-own-head">
          <span>{name}</span><span className="num">{allUncounted(group.items) ? AMOUNT_NOT_KNOWN : money(group.totalMinor)}</span></li>;
        return <details key={category.category} className="plan-cat">
          <summary>
            <span className="plan-cat-name">{category.label}</span>
            <span className="num">{allUncounted(category.items) ? AMOUNT_NOT_KNOWN : money(category.totalMinor)}{split && <small>{split}</small>}</span>
            {together && <span className="plan-whose">{whoseLine(view, category, people)}</span>}
          </summary>
          <ul>
            {category.ownCategories.length === 0
              ? category.items.map((item, index) => row(item, index, null))
              : [...category.ownCategories.map(group => [head(group, group.name!), ...group.items.map((item, index) => row(item, index, group.id))]),
                ...(category.withoutOwn ? [[head(category.withoutOwn, `Everything else in ${category.label}`), ...category.withoutOwn.items.map((item, index) => row(item, index, "rest"))]] : [])].flat()}
          </ul>
          {category.items.some(item => item.uncounted) && <p className="ui-hint plan-uncounted">{gapUncountedWords(category.items.filter(item => item.uncounted).map(item => item.label))}</p>}
        </details>;
      })}
    </>}
  </section>;
}

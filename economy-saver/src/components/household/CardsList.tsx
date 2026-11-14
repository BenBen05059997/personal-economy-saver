import Link from "next/link";
import { Currency } from "@/lib/catalogue/types";
import { dayLabel, formatter } from "@/lib/money/format";
import { closingBefore } from "@/lib/money/runway";
import { cardSummary } from "@/lib/money/card-summary";
import { STATEMENT_COVERED } from "@/lib/money/covered-words";
import type { MoneyState } from "@/lib/money/types";
import { hrefFor } from "@/lib/links";
import { PanelHint } from "@/components/ui/PanelHint";
import { ImportStatement } from "@/components/settings/ImportStatement";
import type { CardsData } from "./Directory";
import "@/components/settings/settings.css";
import "./household.css";


/** The Cards page's rows, the empty hint and the statement import. */
export function CardsList({ state, selected, cardsData }: { state: MoneyState; selected?: string; cardsData: CardsData }) {
  const format = formatter(state.homeCurrency);
  return <>
    {state.cards.map(item => {
      const { owed, limitLeft, next, shortBy } = cardSummary(state, item.id);
      const owner = state.split.members.length > 1 ? state.split.members.find(member => member.id === item.ownerId)?.name ?? "Shared" : null;
      return <Link key={item.id} prefetch={false} className="ui-row directory-link" href={hrefFor({ type: "card", id: item.id })} aria-label={item.label} aria-current={item.id === selected ? "page" : undefined}>
        <div>{item.label}{owner && <small>{owner}</small>}
          <small>{next ? `${next.open ? "So far" : "Statement"} ${format(next.amount)} · due ${dayLabel(next.dueOn)}` : "No statement due"}</small>
          {limitLeft !== undefined && <small>{format(Math.max(0, limitLeft))} limit left</small>}</div>
        <div>{format(owed)}<small>owed now</small>
          {next && <small>{shortBy > 0 ? <span className="directory-short">Short {format(shortBy)}</span> : <span className="directory-covered" title={STATEMENT_COVERED} aria-label={STATEMENT_COVERED}>Covered ✓</span>}</small>}</div>
      </Link>;
    })}
    {state.cards.length === 0 && <PanelHint className="directory-empty" add="card" label="Add a card">No card yet.</PanelHint>}
    <div className="directory-section">
      <ImportStatement cards={cardsData.settings.cards.map(item => ({ id: item.id, label: item.label, lastClose: closingBefore({ closingDay: item.closingDay }, cardsData.settings.today) }))} currency={Currency.parse(cardsData.settings.household.currency)} own={cardsData.own} /></div>
  </>;
}

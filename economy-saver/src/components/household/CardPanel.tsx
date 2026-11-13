import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { dayLabel, formatter } from "@/lib/money/format";
import { cycle, paybackFor, roomOnCard } from "@/lib/money/runway";
import type { Card, MoneyState } from "@/lib/money/types";
import { ViewCard } from "@/components/views/ViewCard";
import { ViewFigure } from "@/components/views/ViewFigure";
import { resolveView } from "@/lib/views/resolve";
import { ApiForm } from "@/components/ui/ApiForm";
import { CardFields } from "@/components/settings/CardFields";
import type { CardsData } from "./Directory";
import { Detail } from "./ListPage";
import "./household.css";

export function CardPanel({ state, card, data }: { state: MoneyState; card: Card; data: CardsData["settings"] }) {
  const format = formatter(state.homeCurrency);
  const current = cycle(state, card.id);
  const next = paybackFor(state, card.id);
  const room = roomOnCard(state, card.id);
  const trips = new Map<string, number>();
  for (const charge of current.charges) {
    if (charge.place) trips.set(charge.place, (trips.get(charge.place) ?? 0) + charge.amount);
  }
  const cycleView = resolveView("card_cycle", { cardId: card.id }, { state });
  const row = data.cards.find(item => item.id === card.id);
  const charges = state.charges.filter(c => c.cardId === card.id).length;
  const note = `${charges === 1 ? "Its 1 charge" : `Its ${charges} charges`} and all of its statements go with it, and the forecast stops counting them.`;
  return <Detail title={card.label} close="/cards">
    <ViewCard result={cycleView} figure={<ViewFigure result={cycleView} />} />
    <p className="directory-big">{format(current.openTotal)}</p><p className="ui-hint">Unbilled this cycle</p>
    <dl>
      <div className="ui-row"><dt>Closes</dt><dd>{dayLabel(current.closesOn)}</dd></div>
      <div className="ui-row"><dt>Next statement</dt><dd>{next ? `${format(next.amount)} · due ${dayLabel(next.dueOn)}` : "None due"}</dd></div>
      {next && <div className="ui-row"><dt>Coverage</dt><dd>{next.source === "short" ? `Short ${format(-next.worstBalance)}` : next.source === "bank" ? "Covered by cash on hand" : `Covered by payments from ${next.arrivals.map(a => a.clientName).join(", ")}`}</dd></div>}
      {room.limitLeft !== undefined && <div className="ui-row"><dt>Limit left</dt><dd>{format(Math.max(0, room.limitLeft))}</dd></div>}
      <div className="ui-row"><dt>Can still go on this card and leave every bill through {dayLabel(room.through)} covered</dt><dd>{format(room.room)}</dd></div>
      {[...trips].map(([place, total]) => <div className="ui-row" key={place}><dt>{place} this cycle</dt><dd>{format(total)}</dd></div>)}
    </dl>
    <h3>Recent charges</h3>
    {state.charges.filter(c => c.cardId === card.id).reverse().map(charge =>
      <div className="ui-row directory-charge" key={charge.id} id={`charge-${charge.id}`}><div>{charge.merchant}
        <small>{dayLabel(charge.date)}{charge.place && ` · ${charge.place}`}{charge.status === "pending" && " · To check"}</small>
        <ConfirmRemove kind="charge" id={charge.id} returnTo={`/cards/${card.id}`} label={`${charge.merchant} ${format(charge.amount)}`} />
      </div><span className="num">{format(charge.amount)}</span></div>)}
    {!state.charges.some(c => c.cardId === card.id) && <p className="ui-hint">No recent charges.</p>}
    {row && <details className="directory-edit"><summary aria-label={`Edit card ${card.label}`}>Edit card</summary>
      <ApiForm><CardFields data={data} card={row} returnTo={`/cards/${card.id}`} /></ApiForm></details>}
    <ConfirmRemove kind="card" id={card.id} returnTo="/cards" label={`${card.label} card`} note={note} />
  </Detail>;
}

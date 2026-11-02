import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dayLabel, formatter, usd } from "@/lib/money/format";
import { cycle, medianLow, paybackFor, project, roomOnCard } from "@/lib/money/runway";
import type { Card, Client, MoneyState } from "@/lib/money/types";
import "./household.css";

function Detail({ title, close, children }: { title: string; close: string; children: ReactNode }) {
  return <aside className="directory-detail" aria-label={title}>
    <header><h2>{title}</h2><Link href={close}>Close</Link></header>
    {children}
  </aside>;
}

function CardPanel({ state, card }: { state: MoneyState; card: Card }) {
  const format = formatter(state.homeCurrency);
  const current = cycle(state, card.id);
  const next = paybackFor(state, card.id);
  const room = roomOnCard(state, card.id);
  const trips = new Map<string, number>();
  for (const charge of current.charges) {
    if (charge.place) trips.set(charge.place, (trips.get(charge.place) ?? 0) + charge.amount);
  }
  return <Detail title={card.label} close="/cards">
    <p className="directory-big">{format(current.openTotal)}</p><p className="ui-hint">Unbilled this cycle</p>
    <dl>
      <div className="ui-row"><dt>Closes</dt><dd>{dayLabel(current.closesOn)}</dd></div>
      <div className="ui-row"><dt>Next statement</dt><dd>{next ? `${format(next.amount)} · due ${dayLabel(next.dueOn)}` : "None due"}</dd></div>
      {next && <div className="ui-row"><dt>Coverage</dt><dd>{next.source === "short" ? `Short ${format(-next.worstBalance)}` : next.source === "bank" ? "Covered by cash on hand" : `Covered by payments from ${next.arrivals.map(a => a.clientName).join(", ")}`}</dd></div>}
      <div className="ui-row"><dt>Room on this card</dt><dd>{format(room.room)}</dd></div>
      {[...trips].map(([place, total]) => <div className="ui-row" key={place}><dt>{place} this cycle</dt><dd>{format(total)}</dd></div>)}
    </dl>
    <h3>Recent charges</h3>
    {state.charges.filter(c => c.cardId === card.id).reverse().map(charge =>
      <div className="ui-row" key={charge.id}><div>{charge.merchant}
        <small>{dayLabel(charge.date)}{charge.place && ` · ${charge.place}`}{charge.status === "pending" && " · To check"}</small>
      </div><span className="num">{format(charge.amount)}</span></div>)}
    {!state.charges.some(c => c.cardId === card.id) && <p className="ui-hint">No recent charges.</p>}
  </Detail>;
}

function ClientPanel({ state, client }: { state: MoneyState; client: Client }) {
  const invoices = state.invoices.filter(i => i.clientId === client.id);
  const history = client.daysToPay;
  return <Detail title={client.name} close="/clients">
    <p className="ui-hint">{client.email}</p>
    <dl>
      <div className="ui-row"><dt>Payment terms</dt><dd>{client.termsDays === 0 ? "Due on receipt" : `${client.termsDays} days`}</dd></div>
      {history.length > 0 && <div className="ui-row"><dt>Time to pay</dt><dd>{medianLow(history)} days usual · {Math.max(...history)} slowest</dd></div>}
    </dl>
    <h3>Work and invoices</h3>
    {invoices.map(invoice => <Link prefetch={false} className="ui-row directory-link" key={invoice.id} href={`/invoices/${invoice.id}`}>
      <div>{invoice.item}<small>{invoice.number ? `#${invoice.number} · ` : ""}{invoice.status}{invoice.paypalStatus && ` · PayPal ${invoice.paypalStatus.toLowerCase().replaceAll("_", " ")}`}
        {invoice.status === "sent" && ` · expected ${dayLabel(project(state, invoice).expectedOn)}`}</small></div>
      <span className="num">{usd(invoice.amountUsd)}</span>
    </Link>)}
    {!invoices.length && <p className="ui-hint">No current work or recent invoices.</p>}
  </Detail>;
}

export function Directory({ state, section, selected }: { state: MoneyState; section: "cards" | "clients"; selected?: string }) {
  const card = section === "cards" && selected ? state.cards.find(row => row.id === selected) : undefined;
  const client = section === "clients" && selected ? state.clients.find(row => row.id === selected) : undefined;
  if (selected && !card && !client) notFound();
  const format = formatter(state.homeCurrency);
  const isCards = section === "cards";
  return <div className={`directory ${selected ? "detail-open" : ""}`}>
    <div className="directory-list">
      <h1 className="ui-title">{isCards ? "Cards" : "Clients"}</h1>
      <p className="ui-hint">{isCards ? "Statements, charges and what will cover them." : "Work to invoice, payments due and how soon clients usually pay."}</p>
      {isCards ? state.cards.map(item => {
        const next = paybackFor(state, item.id);
        return <Link key={item.id} prefetch={false} className="ui-row directory-link" href={`/cards/${item.id}`} aria-current={item.id === selected ? "page" : undefined}>
          <div>{item.label}<small>{next ? `Due ${dayLabel(next.dueOn)}` : "No statement due"}</small></div>
          <div>{next && <>{format(next.amount)}<small>{next.source === "short" ? "Short if clients pay late" : "Covered ✓"}</small></>}</div>
        </Link>;
      }) : state.clients.map(item => {
        const open = state.invoices.filter(i => i.clientId === item.id && i.status === "sent");
        return <Link key={item.id} prefetch={false} className="ui-row directory-link" href={`/clients/${item.id}`} aria-current={item.id === selected ? "page" : undefined}>
          <div>{item.name}<small>{item.email}</small></div><div>{usd(open.reduce((sum, i) => sum + i.amountUsd, 0))}<small>Outstanding</small></div>
        </Link>;
      })}
      {(isCards ? state.cards : state.clients).length === 0 && <p className="directory-empty">No {section} yet.</p>}
    </div>
    {card && <CardPanel state={state} card={card} />}
    {client && <ClientPanel state={state} client={client} />}
  </div>;
}

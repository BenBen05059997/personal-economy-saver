import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { dayLabel, formatter, usd } from "@/lib/money/format";
import { clientPace } from "@/lib/money/pace";
import { cycle, paybackFor, project, roomOnCard } from "@/lib/money/runway";
import type { Card, Client, MoneyState } from "@/lib/money/types";
import { cardSummary } from "@/components/home/card-summary";
import { AddClientForm } from "./AddClientForm";
import "./household.css";

const STATEMENT_COVERED = "Covered: this statement can be paid on its due date from your bank or from client payments due by then.";

function Detail({ title, close, children }: { title: string; close: string; children: ReactNode }) {
  return <aside className="directory-detail" aria-label={title}>
    <header><h2>{title}</h2><Link className="ui-back" href={close}>Close</Link></header>
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
      {room.limitLeft !== undefined && <div className="ui-row"><dt>Limit left</dt><dd>{format(Math.max(0, room.limitLeft))}</dd></div>}
      <div className="ui-row"><dt>Can still go on this card and leave every bill through {dayLabel(room.through)} covered</dt><dd>{format(room.room)}</dd></div>
      {[...trips].map(([place, total]) => <div className="ui-row" key={place}><dt>{place} this cycle</dt><dd>{format(total)}</dd></div>)}
    </dl>
    <h3>Recent charges</h3>
    {state.charges.filter(c => c.cardId === card.id).reverse().map(charge =>
      <div className="ui-row directory-charge" key={charge.id}><div>{charge.merchant}
        <small>{dayLabel(charge.date)}{charge.place && ` · ${charge.place}`}{charge.status === "pending" && " · To check"}</small>
        <ConfirmRemove kind="charge" id={charge.id} returnTo={`/cards/${card.id}`} label={`${charge.merchant} ${format(charge.amount)}`} />
      </div><span className="num">{format(charge.amount)}</span></div>)}
    {!state.charges.some(c => c.cardId === card.id) && <p className="ui-hint">No recent charges.</p>}
  </Detail>;
}

function ClientPanel({ state, client }: { state: MoneyState; client: Client }) {
  const invoices = state.invoices.filter(i => i.clientId === client.id);
  const pace = clientPace(client);
  return <Detail title={client.name} close="/clients">
    <p className="ui-hint">{client.email}</p>
    <dl>
      <div className="ui-row"><dt>Payment terms</dt><dd>{client.termsDays === 0 ? "Due on receipt" : `${client.termsDays} days`}</dd></div>
      {pace && <div className="ui-row"><dt>Time to pay</dt><dd>{pace.usual} days usual · {pace.slowest} slowest</dd></div>}
    </dl>
    <h3>Work and invoices</h3>
    {invoices.map(invoice => <Link prefetch={false} className="ui-row directory-link" key={invoice.id} href={`/invoices/${invoice.id}`}>
      <div>{invoice.item}<small>{invoice.number ? `#${invoice.number} · ` : ""}{invoice.status}{invoice.paypalStatus && ` · PayPal ${invoice.paypalStatus.toLowerCase().replaceAll("_", " ")}`}
        {invoice.status === "sent" && ` · expected ${dayLabel(project(state, invoice).expectedOn)}`}</small></div>
      <span className="num">{usd(invoice.amountUsd)}</span>
    </Link>)}
    {!invoices.length && <p className="ui-hint">No current work or recent invoices.</p>}
    <p className="directory-next"><Link prefetch={false} href={`/invoices/new?client=${client.id}`}>New invoice for this client ›</Link></p>
  </Detail>;
}

export function Directory({ state, section, selected, newClientId }: { state: MoneyState; section: "cards" | "clients"; selected?: string; newClientId: string }) {
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
        const { owed, limitLeft, next, shortBy } = cardSummary(state, item.id);
        const owner = state.split.members.length > 1 ? state.split.members.find(member => member.id === item.ownerId)?.name ?? "Household" : null;
        return <Link key={item.id} prefetch={false} className="ui-row directory-link" href={`/cards/${item.id}`} aria-label={item.label} aria-current={item.id === selected ? "page" : undefined}>
          <div>{item.label}{owner && <small>{owner}</small>}
            <small>{next ? `${next.open ? "So far" : "Statement"} ${format(next.amount)} · due ${dayLabel(next.dueOn)}` : "No statement due"}</small>
            {limitLeft !== undefined && <small>{format(Math.max(0, limitLeft))} limit left</small>}</div>
          <div>{format(owed)}<small>owed now</small>
            {next && <small>{shortBy > 0 ? <span className="directory-short">Short {format(shortBy)}</span> : <span className="directory-covered" title={STATEMENT_COVERED} aria-label={STATEMENT_COVERED}>Covered ✓</span>}</small>}</div>
        </Link>;
      }) : state.clients.map(item => {
        const outstanding = state.invoices.filter(i => i.clientId === item.id && i.status === "sent").reduce((sum, i) => sum + i.amountUsd, 0);
        return <Link key={item.id} prefetch={false} className="ui-row directory-link" href={`/clients/${item.id}`} aria-label={item.name} aria-current={item.id === selected ? "page" : undefined}>
          <div>{item.name}<small>{item.email}</small></div><div>{outstanding > 0 ? <>{usd(outstanding)}<small>Outstanding</small></> : <small>Nothing outstanding</small>}</div>
        </Link>;
      })}
      {(isCards ? state.cards : state.clients).length === 0 && <p className="directory-empty">No {section} yet.</p>}
      {!isCards && <AddClientForm id={newClientId} />}
    </div>
    {card && <CardPanel state={state} card={card} />}
    {client && <ClientPanel state={state} client={client} />}
  </div>;
}

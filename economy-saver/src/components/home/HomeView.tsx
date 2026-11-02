import type { ReaderInbox } from "@/db/reader-inbox";
import Link from "next/link";
import type { MoneyState } from "@/lib/money/types";
import { dayLabel, formatter, usd } from "@/lib/money/format";
import { addDays, arrivals, daysBetween, paybackFor, roomOnCard, safeToSpend, series, statementItems, timeline } from "@/lib/money/runway";
import { fundingOptions } from "@/lib/money/options";
import { toCheck } from "@/lib/money/to-check";
import { homeSentence } from "@/lib/money/sentence";
import { RunwayChart } from "./RunwayChart";
import { ConfirmButton } from "@/components/household/ConfirmButton";
import "./home.css";

type Props = { state: MoneyState };

function Actions({ state }: Props) {
  const options = fundingOptions(state);
  const pick = options.rows.find((option) => option.pick);
  const unbilled = state.invoices.find((i) => i.status === "unbilled");
  const client = state.clients.find((c) => c.id === unbilled?.clientId);
  const invoiceFix = pick?.id === "invoice" && unbilled && client;
  return <div id="actions">
    <div className="home-actions">
      {invoiceFix ? <Link className="home-button home-primary" prefetch={false} href={`/invoices/${unbilled.id}`}>Invoice {client.name.split(" ")[0]} {usd(unbilled.amountUsd)}</Link>
        : pick && <Link className="home-button home-primary" prefetch={false} href={pick.id === "remind" ? "/clients" : "/options"}>{pick.title}</Link>}
      <Link className="home-button home-secondary" prefetch={false} href="/settings#forwarding">Forward a bill</Link>
      <Link className="home-button home-secondary" prefetch={false} href="/upload">Upload a receipt</Link>
    </div>
    {options.gap > 0 && <Link className="home-options" prefetch={false} href="/options">{pick ? "Other options" : "Compare options"} ›</Link>}
  </div>;
}

function Next30Days({ state }: Props) {
  const format = formatter(state.homeCurrency);
  // Only the amount is displayed. The essentials threshold affects the optional spending verdict.
  const safe = safeToSpend(state, 0);
  const end = addDays(state.today, 30);
  const open = statementItems(state).filter((st) => st.open && st.dueOn >= state.today && st.dueOn < end);
  const unbilled = open.map((st) => `${format(st.amount)} on ${state.cards.find((c) => c.id === st.cardId)!.label}`);
  return <section id="next-30-days" className="home-panel home-runway">
    <h2>Next 30 days, if clients pay late</h2>
    <p className="home-label">Safe to spend now</p>
    <div className="home-amount">{format(safe.amount)}</div>
    <p className="home-note">{unbilled.length ? `Includes ${unbilled.join(" and ")} not yet billed` : "No unbilled card spend due in the next 30 days."}</p>
    <RunwayChart balances={series(state, "worst")} format={format} />
  </section>;
}

function ToCheck({ state, inbox }: Props & { inbox: ReaderInbox }) {
  const rows = toCheck(state);
  return <section id="to-check" className="home-panel home-review">
    <h2>To check{rows.length + inbox.readings.length > 0 && ` · ${rows.length + inbox.readings.length}`}</h2>
    {!rows.length && !inbox.readings.length && !inbox.jobs.length && <p className="home-empty">Nothing to check.</p>}
    {inbox.jobs.map(job => <div key={job.id} className="home-row"><Link href="/to-check">{job.status === "failed" ? "Document needs attention" : "Reading document…"}</Link></div>)}
    {inbox.readings.map(r => <div key={r.id} className="home-row"><span>{r.value.name || "Document"}</span><Link href={`/to-check#reading-${r.id}`}>Review</Link></div>)}
    {rows.map((row) => <div key={row.id} className="home-row home-check-row">
      <div>{row.title}<small>{row.detail}</small></div>
      <div className="home-number">{formatter(state.homeCurrency)(row.amount)}</div>
      <ConfirmButton kind={row.kind} id={row.id} title={row.title} />
    </div>)}
  </section>;
}

function Cards({ state }: Props) {
  const format = formatter(state.homeCurrency);
  return <section id="cards" className="home-panel home-cards">
    <h2>Cards <Link prefetch={false} href="/cards">All cards ›</Link></h2>
    {state.cards.length === 0 && <p className="home-empty">No cards added.</p>}
    {state.cards.map((card) => {
      const next = paybackFor(state, card.id);
      return <div key={card.id} className="home-row">
        <div>
          <Link prefetch={false} href={`/cards/${card.id}`}>{card.label}</Link>
          <small>{next ? `${next.open ? "So far · due" : "Statement due"} ${dayLabel(next.dueOn)}` : "No statement due"}</small>
          <small>{format(roomOnCard(state, card.id).room)} room on this card</small>
        </div>
        {next && <div className="home-number">{format(next.amount)}
          <small>{next.source === "short" ? <span className="home-short">Short {format(-next.worstBalance)}</span> : <span className="home-covered">Covered ✓</span>}</small>
        </div>}
      </div>;
    })}
  </section>;
}

function ComingUp({ state }: Props) {
  const format = formatter(state.homeCurrency);
  const usual = timeline(state, "expected");
  const late = series(state, "worst");
  const incoming = new Map(arrivals(state).map((item) => [`${item.invoiceId}-expected`, item]));
  const rows = usual.map((event) => {
      const payment = incoming.get(event.id);
      const i = daysBetween(state.today, event.date);
      const short = late[i] < 0;
      return <div key={event.id} className="home-row home-dated">
        <time dateTime={event.date}>{dayLabel(event.date)}</time>
        <div>{payment ? <><Link prefetch={false} href={`/clients/${payment.clientId}`}>{event.label}</Link> pays</> : event.label}
          {payment ? <small>Usual date · if late, {dayLabel(payment.worstOn)}</small>
            : event.pending ? <small>Awaiting confirmation</small>
            : short && <small className="home-short">Short by {format(-late[i])} if clients pay late</small>}
        </div>
        <div className="home-number">{payment ? `+${usd(payment.amountUsd)}` : format(Math.abs(event.amount))}
          {payment && state.homeCurrency !== "USD" && <small>≈{format(payment.amountHome)}</small>}
          {!payment && !event.pending && !short && <span className="home-covered-tick" aria-label="Covered"> ✓</span>}
        </div>
      </div>;
    });
  const firstShort = usual.findIndex((event) => !event.pending && late[daysBetween(state.today, event.date)] < 0);
  const shown = Math.max(5, firstShort + 1);
  return <section id="coming-up" className="home-panel home-upcoming">
    <h2>Coming up <Link prefetch={false} href="/activity">All activity ›</Link></h2>
    {rows.length === 0 && <p className="home-empty">Nothing due in the next 30 days.</p>}
    {rows.slice(0, shown)}
    {rows.length > shown && <details><summary>Later in the month · {rows.length - shown} more</summary>{rows.slice(shown)}</details>}
  </section>;
}

export function HomeView({ state, inbox, notice }: Props & { inbox: ReaderInbox; notice?: string | null }) {
  const sentence = homeSentence(state);
  const safe = safeToSpend(state, 0);
  const lead = sentence.lead.split(/([,\s]+)/).map((word, index) => {
    if (!sentence.lead.startsWith("You're fine if ") || !safe.lateClients.includes(word)) return word;
    const matches = state.clients.filter((client) => client.name.split(" ")[0] === word);
    if (matches.length !== 1) return word;
    return <Link key={index} prefetch={false} href={`/clients/${matches[0].id}`}>{word}</Link>;
  });
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(state.today)).replace(",", "");
  return <article className="money-home">
    <time className="home-date" dateTime={state.today}>{date}</time>
    <h1>{lead} <span className={safe.shortBy > 0 ? "home-short" : undefined}>{sentence.emphasis}</span></h1>
    {notice && <p role="status" className="home-freshness ui-hint">{notice}</p>}
    <Actions state={state} />
    <div className="home-panels">
      <div className="home-column"><Next30Days state={state} /><Cards state={state} /></div>
      <div className="home-column"><ToCheck state={state} inbox={inbox} /><ComingUp state={state} /></div>
    </div>
  </article>;
}

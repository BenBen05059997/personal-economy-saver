import type { ReaderInbox } from "@/db/reader-inbox";
import Link from "next/link";
import { ApiForm } from "@/components/ui/ApiForm";
import { categoryLabel } from "@/lib/money/categories";
import type { CancelNotice, MoneyState } from "@/lib/money/types";
import { dayLabel, formatter, usd } from "@/lib/money/format";
import { addDays, arrivals, daysBetween, low, safeToSpend, series, statementItems, timeline } from "@/lib/money/runway";
import { fundingOptions } from "@/lib/money/options";
import { potSummary } from "@/lib/money/plan";
import { toCheck } from "@/lib/money/to-check";
import { homeSentence } from "@/lib/money/sentence";
import { splitBalance, transferLine } from "@/lib/money/split";
import { BankBalance } from "./BankBalance";
import { RunwayChart } from "./RunwayChart";
import { cardSummary } from "./card-summary";
import { AddEntry, type EntryIds } from "@/components/household/AddEntry";
import { ConfirmButton } from "@/components/household/ConfirmButton";
import "./home.css";

type Props = { state: MoneyState };
type People = { id: string; name: string }[];

// What the ✓ marks mean in the engine: a bill's tick is "the worst-case balance on its due day is at least zero";
// a card's is "the statement is paid from the bank, or once client payments land by its due date, with every other bill still paid".
const DAY_COVERED = "Covered: your balance stays above zero on this day, even if clients pay late.";
const STATEMENT_COVERED = "Covered: this statement can be paid on its due date from your bank or from client payments due by then.";

function Actions({ state }: Props) {
  const options = fundingOptions(state);
  const pick = options.rows.find((option) => option.pick);
  const unbilled = state.invoices.find((i) => i.status === "unbilled");
  const client = state.clients.find((c) => c.id === unbilled?.clientId);
  const invoiceFix = pick?.id === "invoice" && unbilled && client;
  // D50: a late client the daily job suggested a nudge for comes first; the reminder still needs the tap on its review page.
  const nudged = state.nudgedInvoiceIds?.map(id => state.invoices.find(i => i.id === id && i.status === "sent")).find(i => i !== undefined);
  const nudgedClient = state.clients.find(c => c.id === nudged?.clientId);
  return <div id="actions">
    <div className="home-actions">
      {nudged && nudgedClient ? <Link className="home-button home-primary" prefetch={false} href={`/invoices/${nudged.id}`}>Nudge {nudgedClient.name.split(" ")[0]} {usd(nudged.amountUsd)}</Link> : invoiceFix ? <Link className="home-button home-primary" prefetch={false} href={`/invoices/${unbilled.id}`}>Invoice {client.name.split(" ")[0]} {usd(unbilled.amountUsd)}</Link>
        : pick && <Link className="home-button home-primary" prefetch={false} href={pick.id === "remind" ? "/clients" : "/options"}>{pick.title}</Link>}
      <Link className="home-button home-secondary" prefetch={false} href="/settings#forwarding">Forward a bill</Link>
      <Link className="home-button home-secondary" prefetch={false} href="/upload">Upload a receipt</Link>
    </div>
    {options.gap > 0 && <Link className="home-options" prefetch={false} href="/options">{pick ? "Other options" : "Compare options"} ›</Link>}
  </div>;
}

function Next30Days({ state, balanceId }: Props & { balanceId: string }) {
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
    <BankBalance key={balanceId} currency={state.homeCurrency} balance={format(state.bank)} balanceId={balanceId} />
    {state.pots.length > 0 && <ul className="home-pots">{state.pots.map((pot) => <li key={pot.id}><Link prefetch={false} href="/plan">{potSummary(pot, state)}</Link></li>)}</ul>}
    <RunwayChart balances={series(state, "worst")} format={format} />
  </section>;
}

function ToCheck({ state, inbox }: Props & { inbox: ReaderInbox }) {
  const rows = toCheck(state);
  return <section id="to-check" className="home-panel home-review">
    <h2>To check{rows.length + inbox.readings.length > 0 && ` · ${rows.length + inbox.readings.length}`}</h2>
    {!rows.length && !inbox.readings.length && !inbox.jobs.length && <p className="home-empty">Nothing to check. <Link prefetch={false} href="/settings#forwarding">Forward a bill or upload a receipt ›</Link></p>}
    {inbox.jobs.map(job => <div key={job.id} className="home-row"><Link href="/to-check">{job.status === "failed" ? "Document needs attention" : "Reading document…"}</Link></div>)}
    {inbox.readings.map(r => <div key={r.id} className="home-row"><span>{r.value.name || "Document"}</span><Link href={`/to-check#reading-${r.id}`}>Review</Link></div>)}
    {rows.map((row) => <div key={row.id} className="home-row home-check-row">
      <div>{row.title}<small>{row.detail}</small></div>
      <div className="home-number">{row.amount !== null && formatter(state.homeCurrency)(row.amount)}</div>
      <ConfirmButton kind={row.kind} id={row.id} title={row.title} />
    </div>)}
  </section>;
}

/** D47: three things that make the forecast real. Each ticks when true (a pending bill counts as a bill); the panel is gone once all three are. */
function FirstSteps({ state }: Props) {
  const steps = [
    { done: state.bills.length > 0, open: "Add a bill", closed: "Bill added", note: "Rent, phone, a subscription", href: "#add-bill" },
    { done: state.clients.length > 0, open: "Add a client who pays you", closed: "Client added", note: "So late payments show up in the sentence", href: "/clients" },
    { done: state.charges.length > 0, open: "Add a card charge", closed: "Card charge added", note: "Spend the card has not billed yet", href: "#add-charge" },
  ];
  const left = steps.filter(step => !step.done).length;
  if (left === 0) return null;
  return <section id="first-steps" className="home-panel home-steps">
    <h2>First steps · {left} to go</h2>
    <ol>{steps.map(step => <li key={step.open} className={step.done ? "home-step-done" : undefined}>
      <span className="home-step-tick" aria-hidden="true">{step.done ? "✓" : ""}</span>
      {step.done ? <span>{step.closed}</span>
        : step.href.startsWith("#") ? <a href={step.href}><span>{step.open}</span><small>{step.note}</small></a>
        : <Link prefetch={false} href={step.href}><span>{step.open}</span><small>{step.note}</small></Link>}
    </li>)}</ol>
  </section>;
}

function Cards({ state }: Props) {
  const format = formatter(state.homeCurrency);
  return <section id="cards" className="home-panel home-cards">
    <h2>Cards <Link prefetch={false} href="/cards">All cards ›</Link></h2>
    {state.cards.length === 0 && <p className="home-empty">No cards added. <Link prefetch={false} href="/settings">Add a card in Settings ›</Link></p>}
    {state.cards.map((card) => {
      const { owed, limitLeft, next, shortBy } = cardSummary(state, card.id);
      return <div key={card.id} className="home-row home-card-row">
        <Link prefetch={false} href={`/cards/${card.id}`}>{card.label}</Link>
        <div className="home-number">{format(owed)}<small>owed now</small></div>
        {limitLeft !== undefined && <small className="home-card-limit">{format(Math.max(0, limitLeft))} limit left</small>}
        <small className="home-card-next">{next ? `${next.open ? "So far" : "Statement"} ${format(next.amount)} · due ${dayLabel(next.dueOn)}` : "No statement due"}</small>
        {next && <small className="home-card-status">{shortBy > 0 ? <span className="home-short">Short {format(shortBy)}</span> : <span className="home-covered" title={STATEMENT_COVERED} aria-label={STATEMENT_COVERED}>Covered ✓</span>}</small>}
      </div>;
    })}
  </section>;
}

/** D45: who owes whom, one line per transfer, only for a household of two or more. Mark settled records them all; the sentence does not move. */
function SharedCosts({ state }: Props) {
  if (state.split.members.length < 2) return null;
  const { transfers } = splitBalance(state.split, state.today);
  return <section id="shared-costs" className="home-panel home-split">
    <h2>Shared costs</h2>
    {transfers.length === 0 && <p className="home-empty">Nobody owes anyone anything. Mark a bill or charge as shared to split it. <a href="#add-bill">Add a bill ›</a></p>}
    {transfers.map(transfer => <div key={transfer.fromId + transfer.toId} className="home-row"><div>{transferLine(transfer, state.homeCurrency)}</div></div>)}
    {transfers.length > 0 && <ApiForm action="/api/settle" className="home-settle">
      <input type="hidden" name="returnTo" value="/" />
      <button className="home-confirm">Mark settled</button>
    </ApiForm>}
  </section>;
}

/** "Nov 20", or "Jan 1, 2028" when the date is in another year than today. */
const dateIn = (iso: string, today: string) => dayLabel(iso) + (iso.slice(0, 4) === today.slice(0, 4) ? "" : `, ${iso.slice(0, 4)}`);

/** D48: the row a cancel-by date makes. It is information: nothing here cancels, moves or pays anything. */
function CancelRow({ notice, state }: { notice: CancelNotice; state: MoneyState }) {
  const format = formatter(state.homeCurrency);
  const what = notice.repeats ? "it renews at" : "it is charged";
  return <div className="home-row home-dated home-cancel">
    <time dateTime={notice.cancelBy}>{dayLabel(notice.cancelBy)}</time>
    <div>Cancel {notice.biller} by {dateIn(notice.cancelBy, state.today)} or {what} {format(notice.amount)} on {dateIn(notice.renewsOn, state.today)}
      <small>{categoryLabel(notice.category)} · reminder only</small></div>
    <div className="home-number" />
  </div>;
}

function ComingUp({ state, people, entryIds }: Props & { people: People; entryIds: EntryIds }) {
  const format = formatter(state.homeCurrency);
  const usual = timeline(state, "expected");
  const late = series(state, "worst");
  const incoming = new Map(arrivals(state).map((item) => [`${item.invoiceId}-expected`, item]));
  const repeats = new Map(state.bills.filter((bill) => bill.repeatUnit !== undefined).map((bill) => [bill.id, bill.repeatUnit === "year" ? "Yearly" : "Every month"])); // an event's id is its bill's id
  // A short day says "Short by …" once, on its last row that can carry it (not a client's payment, not a pending bill).
  const canCarry = (event: (typeof usual)[number]) => !incoming.has(event.id) && !event.pending && late[daysBetween(state.today, event.date)] < 0;
  const carries = usual.map((event, index) => canCarry(event) && !usual.slice(index + 1).some((later) => later.date === event.date && canCarry(later)));
  const rows = usual.map((event, index) => {
      const payment = incoming.get(event.id);
      const i = daysBetween(state.today, event.date);
      const short = late[i] < 0;
      return <div key={event.id} className="home-row home-dated">
        <time dateTime={event.date}>{dayLabel(event.date)}</time>
        <div>{payment ? <><Link prefetch={false} href={`/clients/${payment.clientId}`}>{event.label}</Link> pays</> : event.label}
          {payment ? <small>Usual date · if late, {dayLabel(payment.worstOn)}</small>
            : event.pending ? <small>Awaiting confirmation</small>
            : carries[index] && <small className="home-short">Short by {format(-late[i])} if clients pay late</small>}
          {repeats.has(event.id) && <small>{repeats.get(event.id)}</small>}
        </div>
        <div className="home-number">{payment ? `+${usd(payment.amountUsd)}` : format(Math.abs(event.amount))}
          {payment && state.homeCurrency !== "USD" && <small>≈{format(payment.amountHome)}</small>}
          {!payment && !event.pending && !short && <span className="home-covered-tick" title={DAY_COVERED} aria-label={DAY_COVERED}> ✓</span>}
        </div>
      </div>;
    });
  // The rows that say "Short by …" and the low point's own row are never folded away.
  // D48: a cancel-by date is a dated row of its own (information only), placed by date after that day's other rows.
  const notices = state.cancelNotices.filter((notice) => daysBetween(state.today, notice.cancelBy) < 30);
  const lowDay = low(late).dayIndex;
  const lowRow = usual.map((event, index) => carries[index] && daysBetween(state.today, event.date) === lowDay ? index : -1).reduce((a, b) => Math.max(a, b), -1);
  const shownUsual = Math.max(5, carries.indexOf(true) + 1, lowRow + 1);
  const dated = [
    ...usual.map((event, index) => ({ date: event.date, rank: 0, index, node: rows[index] })),
    ...notices.map((notice, index) => ({ date: notice.cancelBy, rank: 1, index, node: <CancelRow key={`cancel-${notice.billId}`} notice={notice} state={state} /> })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rank - b.rank || a.index - b.index));
  // Rows fold after the last usual row that must stay; a cancel-by row folds with the day it belongs to.
  const shown = shownUsual >= usual.length ? dated.length : dated.findIndex((row) => row.rank === 0 && row.index === shownUsual - 1) + 1;
  return <section id="coming-up" className="home-panel home-upcoming">
    <h2>Coming up <Link prefetch={false} href="/activity">All activity ›</Link></h2>
    {dated.length === 0 && <p className="home-empty">Nothing due yet. <a href="#add-bill">Add your rent ›</a></p>}
    {dated.slice(0, shown).map((row) => row.node)}
    {dated.length > shown && <details><summary>Later in the month · {dated.length - shown} more</summary>{dated.slice(shown).map((row) => row.node)}</details>}
    <AddEntry key={entryIds.bill + entryIds.charge} ids={entryIds} returnTo="/" today={state.today} currency={state.homeCurrency} people={people}
      cards={state.cards.map(card => ({ id: card.id, label: card.label }))} />
  </section>;
}

export function HomeView({ state, inbox, notice, people, entryIds, balanceId, demo }: Props & { inbox: ReaderInbox; notice?: string | null; demo: boolean; people: People; entryIds: EntryIds; balanceId: string }) {
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
    {demo && <p className="home-demo">A fictional household that lives in this browser for seven days after your last change. <Link prefetch={false} href="/start">Start with my numbers ›</Link></p>}
    {notice && <p role="status" className="home-freshness ui-hint">{notice}</p>}
    <Actions state={state} />
    <div className="home-panels">
      <div className="home-column"><Next30Days state={state} balanceId={balanceId} /><Cards state={state} /><SharedCosts state={state} /></div>
      <div className="home-column"><FirstSteps state={state} /><ToCheck state={state} inbox={inbox} /><ComingUp state={state} people={people} entryIds={entryIds} /></div>
    </div>
  </article>;
}

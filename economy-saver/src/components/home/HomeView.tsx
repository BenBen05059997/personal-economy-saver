import type { ReaderInbox } from "@/db/reader-inbox";
import { homeDateLabel } from "@/components/ui/dates";
import Link from "next/link";
import { ApiForm } from "@/components/ui/ApiForm";
import { categoryLabel } from "@/lib/money/categories";
import type { ConnectionView } from "@/lib/paypal/contracts";
import { ConnectLine } from "@/components/paypal/ConnectLine";
import type { CancelNotice, MoneyState } from "@/lib/money/types";
import { aboutMoney, dayLabel, formatter, minorPerUnit, repeatWords, usd } from "@/lib/money/format";
import { AMOUNT_NOT_KNOWN, confirmedGaps, gapAmountWords, gapDateWords, gapMeanwhileWords, gapQuestion, openGaps } from "@/lib/money/gaps";
import { addDays, arrivals, daysBetween, series, timeline, WINDOW_DAYS } from "@/lib/money/runway";
import { fundingOptions } from "@/lib/money/options";
import { potSummary } from "@/lib/money/plan";
import { toCheck } from "@/lib/money/to-check";
import { splitBalance, transferLine } from "@/lib/money/split";
import { datesIn, lastOneWords } from "@/lib/money/repeat";
import { HOUSEHOLD_PEOPLE, hrefFor } from "@/lib/links";
import { PanelHint } from "@/components/ui/PanelHint";
import { BankBalance } from "./BankBalance";
import { HomeViews } from "./HomeViews";
import { homeSentence } from "@/lib/money/sentence";
import { Suspense, type ReactNode } from "react";
import { Sentence } from "./Sentence";
import { cardSummary } from "./card-summary";
import { ConfirmButton } from "@/components/household/ConfirmButton";
import { Suggestions } from "./Suggestions";
import type { openSuggestions } from "@/db/suggestions";
import { GetStarted, type GetStartedProgress } from "./GetStarted";
import { Hints } from "./Hints";
import "./home.css";

type Props = { state: MoneyState };

// What the ✓ marks mean in the engine: a bill's tick is "the worst-case balance on its due day is at least zero";
// a card's is "the statement is paid from the bank, or once client payments land by its due date, with every other bill still paid".
const DAY_COVERED = "Covered: your balance stays above zero on this day, even if clients pay late.";
const STATEMENT_COVERED = "Covered: this statement can be paid on its due date from your bank or from client payments due by then.";

function Actions({ state, forwarding }: Props & { forwarding: boolean }) {
  const options = fundingOptions(state);
  const pick = options.rows.find((option) => option.pick);
  const unbilled = state.invoices.find((i) => i.status === "unbilled");
  const client = state.clients.find((c) => c.id === unbilled?.clientId);
  const invoiceFix = pick?.id === "invoice" && unbilled && client;
  return <div id="actions">
    <div className="home-actions">
      {invoiceFix ? <Link className="home-button home-primary" prefetch={false} href={`/invoices/${unbilled.id}`}>Invoice {client.name.split(" ")[0]} {usd(unbilled.amountUsd)}</Link>
        : pick && <Link className="home-button home-primary" prefetch={false} href={pick.href ?? "/options"}>{pick.title}</Link>}
      {forwarding && <Link className="home-button home-secondary" prefetch={false} href="/bills#forwarding">Forward a bill</Link>}
      <Link className="home-button home-secondary" prefetch={false} href="/upload">Upload a receipt</Link>
    </div>
    {options.gap > 0 && <Link className="home-options" prefetch={false} href="/options">{pick ? "Other options" : "Compare options"} ›</Link>}
  </div>;
}

function ToCheck({ state, inbox, forwarding }: Props & { inbox: ReaderInbox; forwarding: boolean }) {
  const rows = toCheck(state);
  const missing = confirmedGaps(state); // D55: confirmed bills with a gap count here and are filled in on To check
  const total = rows.length + inbox.readings.length + missing.length;
  return <section id="to-check" className="home-panel home-review">
    <h2>To check{total > 0 && ` · ${total}`}</h2>
    {total === 0 && !inbox.jobs.length && <PanelHint className="home-empty" href={forwarding ? "/bills#forwarding" : "/upload"} label={forwarding ? "Forward a bill or upload a receipt" : "Upload a receipt"}>Things the app read or drafted, waiting for your OK. Nothing here now.</PanelHint>}
    {inbox.jobs.map(job => <div key={job.id} className="home-row"><Link prefetch={false} href="/to-check?from=home">{job.status === "failed" ? "Document needs attention" : "Reading document…"}</Link></div>)}
    {inbox.readings.map(r => <div key={r.id} className="home-row"><span>{r.value.name || "Document"}</span><Link prefetch={false} href={`/to-check?from=home#reading-${r.id}`}>Review</Link></div>)}
    {missing.map((gap) => <div key={gap.id} className="home-row home-check-row">
      <div>{gapQuestion(gap)}<small>{gapMeanwhileWords(gap)}</small></div>
      <div className="home-number"><Link prefetch={false} className="home-enter" href="/to-check">Enter it ›</Link></div>
    </div>)}
    {rows.map((row) => <div key={row.id} className="home-row home-check-row">
      <div>{row.title}<small>{row.detail}</small></div>
      <div className="home-number">{row.amount !== null ? formatter(state.homeCurrency)(row.amount) : row.kind === "bill" && row.gap?.amount}</div>
      <ConfirmButton kind={row.kind} id={row.id} title={row.title} />
    </div>)}
  </section>;
}

/** The hints panel for a real or blank household: what can be done on Home, each card ticked once its thing exists. Try it has the Get started tour instead. */
function HintsPanel({ state, inbox, tryIt, householdId }: Props & { inbox: ReaderInbox; tryIt: boolean; householdId: string }) {
  if (tryIt) return null;
  const done = {
    bank: state.bank !== 0,
    bill: state.bills.length > 0,
    client: state.clients.length > 0,
    charge: state.charges.length > 0,
    upload: inbox.readings.length + inbox.jobs.length > 0,
  };
  return <Hints householdId={householdId} done={done} hasCard={state.cards.length > 0} />;
}

function Cards({ state }: Props) {
  const format = formatter(state.homeCurrency);
  return <section id="cards" className="home-panel home-cards">
    <h2>Cards <Link prefetch={false} href="/cards">All cards ›</Link></h2>
    {state.cards.length === 0 && <PanelHint className="home-empty" add="card" label="Add a card">No card yet.</PanelHint>}
    {state.cards.length > 0 && state.charges.length === 0 && <PanelHint className="home-empty" add="charge" label="Add a card charge">No card charges yet.</PanelHint>}
    {state.cards.length > 0 && <p className="home-note"><Link prefetch={false} href="/cards">Change closing day ›</Link></p>}
    {state.cards.map((card) => {
      const { owed, limitLeft, next, shortBy } = cardSummary(state, card.id);
      return <div key={card.id} className="home-row home-card-row">
        <Link prefetch={false} className="home-link-target" href={hrefFor({ type: "card", id: card.id })}>{card.label}</Link>
        <div className="home-number">{format(owed)}<small>owed now</small></div>
        {limitLeft !== undefined && <small className="home-card-limit">{format(Math.max(0, limitLeft))} limit left</small>}
        <small className="home-card-next">{next ? `${next.open ? "So far" : "Statement"} ${format(next.amount)} · due ${dayLabel(next.dueOn)}` : "No statement due"}</small>
        {next && <small className="home-card-status">{shortBy > 0 ? <span className="home-short">Short {format(shortBy)}</span> : <span className="home-covered" title={STATEMENT_COVERED} aria-label={STATEMENT_COVERED}>Covered ✓</span>}</small>}
      </div>;
    })}
  </section>;
}

/** D45: who owes whom, one line per transfer, only for a household of two or more. Mark settled records them all; the sentence does not move. */
/** The next shared bill that falls due after today, by date, for the hint that says when the split starts. */
function nextSharedBill(state: MoneyState) {
  const horizon = addDays(state.today, 62);
  const tomorrow = addDays(state.today, 1);
  const dates = state.split.bills.map(bill => ({
    biller: bill.biller,
    date: datesIn(bill, tomorrow, horizon)[0],
  })).filter((item): item is { biller: string; date: string } => item.date !== undefined);
  return dates.sort((a, b) => (a.date < b.date ? -1 : 1))[0];
}

function SharedCosts({ state }: Props) {
  if (state.split.members.length < 2) return null;
  const { transfers } = splitBalance(state.split, state.today);
  const next = nextSharedBill(state);
  const shares = state.split.members.map(member => Math.round(member.shareBp / 100)).join("/");
  return <section id="shared-costs" className="home-panel home-split">
    <h2>Shared costs</h2>
    {transfers.length === 0 && (next
      ? <PanelHint className="home-empty">{state.split.settledThrough !== null && "Nobody owes anyone anything. "}{next.biller} on {dayLabel(next.date)} splits {shares} once it is paid.</PanelHint>
      : state.split.bills.length > 0 || state.split.charges.length > 0
        ? <PanelHint className="home-empty">All settled. New shared items split from here.</PanelHint>
        : <PanelHint className="home-empty" add="bill" label="Add a bill">Choose Shared on a bill or charge to split it by shares.</PanelHint>)}
    <p className="home-note"><Link prefetch={false} href={HOUSEHOLD_PEOPLE}>Share costs ›</Link></p>
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
    <div>Cancel {notice.biller} by {dateIn(notice.cancelBy, state.today)} or {what}{notice.amount === null ? "" : ` ${format(notice.amount)}`} on {dateIn(notice.renewsOn, state.today)}{notice.amount === null ? ` (${AMOUNT_NOT_KNOWN})` : ""}
      <small>{categoryLabel(notice.category)} · reminder only</small></div>
    <div className="home-number" />
  </div>;
}

function ComingUp({ state, added, addedId }: Props & { added: string | null; addedId: string | null }) {
  const format = formatter(state.homeCurrency);
  const usual = timeline(state, "expected");
  const late = series(state, "worst");
  const incoming = new Map(arrivals(state).map((item) => [`${item.invoiceId}-expected`, item]));
  const repeats = new Map(state.bills.filter((bill) => bill.repeatUnit !== undefined).map((bill) => [bill.id, [bill.repeatUnit === "year" ? "Yearly" : repeatWords("month"), lastOneWords({ ...bill, due: bill.startsOn ?? bill.due }, state.today)].filter(Boolean).join(" · ")])); // an event's id is its bill's id
  // A short day says "Short by …" once, on its last row that can carry it (not a client's payment, not a pending bill).
  const canCarry = (event: (typeof usual)[number]) => !incoming.has(event.id) && !event.pending && late[daysBetween(state.today, event.date)] < 0;
  const carries = usual.map((event, index) => canCarry(event) && !usual.slice(index + 1).some((later) => later.date === event.date && canCarry(later)));
  // A bill's first row in Coming up carries id="bill-<bill id>", so a link to /#bill-<id> lands on it (and :target highlights it).
  const firstOfBill = new Set<number>();
  const seenBills = new Set<string>();
  usual.forEach((event, index) => {
    const billId = event.id.split("@")[0];
    if (event.kind === "bill" && !seenBills.has(billId)) { seenBills.add(billId); firstOfBill.add(index); }
  });
  // D55: the gap of each stored bill, so an estimated or uncounted row says where its number came from; a series' later months say only "about".
  const gaps = new Map(openGaps(state).filter(gap => gap.source === "bill").map(gap => [gap.id, gap]));
  const rows = usual.map((event, index) => {
      const payment = incoming.get(event.id);
      const gap = event.kind === "bill" ? gaps.get(event.id.split("@")[0]) : undefined;
      const gapRow = gap !== undefined && event.date === gap.countedOn ? gap : null; // the row the gap's own words belong to
      const i = daysBetween(state.today, event.date);
      const short = late[i] < 0;
      return <div key={event.id} id={firstOfBill.has(index) ? `bill-${event.id.split("@")[0]}` : undefined} className="home-row home-dated">
        <time dateTime={event.date}>{dayLabel(event.date)}</time>
        <div>{payment ? <><Link prefetch={false} href={hrefFor({ type: "client", id: payment.clientId })}>{event.label}</Link> pays</>
          : event.kind === "statement" && event.cardId ? <Link prefetch={false} className="home-link-target" href={hrefFor({ type: "statement", id: event.cardId })}>{event.label}</Link>
          : event.kind === "bill" ? <Link prefetch={false} className="home-link-target" href={event.pending ? "/to-check" : hrefFor({ type: "bill", id: event.id.split("@")[0] })}>{event.label}</Link> : event.label}
          {payment ? <small>Usual date · if late, {dayLabel(payment.worstOn)}</small>
            : event.pending ? <small>Awaiting confirmation</small>
            : carries[index] && <small className="home-short">Short by {format(-late[i])} if clients pay late</small>}
          {repeats.has(event.id) && <small>{repeats.get(event.id)}</small>}
          {gapRow?.missing.includes("amount") && <small>{gapAmountWords(gapRow)}</small>}
          {gapRow?.missing.includes("date") && <small>{gapDateWords(gapRow)}</small>}
        </div>
        <div className="home-number">{payment ? `+${usd(payment.amountUsd)}` : gapRow?.missing.includes("amount") ? <Link prefetch={false} className="home-enter" href="/to-check">Enter it ›</Link> : event.uncounted ? AMOUNT_NOT_KNOWN : event.estimated ? aboutMoney(Math.round(Math.abs(event.amount)) * minorPerUnit(state.homeCurrency), state.homeCurrency) : format(Math.abs(event.amount))}
          {payment && state.homeCurrency !== "USD" && <small>≈{format(payment.amountHome)}</small>}
          {gapRow && !gapRow.missing.includes("amount") && <small><Link prefetch={false} className="home-enter" href="/to-check">Enter it ›</Link></small>}
          {!payment && !event.pending && !short && !event.uncounted && <span className="home-covered-tick" title={DAY_COVERED} aria-label={DAY_COVERED}> ✓</span>}
        </div>
      </div>;
    });
  // D48: a cancel-by date is a dated row of its own (information only), placed by date after that day's other rows.
  const notices = state.cancelNotices.filter((notice) => daysBetween(state.today, notice.cancelBy) < WINDOW_DAYS);
  const dated = [
    ...usual.map((event, index) => ({ date: event.date, rank: 0, index, node: rows[index] })),
    ...notices.map((notice, index) => ({ date: notice.cancelBy, rank: 1, index, node: <CancelRow key={`cancel-${notice.billId}`} notice={notice} state={state} /> })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rank - b.rank || a.index - b.index));
  // Every row up to and including the day the sentence names stays on screen, and so does the first "Short by …" row;
  // the fold starts after them. The day is the sentence's own (`day`), not a low worked out again here.
  const focus = homeSentence(state).day ?? undefined;
  const firstShort = carries.indexOf(true);
  const keep = Math.max(4, firstShort); // the index of the last usual row that stays: five at least
  const keepRow = keep >= usual.length - 1 ? dated.length : dated.findIndex((row) => row.rank === 0 && row.index === keep) + 1;
  const focusRow = focus === undefined ? 0 : dated.reduce((last, row, index) => (row.date <= focus ? index + 1 : last), 0);
  // A bill the add form just saved (?added=) keeps its first row above the fold too, so the "Added …" line has its row under it.
  const addedRow = addedId === null ? 0 : dated.findIndex((row) => row.rank === 0 && usual[row.index].id.split("@")[0] === addedId) + 1;
  const shown = Math.max(keepRow, focusRow, addedRow);
  return <section id="coming-up" className="home-panel home-upcoming">
    <h2>Coming up</h2>
    {added && <p role="status" className="home-added">{added}</p>}
    {dated.length === 0 && <PanelHint className="home-empty" add="bill" label="Add a bill">Nothing due in the next 30 days.</PanelHint>}
    {dated.slice(0, shown).map((row) => row.node)}
    {dated.length > shown && <details><summary>Later in the month · {dated.length - shown} more</summary>{dated.slice(shown).map((row) => row.node)}</details>}
  </section>;
}

/**
 * The one line Coming up shows after the add form saved something (D51): the routes return to "/?added=<id>", and the id is
 * looked up in the household's own state, so no name or amount travels in the address. Any other navigation drops it.
 */
function addedLine(state: MoneyState, id: string | null): string | null {
  if (!id) return null;
  const format = formatter(state.homeCurrency);
  const occurrences = state.bills.filter((bill) => bill.id === id || bill.id.startsWith(`${id}@`)).sort((a, b) => (a.due < b.due ? -1 : 1));
  if (occurrences.length) {
    const next = occurrences.find((bill) => bill.due >= state.today) ?? occurrences[0];
    const gap = openGaps(state).find((item) => item.id === id);
    const amount = gap?.missing.includes("amount") ? `, ${gapAmountWords(gap)}` : ` ${format(next.amount)}`;
    return `Added ${next.biller}${amount}, ${gap?.missing.includes("date") ? gapDateWords(gap) : `due ${dateIn(next.due, state.today)}`}`;
  }
  const charge = state.charges.find((item) => item.id === id);
  const card = charge && state.cards.find((item) => item.id === charge.cardId);
  return charge && card ? `Added ${charge.merchant} ${format(charge.amount)} on ${card.label}` : null;
}

export function HomeView({ state, inbox, notice, balanceId, demo, tryIt, forwarding, added, suggestions, pins, householdId, getStarted, connection, isOwner, asOf }: Props & { inbox: ReaderInbox; notice?: string | null; demo: boolean; tryIt: boolean; forwarding: boolean; added: string | null; balanceId: string; suggestions: Awaited<ReturnType<typeof openSuggestions>>; pins: ReactNode; householdId: string; getStarted: GetStartedProgress | null; connection: ConnectionView; isOwner: boolean; asOf: string | null }) {
  const date = homeDateLabel(state.today);
  return <article className="money-home">
    <time className="home-date" dateTime={state.today}>{date}</time>
    <h1><Sentence state={state} linked /></h1>
    {homeSentence(state).note && <p className="home-sentence-note">{homeSentence(state).note}</p>}
    {demo && tryIt && <p className="home-demo">A fictional household that lives in this browser for seven days after your last change. <Link prefetch={false} href="/start">Start with my numbers ›</Link></p>}
    <ConnectLine connection={connection} isOwner={isOwner} />
    {(notice || asOf) && <p role="status" className="home-freshness ui-hint">{notice ?? `PayPal balance as of ${asOf}.`}</p>}
    <Actions state={state} forwarding={forwarding} />
    <Suspense fallback={null}>{pins}</Suspense>
    {tryIt && getStarted ? <GetStarted key={householdId} householdId={householdId} progress={getStarted} peopleCount={state.split.members.length} invoiceHref={(inv => inv ? `/invoices/${inv.id}` : "/clients")(state.invoices.find(i => i.status === "unbilled") ?? state.invoices.find(i => i.status === "sent"))} /> : <HintsPanel state={state} inbox={inbox} tryIt={tryIt} householdId={householdId} />}
    <HomeViews state={state} bankBalance={<><BankBalance key={balanceId} currency={state.homeCurrency} balance={formatter(state.homeCurrency)(state.bank)} balanceId={balanceId} />{state.pots.length > 0 && <ul className="home-pots">{state.pots.map(pot => <li key={pot.id}><Link prefetch={false} href="/plan">{potSummary(pot, state)}</Link></li>)}</ul>}</>} />
    <div className="home-panels">
      <div className="home-column"><ToCheck state={state} inbox={inbox} forwarding={forwarding} /><Suggestions rows={suggestions} /><Cards state={state} /><SharedCosts state={state} /></div>
      <div className="home-column"><ComingUp state={state} added={addedLine(state, added)} addedId={added} /></div>
    </div>
  </article>;
}

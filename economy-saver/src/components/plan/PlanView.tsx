import Link from "next/link";
import type { MoneyState, Pot } from "@/lib/money/types";
import { majorMoney } from "@/lib/money/format";
import { goalPace } from "@/lib/money/goals";
import { monthByCategory } from "@/lib/money/month";
import { HISTORY_MONTHS, monthBounds, monthName, monthsBack, SEARCH_QUERY_MAX, searchSpending, spendingItems, type SpendingInput } from "@/lib/money/spending";
import { monthYear, moneyInPotsLine, potLine, roomLine, roomNote } from "@/lib/money/plan";
import { ApiForm } from "@/components/ui/ApiForm";
import { AmountInput, PercentInput } from "@/components/ui/CheckedInput";
import "@/components/household/add-entry.css";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { MonthSplit } from "./MonthSplit";
import { RegularCosts } from "./RegularCosts";
import { SpendingResults, SpendingSearchForm } from "./SpendingSearch";
import "./plan.css";

const plain = (n: number, currency: string) => currency === "USD" ? n.toFixed(2) : String(n);

function Fields({ state, pot }: { state: MoneyState; pot?: Pot }) {
  return <>
    {!pot && <label className="ui-field">Name<input name="name" maxLength={60} required placeholder="e.g. Car, trip, tax" /></label>}
    <label className="ui-field">Saved so far ({state.homeCurrency})<AmountInput name="saved" currency={state.homeCurrency} defaultValue={pot ? plain(pot.saved, state.homeCurrency) : "0"} required /></label>
    <label className="ui-field">Target amount, optional ({state.homeCurrency})<AmountInput name="target" currency={state.homeCurrency} defaultValue={pot?.target === undefined ? "" : plain(pot.target, state.homeCurrency)} /></label>
    <label className="ui-field">Target date, optional<input name="targetDate" type="date" defaultValue={pot?.targetDate ?? ""} /></label>
    <label className="ui-field">Set aside % of each client payment, optional<PercentInput name="fillPct" maxLength={6} defaultValue={pot?.fillPct === undefined ? "" : String(pot.fillPct)} placeholder="e.g. 25" /></label>
  </>;
}

function PotRow({ state, pot }: { state: MoneyState; pot: Pot }) {
  const money = (n: number) => majorMoney(n, state.homeCurrency);
  const line = potLine(pot, state);
  const goal = goalPace(pot, state);
  return <section className="plan-pot" aria-label={pot.name}>
    <div className="ui-row">
      <div>
        <b>{pot.name}</b>
        <p className="ui-hint">
          {pot.target === undefined ? "Set aside" : `Target ${money(pot.target)}${pot.targetDate ? ` · by ${monthYear(pot.targetDate)}` : ""}`}
          {pot.fillPct !== undefined && ` · ${pot.fillPct}% of each client payment`}
        </p>
        {line && <p className="plan-line">{line}</p>}
        {goal && goal.neededMinor > 0 && <p className="ui-hint">{goal.paceLine}</p>}
      </div>
      <div className="num">{money(pot.saved)}<small>saved</small></div>
    </div>
    <div className="plan-actions">
      <details className="plan-edit" id={"pot-" + pot.id}>
        <summary>Edit</summary>
        <ApiForm action="/api/pots">
          <input type="hidden" name="id" value={pot.id} />
          <input type="hidden" name="name" value={pot.name} />
          <input type="hidden" name="returnTo" value="/plan" />
          <Fields state={state} pot={pot} />
          <button className="ui-button primary">Save changes</button>
        </ApiForm>
      </details>
      <details className="plan-edit">
        <summary>Remove</summary>
        <ApiForm action="/api/pots/remove">
          <input type="hidden" name="id" value={pot.id} />
          <input type="hidden" name="returnTo" value="/plan" />
          <p>Remove {pot.name}? {money(pot.saved)} becomes cash you can spend again.</p>
          <button className="ui-button">Yes, remove {pot.name}</button>
        </ApiForm>
      </details>
    </div>
  </section>;
}

/** What the address asks Plan for (D53): `?month=YYYY-MM` within the last twelve months and `?q=` a search, both as typed. */
export type PlanAsk = { today: string; current: string; oldest: string; month: string | string[] | null; query: string | string[] | null };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month to show, or the words that refuse the address's month (then the current month is shown). */
function chosenMonth(ask: PlanAsk): { month: string; refusal: string | null } {
  if (ask.month === null || ask.month === ask.current) return { month: ask.current, refusal: null };
  const label = (m: string) => `${monthName(m)} ${m.slice(0, 4)}`;
  if (typeof ask.month !== "string" || !MONTH.test(ask.month) || ask.month < ask.oldest || ask.month > ask.current) {
    return { month: ask.current, refusal: `Plan shows the last ${HISTORY_MONTHS} months, ${label(ask.oldest)} to ${label(ask.current)}. Here is ${monthName(ask.current)}.` };
  }
  return { month: ask.month, refusal: null };
}

/** The search as typed (trimmed), the empty string for none, or the words that refuse it. */
function chosenQuery(ask: PlanAsk): { query: string; refusal: string | null } {
  if (ask.query === null) return { query: "", refusal: null };
  if (typeof ask.query !== "string") return { query: "", refusal: "Search for one thing at a time." };
  const query = ask.query.trim();
  if (query.length > SEARCH_QUERY_MAX) return { query: "", refusal: `A search is at most ${SEARCH_QUERY_MAX} characters.` };
  return { query, refusal: null };
}

function planHref(month: string, current: string, query: string): string {
  const params = new URLSearchParams();
  if (month !== current) params.set("month", month);
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `/plan?${search}` : "/plan";
}

export function PlanView({ state, spending, ask, own, newPotId }: { state: MoneyState; spending: SpendingInput; ask: PlanAsk; own: OwnChoices; newPotId: string }) {
  const inPots = moneyInPotsLine(state);
  const people = state.split.members.map(({ id, name }) => ({ id, name }));
  const { month, refusal: monthRefusal } = chosenMonth(ask);
  const { query, refusal: queryRefusal } = chosenQuery(ask);
  const label = (m: string) => m.slice(0, 4) === ask.current.slice(0, 4) ? monthName(m) : `${monthName(m)} ${m.slice(0, 4)}`;
  const previous = month > ask.oldest ? monthsBack(month, 2) : null;
  const next = month < ask.current ? monthsBack(month, 0) : null; // monthsBack(m, 0) is the month after m
  const nav = <nav className="plan-month-nav" aria-label="Months">
    {previous && <Link href={planHref(previous, ask.current, query)} aria-label={`Previous month, ${label(previous)}`}>‹ {label(previous)}</Link>}
    {next && <Link className="plan-month-next" href={planHref(next, ask.current, query)} aria-label={`Next month, ${label(next)}`}>{label(next)} ›</Link>}
  </nav>;
  const result = query ? searchSpending(spendingItems(spending, `${ask.oldest}-01`, monthBounds(ask.current).last), query, spending.homeCurrency, { from: `${ask.oldest}-01`, to: ask.today, uncountedTo: monthBounds(ask.current).last }) : null;
  return <article className="plan">
    <h1 className="ui-title">Plan</h1>
    <p className="plan-room">{roomLine(state)}</p>
    {roomNote(state) && <p className="ui-hint">{roomNote(state)}</p>}
    {inPots && <p className="ui-hint">{inPots}</p>}
    <SpendingSearchForm query={query} month={month === ask.current ? null : month} />
    {queryRefusal && <p className="plan-line" role="alert">{queryRefusal}</p>}
    {result && <SpendingResults result={result} typed={query} people={people} />}
    {monthRefusal && <p className="plan-line" role="alert">{monthRefusal}</p>}
    <MonthSplit view={monthByCategory(spending, ask.today, month)} filing={{ entries: spendingItems(spending, monthBounds(month).first, monthBounds(month).last), own }} people={people} past={month === ask.current ? undefined : label(month)} nav={nav} />
    <RegularCosts spending={spending} today={ask.today} />
    {state.pots.length === 0 && <p className="ui-hint">No pots yet. A pot is money set aside with a reason; it stops counting as safe to spend.</p>}
    {state.pots.map(pot => <PotRow key={pot.id} state={state} pot={pot} />)}
    <details key={newPotId} className="add-entry" open={state.pots.length === 0}>
      <summary>Add a pot</summary>
      <ApiForm action="/api/pots">
        <input type="hidden" name="id" value={newPotId} />
        <input type="hidden" name="returnTo" value="/plan" />
        <Fields state={state} />
        <button className="ui-button primary">Add pot</button>
      </ApiForm>
    </details>
  </article>;
}

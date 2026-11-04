import type { MoneyState, Pot } from "@/lib/money/types";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { shareLabel } from "@/lib/money/categories";
import { businessLine, monthByCategory, splitLine, type MonthView } from "@/lib/money/month";
import { monthYear, moneyInPotsLine, potLine, roomLine } from "@/lib/money/plan";
import { ApiForm } from "@/components/ui/ApiForm";
import { AmountInput, PercentInput } from "@/components/ui/CheckedInput";
import "@/components/household/add-entry.css";
import "./plan.css";

const plain = (n: number, currency: string) => currency === "USD" ? n.toFixed(2) : String(n);

function Fields({ state, pot }: { state: MoneyState; pot?: Pot }) {
  return <>
    {!pot && <label className="ui-field">Name<input name="name" maxLength={60} required placeholder="Car, trip, tax" /></label>}
    <label className="ui-field">Saved so far ({state.homeCurrency})<AmountInput name="saved" currency={state.homeCurrency} defaultValue={pot ? plain(pot.saved, state.homeCurrency) : "0"} required /></label>
    <label className="ui-field">Target amount, optional ({state.homeCurrency})<AmountInput name="target" currency={state.homeCurrency} defaultValue={pot?.target === undefined ? "" : plain(pot.target, state.homeCurrency)} /></label>
    <label className="ui-field">Target date, optional<input name="targetDate" type="date" defaultValue={pot?.targetDate ?? ""} /></label>
    <label className="ui-field">Set aside % of each client payment, optional<PercentInput name="fillPct" maxLength={6} defaultValue={pot?.fillPct === undefined ? "" : String(pot.fillPct)} placeholder="25" /></label>
  </>;
}

function PotRow({ state, pot }: { state: MoneyState; pot: Pot }) {
  const money = (n: number) => minorMoney(Math.round(n * (state.homeCurrency === "USD" ? 100 : 1)), state.homeCurrency);
  const line = potLine(pot, state);
  return <section className="plan-pot" id={`pot-${pot.id}`} aria-label={pot.name}>
    <div className="ui-row">
      <div>
        <b>{pot.name}</b>
        <p className="ui-hint">
          {pot.target === undefined ? "Set aside" : `Target ${money(pot.target)}${pot.targetDate ? ` · by ${monthYear(pot.targetDate)}` : ""}`}
          {pot.fillPct !== undefined && ` · ${pot.fillPct}% of each client payment`}
        </p>
        {line && <p className="plan-line">{line}</p>}
      </div>
      <div className="num">{money(pot.saved)}<small>saved</small></div>
    </div>
    <div className="plan-actions">
      <details className="plan-edit">
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

/** D46: the current month's confirmed bills and card charges by category, split into business and personal. Information only; it moves no money. */
function MonthGoes({ view }: { view: MonthView }) {
  const money = (minor: number) => minorMoney(minor, view.currency);
  return <section className="plan-month" aria-labelledby="plan-month-title">
    <h2 id="plan-month-title">Where the month goes <small>{view.name}</small></h2>
    {view.categories.length === 0 ? <p className="ui-hint">Nothing confirmed yet this month.</p> : <>
      <p className="plan-line">{businessLine(view)}</p>
      {view.categories.map(category => {
        const split = splitLine(view, category);
        return <details key={category.category} className="plan-cat">
          <summary>
            <span className="plan-cat-name">{category.label}</span>
            <span className="num">{money(category.totalMinor)}{split && <small>{split}</small>}</span>
          </summary>
          <ul>
            {category.items.map((item, index) => <li key={`${item.label}-${item.date}-${index}`}>
              <span>{item.label}<small>{dayLabel(item.date)}</small></span>
              <span className="num">{money(item.amountMinor)}{item.businessBp > 0 && <small>{shareLabel(item.businessBp)}</small>}</span>
            </li>)}
          </ul>
        </details>;
      })}
    </>}
  </section>;
}

export function PlanView({ state, newPotId }: { state: MoneyState; newPotId: string }) {
  const inPots = moneyInPotsLine(state);
  return <article className="plan">
    <h1 className="ui-title">Plan</h1>
    <p className="plan-room">{roomLine(state)}</p>
    {inPots && <p className="ui-hint">{inPots}</p>}
    <MonthGoes view={monthByCategory(state, state.today)} />
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

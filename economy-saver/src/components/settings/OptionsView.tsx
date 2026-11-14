import Link from "next/link";
import type { MoneyState } from "@/lib/money/types";
import { BORROWING_CHECKED, BORROWING_SOURCES, fundingOptions } from "@/lib/money/options";
import { dayLabel, formatter, usd } from "@/lib/money/format";
import "./options.css";

export function OptionsView({ state }: { state: MoneyState }) {
  const options = fundingOptions(state);
  const money = state.homeCurrency === "USD" ? usd : formatter(state.homeCurrency);
  const pick = options.rows.find(row => row.pick);
  return <div className="options-page"><header><p className="ui-hint">NEXT 30 DAYS</p><h1 className="ui-title">Your options</h1>
    {options.gap ? <p className="options-lead">Cover <span className="num">{money(options.gap)}</span> by {dayLabel(options.date)}.</p> : <p className="options-lead">Your next 30 days are covered in the forecast if clients pay late.</p>}
    <p className="ui-hint">{pick ? "The cheapest fix comes first. Payment dates are estimates." : options.gap ? "No option has confirmed funding and timing. Check the amount and deadline before relying on it." : "There is no shortfall to finance."}</p>
  </header>
  {options.gap > 0 && <><section className="ui-panel options-context"><h2>Compare total extra cost</h2>
    <p>Lowest extra cost first. Credit examples borrow at the gap date and repay in full {options.days} days later, on {dayLabel(options.repayOn)}.</p>
    <p className="ui-hint">Costs include the stated interest and fees; principal is shown separately. Usual PayPal and currency-conversion fees are not modelled. Client payments are estimates. Borrowing is never added to your available money.</p>
  </section>
  <ol className="options-list">{options.rows.map(row => <li className={"ui-panel option-row" + (row.pick ? " option-pick" : "")} key={row.id}>
    <div className="option-heading"><div>{row.pick && <p className="option-label">LOWEST COST PROJECTED FIX</p>}<h2>{row.title}</h2></div><strong className="option-cost num">{row.cost ? "≈" : ""}{money(row.cost)}<small>extra cost</small></strong></div>
    <p>{row.detail}</p><p className="ui-hint">{row.status}</p>
    {row.principal > 0 && <><p className="ui-hint">Principal {money(row.principal)} · total repayment ≈{money(row.principal + row.cost)}.</p>
      <p className="ui-hint">{row.repaymentCovered ? `The forecast if clients pay late can cover full repayment on ${dayLabel(options.repayOn)}${row.repayFrom ? ` using projected payments from ${row.repayFrom}` : " from available money"}, after scheduled bills. Payment timing is still an estimate.` : `The forecast if clients pay late does not cover this comparison through full repayment on ${dayLabel(options.repayOn)}. No funded repayment plan yet.`}</p></>}
    {row.source && <details><summary>Reference & assumptions</summary><p className="ui-hint">Checked {BORROWING_CHECKED}. This is a type of credit and a cost example; your own eligibility and contract have not been checked.</p>
      <a href={BORROWING_SOURCES[row.source]} target="_blank" rel="noreferrer">{row.source === "bank" ? "Bank rate and eligibility reference" : row.source === "welfare" ? "Government welfare loan reference, page 11" : "Card rate and full-repayment reference"}</a>
      {row.source === "advance" && <> · <a href={BORROWING_SOURCES.atm} target="_blank" rel="noreferrer">ATM fees</a></>}
    </details>}
    {row.href && <Link className={"ui-button" + (row.pick ? " primary" : "")} prefetch={false} href={row.href}>{row.action}</Link>}
  </li>)}</ol>
  {state.homeCurrency !== "JPY" && <p className="ui-hint">US borrowing terms above are unverified comparison assumptions (V4). Check your issuer’s actual terms before relying on the estimate.</p>}
  </>}
  <Link className="ui-button" prefetch={false} href="/">Back to Home</Link></div>;
}

import { aboutMoney, minorMoney } from "@/lib/money/format";
import { changeTone, changeWords, NO_REGULAR_COSTS, REGULAR_MONTHS, regularCosts } from "@/lib/money/regular";
import { monthBounds, monthName, monthsBack, spendingItems, type SpendingInput } from "@/lib/money/spending";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { ViewPanel } from "@/components/views/ViewPanel";
import { fixedCostsFor } from "@/lib/views/v/fixed-costs";
import type { ViewResult } from "@/lib/views/types";
import "./spending.css";


/**
 * Spending's Regular costs panel (D54): the what-changed line, then each regular cost with this month (marked "so far" while card
 * charges can still come in), last month and the change in words, and a row of the window's months. Server-rendered from the
 * page's one spending read; no links or buttons. Above the list, the same costs month by month as columns (D77: regular costs against everything else).
 */
export function RegularCosts({ spending, today, device }: { spending: SpendingInput; today: string; device?: { householdId: string } }) {
  const current = today.slice(0, 7);
  const from = monthBounds(monthsBack(current, REGULAR_MONTHS)).first, to = monthBounds(current).last;
  const result = regularCosts(spendingItems(spending, from, to), spending.homeCurrency, today, REGULAR_MONTHS);
  const money = (minor: number, estimated?: true) => estimated ? aboutMoney(minor, result.currency) : minorMoney(minor, result.currency);
  const columns = fixedCostsFor({}, spending, today) as ViewResult<"stacked_columns">;
  return <>
    {!columns.empty && <div style={{ marginTop: "var(--space-5)" }}><ViewPanel id="fixed" questions={[{ key: "months", label: "Month by month", result: columns, figure: <StackedColumns result={columns} /> }]} device={device} /></div>}
  <section className="spending-regular" aria-labelledby="regular-costs">
    <h2 id="regular-costs">Regular costs</h2>
    {result.items.length === 0 ? <p className="ui-hint">{NO_REGULAR_COSTS}</p> : <>
      <p className="spending-line">{result.changedLine}</p>
      <ul>
        {result.items.map(cost => {
          const words = changeWords(cost, result.currency);
          const tone = cost.status === "same" || cost.status === "not_yet" ? "same" : changeTone(cost.status); // the muted tint is only for a cost that did not move
          const months = cost.months.map(m => `${monthName(m.month).slice(0, 3)} ${m.month === current && cost.status === "not_yet" ? "not in yet" : money(m.amountMinor, m.estimated)}`);
          return <li key={cost.key} className="spending-regular-row">
            <span className="spending-regular-name">{cost.label}<small>{cost.where}</small></span>
            <span className="num">{cost.status === "not_yet" ? "not in yet" : money(cost.thisMinor, cost.months[cost.months.length - 1].estimated)}{cost.soFar && cost.status !== "not_yet" && <small>so far</small>}</span>
            <span className="spending-regular-change">
              {cost.status !== "started" && <>Last month {money(cost.lastMinor, cost.months[cost.months.length - 2].estimated)} · </>}
              <span className={`spending-regular-${tone}`}>{words}</span>
            </span>
            <span className="spending-regular-months">{months.join(" · ")}</span>
          </li>;
        })}
      </ul>
    </>}
  </section>
  </>;
}

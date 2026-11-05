import { aboutMoney, minorMoney, ordinal } from "@/lib/money/format";
import { REGULAR_MONTHS, regularCosts, type RegularCost, type RegularCosts as Regulars } from "@/lib/money/regular";
import { monthBounds, monthName, monthsBack, spendingItems, type SpendingInput } from "@/lib/money/spending";
import "./plan.css";


/** The change against last month in words, and the tone it is drawn in. The words carry it; the colour only repeats them. */
function change(cost: RegularCost, currency: Regulars["currency"]): { words: string; tone: "up" | "down" | "same" | "plain" } {
  const money = (minor: number) => cost.estimated ? aboutMoney(minor, currency) : minorMoney(minor, currency);
  switch (cost.status) {
    case "up": return { words: `up ${money(cost.changeMinor!)}`, tone: "up" };
    case "down": return { words: `down ${money(-cost.changeMinor!)}`, tone: "down" };
    case "same": return { words: "same", tone: "same" };
    case "started": return { words: "started this month", tone: "plain" };
    case "stopped": return { words: "stopped", tone: "plain" };
    case "not_yet": return { words: `usually on the ${ordinal(cost.usualDay!)}`, tone: "same" };
  }
}

/**
 * Plan's Regular costs panel (D54): the what-changed line, then each regular cost with this month (marked "so far" while card
 * charges can still come in), last month and the change in words, and a row of the window's months. Server-rendered from the
 * page's one spending read; no links or buttons.
 */
export function RegularCosts({ spending, today }: { spending: SpendingInput; today: string }) {
  const current = today.slice(0, 7);
  const from = monthBounds(monthsBack(current, REGULAR_MONTHS)).first, to = monthBounds(current).last;
  const result = regularCosts(spendingItems(spending, from, to), spending.homeCurrency, today, REGULAR_MONTHS);
  const money = (minor: number, estimated?: true) => estimated ? aboutMoney(minor, result.currency) : minorMoney(minor, result.currency);
  return <section className="plan-regular" aria-labelledby="plan-regular-title">
    <h2 id="plan-regular-title">Regular costs</h2>
    {result.items.length === 0 ? <p className="ui-hint">Regular costs show up once a bill repeats or a name comes back two months running.</p> : <>
      <p className="plan-line">{result.changedLine}</p>
      <ul>
        {result.items.map(cost => {
          const { words, tone } = change(cost, result.currency);
          const months = cost.months.map(m => `${monthName(m.month).slice(0, 3)} ${m.month === current && cost.status === "not_yet" ? "not in yet" : money(m.amountMinor, m.estimated)}`);
          return <li key={cost.key} className="plan-regular-row">
            <span className="plan-regular-name">{cost.label}<small>{cost.categoryLabel}</small></span>
            <span className="num">{cost.status === "not_yet" ? "not in yet" : money(cost.thisMinor, cost.months[cost.months.length - 1].estimated)}{cost.soFar && cost.status !== "not_yet" && <small>so far</small>}</span>
            <span className="plan-regular-change">
              {cost.status !== "started" && <>Last month {money(cost.lastMinor, cost.months[cost.months.length - 2].estimated)} · </>}
              <span className={`plan-regular-${tone}`}>{words}</span>
            </span>
            <span className="plan-regular-months">{months.join(" · ")}</span>
          </li>;
        })}
      </ul>
    </>}
  </section>;
}

import type { MoneyState } from "@/lib/money/types";
import type { SpendingInput } from "@/lib/money/spending";
import { monthTrendView } from "@/lib/views/v/month-trend";
import type { ViewResult } from "@/lib/views/types";
import { AddLink } from "@/components/add/AddLink";
import { OverTimePanel } from "./OverTimePanel";
import { RegularCosts } from "./RegularCosts";
import "@/components/home/home-views.css";
import "./spending.css";

/** Spending → Over time (D54, D73): the months side by side, then the regular costs. `device` is the household id when it keeps its canvases on this device (Pin to Home). */
export function OverTime({ state, spending, today, device }: { state: MoneyState; spending: SpendingInput; today: string; device?: { householdId: string } }) {
  const result = monthTrendView({}, { state, spending }) as ViewResult<"stacked_columns">;
  return <>
    {result.empty
      ? <section className="home-panel hv-panel">
        <header><div><h2>{result.title}</h2></div></header>
        <p className="hv-empty">{result.empty.words}</p>
        <div className="hv-blank-actions"><AddLink kind="bill" className="ui-button primary">Add a bill</AddLink><AddLink kind="charge" className="ui-button">Add a card charge</AddLink></div>
      </section>
      : <OverTimePanel result={result} device={device} />}
    <RegularCosts spending={spending} today={today} />
  </>;
}

"use client";

import type { ReactNode } from "react";
import { daysBetween, statementItems } from "@/lib/money/runway";
import { formatter, minorMoney } from "@/lib/money/format";
import { parseHomeMode } from "@/lib/money/look-by";
import { hasNothingToForecast } from "@/lib/money/sentence";
import { AddLink } from "@/components/add/AddLink";
import type { MoneyState } from "@/lib/money/types";
import { longDay } from "@/components/views/chart-utils";
import { ViewTable } from "@/components/views/ViewTable";
import { StepLine } from "@/components/views/forms/StepLine";
import { fact, type FactCase } from "@/lib/money/facts";
import type { TermName } from "@/lib/money/terms";
import type { ViewResult } from "@/lib/views/types";
import { DISPLAY_OPTIONS, PanelHeader, Segmented, useDevicePreference } from "./hv-parts";
import "./home-views.css";

type Mode = "chart" | "table";

function Forecast({ state, result, mode, bankBalance }: { state: MoneyState; result: ViewResult<"step_line">; mode: Mode; bankBalance: ReactNode }) {
  const table = result.table, money = (minor: number) => minorMoney(minor, result.currency);
  // The forecast's own facts (D79): the figures read back, never worked out here.
  const need = (name: TermName, factCase?: FactCase) => { const found = fact(result.facts, name, factCase); if (!found) throw new Error(`The forecast has no ${name} fact`); return found.value; };
  const safe = Number(need("safe_to_spend")), lowLate = Number(need("low_point", "late")), lowUsual = Number(need("low_point", "as_usual"));
  const lowLateDay = String(need("low_point_day", "late")), lowUsualDay = String(need("low_point_day", "as_usual"));
  const open = statementItems(state).filter(item => item.open && item.dueOn >= state.today && daysBetween(state.today, item.dueOn) < (result.data?.days ?? 30));
  const format = formatter(state.homeCurrency);
  return <>
    {mode === "chart" ? <StepLine result={result} /> : table && <ViewTable table={table} />}
    <div className="hv-summary">
      <div><span>Safe to spend now</span><strong>{money(safe)}</strong><small>{open.length ? `Includes ${open.map(item => `${format(item.amount)} on ${state.cards.find(card => card.id === item.cardId)?.label ?? item.label}`).join(" and ")} not yet billed.` : "No unbilled card spend due in the next 30 days."}</small></div>
      <div><span>Lowest if clients pay late</span><strong className={lowLate < 0 ? "hv-neg" : undefined}>{money(lowLate)}</strong><small>{longDay(lowLateDay)}</small></div>
      <div><span>Lowest if clients pay as usual</span><strong>{money(lowUsual)}</strong><small>{longDay(lowUsualDay)}</small></div>
    </div>
    <p className="hv-note">The lowest your balance gets in the next 30 days, after every bill and card statement, if clients pay late.</p>
    {bankBalance}
  </>;
}

/** Home's one chart: the next 30 days (D73), as a chart or a table. */
export function HomeViews({ state, result, bankBalance }: { state: MoneyState; result: ViewResult<"step_line">; bankBalance: ReactNode }) {
  const [stored, save] = useDevicePreference("fipa-home-view", "chart");
  const mode = parseHomeMode(stored);
  if (hasNothingToForecast(state)) return <section id="next-30-days" className="home-panel hv-panel hv-blank"><header><div><h2>Your next 30 days</h2><p>Nothing to forecast yet. Add a bill or a client and your next 30 days show here.</p></div></header><div className="hv-blank-actions"><AddLink kind="bill" className="home-button home-primary">Add a bill</AddLink><AddLink kind="client" className="home-button">Add a client</AddLink></div>{bankBalance}</section>;
  return <section id="next-30-days" className="home-panel hv-panel">
    <PanelHeader title="Your next 30 days" hint="Cash if clients pay as usual or late" question="What does my cash forecast show?" />
    <div className="hv-controls"><Segmented label="Display" value={mode} options={DISPLAY_OPTIONS} onPick={save} /></div>
    <Forecast state={state} result={result} mode={mode} bankBalance={bankBalance} />
  </section>;
}

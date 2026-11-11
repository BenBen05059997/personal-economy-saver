"use client";

import type { ReactNode } from "react";
import { daysBetween, safeToSpend, statementItems } from "@/lib/money/runway";
import { parseHomeMode } from "@/lib/money/look-by";
import { hasNothingToForecast } from "@/lib/money/sentence";
import { AddLink } from "@/components/add/AddLink";
import type { MoneyState } from "@/lib/money/types";
import { longDay } from "./chart-utils";
import { ForecastChart, forecastModel } from "./ForecastChart";
import { DISPLAY_OPTIONS, PanelHeader, Segmented, Table, useDevicePreference } from "./hv-parts";
import "./home-views.css";

type Mode = "chart" | "table";

function Forecast({ state, mode, bankBalance }: { state: MoneyState; mode: Mode; bankBalance: ReactNode }) {
  const model = forecastModel(state), { format, late, usual, lo, hi } = model;
  const open = statementItems(state).filter(item => item.open && item.dueOn >= state.today && daysBetween(state.today, item.dueOn) < late.length);
  return <>
    {mode === "chart" ? <ForecastChart model={model} /> : <Table caption="Forecast by day" head={["Day", "What happens", "If clients pay late", "If they pay on time"]}>{model.rows.map(i => <tr key={model.date(i)}><th scope="row">{longDay(model.date(i))}</th><td>{model.text(i)}</td><td className="hv-num">{format(late[i])}</td><td className="hv-num">{format(usual[i])}</td></tr>)}</Table>}
    <div className="hv-summary">
      <div><span>Safe to spend now</span><strong>{format(safeToSpend(state, 0).amount)}</strong><small>{open.length ? `Includes ${open.map(item => `${format(item.amount)} on ${state.cards.find(card => card.id === item.cardId)?.label ?? item.label}`).join(" and ")} not yet billed.` : "No unbilled card spend due in the next 30 days."}</small></div>
      <div><span>Lowest if clients pay late</span><strong className={lo.amount < 0 ? "hv-neg" : undefined}>{format(lo.amount)}</strong><small>{longDay(lo.date)}</small></div>
      <div><span>Lowest if they pay on time</span><strong>{format(hi.amount)}</strong><small>{longDay(hi.date)}</small></div>
    </div>
    <p className="hv-note">The lowest your balance gets in the next 30 days, after every bill and card statement, if clients pay late.</p>
    {bankBalance}
  </>;
}

/** Home's one chart: the next 30 days (D73), as a chart or a table. */
export function HomeViews({ state, bankBalance }: { state: MoneyState; bankBalance: ReactNode }) {
  const [stored, save] = useDevicePreference("fipa-home-view", "chart");
  const mode = parseHomeMode(stored);
  if (hasNothingToForecast(state)) return <section id="next-30-days" className="home-panel hv-panel hv-blank"><header><div><h2>Your next 30 days</h2><p>Nothing to forecast yet. Add a bill or a client and your next 30 days show here.</p></div></header><div className="hv-blank-actions"><AddLink kind="bill" className="home-button home-primary">Add a bill</AddLink><AddLink kind="client" className="home-button">Add a client</AddLink></div>{bankBalance}</section>;
  return <section id="next-30-days" className="home-panel hv-panel">
    <PanelHeader title="Your next 30 days" hint="Cash if clients pay on time or late" question="What does my cash forecast show?" />
    <div className="hv-controls"><Segmented label="Display" value={mode} options={DISPLAY_OPTIONS} onPick={save} /></div>
    <Forecast state={state} mode={mode} bankBalance={bankBalance} />
  </section>;
}

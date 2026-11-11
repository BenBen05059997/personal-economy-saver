"use client";

import type { Currency } from "@/lib/catalogue/types";
import { minorMoney } from "@/lib/money/format";
import { formatSpendingView, parseSpendingView, type TrendMonth } from "@/lib/money/look-by";
import { DISPLAY_OPTIONS, PanelHeader, Segmented, Table, useDevicePreference } from "@/components/home/hv-parts";
import { MonthColumns } from "./MonthColumns";
import { SPENDING_DEFAULT, SPENDING_KEY } from "./MonthPanel";
import "@/components/home/home-views.css";
import "./spending.css";

/** Spending → Over time (D73): the last months side by side as columns or a table, with the sentence naming the highest past month. */
export function OverTimePanel({ months, currency, sentence, people }: { months: TrendMonth[]; currency: Currency; sentence: string | null; people: number }) {
  const [stored, save] = useDevicePreference(SPENDING_KEY, SPENDING_DEFAULT);
  const { mode, by, trendMode } = parseSpendingView(stored, people);
  const format = (value: number) => minorMoney(value, currency);
  return <section className="home-panel hv-panel">
    <PanelHeader title="Spending over time" hint="Your recent months at a glance" question="How has my spending changed over recent months?" />
    <div className="hv-controls"><Segmented label="Display" value={trendMode} options={DISPLAY_OPTIONS} onPick={next => save(formatSpendingView(mode, by, next))} /></div>
    {months.some(month => month.unknown) && <p className="hv-note">Some amounts are not known and are not included in these totals.</p>}
    {trendMode === "chart" ? <MonthColumns months={months} currency={currency} />
      : <Table caption="Monthly spending trend" head={["Month", "Spent", "Still to come", "Total"]}>{months.map(month => <tr key={month.month}><th scope="row">{month.name} {month.month.slice(0, 4)}</th><td className="hv-num">{format(month.spent)}</td><td className="hv-num">{format(month.coming)}</td><td className="hv-num">{format(month.total)}</td></tr>)}</Table>}
    {sentence && <p className="hv-sentence">{sentence}</p>}
  </section>;
}

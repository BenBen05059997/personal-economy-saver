"use client";

import type { ReactNode } from "react";
import type { Currency } from "@/lib/catalogue/types";
import { minorMoney } from "@/lib/money/format";
import { formatSpendingView, parseSpendingView, type LookBy, type LookByView } from "@/lib/money/look-by";
import { DISPLAY_OPTIONS, PanelHeader, Segmented, Table, useDevicePreference } from "@/components/home/hv-parts";
import { BUSINESS_SEGMENTS, CategoryBars } from "./CategoryBars";
import "@/components/home/home-views.css";
import "./spending.css";

/** The remembered choices on this device for Spending: This month's display and look-at-it-by, then Over time's display. */
export const SPENDING_KEY = "fipa-spending-view";
export const SPENDING_DEFAULT = "chart|category|chart";

const LOOK_LABELS: Record<LookBy, string> = { category: "Category", business: "Business or personal", person: "Person" };
const LOOK_TEXT: Record<LookBy, readonly [string, string]> = {
  category: ["Spending by category, compared with the month before", "Where is my money going this month?"],
  business: ["Each category split by the business share you set", "How much of this month is business?"],
  person: ["Spending by person, compared with the month before", "Who spent what this month?"],
};

/**
 * Spending → This month (D73, D74): the month's chart or table, looked at by category, business or personal, or person. The server
 * works out every look from the same items and sends them; this only picks one and draws it. `split` is the category list
 * (the Category table). `past` is set for a month before the current one: nothing is still to come in it.
 */
export function MonthPanel({ title, nav, views, split, currency, past, notes }: { title: ReactNode; nav: ReactNode; views: Partial<Record<LookBy, LookByView>>; split: ReactNode; currency: Currency; past: boolean; notes: string[] }) {
  const [stored, save] = useDevicePreference(SPENDING_KEY, SPENDING_DEFAULT);
  const { mode, by, trendMode } = parseSpendingView(stored, views.person ? 2 : 1);
  const data = views[by] ?? views.category!;
  const choices = (["category", "business", "person"] as const).filter(item => views[item]);
  const format = (value: number) => minorMoney(value, currency);
  const business = data.by === "business", person = data.by === "person";
  const businessNote = (row: { business?: number; personal?: number }) => row.business === 0 ? "all personal" : row.personal === 0 ? "all business" : `business ${format(row.business ?? 0)}`;
  const unknown = data.rows.some(row => row.unknown);
  const list = data.by === "category" && mode === "table";
  const when = past ? `in ${data.name}` : "this month";
  return <section className="home-panel hv-panel">
    <PanelHeader title={title} hint={LOOK_TEXT[data.by][0]} question={LOOK_TEXT[data.by][1]} />
    {nav}
    <div className="hv-controls">
      <Segmented label="Display" value={mode} options={DISPLAY_OPTIONS} onPick={next => save(formatSpendingView(next, data.by, trendMode))} />
      <div className="hv-look"><span aria-hidden="true">Look at it by</span>
        <Segmented label="Look at it by" value={data.by} options={choices.map(item => [item, LOOK_LABELS[item]] as const)} onPick={next => save(formatSpendingView(mode, next, trendMode))} /></div>
    </div>
    {list ? split : <>
      {unknown && <p className="hv-note">Some amounts are not known and are not included in these totals.</p>}
      {business && <div className="hv-strip"><div><span>Business</span><strong>{format(data.businessMinor)}</strong></div><div><span>Personal</span><strong>{format(data.personalMinor)}</strong></div></div>}
      {mode === "chart" ? <CategoryBars rows={data.rows} currency={currency} lastName={data.lastName} when={when} before={past ? "the month before" : "last month"} {...(business ? { segments: BUSINESS_SEGMENTS, note: businessNote } : {})} />
        : business ? <Table caption={`Business and personal in ${data.name}, by category`} head={["Category", "Business", "Personal", "Total"]}>{data.rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td className="hv-num">{format(row.business)}</td><td className="hv-num">{format(row.personal)}</td><td className="hv-num">{format(row.total)}</td></tr>)}</Table>
        : <Table caption={person ? `Who ${data.name}'s spending belongs to` : `Where ${data.name} goes, by category`} head={[person ? "Person" : "Category", "Spent", "Still to come", data.name, data.lastName]}>{data.rows.flatMap(row => [row, ...(row.children ?? [])].map(item => <tr key={item.key} className={item === row ? undefined : "hv-own"}><th scope="row">{item.label}</th><td className="hv-num">{format(item.spent)}</td><td className="hv-num">{format(item.coming)}</td><td className="hv-num">{format(item.total)}</td><td className="hv-num">{format(item.previous)}</td></tr>))}</Table>}
      {business ? <p className="hv-sentence">{data.businessLine}</p>
        : past ? <p className="hv-sentence">{data.name}: <strong>{format(data.total)}</strong> spent, against {data.lastTotal > 0 ? <strong>{format(data.lastTotal)}</strong> : "nothing recorded"} in {data.lastName}.</p>
        : <p className="hv-sentence">{data.name} so far <strong>{format(data.spent)}</strong> spent, <strong>{format(data.coming)}</strong> still to come: <strong>{format(data.total)}</strong> for the month, against {data.lastTotal > 0 ? <strong>{format(data.lastTotal)}</strong> : "nothing recorded"} in {data.lastName}.</p>}
    </>}
    {notes.map(note => <p className="hv-note" key={note}>{note}</p>)}
  </section>;
}

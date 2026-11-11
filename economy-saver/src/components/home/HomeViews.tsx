"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAskPanel } from "@/components/shell/AskWorkspace";
import { formatter, minorMoney } from "@/lib/money/format";
import { formatHomeView, lookBy, parseHomeView, type LookBy } from "@/lib/money/look-by";
import { monthByCategory } from "@/lib/money/month";
import { daysBetween, safeToSpend, statementItems } from "@/lib/money/runway";
import { monthBounds, monthsBack, spendingItems, type SpendingInput } from "@/lib/money/spending";
import { hasNothingToForecast } from "@/lib/money/sentence";
import { AddLink } from "@/components/add/AddLink";
import type { MoneyState } from "@/lib/money/types";
import { longDay } from "./chart-utils";
import { BUSINESS_SEGMENTS, CategoryBars } from "./CategoryBars";
import { ForecastChart, forecastModel } from "./ForecastChart";
import { MonthColumns } from "./MonthColumns";
import "./home-views.css";

type Mode = "chart" | "table";
const key = "fipa-home-view";
const changed = "fipa-home-view-change";
let fallback = "forecast|chart|category";
function snapshot() { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function subscribe(callback: () => void) { window.addEventListener(changed, callback); window.addEventListener("storage", callback); return () => { window.removeEventListener(changed, callback); window.removeEventListener("storage", callback); }; }
function save(value: string) { fallback = value; try { localStorage.setItem(key, value); } catch { /* The controls still work on this page. */ } window.dispatchEvent(new Event(changed)); }
const serverSnapshot = () => "forecast|chart|category";

function trendRows(input: SpendingInput, today: string) {
  const month = today.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, index) => monthsBack(month, 6 - index));
  return months.map((date) => {
    const view = monthByCategory(input, today, date);
    const bounds = monthBounds(date), entries = spendingItems(input, bounds.first, bounds.last);
    const spent = entries.filter((item) => item.date <= today).reduce((sum, item) => sum + item.amountMinor, 0);
    const coming = date === month ? entries.filter((item) => item.date > today && item.kind === "bill").reduce((sum, item) => sum + item.amountMinor, 0) : 0;
    const biggest = entries.filter(item => !item.uncounted && (item.kind === "charge" || item.repeat === null)).sort((a, b) => b.amountMinor - a.amountMinor)[0];
    return { month: date, name: view.name, spent, coming, total: spent + coming, current: date === month, hasItems: entries.length > 0, unknown: entries.some((item) => item.uncounted), biggest: biggest ? { label: biggest.label, amount: biggest.amountMinor } : null };
  }).filter((entry) => entry.hasItems || entry.month === month);
}

function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return <div className="hv-table-wrap"><table><caption>{caption}</caption><thead><tr>{head.map((label, i) => <th scope="col" key={label} className={i === 0 || label === "What happens" ? undefined : "hv-num"}>{label}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

const Empty = () => <p className="hv-empty">No spending this month yet. <AddLink kind="bill">Add a bill or a card charge.</AddLink></p>;
const Unknown = ({ show }: { show: boolean }) => show ? <p className="hv-note">Some amounts are not known and are not included in these totals.</p> : null;

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

function Categories({ input, state, mode, by }: { input: SpendingInput; state: MoneyState; mode: Mode; by: LookBy }) {
  const data = lookBy(input, state.today, by, state.split.members), format = (value: number) => minorMoney(value, input.homeCurrency), money = formatter(state.homeCurrency);
  const month = state.today.slice(0, 7);
  const pending = state.bills.filter(bill => bill.status === "pending" && bill.due.slice(0, 7) === month);
  if (!data.rows.length) return <><Empty />{pending.map(bill => <p className="hv-note" key={bill.id}>{bill.biller} {money(bill.amount)} waits in To check and is not counted yet.</p>)}</>;
  const business = data.by === "business", person = data.by === "person";
  const businessNote = (row: { business?: number; personal?: number }) => row.business === 0 ? "all personal" : row.personal === 0 ? "all business" : `business ${format(row.business ?? 0)}`;
  return <>
    <Unknown show={data.rows.some(row => row.unknown)} />
    {business && <div className="hv-strip"><div><span>Business</span><strong>{format(data.businessMinor)}</strong></div><div><span>Personal</span><strong>{format(data.personalMinor)}</strong></div></div>}
    {mode === "chart" ? <CategoryBars rows={data.rows} currency={input.homeCurrency} lastName={data.lastName} {...(business ? { segments: BUSINESS_SEGMENTS, note: businessNote } : {})} />
      : business ? <Table caption={`Business and personal in ${data.name}, by category`} head={["Category", "Business", "Personal", "Total"]}>{data.rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td className="hv-num">{format(row.business)}</td><td className="hv-num">{format(row.personal)}</td><td className="hv-num">{format(row.total)}</td></tr>)}</Table>
      : <Table caption={person ? `Who ${data.name}'s spending belongs to` : `Where ${data.name} goes, by category`} head={[person ? "Person" : "Category", "Spent", "Still to come", data.name, data.lastName]}>{data.rows.flatMap(row => [row, ...(row.children ?? [])].map(item => <tr key={item.key} className={item === row ? undefined : "hv-own"}><th scope="row">{item.label}</th><td className="hv-num">{format(item.spent)}</td><td className="hv-num">{format(item.coming)}</td><td className="hv-num">{format(item.total)}</td><td className="hv-num">{format(item.previous)}</td></tr>))}</Table>}
    {business ? <p className="hv-sentence">{data.businessLine}</p>
      : <p className="hv-sentence">{data.name} so far <strong>{format(data.spent)}</strong> spent, <strong>{format(data.coming)}</strong> still to come: <strong>{format(data.total)}</strong> for the month, against {data.lastTotal > 0 ? <strong>{format(data.lastTotal)}</strong> : "nothing recorded"} in {data.lastName}.</p>}
    {pending.map(bill => <p className="hv-note" key={bill.id}>{bill.biller} {money(bill.amount)} waits in To check and is not counted yet.</p>)}
  </>;
}

function Trend({ input, state, mode }: { input: SpendingInput; state: MoneyState; mode: Mode }) {
  const trend = trendRows(input, state.today), format = (value: number) => minorMoney(value, input.homeCurrency);
  if (!trend.some(month => month.total > 0)) return <Empty />;
  const past = trend.filter(month => !month.current && month.total > 0), high = past.sort((a, b) => b.total - a.total)[0];
  return <>
    <Unknown show={trend.some(month => month.unknown)} />
    {mode === "chart" ? <MonthColumns months={trend} currency={input.homeCurrency} />
      : <Table caption="Monthly spending trend" head={["Month", "Spent", "Still to come", "Total"]}>{trend.map(month => <tr key={month.month}><th scope="row">{month.name} {month.month.slice(0, 4)}</th><td className="hv-num">{format(month.spent)}</td><td className="hv-num">{format(month.coming)}</td><td className="hv-num">{format(month.total)}</td></tr>)}</Table>}
    {high && past.length > 1 && <p className="hv-sentence">{high.name} was the highest month ({format(high.total)}){high.biggest ? `, mostly because of ${high.biggest.label} (${format(high.biggest.amount)})` : ""}.</p>}
  </>;
}

const LOOK_LABELS: Record<LookBy, string> = { category: "Category", business: "Business or personal", person: "Person" };
const LOOK_HEADINGS: Record<LookBy, readonly [string, string, string]> = {
  category: ["Where this month goes", "Spending by category, compared with last month", "Where is my money going this month?"],
  business: ["Business and personal this month", "Each category split by the business share you set", "How much of this month is business?"],
  person: ["Who this month's spending belongs to", "Spending by person, compared with last month", "Who spent what this month?"],
};

export function HomeViews({ state, spending, bankBalance }: { state: MoneyState; spending: SpendingInput; bankBalance: ReactNode }) {
  const preference = useSyncExternalStore(subscribe, snapshot, serverSnapshot), people = state.split.members.length;
  const { view, mode, by } = parseHomeView(preference, people);
  const panel = useAskPanel(), router = useRouter();
  if (hasNothingToForecast(state)) return <section id="next-30-days" className="home-panel hv-panel hv-blank"><header><div><h2>Your next 30 days</h2><p>Nothing to forecast yet. Add a bill or a client and your next 30 days show here.</p></div></header><div className="hv-blank-actions"><AddLink kind="bill" className="home-button home-primary">Add a bill</AddLink><AddLink kind="client" className="home-button">Add a client</AddLink></div>{bankBalance}</section>;
  const labels = { forecast: ["Your next 30 days", "Cash if clients pay on time or late", "What does my cash forecast show?"], categories: LOOK_HEADINGS[by], trend: ["Spending over time", "Your recent months at a glance", "How has my spending changed over recent months?"] } as const;
  const choices: LookBy[] = people >= 2 ? ["category", "business", "person"] : ["category", "business"];
  return <section id="next-30-days" className="home-panel hv-panel"><header><div><h2>{labels[view][0]}</h2><p>{labels[view][1]}</p></div><button type="button" onClick={event => { if (panel) panel.ask(labels[view][2], event.currentTarget); else { try { sessionStorage.setItem("pes-ask-submit", JSON.stringify({ id: crypto.randomUUID(), question: labels[view][2] })); } catch { /* The person can still type the question. */ } router.push("/canvas#ask"); } }}>Ask about this</button></header><div className="hv-controls"><div role="group" aria-label="View">{(["forecast", "categories", "trend"] as const).map(item => <button type="button" key={item} aria-pressed={view === item} onClick={() => save(formatHomeView(item, mode, by))}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div><div role="group" aria-label="Display">{(["chart", "table"] as const).map(item => <button type="button" key={item} aria-pressed={mode === item} onClick={() => save(formatHomeView(view, item, by))}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div>{view === "categories" && <div className="hv-look"><span aria-hidden="true">Look at it by</span><div role="group" aria-label="Look at it by">{choices.map(item => <button type="button" key={item} aria-pressed={by === item} onClick={() => save(formatHomeView(view, mode, item))}>{LOOK_LABELS[item]}</button>)}</div></div>}</div>{view === "forecast" ? <Forecast state={state} mode={mode} bankBalance={bankBalance}/> : view === "categories" ? <Categories input={spending} state={state} mode={mode} by={by}/> : <Trend input={spending} state={state} mode={mode}/>}</section>;
}

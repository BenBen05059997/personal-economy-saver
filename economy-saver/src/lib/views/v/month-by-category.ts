// Where the month goes (D73, D74, D75) as a view: lookBy's rows for one month and one question, drawn as ranked bars. Pure; every amount is integer minor units.
import { engineFact, type Fact } from "@/lib/money/facts";
import { minorMoney } from "@/lib/money/format";
import { lookBy, type LookBy, type LookByView, type LookRow } from "@/lib/money/look-by";
import { HISTORY_MONTHS, monthBounds, monthLabel, monthsBack } from "@/lib/money/spending";
import { VIEW_META } from "../catalogue";
import type { ViewArgs } from "../args";
import { ViewError, type FormData, type RankedRow, type Resolver, type TableTwin, type ViewResult } from "../types";

const TEXT: Record<LookBy, readonly [string, string]> = {
  category: ["Spending by category, compared with the month before", "Where is my money going this month?"],
  business: ["Each category split by the business share you set", "How much of this month is business?"],
  person: ["Spending by person, compared with the month before", "Who spent what this month?"],
};
const SPENT = [{ key: "spent", legend: "Spent so far", tone: "main" as const }, { key: "coming", legend: "Still to come (bills and statements you know of)", tone: "soft" as const }];
const BUSINESS = [{ key: "business", legend: "Business", tone: "main" as const }, { key: "personal", legend: "Personal", tone: "quiet" as const }];

export const monthByCategoryView: Resolver<"month_by_category"> = (args: ViewArgs["month_by_category"], ctx): ViewResult<"ranked_bars"> => {
  const { state, spending } = ctx;
  if (!spending) throw new ViewError("The month's spending was not loaded.");
  const today = state.today, current = today.slice(0, 7), oldest = monthsBack(current, HISTORY_MONTHS);
  const month = args.month ?? current;
  if (month > current || month < oldest) throw new ViewError(`Spending shows the last ${HISTORY_MONTHS} months, ${monthLabel(oldest, today)} to ${monthLabel(current, today)}.`);
  const people = state.split.members.map(({ id, name }) => ({ id, name }));
  const by = args.by ?? "category";
  if (by === "person" && people.length < 2) throw new ViewError("Person needs two or more people in the household.");
  const past = month === current ? undefined : monthLabel(month, today);
  const view = lookBy(spending, today, by, people, month);
  const currency = spending.homeCurrency;
  const format = (value: number) => minorMoney(value, currency);
  const business = view.by === "business";
  const when = past ? `in ${view.name}` : "this month", before = past ? "the month before" : "last month";
  const title = past === undefined ? "Where this month goes" : `Where ${past} went`;
  const [hint, question] = TEXT[view.by];
  const parts = (row: LookRow) => business ? [row.business, row.personal] : [row.spent, row.coming];
  const segments = business ? BUSINESS : SPENT;
  const businessNote = (row: LookRow) => row.business === 0 ? "all personal" : row.personal === 0 ? "all business" : `business ${format(row.business)}`;
  const cap = (word: string) => word[0].toUpperCase() + word.slice(1);
  const words = business ? ["business", "personal"] : ["spent", "still to come"];
  const rowOf = (row: LookRow): RankedRow => {
    const [first, second] = parts(row);
    return {
      key: row.key, label: row.label, note: row.note, parts: [first, second], total: row.total, totalLabel: format(row.total), tick: row.previous, tickLabel: format(row.previous),
      sub: business ? businessNote(row) : `vs ${format(row.previous)} ${before}`,
      aria: `${row.label}: ${format(row.total)} ${when}. ${cap(words[0])} ${format(first)}, ${words[1]} ${format(second)}, ${view.lastName} ${format(row.previous)}.`,
      ...(row.children ? { children: row.children.map(rowOf) } : {}),
    };
  };
  const unknown = view.rows.some(row => row.unknown);
  const base = {
    view: "month_by_category" as const, args: { ...args }, form: "ranked_bars" as const, title, question, hint, home: VIEW_META.month_by_category.home, currency,
    source: `Confirmed bills and card charges in ${view.name}, in ${currency}.`,
  };
  if (view.rows.length === 0) {
    return { ...base, data: null, table: null, strip: null, line: null, facts: [], aria: `Nothing spent in ${view.name}.`, empty: past === undefined ? { words: `Nothing spent in ${view.name} yet. Add a bill or a card charge and it shows here.`, add: "bill", addLabel: "Add a bill" } : { words: `Nothing spent in ${past}.`, add: null, addLabel: null } };
  }
  // The facts first (D79): the totals, the change from last month, then each row's change, biggest first. The line is written from them.
  const span = (m: string) => ({ from: monthBounds(m).first, to: monthBounds(m).last });
  const money = (name: "month_spent_so_far" | "month_still_to_come" | "month_total" | "business_share" | "change_from_last_month", value: number, period: ReturnType<typeof span> | null = span(month)) =>
    engineFact(name, value, { from: "month_by_category", currency, ...(period ? { period } : {}) });
  const spentFact = money("month_spent_so_far", view.spent), comingFact = money("month_still_to_come", view.coming), totalFact = money("month_total", view.total);
  const lastFact = view.lastTotal > 0 ? money("month_total", view.lastTotal, span(monthsBack(month, 2))) : null;
  const facts: Fact[] = [spentFact, comingFact, totalFact, ...(lastFact ? [lastFact] : []), money("change_from_last_month", view.change.amount)];
  if (view.change.percent !== null) facts.push(engineFact("change_from_last_month_percent", view.change.percent, { from: "month_by_category", period: span(month) }));
  // The business share of a month in any question, and each category's part (a person's rows are not categories).
  if (business || view.businessMinor > 0) facts.push(money("business_share", view.businessMinor));
  const aboutType = view.by === "person" ? "person" as const : "category" as const;
  for (const row of [...view.rows].sort((a, b) => Math.abs(b.change.amount) - Math.abs(a.change.amount) || a.label.localeCompare(b.label))) {
    const about = { type: aboutType, id: row.key, name: row.label };
    facts.push(engineFact("change_from_last_month", row.change.amount, { from: "month_by_category", currency, period: span(month), about }));
    if (row.change.percent !== null) facts.push(engineFact("change_from_last_month_percent", row.change.percent, { from: "month_by_category", period: span(month), about }));
    if (row.unknown) facts.push(engineFact("not_counted", 1, { from: "month_by_category", period: span(month), about }));
  }
  if (view.by !== "person") for (const row of view.rows) facts.push(engineFact("category_total", row.total, { from: "month_by_category", currency, period: span(month), about: { type: "category", id: row.key, name: row.label } }));
  const said = (item: Fact) => format(item.value as number);
  const against = lastFact ? said(lastFact) : "nothing recorded";
  const line = business ? (view.businessMinor === 0 ? view.businessLine : `Business ${said(facts.find(f => f.name === "business_share")!)} of ${said(totalFact)} ${when}`)
    : past ? `${view.name}: ${said(totalFact)} spent, against ${against} in ${view.lastName}.`
    : `${view.name} so far ${said(spentFact)} spent, ${said(comingFact)} still to come: ${said(totalFact)} for the month, against ${against} in ${view.lastName}.`;
  const data: FormData["ranked_bars"] = {
    segments, tick: { legend: view.lastName }, rows: view.rows.map(rowOf),
    ...(args.open && !business && view.rows.some(row => row.key === args.open && (row.children?.length ?? 0) > 0) ? { open: args.open } : {}),
  };
  return {
    ...base, data, table: tableOf(view, format), empty: null, line, facts,
    strip: business ? [{ label: "Business", value: format(view.businessMinor) }, { label: "Personal", value: format(view.personalMinor) }] : null,
    aria: `${title}. ${line}${unknown ? " Some amounts are not known and are not counted." : ""}`,
  };
};

function tableOf(view: LookByView, format: (value: number) => string): TableTwin {
  if (view.by === "business") {
    return { caption: `Business and personal in ${view.name}, by category`, head: ["Category", "Business", "Personal", "Total"], foot: null,
      rows: view.rows.map(row => ({ key: row.key, cells: [row.label, format(row.business), format(row.personal), format(row.total)] })) };
  }
  const rows = view.rows.flatMap(row => [{ row, child: false }, ...(row.children ?? []).map(kid => ({ row: kid, child: true }))]);
  return { caption: view.by === "person" ? `Who ${view.name}'s spending belongs to` : `Where ${view.name} goes, by category`, foot: null,
    head: [view.by === "person" ? "Person" : "Category", "Spent", "Still to come", view.name, view.lastName],
    rows: rows.map(({ row, child }) => ({ key: row.key, cells: [row.label, format(row.spent), format(row.coming), format(row.total), format(row.previous)], ...(child ? { child: true } : {}) })) };
}

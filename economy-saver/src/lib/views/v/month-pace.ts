// Spending day by day (D73, D77): this month's running total against last month's. Pure; every amount integer minor units.
import { engineFact, type Fact } from "@/lib/money/facts";
import { dayLabel, minorMoney, ordinal } from "@/lib/money/format";
import { monthPace } from "@/lib/money/month-pace";
import { monthBounds, monthName } from "@/lib/money/spending";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type TableTwin, type ViewResult } from "../types";

export const monthPaceView: Resolver<"month_pace"> = (args, ctx): ViewResult => {
  const { spending } = ctx;
  if (!spending) throw new ViewError("Spending is not loaded for this view.");
  const meta = VIEW_META.month_pace, currency = spending.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const pace = monthPace(spending, ctx.state.today, args.month);
  const name = monthName(pace.month), last = monthName(pace.previous);
  const base = { view: "month_pace" as const, args: { ...args }, form: "pace_lines" as const, title: "Spending day by day", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "Your bills and card charges, by the day they fall" };
  if (pace.thisPoints.length === 0 || (pace.thisPoints[pace.thisPoints.length - 1] === 0 && pace.lastTotalMinor === 0)) {
    return { ...base, data: null, table: null, line: null, aria: "No days to compare yet.", facts: [],
      empty: { words: "Nothing to compare yet. Days show here once you have bills or card charges.", add: "bill", addLabel: "Add a bill" } };
  }
  const over = pace.todayIndex === null, day = pace.thisPoints.length;
  const thisMinor = pace.thisSoFarMinor, lastMinor = over ? pace.lastTotalMinor : pace.lastSoFarMinor;
  // The facts first (D79); the sentence is written from them.
  const range = (month: string, through: number) => ({ from: monthBounds(month).first, to: `${month}-${String(through).padStart(2, "0")}` });
  const thisPeriod = over ? range(pace.month, pace.days) : range(pace.month, day), lastPeriod = over ? range(pace.previous, pace.lastPoints.length) : range(pace.previous, Math.min(day, pace.lastPoints.length));
  const money = (name: "month_spent_so_far" | "month_total" | "change_from_last_month", value: number, period: typeof thisPeriod) => engineFact(name, value, { from: "month_pace", currency, period });
  const thisFact = money(over ? "month_total" : "month_spent_so_far", thisMinor, thisPeriod);
  const lastFact = money(over ? "month_total" : "month_spent_so_far", lastMinor, lastPeriod);
  const lastTotalFact = over ? null : money("month_total", pace.lastTotalMinor, range(pace.previous, pace.lastPoints.length));
  const changeFact = money("change_from_last_month", thisMinor - lastMinor, thisPeriod);
  const facts: Fact[] = [thisFact, lastFact, ...(lastTotalFact ? [lastTotalFact] : []), changeFact];
  const said = (item: Fact) => format(item.value as number);
  const gap = thisMinor === lastMinor ? "the same as" : `${format(Math.abs(changeFact.value as number))} ${thisMinor > lastMinor ? "more" : "less"} than`;
  const line = over
    ? `${name} came to ${said(thisFact)}, ${gap} ${last} (${said(lastFact)}).`
    : `By the ${ordinal(day)} you have spent ${said(thisFact)} in ${name}, ${gap} ${last} by the same day (${said(lastFact)}). ${last} ended at ${said(lastTotalFact!)}.`;
  const date = (index: number) => dayLabel(`${pace.month}-${String(index + 1).padStart(2, "0")}`);
  const table: TableTwin = {
    caption: `Spending so far, ${name} and ${last}`, head: ["Day", name, last], foot: null,
    rows: Array.from({ length: pace.days }, (_, i) => ({ key: String(i + 1), cells: [date(i), i < pace.thisPoints.length ? format(pace.thisPoints[i]) : "–", i < pace.lastPoints.length ? format(pace.lastPoints[i]) : "–"], ...(i === pace.todayIndex && { tone: "in" as const }) })),
  };
  return {
    ...base, empty: null, line, table, facts,
    data: { days: pace.days, todayIndex: pace.todayIndex, lines: [{ key: "this", label: name, tone: "main", points: pace.thisPoints }, { key: "last", label: last, tone: "quiet", points: pace.lastPoints }] },
    aria: `Spending added up day by day, ${name} against ${last}. Use the left and right arrow keys to look at each day.`,
  };
};

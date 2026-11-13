// Spending day by day (D73, D77): this month's running total against last month's. Pure; every amount integer minor units.
import { dayLabel, minorMoney, ordinal } from "@/lib/money/format";
import { monthPace } from "@/lib/money/month-pace";
import { monthName } from "@/lib/money/spending";
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
    return { ...base, data: null, table: null, line: null, aria: "No days to compare yet.", figures: { days: 0 },
      empty: { words: "Nothing to compare yet. Days show here once you have bills or card charges.", add: "bill", addLabel: "Add a bill" } };
  }
  const over = pace.todayIndex === null, day = pace.thisPoints.length;
  const thisMinor = pace.thisSoFarMinor, lastMinor = over ? pace.lastTotalMinor : pace.lastSoFarMinor, difference = Math.abs(thisMinor - lastMinor);
  const gap = thisMinor === lastMinor ? "the same as" : `${format(difference)} ${thisMinor > lastMinor ? "more" : "less"} than`;
  const line = over
    ? `${name} came to ${format(thisMinor)}, ${gap} ${last} (${format(lastMinor)}).`
    : `By the ${ordinal(day)} you have spent ${format(thisMinor)} in ${name}, ${gap} ${last} by the same day (${format(lastMinor)}). ${last} ended at ${format(pace.lastTotalMinor)}.`;
  const date = (index: number) => dayLabel(`${pace.month}-${String(index + 1).padStart(2, "0")}`);
  const table: TableTwin = {
    caption: `Spending so far, ${name} and ${last}`, head: ["Day", name, last], foot: null,
    rows: Array.from({ length: pace.days }, (_, i) => ({ key: String(i + 1), cells: [date(i), i < pace.thisPoints.length ? format(pace.thisPoints[i]) : "–", i < pace.lastPoints.length ? format(pace.lastPoints[i]) : "–"], ...(i === pace.todayIndex && { tone: "in" as const }) })),
  };
  return {
    ...base, empty: null, line, table,
    data: { days: pace.days, todayIndex: pace.todayIndex, lines: [{ key: "this", label: name, tone: "main", points: pace.thisPoints }, { key: "last", label: last, tone: "quiet", points: pace.lastPoints }] },
    aria: `Spending added up day by day, ${name} against ${last}. Use the left and right arrow keys to look at each day.`,
    figures: { day, days: pace.days, thisSoFarMinor: thisMinor, lastSoFarMinor: lastMinor, lastTotalMinor: pace.lastTotalMinor, differenceMinor: difference },
  };
};

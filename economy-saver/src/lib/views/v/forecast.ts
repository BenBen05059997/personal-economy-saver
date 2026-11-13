// The forecast view (D77): the next days of cash as a step line, worked out on the server from the engine's series and timelines.
import type { Currency } from "@/lib/catalogue/types";
import { forecastCosts } from "@/lib/money/forecast-causes";
import { dayLabel, formatter, minorMoney, minorPerUnit, ordinal } from "@/lib/money/format";
import { addDays, low, safeToSpend, series, timeline, WINDOW_DAYS } from "@/lib/money/runway";
import { hasNothingToForecast } from "@/lib/money/sentence";
import { VIEW_META } from "../catalogue";
import type { FormData, Resolver, TableTwin, ViewResult } from "../types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "2026-11-27" -> "Fri, Nov 27" (server side; the browser copy lives in chart-utils, which imports hooks). */
export const longDay = (iso: string) => `${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${dayLabel(iso)}`;

type StepLine = FormData["step_line"];
type StepInput = { startDate: string; currency: Currency; lines: StepLine["lines"]; band: StepLine["band"]; lowLine: string; sub: string[]; marks?: StepLine["marks"]; dayWords: StepLine["dayWords"]; direct: StepLine["direct"] };

/** The step-line data for any set of day-by-day lines (integer minor units): weekly x labels, the lowest point of `lowLine` with its words, and the rest as given. Forecast, what-if and the legacy flow block all draw through this. */
export function stepLine(input: StepInput): StepLine {
  const line = input.lines.find(l => l.key === input.lowLine) ?? input.lines[0], days = line.points.length;
  let index = 0;
  line.points.forEach((v, i) => { if (v < line.points[index]) index = i; });
  const minor = line.points[index], short = minor < 0, date = addDays(input.startDate, index), format = (m: number) => minorMoney(m, input.currency);
  const every = days <= 45 ? 7 : days <= 90 ? 14 : 28;
  const xTicks = Array.from({ length: Math.ceil(days / every) }, (_, k) => k * every).filter(i => i < days).map(i => ({ index: i, label: i === 0 ? "Today" : longDay(addDays(input.startDate, i)).slice(5) }));
  return {
    days, startDate: input.startDate, xTicks, lines: input.lines, band: input.band,
    low: { line: line.key, index, minor, label: `${short ? `Short ${format(-minor)}` : `Lowest ${format(minor)}`} on ${longDay(date)}`, short, sub: input.sub },
    marks: input.marks ?? [], dayWords: input.dayWords, direct: input.direct,
  };
}

const LATE = "If clients pay late (what safe to spend uses)", USUAL = "If they pay on time";

export const forecastView: Resolver<"forecast"> = (args, ctx): ViewResult => {
  const { state } = ctx, days = args.days ?? WINDOW_DAYS, which = args.case ?? "both";
  const currency = state.homeCurrency, per = minorPerUnit(currency), format = formatter(currency), minor = (v: number) => Math.round(v * per);
  const meta = VIEW_META.forecast, title = `Your next ${days} days`;
  const base = { view: "forecast" as const, args: { ...args }, form: "step_line" as const, title, question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "From your bills, card statements and your clients' usual pay days." };
  if (hasNothingToForecast(state)) return { ...base, data: null, table: null, line: null, aria: "Nothing to forecast yet.", figures: {}, empty: { words: "Nothing to forecast yet. Add a bill or a client and your next days show here.", add: "bill", addLabel: "Add a bill" } };

  const late = series(state, "worst", days), usual = series(state, "expected", days);
  const lateEvents = timeline(state, "worst", days), usualEvents = timeline(state, "expected", days);
  const date = (i: number) => addDays(state.today, i);
  const pending = new Map(state.bills.filter(bill => bill.status === "pending").map(bill => [bill.id, bill]));
  const lineFor = (event: ReturnType<typeof timeline>[number]) => {
    if (event.pending) { const bill = pending.get(event.id); return `${event.label} ${format(bill ? bill.amount : -event.amount)} waits in To check and is not counted yet`; }
    if (event.uncounted) return `${event.label}: amount not known`;
    return `${event.label} ${event.amount < 0 ? "−" : "+"}${format(Math.abs(event.amount))}`;
  };
  const on = (events: typeof lateEvents, day: string) => events.filter(event => event.date === day).map(lineFor);
  // The lines for a day: one list when late and on time agree, two when they differ.
  const words = (i: number): { lines: string[]; text: string } => {
    const a = on(lateEvents, date(i)), b = on(usualEvents, date(i));
    if (which === "late" || (which === "both" && a.join("|") === b.join("|"))) return { lines: a.length ? a : ["Nothing scheduled"], text: a.join("; ") || "Nothing scheduled" };
    if (which === "usual") return { lines: b.length ? b : ["Nothing scheduled"], text: b.join("; ") || "Nothing scheduled" };
    const lines = [`If late: ${a.join("; ") || "nothing"}`, `If on time: ${b.join("; ") || "nothing"}`];
    return { lines, text: lines.join(". ") };
  };
  const dayWords = late.map((_, i) => ({ date: date(i), label: longDay(date(i)), lines: words(i).lines }));

  const lo = low(late, state.today), hi = low(usual, state.today);
  const lowLine = which === "usual" ? "quiet" : "main", lowOf = which === "usual" ? hi : lo, lowEvents = which === "usual" ? usualEvents : lateEvents;
  const lowerFirst = (label: string) => /^[A-Z][a-z]+$/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
  const sub = forecastCosts(lowEvents, lowOf.date).map((event, index) => {
    const label = event.label.replace(/ statement$/, ""), day = event.date === lowOf.date ? "" : ` on the ${ordinal(Number(event.date.slice(8, 10)))}`;
    return `${index ? lowerFirst(label) : label} ${format(-event.amount)}${day}`;
  });
  const lines: StepLine["lines"] = [];
  if (which !== "usual") lines.push({ key: "main", label: LATE, tone: "main", points: late.map(minor) });
  if (which !== "late") lines.push({ key: "quiet", label: USUAL, tone: "quiet", points: usual.map(minor) });
  const data = stepLine({
    startDate: state.today, currency, lines, band: which === "both" ? ["quiet", "main"] : null, lowLine, sub, dayWords,
    direct: lines.map(l => ({ line: l.key, text: l.key === "main" ? "If late" : "If on time" })),
  });

  const eventDays = new Set([...lateEvents, ...usualEvents].map(event => event.date));
  const head = ["Day", "What happens", ...(which !== "usual" ? ["If clients pay late"] : []), ...(which !== "late" ? ["If they pay on time"] : [])];
  const table: TableTwin = {
    caption: "Forecast by day", head, foot: null, align: head.map((_, i) => i === 1 ? "start" : "end"),
    rows: late.map((_, i) => i).filter(i => i === 0 || eventDays.has(date(i))).map(i => ({ key: date(i), cells: [longDay(date(i)), words(i).text, ...(which !== "usual" ? [format(late[i])] : []), ...(which !== "late" ? [format(usual[i])] : [])] })),
  };

  const short = data.low.short, lowDay = longDay(lowOf.date), who = which === "usual" ? "if clients pay on time" : "if clients pay late";
  const aria = `Cash forecast for the next ${days} days. ${short ? `${which === "usual" ? "If clients pay on time" : "If clients pay late"} you are ${format(-lowOf.amount)} short on ${lowDay}` : `The lowest ${who} is ${format(lowOf.amount)} on ${lowDay}`}. Use the left and right arrow keys to look at each day.`;
  return {
    ...base, data, table, empty: null, aria,
    line: short ? `${which === "usual" ? "If clients pay on time" : "If clients pay late"} you are ${format(-lowOf.amount)} short on ${lowDay}.` : `The lowest ${who} is ${format(lowOf.amount)} on ${lowDay}.`,
    figures: { safeToSpendMinor: minor(safeToSpend(state, 0).amount), lowLateMinor: minor(lo.amount), lowLateDate: lo.date, lowUsualMinor: minor(hi.amount), lowUsualDate: hi.date },
  };
};

// The bills calendar (D77): what goes out and what comes in, day by day, with each day shaded by how much goes out. Pure; every amount integer minor units.
import { dayLabel, minorMoney } from "@/lib/money/format";
import { addDays } from "@/lib/money/runway";
import { calendarDays, type CalendarItem } from "@/lib/money/calendar";
import { VIEW_META } from "../catalogue";
import type { FormData, Resolver, TableTwin, ViewResult } from "../types";
import { longDay } from "./forecast";

const dayOfWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export const calendarView: Resolver<"bills_calendar"> = (args, ctx): ViewResult => {
  const { state } = ctx, days = args.days ?? 30, shared = args.whose === "shared";
  const meta = VIEW_META.bills_calendar, currency = state.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const base = {
    view: "bills_calendar" as const, args: { ...args }, form: "calendar" as const, title: shared ? "When shared bills fall" : "When bills fall", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null,
    source: shared ? "The household's shared bills." : "Your bills, card statements and your clients' usual pay days.",
  };
  const rows = calendarDays(state, days, args.whose);
  if (!rows.some(row => row.items.length > 0)) {
    return { ...base, data: null, table: null, line: null, aria: "Nothing is due.", figures: { days, outMinor: 0, inMinor: 0, shortDays: 0, pendingCount: 0 },
      empty: { words: shared ? `No shared bills fall in the next ${days} days. Add a bill and it shows here.` : `Nothing is due in the next ${days} days. Add a bill and it shows here.`, add: "bill", addLabel: "Add a bill" } };
  }
  const words = (item: CalendarItem) => {
    if (item.pending) return `${item.label} ${format(item.amountMinor)} waits in To check and is not counted yet`;
    if (item.uncounted) return `${item.label}: amount not known`;
    const sign = item.kind === "arrival" ? "+" : "−";
    return `${item.label} ${item.estimated ? "about " : ""}${sign}${format(item.amountMinor)}`;
  };
  // The cells: whole weeks from the Sunday on or before today, to the Saturday on or after the last day.
  const start = addDays(state.today, -dayOfWeek(state.today)), end = rows[rows.length - 1].date, lastWeekEnd = addDays(end, 6 - dayOfWeek(end));
  const byDate = new Map(rows.map(row => [row.date, row]));
  const weeks: FormData["calendar"]["weeks"] = [];
  for (let date = start; date <= lastWeekEnd; date = addDays(date, 1)) {
    if (dayOfWeek(date) === 0) weeks.push([]);
    const row = byDate.get(date);
    weeks[weeks.length - 1].push({ date, inRange: row !== undefined, today: date === state.today, outMinor: row?.outMinor ?? 0, inMinor: row?.inMinor ?? 0, short: row?.short ?? false, items: row?.items.map(words) ?? [] });
  }
  const outMinor = rows.reduce((sum, row) => sum + row.outMinor, 0), inMinor = rows.reduce((sum, row) => sum + row.inMinor, 0);
  const heaviest = rows.reduce((best, row) => row.outMinor > best.outMinor ? row : best, rows[0]);
  const shortDays = rows.filter(row => row.short), pendingCount = rows.reduce((sum, row) => sum + row.items.filter(item => item.pending).length, 0);
  const lastShort = shortDays.length > 0 ? shortDays[shortDays.length - 1].date : null;
  const table: TableTwin = {
    caption: shared ? "Shared bills by day" : "Bills and money coming, by day", head: ["Day", "What", "Goes out", ...(shared ? [] : ["Comes in"])], foot: null,
    align: shared ? ["start", "start", "end"] : ["start", "start", "end", "end"],
    rows: rows.filter(row => row.items.length > 0 || row.short).map(row => ({
      key: row.date, ...(row.short && { tone: "short" as const }),
      cells: [longDay(row.date), [...row.items.map(words), ...(row.short ? ["short if clients pay late"] : [])].join("; "), row.outMinor ? format(row.outMinor) : "–", ...(shared ? [] : [row.inMinor ? format(row.inMinor) : "–"])],
    })),
  };
  const line = `${format(outMinor)} goes out in the next ${days} days${shared ? "" : ` and ${format(inMinor)} comes in as clients pay as usual`}. The heaviest day is ${longDay(heaviest.date)} (${format(heaviest.outMinor)}).`
    + (lastShort ? ` If clients pay late you are short from ${dayLabel(shortDays[0].date)} to ${dayLabel(lastShort)}.` : "");
  return {
    ...base, empty: null, table, line,
    data: { weeks, maxOutMinor: Math.max(0, ...rows.map(row => row.outMinor)) },
    aria: `Calendar of the next ${days} days. ${format(outMinor)} goes out${shared ? "" : ` and ${format(inMinor)} comes in`}. The heaviest day is ${longDay(heaviest.date)}.`,
    figures: { days, outMinor, inMinor, heaviestMinor: heaviest.outMinor, heaviestDate: heaviest.date, shortDays: shortDays.length, pendingCount },
  };
};

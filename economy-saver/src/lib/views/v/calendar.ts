// The bills calendar (D77): what goes out and what comes in, day by day, with each day shaded by how much goes out. Pure; every amount integer minor units.
import { engineFact, type Fact } from "@/lib/money/facts";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { addDays } from "@/lib/money/runway";
import { calendarDays, type CalendarItem } from "@/lib/money/calendar";
import { sharedBillsComing } from "@/lib/money/family";
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
    return { ...base, data: null, table: null, line: null, aria: "Nothing is due.", facts: [],
      empty: { words: shared ? `No shared bills fall in the next ${days} days. Add a bill and it shows here.` : `Nothing is due in the next ${days} days. Add a bill and it shows here.`, add: "bill", addLabel: "Add a bill" } };
  }
  const words = (item: CalendarItem) => {
    if (item.pending) return `${item.label} ${format(item.amountMinor)} waits in To check and is not counted yet`;
    if (item.uncounted) return `${item.label}: amount not known`;
    const sign = item.kind === "arrival" ? "+" : "−";
    return `${item.label} ${item.estimated ? "about " : ""}${sign}${format(item.amountMinor)}`;
  };
  // The family link's table names each shared bill, without its amount (the next column has it), and who pays it.
  const payers = new Map(shared ? sharedBillsComing(state).map(bill => [`${bill.date}|${bill.biller}`, bill.paidBy] as const) : []);
  const nameOf = (item: CalendarItem) => item.pending || item.uncounted ? words(item) : item.label;
  const paidBy = (date: string, items: CalendarItem[]) => items.map(item => payers.get(`${date}|${item.label}`) ?? "").filter(Boolean).join("; ") || "–";
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
    caption: shared ? "Shared bills by day" : "Bills and money coming, by day", head: ["Day", "What", ...(shared ? ["Paid by"] : []), "Goes out", ...(shared ? [] : ["Comes in"])], foot: null,
    align: shared ? ["start", "start", "start", "end"] : ["start", "start", "end", "end"],
    rows: rows.filter(row => row.items.length > 0 || row.short).map(row => ({
      key: row.date, ...(row.short && { tone: "short" as const }),
      cells: [longDay(row.date), [...row.items.map(shared ? nameOf : words), ...(row.short ? ["short if clients pay late"] : [])].join("; "), ...(shared ? [paidBy(row.date, row.items)] : []), row.outMinor ? format(row.outMinor) : "–", ...(shared ? [] : [row.inMinor ? format(row.inMinor) : "–"])],
    })),
  };
  // The facts first (D79); the line reads every number and date back from them.
  const from = "bills_calendar", money = { from, currency };
  const facts: Fact[] = [engineFact("days_shown", days, { from }), engineFact("goes_out", outMinor, money)];
  if (!shared) facts.push(engineFact("comes_in", inMinor, money));
  facts.push(engineFact("heaviest_day_goes_out", heaviest.outMinor, money), engineFact("heaviest_day", heaviest.date, { from }));
  facts.push(engineFact("short_days", shortDays.length, { from }));
  if (lastShort) facts.push(engineFact("first_short_day", shortDays[0].date, { from }), engineFact("last_short_day", lastShort, { from }));
  if (pendingCount > 0) facts.push(engineFact("to_check", pendingCount, { from }));
  const said = (name: Fact["name"]) => facts.find(item => item.name === name)!.value;
  const line = `${format(Number(said("goes_out")))} goes out in the next ${said("days_shown")} days${shared ? "" : ` and ${format(Number(said("comes_in")))} comes in as clients pay as usual`}. The heaviest day is ${longDay(String(said("heaviest_day")))} (${format(Number(said("heaviest_day_goes_out")))}).`
    + (lastShort ? ` If clients pay late you are short from ${dayLabel(String(said("first_short_day")))} to ${dayLabel(String(said("last_short_day")))}.` : "");
  return {
    ...base, empty: null, table, line, facts,
    data: { weeks, maxOutMinor: Math.max(0, ...rows.map(row => row.outMinor)) },
    aria: `Calendar of the next ${days} days. ${format(outMinor)} goes out${shared ? "" : ` and ${format(inMinor)} comes in`}. The heaviest day is ${longDay(heaviest.date)}.`,
  };
};

// The forecast view (D77): the next days of cash as a step line, worked out on the server from the engine's series and timelines.
import { engineFact, fact, type Fact, type FactAbout } from "@/lib/money/facts";
import { forecastCosts } from "@/lib/money/forecast-causes";
import { AMOUNT_NOT_KNOWN } from "@/lib/money/gaps";
import { dayLabel, formatter, longDay, minorPerUnit, ordinal, toMinor } from "@/lib/money/format";
import { firstShort, low, safeToSpend, series, timeline, WINDOW_DAYS } from "@/lib/money/runway";
import { hasNothingToForecast } from "@/lib/money/sentence";
import { CASES } from "@/lib/money/terms";
import { VIEW_META } from "../catalogue";
import { stepLine } from "../step-line";
import { ViewError, type FormData, type Resolver, type TableTwin, type ViewResult } from "../types";
import { eventWords, ifCase, ifClientsPay, NOTHING_SCHEDULED } from "../words";
import { storedId } from "@/lib/money/repeat";
import { addDays, daysBetween } from "@/lib/money/dates";

type StepLine = FormData["step_line"];
const LATE = `${ifClientsPay("late")} (what safe to spend uses)`, USUAL = ifCase("as_usual");

export const forecastView: Resolver<"forecast"> = (args, ctx): ViewResult => {
  const { state } = ctx, days = args.days ?? WINDOW_DAYS, which = args.case ?? "both";
  const currency = state.homeCurrency, per = minorPerUnit(currency), format = formatter(currency), minor = (v: number) => toMinor(v, currency);
  const meta = VIEW_META.forecast, title = `Your next ${days} days`;
  const base = { view: "forecast" as const, args: { ...args }, form: "step_line" as const, title, question: meta.question, hint: meta.hint, currency, strip: null, source: "From your bills, card statements and your clients' usual pay days." };
  if (hasNothingToForecast(state)) return { ...base, data: null, table: null, line: null, aria: "Nothing to forecast yet.", facts: [], empty: { words: "Nothing to forecast yet. Add a bill or a client and your next days show here.", add: "bill", addLabel: "Add a bill" } };

  const late = series(state, "worst", days), usual = series(state, "expected", days);
  const lateEvents = timeline(state, "worst", days), usualEvents = timeline(state, "expected", days);
  const date = (i: number) => addDays(state.today, i);
  const pending = new Map(state.bills.filter(bill => bill.status === "pending").map(bill => [bill.id, bill]));
  const lineFor = (event: ReturnType<typeof timeline>[number]) => { const bill = pending.get(event.id); return eventWords(event, format, bill ? bill.amount : -event.amount); };
  const on = (events: typeof lateEvents, day: string) => events.filter(event => event.date === day).map(lineFor);
  // The lines for a day: one list when late and as usual agree, two when they differ.
  const words = (i: number): { lines: string[]; text: string } => {
    const a = on(lateEvents, date(i)), b = on(usualEvents, date(i));
    if (which === "late" || (which === "both" && a.join("|") === b.join("|"))) return { lines: a.length ? a : [NOTHING_SCHEDULED], text: a.join("; ") || NOTHING_SCHEDULED };
    if (which === "usual") return { lines: b.length ? b : [NOTHING_SCHEDULED], text: b.join("; ") || NOTHING_SCHEDULED };
    const lines = [`${ifCase("late")}: ${a.join("; ") || "nothing"}`, `${ifCase("as_usual")}: ${b.join("; ") || "nothing"}`];
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
  // A bill named by `mark` is drawn on the day it falls due; a bill not due in these days is refused in words.
  const markLine = which === "usual" ? usualEvents : lateEvents;
  const marked = args.mark === undefined ? undefined : markLine.find(event => event.kind === "bill" && storedId(event.id) === args.mark);
  if (args.mark !== undefined && !marked) throw new ViewError(`That bill is not due in the next ${days} days, so there is no day to mark.`);
  const marks = marked ? [{ index: daysBetween(state.today, marked.date), label: `${marked.label} ${marked.uncounted ? AMOUNT_NOT_KNOWN : format(Math.abs(marked.amount))} · ${dayLabel(marked.date)}` }] : [];
  const data = stepLine({
    startDate: state.today, currency, lines, band: which === "both" ? ["quiet", "main"] : null, lowLine, sub, marks, dayWords,
    direct: lines.map(l => ({ line: l.key, text: l.key === "main" ? ifCase("late") : ifCase("as_usual") })),
  });

  const eventDays = new Set([...lateEvents, ...usualEvents].map(event => event.date));
  const head = ["Day", "What happens", ...(which !== "usual" ? ["If clients pay late"] : []), ...(which !== "late" ? ["If as usual"] : [])];
  const table: TableTwin = {
    caption: "Forecast by day", head, foot: null, align: head.map((_, i) => i === 1 ? "start" : "end"),
    rows: late.map((_, i) => i).filter(i => i === 0 || eventDays.has(date(i))).map(i => ({ key: date(i), cells: [longDay(date(i)), words(i).text, ...(which !== "usual" ? [format(late[i])] : []), ...(which !== "late" ? [format(usual[i])] : [])] })),
  };

  // The facts first (D79): every figure in the line below is read back from them. Both cases are the engine's own series and its safe to spend.
  const facts: Fact[] = [];
  const from = "forecast", money = { from, currency }, window = { from: state.today, to: addDays(state.today, days - 1) };
  const showLate = which !== "usual", showUsual = which !== "late";
  // The Home sentence's parts (both cases' low point, and the shortfall) are facts whichever line is drawn.
  const sts = safeToSpend(state, { days });
  if (days === WINDOW_DAYS) facts.push(engineFact("safe_to_spend", minor(sts.amount), money));
  else facts.push(engineFact("safe_to_spend_for_period", minor(sts.amount), { ...money, period: window }));
  if (days === WINDOW_DAYS && showUsual) facts.push(engineFact("safe_to_spend_as_usual", minor(safeToSpend(state, { case: "as_usual" }).amount), money));
  const clientAbout = (name: string): FactAbout => { const found = state.clients.filter(c => c.name.split(" ")[0] === name); return { type: "client", id: found.length === 1 ? found[0].id : name, name }; };
  if (showLate) for (const name of sts.lateClients) facts.push(engineFact("late_client", name, { from, about: clientAbout(name) }));
  const costAbout = (event: ReturnType<typeof timeline>[number]): FactAbout => event.kind === "statement" && event.cardId ? { type: "card", id: event.cardId, name: event.label.replace(/ statement$/, "") } : { type: "bill", id: storedId(event.id), name: event.label };
  const addCase = (c: "late" | "as_usual", point: ReturnType<typeof low>, events: typeof lateEvents, balances: number[]) => {
    facts.push(engineFact("low_point", minor(point.amount), { ...money, case: c }), engineFact("low_point_day", point.date, { from, case: c }));
    if (point.amount < 0) facts.push(engineFact("short", minor(-point.amount), { ...money, case: c }));
    const first = firstShort(balances);
    if (first !== null) facts.push(engineFact("days_until_short", first, { from, case: c }));
    for (const event of forecastCosts(events, point.date)) facts.push(engineFact("cost_before_low", minor(-event.amount), { ...money, case: c, period: { on: event.date }, about: costAbout(event) }));
  };
  // A bill that waits for the person's yes is shown at the amount it would be and counted nowhere (the same on both lines).
  for (const bill of pending.values()) {
    const due = [...lateEvents, ...usualEvents].find(event => event.pending && event.id === bill.id);
    if (due) facts.push(engineFact("to_check_amount", minor(bill.amount), { ...money, period: { on: due.date }, about: { type: "bill", id: bill.id, name: bill.biller } }));
  }
  if (showLate) addCase("late", lo, lateEvents, late);
  if (showUsual) addCase("as_usual", hi, usualEvents, usual);
  const spare = (c: "late" | "as_usual", point: ReturnType<typeof low>) => {
    facts.push(engineFact("low_point", minor(point.amount), { ...money, case: c }), engineFact("low_point_day", point.date, { from, case: c }));
    if (point.amount < 0) facts.push(engineFact("short", minor(-point.amount), { ...money, case: c }));
  };
  if (!showLate) spare("late", lo);
  if (!showUsual) spare("as_usual", hi);

  const short = data.low.short, caseKey = which === "usual" ? "as_usual" as const : "late" as const;
  const lowMinor = Number(fact(facts, "low_point", caseKey)!.value), lowDay = longDay(String(fact(facts, "low_point_day", caseKey)!.value));
  const sentence = short ? `${ifClientsPay(caseKey)} you are ${format(-lowMinor / per)} short on ${lowDay}` : `The lowest if clients pay ${CASES[caseKey].label} is ${format(lowMinor / per)} on ${lowDay}`;
  return {
    ...base, data, table, empty: null, facts,
    aria: `Cash forecast for the next ${days} days. ${sentence}. Use the left and right arrow keys to look at each day.`,
    line: `${sentence}.`,
  };
};

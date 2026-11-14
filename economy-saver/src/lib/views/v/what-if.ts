// The what-if (D77): the next days of cash with a change, drawn over the days as they are now (the ghost). Code runs the engine on a copy of the
// money state (`whatIf`); nothing is saved. A spend moves the late case (the one safe to spend uses); a client paying later moves the usual case,
// because the change is "later than usual". The amount the person asked about is a person fact (D79): it confirms nothing.
import { engineFact, fact, personFact, type Fact } from "@/lib/money/facts";
import { WhatIfError, whatIf } from "@/lib/money/whatif";
import { formatter, minorMoney, minorPerUnit } from "@/lib/money/format";
import { addDays, daysBetween, low, series, timeline, WINDOW_DAYS } from "@/lib/money/runway";
import { hasNothingToForecast } from "@/lib/money/sentence";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type TableTwin, type ViewResult } from "../types";
import { longDay, stepLine } from "./forecast";

export const whatIfView: Resolver<"what_if"> = (args, ctx): ViewResult => {
  const { state } = ctx, currency = state.homeCurrency, per = minorPerUnit(currency), format = formatter(currency), money = (minor: number) => minorMoney(minor, currency), toMinor = (v: number) => Math.round(v * per);
  const meta = VIEW_META.what_if, { amountMinor, late } = args;
  if ((amountMinor === undefined) === (late === undefined)) throw new ViewError("what_if takes an amount to spend, or one client paying late, not both and not neither.");
  if (amountMinor !== undefined && args.date !== undefined && late !== undefined) throw new ViewError("A date goes with an amount.");
  const client = late ? state.clients.find(c => c.id === late.clientId) : undefined;
  if (late && !client) throw new ViewError("That client is not in your records, so they cannot be late in a what-if.");
  const spendDate = args.date ?? state.today, kind = late ? "expected" as const : "worst" as const;
  const base = { view: "what_if" as const, args: { ...args }, form: "step_line" as const, title: late ? `What if ${client!.name.split(" ")[0]} pays late` : "What if you spend it", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "Your next days, worked out again with the change. Nothing is saved." };
  if (hasNothingToForecast(state)) return { ...base, data: null, table: null, line: null, aria: "Nothing to forecast yet.", facts: [], empty: { words: "Nothing to forecast yet. Add a bill or a client and a what-if shows here.", add: "bill", addLabel: "Add a bill" } };

  let changed;
  try { changed = whatIf(state, late ? [{ kind: "client_late", clientId: late.clientId, days: late.days }] : [{ kind: "add_cost", name: "Your spend", amountMinor: amountMinor!, date: spendDate }]); }
  catch (error) { if (error instanceof WhatIfError) throw new ViewError(error.message); throw error; }

  const days = WINDOW_DAYS, now = series(state, kind, days), next = series(changed, kind, days);
  const date = (i: number) => addDays(state.today, i), events = timeline(changed, kind, days);
  const lineFor = (event: (typeof events)[number]) => event.pending ? `${event.label} waits in To check and is not counted yet` : event.uncounted ? `${event.label}: amount not known` : `${event.label} ${event.amount < 0 ? "−" : "+"}${format(Math.abs(event.amount))}`;
  const wordsOn = (i: number) => events.filter(event => event.date === date(i)).map(lineFor);
  const dayWords = next.map((_, i) => ({ date: date(i), label: longDay(date(i)), lines: wordsOn(i).length ? wordsOn(i) : ["Nothing scheduled"] }));
  const withLabel = late ? `If ${client!.name.split(" ")[0]} pays ${late.days} ${late.days === 1 ? "day" : "days"} later` : "With this spend", nowLabel = "As things are now";
  const markIndex = late ? -1 : daysBetween(state.today, spendDate);
  const data = stepLine({
    startDate: state.today, currency, lowLine: "main", sub: [], dayWords, band: null,
    lines: [{ key: "main", label: withLabel, tone: "main", points: next.map(toMinor) }, { key: "ghost", label: nowLabel, tone: "ghost", points: now.map(toMinor) }],
    marks: markIndex > 0 && markIndex < days ? [{ index: markIndex, label: "Your spend" }] : [],
    direct: [{ line: "main", text: withLabel }, { line: "ghost", text: nowLabel }],
  });

  const loWith = low(next, state.today), loNow = low(now, state.today);
  // The facts first (D79), in the case the change moves: a spend moves the late case, a client N days later moves as usual. The line reads them back.
  const c = kind === "worst" ? "late" as const : "as_usual" as const, from = "what_if", money_ = { from, currency, case: c };
  const facts: Fact[] = [
    engineFact("low_point_after_change", toMinor(loWith.amount), money_), engineFact("low_point_day_after_change", loWith.date, { from, case: c }),
    engineFact("low_point_before_change", toMinor(loNow.amount), money_), engineFact("low_point_day_before_change", loNow.date, { from, case: c }),
  ];
  if (loWith.amount < 0) facts.push(engineFact("short", toMinor(-loWith.amount), money_));
  if (loNow.amount < 0) facts.push(engineFact("short", toMinor(-loNow.amount), money_));
  if (late) facts.push(personFact("days_later_than_usual", late.days, { from, case: "as_usual", about: { type: "client", id: client!.id, name: client!.name } }));
  else facts.push(personFact("amount_tested", amountMinor!, { from, currency, period: { on: spendDate } }));
  const read = (name: "low_point_after_change" | "low_point_day_after_change" | "low_point_before_change" | "low_point_day_before_change") => fact(facts, name, c)!.value;
  const [withMinor, withDay, nowMinor, nowDay] = [Number(read("low_point_after_change")), String(read("low_point_day_after_change")), Number(read("low_point_before_change")), String(read("low_point_day_before_change"))];
  const phrase = (minor: number, day: string) => minor < 0 ? `${money(-minor)} short on ${longDay(day)}` : `lowest ${money(minor)} on ${longDay(day)}`;
  const eventDays = new Set(events.map(event => event.date));
  const table: TableTwin = {
    caption: "What if, by day", head: ["Day", "What happens", "With the change", nowLabel], foot: null, align: ["end", "start", "end", "end"],
    rows: next.map((_, i) => i).filter(i => i === 0 || eventDays.has(date(i)) || next[i] !== next[i - 1] || now[i] !== now[i - 1]).map(i => ({ key: date(i), cells: [longDay(date(i)), dayWords[i].lines.join("; "), format(next[i]), format(now[i])] })),
  };
  return {
    ...base, data, table, empty: null,
    facts,
    line: `With it: ${phrase(withMinor, withDay)}. Now: ${phrase(nowMinor, nowDay)}.`,
    aria: `Cash for the next ${days} days with the change, against as things are now. With it you are ${phrase(withMinor, withDay)}; now you are ${phrase(nowMinor, nowDay)}. Use the left and right arrow keys to look at each day.`,
  };
};

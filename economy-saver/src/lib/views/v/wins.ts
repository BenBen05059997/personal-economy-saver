// What our choices saved (D81, D77): each month's wins, the ones found in the records and the ones the person said, and the medals. Pure; every amount integer minor units.
// What choices saved is never money set aside and the two are never added: this view never states money set aside.
import { engineFact, type Fact } from "@/lib/money/facts";
import { dayLabel, minorMoney, plural } from "@/lib/money/format";
import { foundWins, medalAbout, medals, medalTitle, milestones, monthWins, personalBests, type MonthWins } from "@/lib/money/saving";
import { HISTORY_MONTHS, monthBounds, monthLabel, monthName, monthPeriod, monthsBack, spendingItems } from "@/lib/money/spending";
import { labelOf } from "@/lib/money/terms";
import { VIEW_META } from "../catalogue";
import { monthAxisLabel, monthRowLabel, SO_FAR } from "../words";
import { ViewError, type Resolver, type ViewResult } from "../types";

const EMPTY = "Choices that save show here: a regular cost that went down, a month under your usual, or a cheaper choice you tell Ask.";

export const winsView: Resolver<"wins"> = (args, ctx): ViewResult => {
  const { spending, moves, choices, state } = ctx;
  if (!spending) throw new ViewError("Spending is not loaded for this view.");
  if (!moves) throw new ViewError("Pot moves are not loaded for this view.");
  if (!choices) throw new ViewError("Choices are not loaded for this view.");
  const meta = VIEW_META.wins, currency = spending.homeCurrency, today = state.today, format = (minor: number) => minorMoney(minor, currency);
  const record = { moves, choices };
  const current = today.slice(0, 7), count = args.months ?? 6;
  const items = spendingItems(spending, monthBounds(monthsBack(current, HISTORY_MONTHS)).first, monthBounds(current).last);
  // The span: the last `count` months, the current one included. Found wins come from closed months only, so this month holds what was said and kept so far.
  const span = Array.from({ length: count }, (_, i) => monthsBack(current, count - i));
  const found = span.filter(month => month < current).flatMap(month => foundWins(items, currency, month, record, today));
  const months = span.map(month => ({ month, name: monthName(month), current: month === current, wins: monthWins(record, found, month) }));
  const base = { view: "wins" as const, args: args as Record<string, unknown>, form: meta.form as "stacked_columns", title: "What your choices saved", question: meta.question, hint: meta.hint, currency, strip: null, source: "Your spending records and the choices you told fipa about" };
  const total = months.reduce((sum, month) => sum + month.wins.totalMinor, 0), n = months.reduce((sum, month) => sum + month.wins.count, 0);

  // Medals: every level earned, and what is still to go to the next of each kind. Totals, never a run. A goal reached or months set aside
  // earn them before any choice, so they are stated even when no month has a win.
  const all = medals(record, state.pots), medalFacts: Fact[] = [];
  for (const medal of all) {
    const about = medalAbout(medal);
    if (medal.earnedOn !== null) medalFacts.push(engineFact("medal_earned_on", medal.earnedOn, { from: "wins", about }));
    else if (medal.toGo !== null) medalFacts.push(medal.kind === "choices" ? engineFact("next_medal_at", medal.toGo, { from: "wins", currency, about }) : engineFact("next_medal_count", medal.toGo, { from: "wins", about }));
  }
  const { goalDays, monthDays } = milestones(record, state.pots), goals = goalDays.length, setAsideMonths = monthDays.length;
  if (goals > 0) medalFacts.push(engineFact("goals_reached", goals, { from: "wins" }));
  if (setAsideMonths > 0) medalFacts.push(engineFact("months_set_aside", setAsideMonths, { from: "wins" }));
  const newest = all.filter(medal => medal.earnedOn !== null && medal.earnedOn >= `${span[0]}-01`).sort((a, b) => (a.earnedOn! < b.earnedOn! ? 1 : a.earnedOn! > b.earnedOn! ? -1 : b.level - a.level))[0];
  const medalLine = newest ? `New medal: ${medalTitle(newest)}, earned ${dayLabel(newest.earnedOn!)}.` : "";
  if (n === 0) return { ...base, data: null, table: null, line: null, aria: "No choices to show yet.", facts: medalFacts, empty: { words: medalLine ? `${medalLine} ${EMPTY}` : EMPTY, add: null, addLabel: null } };

  // The facts first (D79); the sentence is written from them.
  const span2 = { from: monthPeriod(span[0]).from, to: monthPeriod(current).to };
  const facts: Fact[] = [];
  const money = (name: "choices_saved" | "found_win" | "said_win" | "usual_spending", minor: number, period: { from: string; to: string }, about?: Fact["about"]) =>
    engineFact(name, minor, { from: "wins", currency, period, ...(about && { about }) });
  for (const month of months) {
    if (month.wins.count === 0) continue;
    const period = monthPeriod(month.month);
    facts.push(money("choices_saved", month.wins.totalMinor, period), money("found_win", month.wins.foundMinor, period), money("said_win", month.wins.saidMinor, period), engineFact("win_count", month.wins.count, { from: "wins", period }));
    for (const choice of month.wins.said) facts.push(money("said_win", choice.minor, period, { type: "choice", id: choice.id, name: choice.words }));
    for (const choice of month.wins.kept) facts.push(money("found_win", choice.minor, period, { type: "choice", id: choice.id, name: choice.words }));
    for (const win of month.wins.fresh) {
      const about = { type: "choice" as const, id: win.key, name: win.label };
      facts.push(money("found_win", win.winMinor, period, about));
      if (win.kind === "under_usual") facts.push(money("usual_spending", win.baselineMinor, period, about));
    }
  }
  facts.push(money("choices_saved", total, span2), engineFact("win_count", n, { from: "wins", period: span2 }), ...medalFacts);
  const closed = monthsBack(current, 2), bests = personalBests(record, items, currency, closed, today);
  if (bests.choices) facts.push(engineFact("best_month_choices", bests.choices.minor, { from: "wins", currency, period: monthPeriod(bests.choices.month) }));

  // The sentence: the latest month in the span with a win.
  const latest = [...months].reverse().find(month => month.wins.count > 0)!, w: MonthWins = latest.wins;
  const when = `${monthLabel(latest.month, today)}${latest.current ? ` ${SO_FAR}` : ""}`;
  const split = w.foundMinor > 0 && w.saidMinor > 0 ? `: ${format(w.foundMinor)} found in your records and about ${format(w.saidMinor)} you said`
    : w.foundMinor > 0 ? ", all found in your records" : ", all you said";
  const line = `In ${when} your choices saved about ${format(w.totalMinor)} (${plural(w.count, "choice")})${split}.${medalLine ? ` ${medalLine}` : ""}`;

  const columns = months.map(month => {
    const parts = [month.wins.foundMinor, month.wins.saidMinor], tot = month.wins.totalMinor;
    return { key: month.month, label: monthAxisLabel(month.name, month.current), parts, total: tot, totalLabel: format(tot), current: month.current,
      aria: `${month.name}: your choices saved about ${format(tot)}${month.current ? ` ${SO_FAR}` : ""}. ${format(parts[0])} found in your records, about ${format(parts[1])} you said.` };
  });
  return {
    ...base, empty: null, facts, line,
    data: { segments: [{ key: "found", legend: labelOf("found_win").replace(/^./, c => c.toUpperCase()), tone: "main" }, { key: "said", legend: labelOf("said_win").replace(/^./, c => c.toUpperCase()), tone: "soft" }], columns, refs: [] },
    table: { caption: "What your choices saved, by month", head: ["Month", "Found in your records", "You said", "Together"], foot: ["Together", format(months.reduce((s, m) => s + m.wins.foundMinor, 0)), format(months.reduce((s, m) => s + m.wins.saidMinor, 0)), format(total)],
      rows: months.map(month => ({ key: month.month, cells: [monthRowLabel(month.name, month.month, month.current), format(month.wins.foundMinor), format(month.wins.saidMinor), format(month.wins.totalMinor)] })) },
    aria: "What your choices saved each month, found in your records and said by you. Use Tab to move between months.",
  };
};

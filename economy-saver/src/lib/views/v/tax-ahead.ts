// Will the pot cover the tax bills? (D77) The pot's day-by-day amount against the Government & tax bills due, from the engine's `taxAhead`. Pure; integer minor units.
import { addDays } from "@/lib/money/dates";
import { engineFact, type Fact } from "@/lib/money/facts";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { TAX_AHEAD_DAYS, taxAhead } from "@/lib/money/tax-ahead";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type ViewResult } from "../types";
import { longDay, stepLine } from "./forecast";

export const taxAheadView: Resolver<"tax_ahead"> = (args, ctx): ViewResult => {
  const { state } = ctx, pot = state.pots.find(row => row.id === args.potId), days = args.days ?? TAX_AHEAD_DAYS;
  if (!pot) throw new ViewError("I couldn't find that pot.");
  const meta = VIEW_META.tax_ahead, currency = state.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const base = { view: "tax_ahead" as const, args: args as Record<string, unknown>, form: meta.form as "step_line", title: `${pot.name}: tax ahead`, question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "The pot, your open invoices on their usual pay days and your Government & tax bills" };
  const none = (words: string, add: "bill" | null, addLabel: string | null) => ({ ...base, data: null, table: null, line: null, aria: "No tax picture yet.", facts: [] as Fact[], empty: { words, add, addLabel } });
  const ahead = taxAhead(state, args.potId, days);
  if (!ahead) return none("Set a fill rule on this pot to see the tax ahead.", null, null);
  if (ahead.taxBills.length === 0) return none("Add your tax bills (Government & tax) to see whether this pot covers them.", "bill", "Add a bill");

  const date = (i: number) => addDays(state.today, i);
  const counted = ahead.taxBills.filter(bill => bill.counted), pending = ahead.taxBills.filter(bill => bill.pending);
  const words = (i: number) => [
    ...ahead.steps.filter(step => step.index === i).map(step => `${step.client}${step.number ? ` ${step.number}` : ""} pays: ${format(step.addMinor)} goes into the pot`),
    ...ahead.taxBills.filter(bill => bill.index === i).map(bill => bill.pending ? `${bill.biller} ${format(bill.amountMinor)} waits in To check and is not counted yet` : `${bill.biller} ${format(bill.amountMinor)} is due`),
  ];
  const dayWords = ahead.pot.map((_, i) => ({ date: date(i), label: longDay(date(i)), lines: words(i).length ? words(i) : ["Nothing scheduled"] }));
  const { low } = ahead, lowDate = date(low.index), lowWords = longDay(lowDate);
  const lines = [
    { key: "main", label: "In the pot", tone: "main" as const, points: ahead.pot },
    { key: "quiet", label: "Tax bills due so far", tone: "quiet" as const, points: ahead.bills },
  ];
  const data = stepLine({
    startDate: state.today, currency, lines, band: null, lowLine: "main", sub: [], dayWords,
    marks: ahead.taxBills.map(bill => ({ index: bill.index, label: `${bill.biller} ${format(bill.amountMinor)}${bill.pending ? " (not counted yet)" : ""} due ${dayLabel(bill.date)}` })),
    direct: lines.map(l => ({ line: l.key, text: l.label })),
  });
  data.xTicks = data.xTicks.filter((_, i) => i % 2 === 0); // the panel is narrow: a date every four weeks
  // The first day the bills pass the pot, or the day with the least to spare (the pot's own line carries the dot).
  data.low = { line: "main", index: low.index, minor: ahead.pot[low.index], short: low.short, sub: [], label: low.short ? `Short ${format(low.shortMinor)} on ${lowWords}` : `${format(low.marginMinor)} to spare on ${lowWords}` };

  const through = counted.length ? counted[counted.length - 1].date : date(days - 1);
  const line = low.short ? `The pot is ${format(low.shortMinor)} short of the tax bills on ${dayLabel(lowDate)}.` : `The pot covers the tax bills through ${dayLabel(through)}.`;
  const note = pending.length ? ` ${pending.map(bill => bill.biller).join(" and ")} waits in To check and is not counted yet.` : "";
  const eventDays = new Set(ahead.taxBills.map(bill => bill.index).concat(ahead.steps.map(step => step.index)));
  const rows = ahead.pot.map((_, i) => i).filter(i => i === 0 || eventDays.has(i));
  const potAbout = { type: "pot" as const, id: pot.id, name: pot.name }, billAbout = (bill: (typeof ahead.taxBills)[number]) => ({ type: "bill" as const, id: bill.id, name: bill.biller });
  const facts: Fact[] = [
    engineFact("pot", ahead.pot[0], { from: "tax_ahead", currency, about: potAbout }),
    ...(low.short ? [
      engineFact("tax_ahead", low.shortMinor, { from: "tax_ahead", currency, about: potAbout }),
      engineFact("tax_short_on", lowDate, { from: "tax_ahead", about: potAbout }),
      // The bill that makes the pot short: the one due on that day.
      ...ahead.taxBills.filter(bill => bill.index === low.index).flatMap(bill => bill.counted
        ? [engineFact("bill_amount", bill.amountMinor, { from: "tax_ahead", currency, about: billAbout(bill), period: { on: bill.date } }), engineFact("due", bill.date, { from: "tax_ahead", about: billAbout(bill) })]
        : [engineFact("not_counted", 1, { from: "tax_ahead", about: billAbout(bill) })]),
    ] : [engineFact("tax_covered_through", through, { from: "tax_ahead" })]),
    ...pending.filter(bill => !(low.short && bill.index === low.index)).map(bill => engineFact("not_counted", 1, { from: "tax_ahead", about: billAbout(bill) })),
  ];
  return {
    ...base, data, empty: null, line: line + note, facts,
    table: {
      caption: `${pot.name} against the tax bills`, head: ["Day", "What happens", "In the pot", "Tax bills so far"], foot: null, align: ["start", "end", "end"],
      rows: rows.map(i => ({ key: date(i), cells: [longDay(date(i)), dayWords[i].lines.join("; "), format(ahead.pot[i]), format(ahead.bills[i])] })),
    },
    aria: `${pot.name} against the tax bills for the next ${days} days. ${low.short ? `The pot is ${format(low.shortMinor)} short on ${lowWords}.` : `The pot covers the tax bills counted so far.`} Use the left and right arrow keys to look at each day.`,
  };
};

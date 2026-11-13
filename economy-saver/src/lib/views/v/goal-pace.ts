// A goal's pace (D66, D77): what is saved against where the goal expects you to be today, and when this pace reaches it. Pure; integer minor units.
import { dayLabel, minorMoney } from "@/lib/money/format";
import { goalPace } from "@/lib/money/goals";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type ViewResult } from "../types";

const dated = (iso: string, today: string) => iso.slice(0, 4) === today.slice(0, 4) ? dayLabel(iso) : `${dayLabel(iso)}, ${iso.slice(0, 4)}`;

export const goalPaceView: Resolver<"goal_pace"> = (args, ctx): ViewResult => {
  const { state } = ctx, pot = state.pots.find(row => row.id === args.potId);
  if (!pot) throw new ViewError("I couldn't find that pot.");
  const meta = VIEW_META.goal_pace, currency = state.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const base = { view: "goal_pace" as const, args: args as Record<string, unknown>, form: meta.form as "goal_line", title: `${pot.name}: its pace`, question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "What is saved in the pot and the target date you set" };
  const goal = goalPace(pot, state);
  if (!goal) return { ...base, data: null, table: null, line: null, aria: "This pot has no goal.", figures: {}, empty: { words: "Give this pot a target and a date to see its pace.", add: null, addLabel: null } };
  const day = (iso: string) => dated(iso, state.today);
  const reached = goal.neededMinor === 0;
  const projection = goal.reachedOn ? { date: goal.reachedOn, minor: goal.targetMinor, label: reached ? "Target reached" : `At this pace: ${day(goal.reachedOn)}` } : null;
  const data = {
    start: { date: goal.startedOn, minor: 0 },
    target: { date: goal.targetDate, minor: goal.targetMinor, label: `${format(goal.targetMinor)} by ${day(goal.targetDate)}` },
    today: { date: state.today, minor: goal.savedMinor, label: `Saved ${format(goal.savedMinor)}` },
    expected: { minor: goal.expectedMinor, label: `Expected by today ${format(goal.expectedMinor)}` },
    projection,
  };
  const word = goal.deltaMinor === 0 ? "On pace" : goal.deltaMinor < 0 ? `${format(-goal.deltaMinor)} behind pace` : `${format(goal.deltaMinor)} ahead of pace`;
  return {
    ...base, data, empty: null, line: goal.summary,
    table: {
      caption: `${pot.name}: its pace`, head: ["", "Amount", "Date"], align: ["end", "start"], foot: null,
      rows: [
        { key: "saved", cells: ["Saved so far", format(goal.savedMinor), day(state.today)] },
        { key: "expected", cells: ["Expected by today", format(goal.expectedMinor), day(state.today)] },
        { key: "target", cells: ["Target", format(goal.targetMinor), day(goal.targetDate)] },
        { key: "pace", cells: ["At this pace", format(goal.targetMinor), goal.reachedOn ? day(goal.reachedOn) : "Not available yet"] },
      ],
    },
    aria: `${pot.name}: ${reached ? "target reached" : `${format(goal.savedMinor)} saved of ${format(goal.targetMinor)}, ${word.toLowerCase()}`}.`,
    figures: { targetMinor: goal.targetMinor, savedMinor: goal.savedMinor, neededMinor: goal.neededMinor, expectedMinor: goal.expectedMinor, deltaMinor: goal.deltaMinor, behindMinor: Math.max(0, -goal.deltaMinor), aheadMinor: Math.max(0, goal.deltaMinor), monthlyNeededMinor: goal.monthlyNeededMinor, reachedOn: goal.reachedOn, targetDate: goal.targetDate },
  };
};

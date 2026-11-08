import type { Currency } from "@/lib/catalogue/types";
import { dayLabel, minorMoney, minorPerUnit } from "./format";
import { monthsUntil } from "./plan";
import { addDays, daysBetween } from "./runway";
import type { MoneyState, Pot } from "./types";

type GoalClock = Pick<MoneyState, "today" | "homeCurrency">;

export type GoalPace = {
  id: string;
  name: string;
  currency: Currency;
  startedOn: string;
  targetDate: string;
  targetMinor: number;
  savedMinor: number;
  neededMinor: number;
  expectedMinor: number;
  deltaMinor: number;
  monthlyNeededMinor: number;
  reachedOn: string | null;
  paceLine: string;
  summary: string;
};

/** The target builds evenly from the day the pot was created. The forecast uses actual saving since that date. */
export function goalPace(pot: Pot, state: GoalClock): GoalPace | null {
  if (pot.target === undefined || !pot.targetDate) return null;
  const { today, homeCurrency: currency } = state;
  const startedOn = pot.startedOn ?? today;
  const targetDate = pot.targetDate;
  const unit = minorPerUnit(currency);
  const targetMinor = Math.round(pot.target * unit);
  const savedMinor = Math.round(pot.saved * unit);
  const neededMinor = Math.max(0, targetMinor - savedMinor);
  const elapsed = Math.max(0, daysBetween(startedOn, today));
  const duration = Math.max(1, daysBetween(startedOn, targetDate));
  const expectedMinor = targetDate <= today ? targetMinor : Math.ceil(targetMinor * Math.min(elapsed, duration) / duration);
  const deltaMinor = savedMinor - expectedMinor;
  const monthlyNeededMinor = Math.ceil(neededMinor / monthsUntil(today, targetDate));
  const remainingDays = elapsed > 0 && savedMinor > 0 ? Math.ceil(neededMinor * elapsed / savedMinor) : Infinity;
  const reachedOn = neededMinor === 0 ? today : remainingDays <= daysBetween(today, "9999-12-31") ? addDays(today, remainingDays) : null;
  const money = (value: number) => minorMoney(value, currency);
  let paceLine = "Target reached.";
  let summary = paceLine;
  if (neededMinor > 0) {
    const pace = deltaMinor === 0 ? "On pace." : money(Math.abs(deltaMinor)) + (deltaMinor < 0 ? " behind pace." : " ahead of pace.");
    const required = targetDate <= today
      ? "The target date has arrived. " + money(neededMinor) + " still to set aside."
      : money(monthlyNeededMinor) + " a month to reach " + money(targetMinor) + " by " + dayLabel(targetDate) + ".";
    paceLine = "By today: " + money(expectedMinor) + ". " + pace
      + (reachedOn ? " At this pace: " + dayLabel(reachedOn) + ", " + reachedOn.slice(0, 4) + "." : " A date at this pace is not available yet.");
    summary = paceLine + " " + required;
  }
  return { id: pot.id, name: pot.name, currency, startedOn, targetDate, targetMinor, savedMinor, neededMinor, expectedMinor,
    deltaMinor, monthlyNeededMinor, reachedOn, paceLine, summary };
}

export function goalPaces(state: Pick<MoneyState, "pots" | "today" | "homeCurrency">): GoalPace[] {
  return state.pots.flatMap(pot => {
    const pace = goalPace(pot, state);
    return pace ? [pace] : [];
  });
}

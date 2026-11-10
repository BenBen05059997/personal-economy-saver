// Planning maths for pots (D43). Pure functions over a MoneyState: no React, no clock, no I/O.
// Amounts are in the state's home currency units, as everywhere in the engine (whole yen; dollars with cents for USD).

import { addMonths } from "./dates";
import { MONTHS, minorMoney, minorPerUnit } from "./format";
import { availableCash, moneyInPots, series } from "./runway";
import { expectsClientPayment } from "./sentence";
import type { MoneyState, Pot } from "./types";

export { addMonths };

const unit = (state: MoneyState) => minorPerUnit(state.homeCurrency);

/** Whole months from `from` to `to` (the most whole months that fit), never less than 1. */
export function monthsUntil(from: string, to: string): number {
  let m = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  if (addMonths(from, m) > to) m -= 1;
  return Math.max(1, m);
}

/**
 * What the next 30 days leave over if clients pay as usual: the expected-case balance at the end of the 30-day window
 * less the cash it starts from (which already excludes money in pots). Negative when the month is a net outflow.
 */
export function monthlyRoom(state: MoneyState): number {
  const expected = series(state, "expected");
  const end = expected[expected.length - 1];
  return Math.round((end - availableCash(state)) * unit(state)) / unit(state);
}

type PlanInput = {
  target: number;
  saved: number;
  targetDate?: string; // YYYY-MM-DD
  monthly?: number; // a pace to test; when absent and there is room, the room is the pace
};

type Plan = {
  needed: number; // still to set aside
  monthlyRoom: number;
  months?: number; // whole months to the target date (at least 1), when there is a date
  monthlyNeeded?: number; // needed per month to arrive on the target date
  fits?: boolean; // monthlyNeeded is within monthlyRoom
  pace?: number; // the monthly amount behind reachedOn: the one given, else the room when positive
  monthsAtPace?: number;
  reachedOn?: string; // the date the target is reached at that pace
};

export function planFor(input: PlanInput, state: MoneyState): Plan {
  const u = unit(state);
  const needed = Math.max(0, Math.round((input.target - input.saved) * u) / u);
  const room = monthlyRoom(state);
  const plan: Plan = { needed, monthlyRoom: room };
  if (input.targetDate) {
    const months = monthsUntil(state.today, input.targetDate);
    const monthlyNeeded = Math.ceil(Math.round(needed * u) / months) / u;
    Object.assign(plan, { months, monthlyNeeded, fits: monthlyNeeded <= Math.max(room, 0) });
  }
  const pace = input.monthly !== undefined && input.monthly > 0 ? input.monthly : room > 0 ? room : undefined;
  if (pace !== undefined) {
    const monthsAtPace = needed === 0 ? 0 : Math.ceil(Math.round(needed * u) / Math.round(pace * u));
    Object.assign(plan, { pace, monthsAtPace, reachedOn: addMonths(state.today, monthsAtPace) });
  }
  return plan;
}

/** "2027-03-31" -> "Mar 2027" */
export const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** The one-line answer, built here so the screen and the agent say the same words and numbers. */
export function planLine(input: PlanInput, plan: Plan, state: MoneyState): string {
  const money = (n: number) => minorMoney(Math.round(n * unit(state)), state.homeCurrency);
  const room = roomClause(state).slice(0, -1);
  if (plan.needed === 0) return `Nothing more to set aside: ${money(input.target)} is already there.`;
  const parts: string[] = [];
  if (plan.monthlyNeeded !== undefined && input.targetDate) {
    parts.push(`${money(plan.monthlyNeeded)} a month to reach ${money(input.target)} by ${monthYear(input.targetDate)}.`);
    parts.push(`${room}, so it ${plan.fits ? "fits" : "does not fit"}.`);
  }
  if (plan.reachedOn !== undefined && plan.pace !== undefined && (input.monthly !== undefined || !input.targetDate)) {
    const source = input.monthly !== undefined ? "" : " (what the next 30 days leave)";
    parts.push(`At ${money(plan.pace)} a month${source} you would reach ${money(input.target)} around ${monthYear(plan.reachedOn)}.`);
  }
  if (!parts.length) parts.push(`${room}, so there is no date to give for ${money(input.target)}.`);
  return parts.join(" ");
}

/** The short line under a goal pot on the Plan page: what it takes by its date, or where the current pace gets it. Undefined for a pot with no target. */
export function potLine(pot: Pot, state: MoneyState): string | undefined {
  if (pot.target === undefined) return undefined;
  const money = (n: number) => minorMoney(Math.round(n * unit(state)), state.homeCurrency);
  const request: PlanInput = { target: pot.target, saved: pot.saved, ...(pot.targetDate && { targetDate: pot.targetDate }) };
  const plan = planFor(request, state);
  if (plan.needed === 0) return "Target reached";
  if (plan.monthlyNeeded !== undefined && pot.targetDate) {
    return `${money(plan.monthlyNeeded)} a month to reach ${money(pot.target)} by ${monthYear(pot.targetDate)}. ${plan.fits ? "Fits within" : "More than"} what the next 30 days leave.`;
  }
  if (plan.reachedOn !== undefined && plan.pace !== undefined) return `At ${money(plan.pace)} a month you would reach ${money(pot.target)} around ${monthYear(plan.reachedOn)}.`;
  return "The next 30 days leave nothing over yet, so there is no date to give.";
}

/** What the next 30 days leave, as a sentence that planLine can continue ("…, so it fits"). */
function roomClause(state: MoneyState): string {
  const room = monthlyRoom(state);
  return room > 0
    ? `The next 30 days leave about ${minorMoney(Math.round(room * unit(state)), state.homeCurrency)} if clients pay as usual.`
    : "The next 30 days leave nothing over if clients pay as usual.";
}

/** The sentence at the top of the Plan page. With no client payment expected, it says the plan counts the bank balance only. */
export function roomLine(state: MoneyState): string {
  return expectsClientPayment(state)
    ? roomClause(state)
    : "No client payments are expected in the next 30 days, so the plan counts your bank balance only.";
}

/**
 * Under the room line: what the number counts, so it is not read as safe to spend (Home's lowest balance if clients are late).
 * monthlyRoom is the expected-case balance at the end of 30 days less today's cash: client payments at their usual dates
 * less every confirmed bill and card statement in the window. Undefined when roomLine says the plan counts the bank only.
 */
export function roomNote(state: MoneyState): string | undefined {
  return expectsClientPayment(state)
    ? "What client payments bring in over the next 30 days, after every bill and card statement, if clients pay as usual. It leaves out today’s balance and comes before anything goes into pots."
    : undefined;
}

/** Under the room line: how much is set aside and so left out of safe to spend. Undefined with no money in pots. */
export function moneyInPotsLine(state: MoneyState): string | undefined {
  const total = moneyInPots(state);
  return total > 0 ? `${minorMoney(Math.round(total * unit(state)), state.homeCurrency)} is set aside in pots and is not counted as safe to spend.` : undefined;
}

/** One quiet line for Home: "Tax ¥15,000 set aside" or "Car ¥200,000 of ¥1,200,000 · by Mar 2027". */
export function potSummary(pot: Pot, state: MoneyState): string {
  const money = (n: number) => minorMoney(Math.round(n * unit(state)), state.homeCurrency);
  return pot.target === undefined
    ? `${pot.name} ${money(pot.saved)} set aside`
    : `${pot.name} ${money(pot.saved)} of ${money(pot.target)}${pot.targetDate ? ` · by ${monthYear(pot.targetDate)}` : ""}`;
}

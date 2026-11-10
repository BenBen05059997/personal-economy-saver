// The plan window and how a later day is reached. `loadMoneyState` expands repeating bills only to the end of the plan window (the 30 days
// and every known statement), so Home does no more work than it needs. A question about a later day, up to the two-year horizon
// (horizon.ts), asks `stateThrough` for the same state expanded to that day; nothing is read again from the database.

import { HORIZON_MESSAGE, latestDate } from "./horizon";
import { expandBills } from "./repeat";
import { daysBetween, planWindow, series, timeline } from "./runway";
import type { MoneyState } from "./types";

type SeriesKind = Parameters<typeof series>[1];

/** The state with its bills expanded through `through`; the state itself when its window already reaches that day. A day before today or past the two-year horizon is refused. */
export function stateThrough(state: MoneyState, through: string): MoneyState {
  if (through < state.today) throw new Error("That day has already passed");
  if (through > latestDate(state.today)) throw new Error(HORIZON_MESSAGE);
  if (daysBetween(state.today, through) < planWindow(state)) return state;
  return { ...state, bills: expandBills(state.storedBills, state.today, through, state.homeCurrency) };
}

export type DayView = {
  date: string;
  balance: number; // the series balance at the end of that day, home units
  events: ReturnType<typeof timeline>; // that day's dated events, money in first
};

/** What is due on one day and the balance at its end, for any day from today to the horizon. */
export function dayView(state: MoneyState, kind: SeriesKind, date: string): DayView {
  const expanded = stateThrough(state, date);
  const days = daysBetween(state.today, date) + 1;
  return { date, balance: series(expanded, kind, days)[days - 1], events: timeline(expanded, kind, days).filter(event => event.date === date) };
}

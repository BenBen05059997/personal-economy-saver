// Spending added up day by day, this month against the month before (D73, D77). Pure: the bills and charges the month view reads, counted by the day they fall.
import { monthBounds, monthsBack, spendingItems, type SpendingInput } from "./spending";

export type MonthPace = {
  month: string; previous: string; // YYYY-MM
  days: number; // the longer of the two months, in days
  thisPoints: number[]; // running total at the end of each day, through today (the whole month when it is over); integer minor units
  lastPoints: number[]; // the month before, the whole month
  todayIndex: number | null; // the index of today in thisPoints, null for a month that is over
  thisSoFarMinor: number; lastSoFarMinor: number; // both to the same day of the month
  lastTotalMinor: number;
};

const dayCount = (month: string) => Number(monthBounds(month).last.slice(8, 10));

/** The running total of the items dated in `month`, one value per day from the 1st for `length` days. */
function running(input: SpendingInput, month: string, length: number): number[] {
  const { first, last } = monthBounds(month), byDay = new Array<number>(dayCount(month)).fill(0);
  for (const item of spendingItems(input, first, last)) if (!item.uncounted) byDay[Number(item.date.slice(8, 10)) - 1] += item.amountMinor;
  let total = 0;
  return byDay.slice(0, length).map(amount => (total += amount));
}

/**
 * `month` (default the one `today` is in) against the month before. The first line stops at today in the current month and runs to the month's
 * end in a past one; a month that has not begun has no points. A bill still to come is not in it: it is not spent yet.
 */
export function monthPace(input: SpendingInput, today: string, month: string = today.slice(0, 7)): MonthPace {
  const previous = monthsBack(month, 2), current = today.slice(0, 7);
  const elapsed = month < current ? dayCount(month) : month === current ? Number(today.slice(8, 10)) : 0;
  const thisPoints = running(input, month, elapsed), lastPoints = running(input, previous, dayCount(previous));
  const same = Math.min(elapsed, lastPoints.length);
  return {
    month, previous, days: Math.max(dayCount(month), lastPoints.length), thisPoints, lastPoints,
    todayIndex: month === current ? elapsed - 1 : null,
    thisSoFarMinor: thisPoints[elapsed - 1] ?? 0,
    lastSoFarMinor: same > 0 ? lastPoints[same - 1] : 0,
    lastTotalMinor: lastPoints[lastPoints.length - 1] ?? 0,
  };
}

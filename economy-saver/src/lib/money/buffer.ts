// How many months the cash you can spend would last (D77): spendable cash over the average of the last three full months of spending. Pure.
import { availableCash } from "./runway";
import { minorPerUnit } from "./format";
import type { TrendMonth } from "./look-by";
import type { MoneyState } from "./types";

export const BUFFER_MONTHS_AVERAGED = 3;
/** The marks drawn on the bar: the usual guide's two ends. Information, not a target. */
export const BUFFER_MARKS = [3, 6] as const;
/** The guide under the bar; it names where the marks come from. */
export const BUFFER_GUIDE = "The usual guide is 3–6 months; 9–12 for a variable income.";

export type Buffer = { months: number; cashMinor: number; monthlyMinor: number; basis: { month: string; name: string; minor: number }[] };

/** Null until a past month with spending exists. `months` is cash ÷ the average a month, to one decimal, and 0 when there is no cash. */
export function bufferMonths(state: MoneyState, trend: TrendMonth[]): Buffer | null {
  const basis = trend.filter(month => !month.current && month.total > 0).slice(-BUFFER_MONTHS_AVERAGED).map(month => ({ month: month.month, name: month.name, minor: month.total }));
  if (basis.length === 0) return null;
  const monthlyMinor = Math.round(basis.reduce((sum, month) => sum + month.minor, 0) / basis.length);
  if (monthlyMinor <= 0) return null;
  const cashMinor = Math.round(availableCash(state) * minorPerUnit(state.homeCurrency));
  return { months: Math.max(0, Math.round((cashMinor / monthlyMinor) * 10) / 10), cashMinor, monthlyMinor, basis };
}

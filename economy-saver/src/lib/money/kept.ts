// What you kept each month (D77): money in minus spending, for the months where both records exist. Pure; integer minor units.
import type { TrendMonth } from "./look-by";
import type { IncomeRow } from "./types";

export type KeptMonth = { month: string; name: string; current: boolean; incomeMinor: number; spentMinor: number; keptMinor: number; unrated: number };

/**
 * One entry per month of `trend` from the first one that has both a payment received and spending, oldest first. The current month counts what was spent so far.
 * Kept is money in minus spent and can be below zero. A payment with no rate to the home currency is counted in `unrated`, never as money in.
 */
export function keptByMonth(income: IncomeRow[], trend: TrendMonth[]): KeptMonth[] {
  const months = trend.map((month): KeptMonth => {
    const paid = income.filter(row => row.paidOn.slice(0, 7) === month.month);
    const incomeMinor = paid.reduce((sum, row) => sum + (row.homeMinor ?? 0), 0);
    return { month: month.month, name: month.name, current: month.current, incomeMinor, spentMinor: month.spent, keptMinor: incomeMinor - month.spent, unrated: paid.filter(row => row.homeMinor === null).length };
  });
  const first = months.findIndex(month => month.incomeMinor > 0 && month.spentMinor > 0);
  return first < 0 ? [] : months.slice(first);
}

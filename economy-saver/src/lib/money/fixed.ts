// Regular costs by month (D54, D77). Pure: each month's spending split into the regular costs (the names `regularCosts` finds) and everything else,
// so the two add up to the month's total in Over time. Moves no money. Integer minor units.
import { regularCosts } from "./regular";
import { monthBounds, monthsBack, spendingItems, nameKey, type SpendingInput } from "./spending";
import { monthTrend } from "./look-by";

export type FixedMonth = { month: string; name: string; current: boolean; regularMinor: number; regularShare: number; /* whole percent of the month's total that is regular */ otherMinor: number; totalMinor: number; biggest: { label: string; amountMinor: number } | null };
export type FixedByMonth = { months: FixedMonth[]; regularCount: number };

/**
 * The last `months` months (six unless asked; 2 to 12), oldest first, the same months Over time draws (an empty past month is left out).
 * A month's regular part is what the regular costs of that same window cost in it; the rest is everything else, counted the same way
 * as `monthTrend` (this month: so far, plus the bills still due in it), so regular + other = the month's `monthTrend` total.
 */
export function fixedByMonth(input: SpendingInput, today: string, months = 6): FixedByMonth {
  const current = today.slice(0, 7), first = monthBounds(monthsBack(current, months)).first, last = monthBounds(current).last;
  const items = spendingItems(input, first, last);
  const regular = regularCosts(items, input.homeCurrency, today, months);
  const keys = new Set(regular.items.map(cost => cost.key));
  const counted = items.filter(item => !item.uncounted && (item.kind === "bill" || item.date <= today));
  return {
    regularCount: regular.items.length,
    months: monthTrend(input, today, months).map(trend => {
      const spent = regular.items.reduce((sum, cost) => sum + (cost.months.find(m => m.month === trend.month)?.amountMinor ?? 0), 0);
      const inMonth = counted.filter(item => item.date.startsWith(trend.month));
      const other = inMonth.filter(item => !keys.has(`${item.category}:${nameKey(item.label)}`)).reduce((sum, item) => sum + item.amountMinor, 0);
      const biggest = regular.items.map(cost => ({ label: cost.label, amountMinor: cost.months.find(m => m.month === trend.month)?.amountMinor ?? 0 })).sort((a, b) => b.amountMinor - a.amountMinor)[0];
      const totalMinor = spent + other;
      return { month: trend.month, name: trend.name, current: trend.current, regularMinor: spent, regularShare: totalMinor > 0 ? Math.round(spent * 100 / totalMinor) : 0, otherMinor: other, totalMinor, biggest: biggest && biggest.amountMinor > 0 ? biggest : null };
    }),
  };
}

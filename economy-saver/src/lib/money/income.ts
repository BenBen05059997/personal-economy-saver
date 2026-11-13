// Money in by month (D77): the paid client invoices of the last months, per client, in the home currency's integer minor units. Pure.
import { monthName, monthsBack } from "./spending";
import type { IncomeRow } from "./types";

export type IncomeMonth = { month: string; name: string; current: boolean; total: number; byClient: Record<string, number> };
export type IncomeByMonth = {
  months: IncomeMonth[]; // oldest first, the current month last
  clients: { id: string; name: string; total: number }[]; // biggest total first (ties by name); only clients with money counted in the range
  /** Money in per completed month, from the first month with a payment to the last completed month; null until one completed month has a payment before it ends. */
  averageMinor: number | null;
  lowest: { month: string; name: string; minor: number } | null; // the lowest completed month in that same span
  unrated: string[]; // clients with a payment whose value in the home currency is not known (never counted as zero)
};

/** Money in for each of the last `months` months (the current one included): per client, the total, the average a month and the lowest completed month. A payment with no known value is named in `unrated` and not counted. */
export function incomeByMonth(rows: readonly IncomeRow[], today: string, months: number): IncomeByMonth {
  const current = today.slice(0, 7), first = monthsBack(current, months);
  const list: IncomeMonth[] = [];
  for (let i = 0, month = first; i < months; i++) {
    list.push({ month, name: monthName(month), current: month === current, total: 0, byClient: {} });
    month = nextMonth(month);
  }
  const byMonth = new Map(list.map(item => [item.month, item]));
  const names = new Map<string, string>(), totals = new Map<string, number>(), unrated = new Set<string>();
  for (const row of rows) {
    const item = byMonth.get(row.paidOn.slice(0, 7));
    if (!item) continue;
    const key = row.clientId ?? row.clientName;
    names.set(key, row.clientName);
    if (row.homeMinor === null) { unrated.add(row.clientName); continue; }
    item.byClient[key] = (item.byClient[key] ?? 0) + row.homeMinor;
    item.total += row.homeMinor;
    totals.set(key, (totals.get(key) ?? 0) + row.homeMinor);
  }
  const clients = [...totals].map(([id, total]) => ({ id, name: names.get(id)!, total })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const start = list.findIndex(item => item.total > 0), done = list.filter((item, i) => i >= start && !item.current);
  const lowest = start < 0 || done.length === 0 ? null : done.reduce((low, item) => (item.total < low.total ? item : low));
  return {
    months: list, clients,
    averageMinor: done.length === 0 ? null : Math.round(done.reduce((sum, item) => sum + item.total, 0) / done.length),
    lowest: lowest && { month: lowest.month, name: lowest.name, minor: lowest.total },
    unrated: [...unrated].sort(),
  };
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

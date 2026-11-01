import { addDays } from "@/lib/money/runway";
import { dayLabel, formatter, group } from "@/lib/money/format";
import type { MoneyState } from "@/lib/money/types";

export { currencySymbol, dayLabel, formatter, group, money, usd, yen } from "@/lib/money/format";

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Money text in the state's home currency: ¥1,200 for Ben, $1,200 for Maya. */
export function homeFormat(m: MoneyState): (n: number) => string {
  return formatter(m.homeCurrency);
}

export function usdCents(n: number): string {
  return "$" + group(Math.trunc(n)) + "." + (Math.round(n * 100) % 100).toString().padStart(2, "0");
}

/** "2026-11-14" -> "Sat, Nov 14" */
export function weekdayLabel(iso: string): string {
  const wd = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
  return `${WEEKDAYS[wd]}, ${dayLabel(iso)}`;
}

/** Name of the month before the one `iso` falls in. */
export function previousMonthName(iso: string): string {
  return MONTHS_LONG[(Number(iso.slice(5, 7)) + 10) % 12];
}

export function dayLabelAt(today: string, index: number): string {
  return dayLabel(addDays(today, index));
}

/** "12,500", "¥12,500" or "12500" -> 12500 (0 when there are no digits). */
export function parseAmount(text: string): number {
  return parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
}

export function shortName(name: string): string {
  return name.split(" ")[0];
}

/** "Nov 14–15" for two dates in one month, "Nov 30–Dec 2" across months, "Nov 14" for one day. */
export function spanLabel(from: string, to: string): string {
  if (from === to) return dayLabel(from);
  return from.slice(0, 7) === to.slice(0, 7) ? `${dayLabel(from)}–${Number(to.slice(8, 10))}` : `${dayLabel(from)}–${dayLabel(to)}`;
}

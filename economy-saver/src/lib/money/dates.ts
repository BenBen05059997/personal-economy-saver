// Calendar dates as YYYY-MM-DD strings, handled in UTC so the maths does not depend on the time zone. The one place
// for add-days, add-months, month-end clamping and month bounds.

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  return new Date(toUtc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b minus a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** The date `day` falls on in the given month (month 1-12, may overflow), clamped to the month's length (31 = month end). */
export function dateIn(year: number, month: number, day: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(Math.max(1, day), last))}`;
}

/** `iso` plus `n` calendar months; a day that does not exist in the target month (Jan 31 + 1) falls on the month's last day. */
export function addMonths(iso: string, n: number): string {
  return dateIn(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) + n, Number(iso.slice(8, 10)));
}

/** True when `value` is YYYY-MM-DD and names a day that exists (no 2026-02-30). Pure: it also runs in the browser. */
export function isCalendarDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]);
}

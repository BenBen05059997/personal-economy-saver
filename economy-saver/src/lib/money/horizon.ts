// How far ahead a bill or a card charge may be dated: two years from the household's today. Shared by the date
// inputs (their `max`) and the server's check, so both draw the line on the same day.

export const HORIZON_MESSAGE = "Choose a date within the next two years";

/** The last date a bill or charge may carry: `today` two years on (29 Feb becomes 28 Feb). */
export function latestDate(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const on = new Date(Date.UTC(y + 2, m - 1, d));
  const real = on.getUTCMonth() === m - 1 ? on : new Date(Date.UTC(y + 2, m, 0));
  return real.toISOString().slice(0, 10);
}

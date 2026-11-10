// How far ahead a bill or a card charge may be dated: two years from the household's today. Shared by the date
// inputs (their `max`) and the server's check, so both draw the line on the same day.

import { addMonths } from "./dates";

export const HORIZON_MESSAGE = "Choose a date within the next two years";

/** The last date a bill or charge may carry: `today` two years on (29 Feb becomes 28 Feb). */
export function latestDate(today: string): string {
  return addMonths(today, 24);
}

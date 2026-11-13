import { HISTORY_MONTHS, monthName, SEARCH_QUERY_MAX } from "@/lib/money/spending";

/** What the address asks Spending for (D53): `?month=YYYY-MM` within the last twelve months and `?q=` a search, both as typed. */
export type SpendingAsk = { today: string; current: string; oldest: string; month: string | string[] | null; query: string | string[] | null };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month to show, or the words that refuse the address's month (then the current month is shown). */
export function chosenMonth(ask: SpendingAsk): { month: string; refusal: string | null } {
  if (ask.month === null || ask.month === ask.current) return { month: ask.current, refusal: null };
  const label = (m: string) => `${monthName(m)} ${m.slice(0, 4)}`;
  if (typeof ask.month !== "string" || !MONTH.test(ask.month) || ask.month < ask.oldest || ask.month > ask.current) {
    return { month: ask.current, refusal: `Spending shows the last ${HISTORY_MONTHS} months, ${label(ask.oldest)} to ${label(ask.current)}. Here is ${monthName(ask.current)}.` };
  }
  return { month: ask.month, refusal: null };
}

/** The search as typed (trimmed), the empty string for none, or the words that refuse it. */
export function chosenQuery(ask: Pick<SpendingAsk, "query">): { query: string; refusal: string | null } {
  if (ask.query === null) return { query: "", refusal: null };
  if (typeof ask.query !== "string") return { query: "", refusal: "Search for one thing at a time." };
  const query = ask.query.trim();
  if (query.length > SEARCH_QUERY_MAX) return { query: "", refusal: `A search is at most ${SEARCH_QUERY_MAX} characters.` };
  return { query, refusal: null };
}

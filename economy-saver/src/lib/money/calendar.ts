// What goes out and what comes in, day by day (D77): the Bills calendar's numbers. Pure; every amount integer minor units of the home currency.
import { minorPerUnit } from "./format";
import { sharedBillsComing } from "./family";
import { addDays, series, timeline, WINDOW_DAYS } from "./runway";
import type { MoneyState } from "./types";

/** One thing on a day. A pending bill waits in To check and is flagged, never counted; an unknown amount is flagged and counts for nothing. */
export type CalendarItem = { label: string; kind: "bill" | "statement" | "arrival"; amountMinor: number; pending?: true; uncounted?: true; estimated?: true;
  /** What the item is about, for the facts: the bill, the card or the client, by id; `open` marks a statement still collecting charges. */
  id: string; cardId?: string; clientId?: string; open?: true };
export type CalendarDay = {
  date: string;
  outMinor: number; // what goes out that day (counted items only)
  inMinor: number; // what clients are expected to pay that day, on their usual days
  short: boolean; // the balance is below zero at the end of the day if clients pay late (the line safe to spend uses)
  items: CalendarItem[];
};

/**
 * The `days` days from today, one row each. Money in is on each client's usual day; `short` is the late series below zero. `whose: "shared"`
 * lists only the shared bills (`sharedBillsComing`): no money in, and no short marks, because the household's cash is not theirs alone to read.
 */
export function calendarDays(state: MoneyState, days: number = WINDOW_DAYS, whose?: "shared"): CalendarDay[] {
  const unit = minorPerUnit(state.homeCurrency), minor = (amount: number) => Math.round(amount * unit);
  const rows: CalendarDay[] = Array.from({ length: days }, (_, i) => ({ date: addDays(state.today, i), outMinor: 0, inMinor: 0, short: false, items: [] }));
  const at = new Map(rows.map(row => [row.date, row]));
  if (whose === "shared") {
    for (const bill of sharedBillsComing(state)) {
      const row = at.get(bill.date);
      if (!row) continue;
      row.items.push({ label: bill.biller, kind: "bill", id: bill.key, amountMinor: bill.amountMinor, ...(bill.estimated && { estimated: true as const }), ...(bill.uncounted && { uncounted: true as const }) });
      if (!bill.uncounted) row.outMinor += bill.amountMinor;
    }
    return rows;
  }
  const late = series(state, "worst", days);
  rows.forEach((row, i) => { row.short = late[i] < 0; });
  for (const event of timeline(state, "expected", days)) {
    const row = at.get(event.date);
    if (!row) continue;
    const amountMinor = Math.abs(minor(event.amount));
    const about = { id: event.id, ...(event.cardId && { cardId: event.cardId }), ...(event.clientId && { clientId: event.clientId }), ...(event.open && { open: true as const }) };
    const flags = { ...(event.pending && { pending: true as const }), ...(event.uncounted && { uncounted: true as const }), ...(event.estimated && { estimated: true as const }) };
    if (event.pending) {
      // A pending bill is shown at the amount it would be, and counted nowhere.
      const bill = state.bills.find(b => b.id === event.id);
      row.items.push({ label: event.label, kind: event.kind, amountMinor: bill ? minor(bill.amount) : amountMinor, ...about, ...flags });
      continue;
    }
    row.items.push({ label: event.label, kind: event.kind, amountMinor, ...about, ...flags });
    if (event.uncounted) continue;
    if (event.amount > 0) row.inMinor += amountMinor; else row.outMinor += amountMinor;
  }
  return rows;
}

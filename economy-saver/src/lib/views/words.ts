// Words several pictures, the canvas and the pages write the same way: an event on a day, a case, a bill that waits for a yes. Pure.
import { AMOUNT_NOT_KNOWN } from "@/lib/money/gaps";
import { CASES } from "@/lib/money/terms";

/** What follows the name of a bill that waits for the person's yes. */
export const WAITS_IN_TO_CHECK = "waits in To check and is not counted yet";
/** A day with nothing on it. */
export const NOTHING_SCHEDULED = "Nothing scheduled";

/** "Hikari Denki ¥11,220 waits in To check and is not counted yet"; the amount is left out when `amount` is. */
export const waitsWords = (label: string, amount?: string) => `${label}${amount === undefined ? "" : ` ${amount}`} ${WAITS_IN_TO_CHECK}`;

/** "Gas bill: amount not known". */
export const notKnownWords = (label: string) => `${label}: ${AMOUNT_NOT_KNOWN}`;

/** One event on a day: a bill that waits, an amount that is not known, or the signed amount (`amount` is in the units `format` writes). `waitingAmount` is the amount shown for a bill that waits. */
export function eventWords(event: { label: string; amount: number; pending?: boolean; uncounted?: boolean }, format: (amount: number) => string, waitingAmount?: number): string {
  if (event.pending) return waitsWords(event.label, waitingAmount === undefined ? undefined : format(waitingAmount));
  if (event.uncounted) return notKnownWords(event.label);
  return `${event.label} ${event.amount < 0 ? "−" : "+"}${format(Math.abs(event.amount))}`;
}

type CaseKey = keyof typeof CASES;

/** "If clients pay late", "If clients pay as usual". */
export const ifClientsPay = (which: CaseKey) => `If clients pay ${CASES[which].label}`;
/** "If late", "If as usual". */
export const ifCase = (which: CaseKey) => `If ${CASES[which].label}`;

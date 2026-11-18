// Words several pictures, the canvas and the pages write the same way: an event on a day, a case, a bill that waits for a yes. Pure.
import { AMOUNT_NOT_KNOWN } from "@/lib/money/gaps";
import { CASES, labelOf } from "@/lib/money/terms";

/** What follows the name of a bill that waits for the person's yes. */
export const WAITS_IN_TO_CHECK = `waits in ${labelOf("to_check")} and is not counted yet`;
/** The short flag on an event that waits for the person's yes. */
export const WAITS_FLAG = `Waits in ${labelOf("to_check")}`;
/** What marks the current month, which is not over, beside its name. */
export const SO_FAR = "so far";
/** The month's name on a chart axis ("Nov", or "Nov so far" for the month not over). */
export const monthAxisLabel = (name: string, current: boolean) => `${name.slice(0, 3)}${current ? ` ${SO_FAR}` : ""}`;
/** The month's name in a table row ("November 2026", or "November 2026 (so far)"). */
export const monthRowLabel = (name: string, month: string, current: boolean) => `${name} ${month.slice(0, 4)}${current ? ` (${SO_FAR})` : ""}`;
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

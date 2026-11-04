import { addDays, medianLow } from "./runway";
import type { Client } from "./types";

/**
 * How fast a client pays, from the paid invoices the forecast already uses (D50): the usual days from sending to paid
 * (the same median the runway uses) and the slowest. Null with no paid invoice. Display and tools only; the sentence and
 * the runway do not read this.
 */
export function clientPace(client: Client): { usual: number; slowest: number } | null {
  if (client.daysToPay.length === 0) return null;
  return { usual: medianLow(client.daysToPay), slowest: Math.max(...client.daysToPay) };
}

/**
 * The day a sent invoice is expected to be paid, without `project()`'s floor at tomorrow: what the client's own history
 * says (the usual days), else the client's terms. The nudge rule needs the raw date to know how late the invoice is.
 */
export function expectedPayDate(client: Client, sentOn: string): string {
  return addDays(sentOn, client.daysToPay.length ? medianLow(client.daysToPay) : client.termsDays);
}

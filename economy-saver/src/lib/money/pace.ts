import { addDays, daysBetween, medianLow } from "./runway";
import type { Client, MoneyState } from "./types";

/**
 * How fast a client pays, from the paid invoices the forecast already uses (D50): the usual days from sending to paid
 * (the same median the runway uses) and the slowest. Null with no paid invoice. Display and tools only; the sentence and
 * the runway do not read this.
 */
export function clientPace(client: Client): { usual: number; slowest: number } | null {
  if (client.daysToPay.length === 0) return null;
  return { usual: medianLow(client.daysToPay), slowest: Math.max(...client.daysToPay) };
}

/** The pace in words, as the client panel says it: "9 days usual · 21 slowest"; null with no paid invoice. */
export function paceLine(client: Client): string | null {
  const pace = clientPace(client);
  return pace === null ? null : `${pace.usual} days usual · ${pace.slowest} slowest`;
}

/**
 * The day a sent invoice is expected to be paid, without `project()`'s floor at tomorrow: what the client's own history
 * says (the usual days), else the client's terms. The nudge rule needs the raw date to know how late the invoice is.
 */
export function expectedPayDate(client: Client, sentOn: string): string {
  return addDays(sentOn, client.daysToPay.length ? medianLow(client.daysToPay) : client.termsDays);
}

/** One client's pace as dots (D77): the days each paid invoice took, the usual and the slowest, and each open invoice's days since it was sent (late once past the slowest). */
export type PaceDots = { clientId: string; name: string; dots: number[]; usual: number; slowest: number; open: { invoiceId: string; number: string | null; days: number; late: boolean }[] };

/** Every client with a paid invoice as `PaceDots`, in the state's client order; one client when `clientId` is given. A payment read from a connected PayPal has no sent day, so it gives no dot (it is not in `daysToPay`). */
export function paceDots(state: MoneyState, clientId?: string): PaceDots[] {
  return state.clients.filter(client => (clientId === undefined || client.id === clientId) && client.daysToPay.length > 0).map(client => {
    const pace = clientPace(client)!;
    const open = state.invoices.filter(invoice => invoice.clientId === client.id && invoice.status === "sent" && invoice.sentOn !== undefined)
      .map(invoice => ({ invoiceId: invoice.id, number: invoice.number ?? null, days: daysBetween(invoice.sentOn!, state.today), late: daysBetween(invoice.sentOn!, state.today) > pace.slowest }))
      .sort((a, b) => b.days - a.days);
    return { clientId: client.id, name: client.name, dots: client.daysToPay, usual: pace.usual, slowest: pace.slowest, open };
  });
}

import type { FactAbout } from "./facts";
import { daysBetween, medianLow, overdue } from "./runway";
import type { Client, Invoice, MoneyState } from "./types";

/** What a fact about one invoice points at; the pace picture and the nudge finding name an invoice the same way. */
export function invoiceAbout(invoice: Pick<Invoice, "id" | "number">, clientName: string): FactAbout {
  return { type: "invoice", id: invoice.id, name: `${invoice.number ? `Invoice ${invoice.number}` : "An invoice"} from ${clientName}` };
}

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

/** One client's pace as dots (D77): the days each paid invoice took, the usual and the slowest, and each open invoice's days since it was sent and whether it is overdue (D78: past the day the forecast expects it). */
export type PaceDots = { clientId: string; name: string; dots: number[]; usual: number; slowest: number; open: { invoiceId: string; number: string | null; days: number; overdue: boolean; daysOverdue: number }[] };

/** Every client with a paid invoice as `PaceDots`, in the state's client order; one client when `clientId` is given. A payment read from a connected PayPal has no sent day, so it gives no dot (it is not in `daysToPay`). */
export function paceDots(state: MoneyState, clientId?: string): PaceDots[] {
  return state.clients.filter(client => (clientId === undefined || client.id === clientId) && client.daysToPay.length > 0).map(client => {
    const pace = clientPace(client)!;
    const open = state.invoices.filter(invoice => invoice.clientId === client.id && invoice.status === "sent" && invoice.sentOn !== undefined)
      .map(invoice => {
        const { daysOverdue } = overdue(state, invoice);
        return { invoiceId: invoice.id, number: invoice.number ?? null, days: daysBetween(invoice.sentOn!, state.today), overdue: daysOverdue > 0, daysOverdue };
      })
      .sort((a, b) => b.days - a.days);
    return { clientId: client.id, name: client.name, dots: client.daysToPay, usual: pace.usual, slowest: pace.slowest, open };
  });
}

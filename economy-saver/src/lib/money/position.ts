// Where you stand (D77). Pure: what you hold, less what the cards will take, plus what clients owe, as steps a waterfall draws.
// `minor` is the running total for a start, a subtotal and the total, and the signed change for a plus or a minus. Integer minor units of the home currency.
import type { FormData } from "@/lib/views/types";
import { minorMoney, minorPerUnit } from "./format";
import { cardSummary } from "./card-summary";
import { arrivals, moneyInPots } from "./runway";
import type { MoneyState } from "./types";

type Step = FormData["waterfall"]["steps"][number];

/** The steps from the bank balance to what you would have if every card were paid and every sent invoice landed. Empty when there is nothing to show. */
export function positionSteps(state: MoneyState): Step[] {
  const currency = state.homeCurrency, per = minorPerUnit(currency), minor = (value: number) => Math.round(value * per), format = (value: number) => minorMoney(value, currency);
  const bank = minor(state.bank), paypal = minor(state.paypal), pots = minor(moneyInPots(state));
  const cards = state.cards.map(card => ({ card, owed: minor(cardSummary(state, card.id).owed) })).filter(item => item.owed > 0);
  const clients = arrivals(state).reduce((sum, arrival) => sum + minor(arrival.amountHome), 0);
  if (bank === 0 && paypal === 0 && pots === 0 && cards.length === 0 && clients === 0) return [];

  const steps: Step[] = [];
  let running = bank;
  steps.push({ key: "bank", label: "Bank", minor: bank, kind: "start", amountLabel: format(bank), about: false });
  running += paypal;
  steps.push({ key: "paypal", label: "PayPal", minor: paypal, kind: "plus", amountLabel: `+${format(paypal)}`, about: false });
  if (pots > 0) { running -= pots; steps.push({ key: "pots", label: "Set aside in pots", minor: -pots, kind: "minus", amountLabel: `−${format(pots)}`, about: false }); }
  steps.push({ key: "cash", label: "Cash to spend", minor: running, kind: "subtotal", amountLabel: format(running), about: false });
  for (const { card, owed } of cards) { running -= owed; steps.push({ key: `card-${card.id}`, label: `${card.label} owed`, minor: -owed, kind: "minus", amountLabel: `−${format(owed)}`, about: false }); }
  if (clients > 0) { running += clients; steps.push({ key: "clients", label: "Clients owe you", minor: clients, kind: "plus", amountLabel: `+${format(clients)}`, about: true }); }
  steps.push({ key: "net", label: "What you have", minor: running, kind: "total", amountLabel: format(running), about: clients > 0 });
  return steps;
}

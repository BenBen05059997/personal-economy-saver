// One card's cycle (D77): where today sits in it, when it closes and is paid, the last statement that closed, what covers the soonest statement,
// and, for an amount, which statement a purchase today lands on and whether it fits. Pure; every amount is integer minor units of the home currency.
import { minorPerUnit } from "./format";
import { cycle, paybackFor, roomOnCard, statementItems } from "./runway";
import type { MoneyState } from "./types";

export type CardCycle = {
  cardId: string;
  label: string;
  today: string;
  closesOn: string;
  dueOn: string; // when the statement the open cycle builds is paid
  openMinor: number; // unbilled this cycle
  closed: { amountMinor: number; closedOn: string; dueOn: string } | null; // the soonest closed statement still to pay
  payback: { amountMinor: number; dueOn: string; open: boolean; source: "bank" | "clients" | "short"; shortMinor: number; arrivals: { clientName: string; on: string; amountMinor: number }[] } | null; // what covers the soonest statement
  roomMinor: number; // what could still go on the card and be paid in full
  roomAfterMinor: number | null; // with an amount: the room left once that purchase is on the card
  limitLeftMinor: number | null;
  landing: { closesOn: string; dueOn: string; fits: boolean } | null; // with an amount: where a purchase today lands
};

/** The cycle of one card, or null for a card the household does not have. */
export function cardCycle(state: MoneyState, cardId: string, amountMinor?: number): CardCycle | null {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return null;
  const per = minorPerUnit(state.homeCurrency), minor = (v: number) => Math.round(v * per);
  const open = cycle(state, cardId), room = roomOnCard(state, cardId), payback = paybackFor(state, cardId);
  const closed = statementItems(state).filter(item => item.cardId === cardId && !item.open)[0];
  const roomMinor = minor(room.room);
  const roomAfterMinor = amountMinor === undefined ? null : minor(roomOnCard(state, cardId, amountMinor).room);
  return {
    cardId, label: card.label, today: state.today, closesOn: open.closesOn, dueOn: open.dueOn, openMinor: minor(open.openTotal),
    closed: closed ? { amountMinor: minor(closed.amount), closedOn: closed.closedOn ?? closed.closesOn, dueOn: closed.dueOn } : null,
    payback: payback ? { amountMinor: minor(payback.amount), dueOn: payback.dueOn, open: payback.open, source: payback.source, shortMinor: payback.source === "short" ? minor(Math.max(0, -payback.worstBalance)) : 0,
      arrivals: payback.source === "bank" ? [] : payback.arrivals.map(a => ({ clientName: a.clientName, on: a.worstOn, amountMinor: minor(a.amountHome) })) } : null,
    roomMinor, roomAfterMinor, limitLeftMinor: room.limitLeft === undefined ? null : minor(Math.max(0, room.limitLeft)),
    landing: amountMinor === undefined ? null : { closesOn: open.closesOn, dueOn: open.dueOn, fits: amountMinor <= roomMinor },
  };
}

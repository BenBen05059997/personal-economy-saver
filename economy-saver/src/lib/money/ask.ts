import { fromMinor, toMinor } from "@/db/money";
import { dayLabel, minorMoney } from "./format";
import { dueItems, roomOnCard, safeToSpend } from "./runway";
import { homeSentence } from "./sentence";
import type { MoneyState } from "./types";

export function spendAnswer(state: MoneyState, amountMinor: number, cardId?: string) {
  const amount = fromMinor(amountMinor, state.homeCurrency);
  const safe = safeToSpend(state, 0);
  const cash = amount <= safe.amount ? "Cash covers it" : `Hold off on cash with a low point on ${dayLabel(safe.low.date)}`;
  const rooms = state.cards.filter(card => !cardId || card.id === cardId).map(card => ({ card, ...roomOnCard(state, card.id) }));
  const selected = rooms.find(card => card.room >= amount) ?? rooms[0];
  if (!selected) return cash + ".";
  const detail = selected.room >= amount
    ? `${selected.card.label} covers it in full on ${dayLabel(selected.dueOn)}`
    : `${selected.card.label} cannot cover it in full on ${dayLabel(selected.dueOn)}`;
  return cash + ", and " + detail + ".";
}

export function dueAnswer(state: MoneyState) {
  const due = dueItems(state).find(item => !item.pending);
  if (!due) return "There are no confirmed bills or card statements due in the next 30 days.";
  const amount = minorMoney(toMinor(due.amount, state.homeCurrency), state.homeCurrency);
  return `${due.label} is due ${dayLabel(due.date)} for ${amount}, ${due.covered ? "covered even if clients pay late" : "short if clients pay late"}.`;
}

export function statusAnswer(state: MoneyState) {
  const sentence = homeSentence(state);
  return sentence.text;
}

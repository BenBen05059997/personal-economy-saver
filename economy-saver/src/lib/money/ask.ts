import { fromMinor, toMinor } from "@/db/money";
import { dayLabel, minorMoney } from "./format";
import { AMOUNT_NOT_KNOWN, DATE_NOT_KNOWN } from "./gaps";
import { addDays, dueItems, roomOnCard, safeToSpend, WINDOW_DAYS } from "./runway";
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
  const minor = minorMoney(toMinor(due.amount, state.homeCurrency), state.homeCurrency);
  const amount = due.uncounted ? AMOUNT_NOT_KNOWN : due.estimated ? `about ${minor}` : minor;
  return `${due.label} is due ${due.dueUnknown ? `now (${DATE_NOT_KNOWN})` : dayLabel(due.date)}${due.uncounted ? `, ${amount}` : ` for ${amount}`}, ${due.covered ? "covered even if clients pay late" : "short if clients pay late"}.`;
}

export function statusAnswer(state: MoneyState) {
  const sentence = homeSentence(state);
  return sentence.note === null ? sentence.text : `${sentence.text} ${sentence.note}`; // D55: the note beside the text
}

/** Home's "Safe to spend now" (D2): the lowest balance in the next 30 days if clients pay late, after every bill and card statement, unbilled card spend included. */
export function safeToSpendLine(state: MoneyState) {
  const amount = minorMoney(toMinor(safeToSpend(state, 0).amount, state.homeCurrency), state.homeCurrency);
  return `Safe to spend now: ${amount}. This is the most you can spend without running short at any point in the next ${WINDOW_DAYS} days (to ${dayLabel(addDays(state.today, WINDOW_DAYS))}) if clients pay late, after every bill and card statement, including card spend not yet billed; it is ${minorMoney(0, state.homeCurrency)} when a late payment would already leave you short. It is one figure for the whole window; there is no separate figure for this week or this month.`;
}

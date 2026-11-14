import { toMinor } from "@/db/money";
import { dayLabel, minorMoney } from "./format";
import { AMOUNT_NOT_KNOWN, DATE_NOT_KNOWN } from "./gaps";
import { addDays, dueItems, low, roomOnCard, safeToSpend, series, WINDOW_DAYS } from "./runway";
import { engineFact, fact, forModel, personFact, type Fact } from "./facts";
import { homeSentence } from "./sentence";
import type { MoneyState } from "./types";

const minorOf = (state: MoneyState, amount: number) => toMinor(amount, state.homeCurrency);

/** Facts appended to a tool's text, so the model reads the figures the words came from. */
export function withFacts(text: string, facts: readonly Fact[]): string {
  return `${text}\n\nFacts: ${JSON.stringify(forModel(facts))}`;
}

/** Can I spend this? The facts first (the amount tested is the person's, the rest are the engine's); the words are written from them. */
export function spendReading(state: MoneyState, amountMinor: number, cardId?: string, from = "can_i_spend"): { text: string; facts: Fact[] } {
  const currency = state.homeCurrency;
  const safe = safeToSpend(state);
  const safeMinor = minorOf(state, safe.amount);
  const facts: Fact[] = [
    personFact("amount_tested", amountMinor, { from, currency }),
    engineFact("safe_to_spend", safeMinor, { from, currency }),
    engineFact("low_point_day", safe.low.date, { from, case: "late" }),
  ];
  const rooms = state.cards.filter(card => !cardId || card.id === cardId).map(card => {
    const about = { type: "card" as const, id: card.id, name: card.label };
    const before = roomOnCard(state, card.id), after = roomOnCard(state, card.id, amountMinor);
    const room = engineFact("card_room", minorOf(state, before.room), { from, currency, about });
    facts.push(room, engineFact("card_room_after", minorOf(state, after.room), { from, currency, about }), engineFact("due", before.dueOn, { from, about }));
    if (before.limitLeft !== undefined) facts.push(engineFact("limit_left", minorOf(state, Math.max(0, before.limitLeft)), { from, currency, about }));
    return { label: card.label, room: room.value as number, dueOn: before.dueOn };
  });
  const cash = amountMinor <= safeMinor ? "Cash covers it" : `Hold off on cash with a low point on ${dayLabel(fact(facts, "low_point_day")!.value as string)}`;
  const selected = rooms.find(card => card.room >= amountMinor) ?? rooms[0];
  if (!selected) return { text: cash + ".", facts };
  const detail = selected.room >= amountMinor
    ? `${selected.label} covers it in full on ${dayLabel(selected.dueOn)}`
    : `${selected.label} cannot cover it in full on ${dayLabel(selected.dueOn)}`;
  return { text: cash + ", and " + detail + ".", facts };
}

export function spendAnswer(state: MoneyState, amountMinor: number, cardId?: string) {
  return spendReading(state, amountMinor, cardId).text;
}

/** Today's outlook as facts: safe to spend, and the low point and any shortfall in each case, with the day. */
export function outlookFacts(state: MoneyState, from: string): Fact[] {
  const currency = state.homeCurrency;
  const safe = safeToSpend(state);
  const usual = low(series(state, "expected"), state.today);
  const facts: Fact[] = [engineFact("safe_to_spend", minorOf(state, safe.amount), { from, currency })];
  for (const [kind, point] of [["late", safe.low], ["as_usual", usual]] as const) {
    const period = { on: point.date };
    facts.push(engineFact("low_point", minorOf(state, point.amount), { from, currency, case: kind, period }), engineFact("low_point_day", point.date, { from, case: kind }));
    if (point.amount < 0) facts.push(engineFact("short", minorOf(state, -point.amount), { from, currency, case: kind, period }));
  }
  return facts;
}

/** The facts behind the next due item (the one dueAnswer says): its day and amount, or that its amount is not counted. */
export function dueFacts(state: MoneyState, from: string): Fact[] {
  const due = dueItems(state).find(item => !item.pending);
  if (!due) return [];
  const currency = state.homeCurrency;
  const about = due.kind === "statement" && due.cardId
    ? { type: "card" as const, id: due.cardId, name: due.label }
    : { type: "bill" as const, id: due.id, name: due.label };
  const facts: Fact[] = [engineFact("due", due.date, { from, about })];
  if (due.uncounted) facts.push(engineFact("not_counted", 1, { from, about }));
  else facts.push(engineFact(due.kind === "bill" ? "bill_amount" : due.open ? "statement_open" : "statement_closed", minorOf(state, due.amount), { from, currency, about }));
  if (due.estimated) facts.push(engineFact("about_estimate", 1, { from, about }));
  return facts;
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
  const amount = minorMoney(toMinor(safeToSpend(state).amount, state.homeCurrency), state.homeCurrency);
  return `Safe to spend now: ${amount}. This is the most you can spend without running short at any point in the next ${WINDOW_DAYS} days (to ${dayLabel(addDays(state.today, WINDOW_DAYS))}) if clients pay late, after every bill and card statement, including card spend not yet billed; it is ${minorMoney(0, state.homeCurrency)} when a late payment would already leave you short. It is one figure for the whole window; there is no separate figure for this week or this month.`;
}

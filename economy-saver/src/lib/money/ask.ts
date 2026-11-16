import { dayLabel, toMinor } from "./format";
import { low, roomOnCard, safeToSpend, series } from "./runway";
import { engineFact, fact, forModel, personFact, type Fact } from "./facts";
import type { MoneyState } from "./types";

/** Facts appended to a tool's text, so the model reads the figures the words came from. */
export function withFacts(text: string, facts: readonly Fact[]): string {
  return `${text}\n\nFacts: ${JSON.stringify(forModel(facts))}`;
}

/** Can I spend this? The facts first (the amount tested is the person's, the rest are the engine's); the words are written from them. */
export function spendReading(state: MoneyState, amountMinor: number, cardId?: string, from = "can_i_spend"): { text: string; facts: Fact[] } {
  const currency = state.homeCurrency;
  const safe = safeToSpend(state);
  const safeMinor = toMinor(safe.amount, state.homeCurrency);
  const facts: Fact[] = [
    personFact("amount_tested", amountMinor, { from, currency }),
    engineFact("safe_to_spend", safeMinor, { from, currency }),
    engineFact("low_point_day", safe.low.date, { from, case: "late" }),
  ];
  const rooms = state.cards.filter(card => !cardId || card.id === cardId).map(card => {
    const about = { type: "card" as const, id: card.id, name: card.label };
    const before = roomOnCard(state, card.id), after = roomOnCard(state, card.id, amountMinor);
    const room = engineFact("card_room", toMinor(before.room, state.homeCurrency), { from, currency, about });
    facts.push(room, engineFact("card_room_after", toMinor(after.room, state.homeCurrency), { from, currency, about }), engineFact("due", before.dueOn, { from, about }));
    if (before.limitLeft !== undefined) facts.push(engineFact("limit_left", toMinor(Math.max(0, before.limitLeft), state.homeCurrency), { from, currency, about }));
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

/** Today's outlook as facts: safe to spend, and the low point and any shortfall in each case, with the day. */
export function outlookFacts(state: MoneyState, from: string): Fact[] {
  const currency = state.homeCurrency;
  const safe = safeToSpend(state);
  const usual = low(series(state, "expected"), state.today);
  const facts: Fact[] = [engineFact("safe_to_spend", toMinor(safe.amount, state.homeCurrency), { from, currency })];
  for (const [kind, point] of [["late", safe.low], ["as_usual", usual]] as const) {
    const period = { on: point.date };
    facts.push(engineFact("low_point", toMinor(point.amount, state.homeCurrency), { from, currency, case: kind, period }), engineFact("low_point_day", point.date, { from, case: kind }));
    if (point.amount < 0) facts.push(engineFact("short", toMinor(-point.amount, state.homeCurrency), { from, currency, case: kind, period }));
  }
  return facts;
}

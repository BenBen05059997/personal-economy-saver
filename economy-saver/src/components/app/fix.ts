import { addDays, daysBetween, dueItems, ladder, low, planWindow, roomOnCard, series, type DueItem, type Rung } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";
import { dayLabel, homeFormat } from "./format";
import type { Stage } from "./state";

// What the card screens say about "can I proceed?", read from the runway maths. Plain sentences, the person's own numbers.

/** The cheapest way to cover a gap that is not a loan: D7 says never suggest a cash advance, a minimum payment or revolving as a fix. */
export function cheapestFix(money: MoneyState): Rung | undefined {
  const rungs = ladder(money).filter((r) => r.id !== "advance");
  return rungs.find((r) => r.pick) ?? rungs[0];
}

/**
 * The ways to cover a gap, cheapest first, with the pick always a fix that is not a loan (D7). A card cash advance
 * stays in the list as a cost to compare against, never as the pick and never as something to do.
 */
export function fixLadder(money: MoneyState): Rung[] {
  const pick = cheapestFix(money)?.id;
  return ladder(money).map((r) => ({ ...r, pick: r.id === pick, ...(r.id === "advance" ? { verdict: "Costs interest. Not suggested" } : {}) }));
}

export type Answer = {
  ok: boolean; // the card's statement can be paid in full, even if clients pay late
  text: string;
  note?: string; // a shortfall that is not this card's doing
  fix?: Rung; // when something is short
};

/** "Can I proceed?" for one card: how much more it can take, read per card. */
export function chargeAnswer(money: MoneyState, cardId: string): Answer {
  const fmt = homeFormat(money);
  const card = money.cards.find((c) => c.id === cardId);
  const label = card?.label ?? "the card";
  const r = roomOnCard(money, cardId);
  const worst = series(money, "worst", planWindow(money));
  const dueIdx = daysBetween(money.today, r.dueOn);
  const item = dueItems(money, planWindow(money)).find((d) => d.cardId === cardId && d.date === r.dueOn && d.open);
  const due = dayLabel(r.dueOn);

  if (item && !item.covered) {
    return { ok: false, text: `Hold off on ${label}: in the worst case you are ${fmt(-item.worstBalance)} short on ${due}, the day its statement is paid.`, fix: cheapestFix(money) };
  }

  // A dip before the due date is not from this card; one after it would be hit by anything more put on it.
  const before = low(worst.slice(0, Math.max(0, dueIdx)), money.today);
  const note = before.amount < 0 ? `Separately, ${dayLabel(before.date)} is ${fmt(-before.amount)} short. That is not from this card.` : undefined;
  const fix = note ? cheapestFix(money) : undefined;

  if (r.limitLeft !== undefined && r.limitLeft <= 0) {
    return { ok: true, text: `${label} is at its limit. Its ${due} statement can still be paid in full, even if clients pay late.`, note, fix };
  }
  if (r.room <= 0) {
    const after = low(worst.slice(Math.max(0, dueIdx)), addDays(money.today, Math.max(0, dueIdx)));
    return { ok: true, text: `No room on ${label} right now. Its ${due} statement is covered, but the worst case falls to ${fmt(after.amount)} on ${dayLabel(after.date)}.`, note, fix: fix ?? cheapestFix(money) };
  }
  const limit = r.capped ? ` That is what is left of ${label}'s limit.` : "";
  return {
    ok: true,
    text: `You can put about ${fmt(r.room)} more on ${label} and still pay its ${due} statement, and everything else due through ${dayLabel(r.through)}, in full, even if clients pay late.${limit}`,
    note,
    fix,
  };
}

/** What the fix button says and does, by where the invoice stands. Null when the invoice is already out. */
export function fixButton(stage: Stage): string | null {
  if (stage === "approve") return "Review the invoice";
  if (stage === "bill") return "Confirm the bill first";
  return null;
}

/** The statement due soonest for one card, in the window or not. */
export function nextStatement(money: MoneyState, cardId: string): DueItem | undefined {
  return dueItems(money, 30).find((d) => d.cardId === cardId);
}

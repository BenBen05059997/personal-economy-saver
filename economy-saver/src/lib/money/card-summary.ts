import { cycle, paybackFor, roomOnCard, statementItems, type Payback } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";

// The words behind a "Covered" mark, kept once for every face that shows it. In the engine a bill's tick is "the worst-case balance on its due day is at least zero";
// a card's is "the statement is paid from the bank, or once client payments land by its due date, with every other bill still paid".
export const STATEMENT_COVERED = "Covered: this statement can be paid on its due date from your bank or from client payments due by then.";
export const DAY_COVERED = "Covered: your balance stays above zero on this day, even if clients pay late.";

type CardSummary = {
  owed: number; // unbilled charges in the open cycle plus any closed statement not yet paid
  limitLeft?: number; // only when the card has a limit
  next?: Payback; // the soonest statement: amount, due date and where it is paid from
  shortBy: number; // 0 when the next statement is covered by expected money
};

/** What a card row shows, assembled from the engine's own outputs; no maths of its own beyond one sum. */
export function cardSummary(state: MoneyState, cardId: string): CardSummary {
  const closedUnpaid = statementItems(state).filter((st) => st.cardId === cardId && !st.open).reduce((sum, st) => sum + st.amount, 0);
  const next = paybackFor(state, cardId);
  return {
    owed: cycle(state, cardId).openTotal + closedUnpaid,
    limitLeft: roomOnCard(state, cardId).limitLeft,
    next,
    shortBy: next?.source === "short" ? Math.max(0, -next.worstBalance) : 0,
  };
}

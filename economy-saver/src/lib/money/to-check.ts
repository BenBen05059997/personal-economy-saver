import { dayLabel } from "./format";
import { pendingCharges } from "./runway";
import type { MoneyState } from "./types";

export function toCheck(state: MoneyState) {
  return [
    ...state.bills.filter(bill => bill.status === "pending").map(bill => ({
      kind: "bill" as const, id: bill.id, amount: bill.amount, title: bill.biller,
      detail: `${bill.category} · due ${dayLabel(bill.due)}`,
    })),
    ...pendingCharges(state).map(charge => {
      const card = state.cards.find(card => card.id === charge.cardId);
      if (!card) throw new Error("Card for pending charge was not found");
      const source = { card_email: "Card email", receipt: "Receipt", voice: "Voice", manual: "Manual entry" };
      return { kind: "charge" as const, id: charge.id, title: charge.merchant, amount: charge.amount,
        detail: `${card.label} · ${dayLabel(charge.date)} · ${source[charge.source]}` };
    }),
  ];
}

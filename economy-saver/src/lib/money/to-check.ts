import { dayLabel, minorMoney } from "./format";
import { monthYear } from "./plan";
import { pendingCharges } from "./runway";
import type { MoneyState } from "./types";

export function toCheck(state: MoneyState) {
  const minor = (amount: number) => Math.round(amount * (state.homeCurrency === "USD" ? 100 : 1));
  return [
    ...state.balanceUpdates.map(update => ({
      kind: "balance" as const, id: update.id, amount: null,
      title: `Bank balance → ${minorMoney(minor(update.amount), state.homeCurrency)}`,
      detail: `now ${minorMoney(minor(state.bank), state.homeCurrency)}`,
    })),
    ...state.pendingPots.map(pot => ({
      kind: "pot" as const, id: pot.id, amount: null,
      title: `New pot: ${pot.name}${pot.target === undefined ? "" : `, ${minorMoney(minor(pot.target), state.homeCurrency)}${pot.targetDate ? ` by ${monthYear(pot.targetDate)}` : ""}`}`,
      detail: pot.fillPct === undefined ? "Money set aside is not spendable" : `Sets aside ${pot.fillPct}% of each client payment`,
    })),
    ...state.bills.filter(bill => bill.status === "pending").map(bill => ({
      kind: "bill" as const, id: bill.id, amount: bill.amount, title: bill.biller,
      detail: `${bill.category} · due ${dayLabel(bill.due)}${bill.repeatDay === undefined ? "" : " · every month"}`,
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

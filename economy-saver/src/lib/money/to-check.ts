import { categoryLabel, shareLabel } from "./categories";
import { dayLabel, minorMoney } from "./format";
import { monthYear } from "./plan";
import { pendingCharges } from "./runway";
import type { MoneyState } from "./types";

export function toCheck(state: MoneyState) {
  const minor = (amount: number) => Math.round(amount * (state.homeCurrency === "USD" ? 100 : 1));
  const payer = (id: string) => state.split.members.find(member => member.id === id)?.name; // D45: kept through To check
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
      detail: `${categoryLabel(bill.category)} · ${shareLabel(bill.businessBp)} · due ${dayLabel(bill.due)}${bill.repeatUnit === undefined ? "" : bill.repeatUnit === "month" ? " · every month" : " · every year"}${bill.nextAmount === undefined || bill.nextAmountFrom === undefined ? "" : ` · ${minorMoney(minor(bill.nextAmount), state.homeCurrency)} from ${dayLabel(bill.nextAmountFrom)}`}${bill.cancelBy === undefined ? "" : ` · cancel by ${dayLabel(bill.cancelBy)}`}${bill.paidBy === undefined ? "" : ` · shared, paid by ${payer(bill.paidBy)}`}`,
    })),
    ...pendingCharges(state).map(charge => {
      const card = state.cards.find(card => card.id === charge.cardId);
      if (!card) throw new Error("Card for pending charge was not found");
      const source = { card_email: "Card email", receipt: "Receipt", voice: "Voice", manual: "Manual entry" };
      return { kind: "charge" as const, id: charge.id, title: charge.merchant, amount: charge.amount,
        detail: `${card.label} · ${dayLabel(charge.date)} · ${categoryLabel(charge.category)} · ${shareLabel(charge.businessBp)} · ${source[charge.source]}${charge.shared ? " · shared" : ""}` };
    }),
  ];
}

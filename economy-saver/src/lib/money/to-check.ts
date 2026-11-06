import { categoryLabel, shareLabel } from "./categories";
import { DATE_NOT_KNOWN, gapAmountWords, gapDateWords, gapQuestion, openGaps } from "./gaps";
import { dayLabel, minorMoney, minorPerUnit, repeatWords } from "./format";
import { monthYear } from "./plan";
import { lastOneWords } from "./repeat";
import { pendingCharges } from "./runway";
import type { MadeBy, MoneyState } from "./types";

/** D50: the muted words after a title when the agent drafted the row; nothing for any other maker. */
export function draftedLabel(madeBy: MadeBy | undefined): string | null {
  return madeBy === "ask" ? "Drafted by Ask" : madeBy === "mcp" ? "Drafted through MCP" : null;
}

export function toCheck(state: MoneyState) {
  const minor = (amount: number) => Math.round(amount * minorPerUnit(state.homeCurrency));
  const gaps = new Map(openGaps(state).filter(gap => gap.source === "bill").map(gap => [gap.id, gap]));
  const payer = (id: string) => state.split.members.find(member => member.id === id)?.name; // D45: kept through To check
  return [
    ...state.balanceUpdates.map(update => ({
      kind: "balance" as const, id: update.id, amount: null, madeBy: update.madeBy,
      title: `Bank balance → ${minorMoney(minor(update.amount), state.homeCurrency)}`,
      detail: `now ${minorMoney(minor(state.bank), state.homeCurrency)}`,
    })),
    ...state.pendingPots.map(pot => ({
      kind: "pot" as const, id: pot.id, amount: null, madeBy: pot.madeBy,
      title: `New pot: ${pot.name}${pot.target === undefined ? "" : `, ${minorMoney(minor(pot.target), state.homeCurrency)}${pot.targetDate ? ` by ${monthYear(pot.targetDate)}` : ""}`}`,
      detail: pot.fillPct === undefined ? "Money set aside is not spendable" : `Sets aside ${pot.fillPct}% of each client payment`,
    })),
    ...state.bills.filter(bill => bill.status === "pending").map(bill => {
      const gap = gaps.get(bill.id) ?? null;
      return {
      // D55: a bill with its amount not known has no amount here (never ¥0); `gap` holds the words and the question for the missing piece.
      kind: "bill" as const, id: bill.id, amount: bill.amountUnknown ? null : bill.amount, title: bill.biller, madeBy: bill.madeBy,
      gap: gap && { question: gapQuestion(gap), amount: gap.missing.includes("amount") ? gapAmountWords(gap) : null, date: gap.missing.includes("date") ? gapDateWords(gap) : null },
      detail: `${categoryLabel(bill.category)} · ${shareLabel(bill.businessBp)} · ${bill.dueUnknown ? DATE_NOT_KNOWN : `due ${dayLabel(bill.due)}`}${bill.repeatUnit === undefined ? "" : ` · ${repeatWords(bill.repeatUnit).toLowerCase()}${bill.dueUnknown ? "" : ` · ${lastOneWords(bill, state.today) ?? ""}`.replace(/ · $/, "")}`}${bill.nextAmount === undefined || bill.nextAmountFrom === undefined ? "" : ` · ${minorMoney(minor(bill.nextAmount), state.homeCurrency)} from ${dayLabel(bill.nextAmountFrom)}`}${bill.cancelBy === undefined ? "" : ` · cancel by ${dayLabel(bill.cancelBy)}`}${bill.paidBy === undefined ? "" : ` · shared, paid by ${payer(bill.paidBy)}`}`,
    }; }),
    ...pendingCharges(state).map(charge => {
      const card = state.cards.find(card => card.id === charge.cardId);
      if (!card) throw new Error("Card for pending charge was not found");
      const source = { card_email: "Card email", receipt: "Receipt", voice: "Voice", manual: "Manual entry" };
      return { kind: "charge" as const, id: charge.id, title: charge.merchant, amount: charge.amount, madeBy: charge.madeBy,
        detail: `${card.label} · ${dayLabel(charge.date)} · ${categoryLabel(charge.category)} · ${shareLabel(charge.businessBp)} · ${source[charge.source]}${charge.shared ? " · shared" : ""}` };
    }),
  ];
}

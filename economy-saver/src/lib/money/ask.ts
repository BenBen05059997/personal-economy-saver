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
  return sentence.lead + " " + sentence.emphasis;
}

// Read the amount from a complete currency expression. A mismatched currency is never converted implicitly.
function amountIn(text: string, state: MoneyState, wholeExpression = false) {
  const match = /^(?:(¥|\$|JPY|USD)\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(yen|dollars?|JPY|USD))?/i.exec(text.trim());
  if (!match) return null;
  const rest = text.trim().slice(match[0].length).trim();
  if (rest && (wholeExpression || !/^(?:tonight|today|tomorrow|now|for|at|on|in cash)\b/i.test(rest))) return null;
  if (match[1] && match[3]) return null;
  const unit = (match[1] ?? match[3] ?? state.homeCurrency).toUpperCase();
  const currency = ["¥", "JPY", "YEN"].includes(unit) ? "JPY" : "USD";
  if (currency !== state.homeCurrency) return null;
  const [whole, decimals = ""] = match[2].split(".");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(whole) || decimals.length > (currency === "USD" ? 2 : 0)) return null;
  const minor = Number(whole.replaceAll(",", "")) * (currency === "USD" ? 100 : 1) + Number(decimals.padEnd(2, "0"));
  return minor > 0 && Number.isSafeInteger(minor) ? minor : null;
}

export type AskResult = { answer: string; charge?: { merchant: string; cardId: string; amountMinor: number } };
export function interpretQuestion(state: MoneyState, text: string): AskResult {
  const question = text.trim().replace(/[.!?]+$/, "");
  const card = state.cards.find(c => question.toLowerCase().endsWith(" on " + c.label.toLowerCase()));
  if (/^(?:i (?:paid|spent)|log)\b/i.test(question)) {
    const log = /^(?:i (?:paid|spent)|log)\s+(.+?)\s+at\s+(.+?)\s+on\s+.+$/i.exec(question);
    const merchant = log?.[2];
    const amount = log && amountIn(log[1], state, true);
    if (!amount || !merchant || !card) return { answer: "Include an amount in your home currency, the merchant and the card name." };
    return { answer: `${minorMoney(amount, state.homeCurrency)} at ${merchant} on ${card.label} is ready in To check.`,
      charge: { merchant, cardId: card.id, amountMinor: amount } };
  }
  const spending = /\b(?:afford|spend)\s+(.+)$/i.exec(question);
  if (spending) {
    if (/\bon\s+(?:my\s+)?card\b/i.test(question) && !card) return { answer: "Use the card name exactly as it appears in Cards." };
    const amount = amountIn(spending[1], state);
    return { answer: amount ? spendAnswer(state, amount, card?.id) : `Include a positive purchase amount in ${state.homeCurrency}.` };
  }
  if (/\b(?:due|upcoming|coming up)\b/i.test(question)) return { answer: dueAnswer(state) };
  if (/\b(?:where (?:am i|do i stand)|runway|overview|how am i|safe to spend)\b/i.test(question)) return { answer: statusAnswer(state) };
  return { answer: "Ask what’s due, whether you can afford an amount, or log a card purchase." };
}

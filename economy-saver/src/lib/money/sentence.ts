import type { Currency } from "@/lib/catalogue/types";
import { money } from "./format";
import { arrivals, daysBetween, low, safeToSpend, series, type LowPoint, type SafeToSpend } from "./runway";
import type { MoneyState } from "./types";

function ordinal(date: string): string {
  const day = Number(date.slice(-2));
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[day % 10] ?? "th";
  return day + suffix;
}

/** Whether any client payment is expected to land in the next 30 days. Without one, "even if clients pay late" says nothing true. */
export function expectsClientPayment(state: MoneyState, days = 30) {
  return arrivals(state).some(arrival => daysBetween(state.today, arrival.expectedOn) < days);
}

export function composeSentence(safe: SafeToSpend, usualLow: LowPoint, currency: Currency, clientsExpected = true) {
  const amount = (value: number) => money(Math.abs(value), currency);
  const on = (point: LowPoint) => " on the " + ordinal(point.date);
  if (safe.low.amount >= 0) {
    return {
      lead: clientsExpected ? "You're fine for the next 30 days, even if clients pay late. Lowest point" : "You're fine for the next 30 days. Lowest point",
      emphasis: amount(safe.low.amount) + on(safe.low) + ".",
    };
  }
  if (usualLow.amount < 0) {
    return {
      lead: "Even if clients pay as usual, you're",
      emphasis: amount(usualLow.amount) + " short" + on(usualLow) + ".",
    };
  }
  const clients = safe.lateClients;
  const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(clients);
  const lead = names
    ? `You're fine if ${names} ${clients.length === 1 ? "pays" : "pay"} as usual. If ${clients.length === 1 ? "that payment is" : "they're"} late, you're`
    : "If client payments are late, you're";
  return { lead, emphasis: amount(safe.shortBy) + " short" + on(safe.low) + "." };
}

/** D47: nothing to forecast (no confirmed bill, no confirmed card charge, no closed statement, no invoice still to be paid): pending items count for nothing, as everywhere else. */
export function hasNothingToForecast(state: MoneyState) {
  return !state.bills.some(bill => bill.status === "confirmed")
    && !state.charges.some(charge => charge.status === "confirmed")
    && state.statements.length === 0
    && !state.invoices.some(invoice => invoice.status !== "paid" && invoice.status !== "closed");
}

export function homeSentence(state: MoneyState) {
  if (hasNothingToForecast(state)) {
    return { lead: "Add your rent, your bills and the clients who pay you to see your next 30 days.", emphasis: `Bank balance ${money(state.bank, state.homeCurrency)}.` };
  }
  // The amount and low point do not use the monthly-essentials threshold (only the verdict does).
  return composeSentence(safeToSpend(state, 0), low(series(state, "expected")), state.homeCurrency, expectsClientPayment(state));
}

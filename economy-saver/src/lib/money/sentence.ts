import type { Currency } from "@/lib/catalogue/types";
import { money } from "./format";
import { low, safeToSpend, series, type LowPoint, type SafeToSpend } from "./runway";
import type { MoneyState } from "./types";

function ordinal(date: string): string {
  const day = Number(date.slice(-2));
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[day % 10] ?? "th";
  return day + suffix;
}

export function composeSentence(safe: SafeToSpend, usualLow: LowPoint, currency: Currency) {
  const amount = (value: number) => money(Math.abs(value), currency);
  const on = (point: LowPoint) => " on the " + ordinal(point.date);
  if (safe.low.amount >= 0) {
    return {
      lead: "You're fine for the next 30 days, even if clients pay late. Lowest point",
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

export function homeSentence(state: MoneyState) {
  // The amount and low point do not use the monthly-essentials threshold (only the verdict does).
  return composeSentence(safeToSpend(state, 0), low(series(state, "expected")), state.homeCurrency);
}

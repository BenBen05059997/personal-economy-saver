// Money text shared by the runway maths and the screen. Written by hand (no Intl) so the server
// and the browser always render the same characters.

import type { Currency } from "@/lib/catalogue/types";

/** 1234567 -> "1,234,567". */
export function group(n: number): string {
  return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function currencySymbol(c: Currency): string {
  return c === "JPY" ? "¥" : "$";
}

/** Whole units with a real minus sign: ¥1,200, −¥1,200, $1,200, −$1,200. */
export function money(n: number, c: Currency): string {
  return (Math.round(n) < 0 ? "−" : "") + currencySymbol(c) + group(n);
}

export const usd = (n: number) => minorMoney(Math.round(n * minorPerUnit("USD")), "USD");

/** The decimal places a currency keeps in minor units: the one table (JPY has none, USD has cents). */
export const MINOR_PLACES: Record<string, number> = { JPY: 0, USD: 2 };

/** Whole minor units per unit of a currency (cents for USD, yen for JPY). */
export const minorPerUnit = (currency: Currency) => 10 ** MINOR_PLACES[currency];

/** A formatter bound to one currency. */
export function formatter(c: Currency): (n: number) => string {
  return (n) => money(n, c);
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-27" -> "Nov 27" */
export function dayLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** 25 -> "25th", 1 -> "1st", 12 -> "12th", 22 -> "22nd". */
export function ordinal(n: number): string {
  const rest = n % 100;
  return n + (rest >= 11 && rest <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]));
}

/** An amount in whole units of `currency` (a forecast figure) written exactly: 12.5 USD is "$12.50", 1200 JPY is "¥1,200". */
export function majorMoney(amount: number, currency: Currency): string {
  return minorMoney(Math.round(amount * minorPerUnit(currency)), currency);
}

/** An amount that is a guess, not a real bill: "about ¥6,000" (D54). Same digits as `minorMoney`. */
export function aboutMoney(minor: number, currency: Currency): string {
  return "about " + minorMoney(minor, currency);
}

/** How a bill repeats, in the words the screens use: "One-off", "Every month", "Every year"; with the day (and, for a year, the month) "Every month on the 25th", "Every year on Nov 25". */
export function repeatWords(unit: "month" | "year" | null | undefined, day?: number, month?: number): string {
  if (unit === null || unit === undefined) return "One-off";
  if (day === undefined) return unit === "month" ? "Every month" : "Every year";
  if (unit === "month") return `Every month on the ${ordinal(day)}`;
  if (month === undefined) throw new Error("A yearly bill needs its month to name the day");
  return `Every year on ${MONTHS[month - 1]} ${day}`;
}

/** Exact ledger amount. Invoice and activity screens keep USD cents when present. */
export function minorMoney(minor: number, currency: Currency): string {
  if (!Number.isSafeInteger(minor)) throw new Error("Amount must be an integer in minor units");
  const value = Math.abs(minor);
  const dollars = currency === "USD";
  const per = minorPerUnit(currency);
  const fraction = dollars && value % per ? "." + String(value % per).padStart(MINOR_PLACES[currency], "0") : "";
  return (minor < 0 ? "−" : "") + currencySymbol(currency) + group(Math.floor(value / per)) + fraction;
}

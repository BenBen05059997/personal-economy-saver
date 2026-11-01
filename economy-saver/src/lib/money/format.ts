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

export const yen = (n: number) => money(n, "JPY");
export const usd = (n: number) => money(n, "USD");

/** A formatter bound to one currency. */
export function formatter(c: Currency): (n: number) => string {
  return (n) => money(n, c);
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-27" -> "Nov 27" */
export function dayLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

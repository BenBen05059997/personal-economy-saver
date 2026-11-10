// How an amount typed by a person is read: one function for the input's own check in the browser and for the
// server's parser, so both accept and refuse the same text with the same words.
// Accepted: digits with an optional decimal part, thousands separators ("1,000.50"), full-width digits (NFKC),
// and a leading minus where the field allows one. Never accepted: a plus sign, spaces inside, an exponent.

import type { Currency } from "@/lib/catalogue/types";
import { MINOR_PLACES, minorMoney, minorPerUnit } from "./format";

/** The largest amount any form takes, in whole units: ¥100,000,000 or $1,000,000. */
export const AMOUNT_LIMIT: Record<Currency, number> = { JPY: 100_000_000, USD: 1_000_000 };

const SHAPE = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

type ReadAmount = { minor: number } | { problem: string };

/** The message for an amount over the limit: "Enter an amount up to ¥100,000,000". */
export function limitMessage(currency: Currency): string {
  return `Enter an amount up to ${minorMoney(AMOUNT_LIMIT[currency] * minorPerUnit(currency), currency)}`;
}

const MARKS: Record<string, string> = { "円": "JPY", "¥": "JPY", "￥": "JPY", "JPY": "JPY", "YEN": "JPY", "$": "USD", "＄": "USD", "USD": "USD" };
const MARK = /^(円|¥|￥|\$|＄|JPY|USD|YEN)$/i;

/** Takes one leading or trailing currency mark off the text. A mark of another currency is refused in words. */
function stripCurrency(text: string, currency: string): { text: string } | { problem: string } {
  const lead = /^(-?)\s*(円|¥|￥|\$|＄|JPY|USD|YEN)\s*(.*)$/i.exec(text);
  const trail = /^(.*?)\s*(円|¥|￥|\$|＄|JPY|USD|YEN)$/i.exec(text);
  const found = lead ? { mark: lead[2], rest: lead[1] + lead[3] } : trail ? { mark: trail[2], rest: trail[1] } : null;
  if (!found || !MARK.test(found.mark)) return { text };
  const mark = MARKS[found.mark] ?? MARKS[found.mark.toUpperCase()];
  if (mark !== currency) return { problem: currency === "JPY" ? "This amount is in yen. Enter a whole number of yen, like 5000 or 5,000" : "This amount is in dollars. Enter an amount in dollars, like 400, 1,000 or 400.50" };
  return { text: found.rest.trim() };
}

/**
 * Reads typed text as signed integer minor units of `currency` (yen, or cents), or says in words what is wrong.
 * `signed` is whether a minus sign is part of the field; zero is a valid reading (callers that need more than zero check it).
 */
export function readAmount(text: string, currency: string, signed = true): ReadAmount {
  const places = MINOR_PLACES[currency];
  if (places === undefined) throw new Error(`Unknown currency: ${currency}`);
  const stripped = stripCurrency(text.normalize("NFKC").trim(), currency);
  if ("problem" in stripped) return stripped;
  const match = SHAPE.exec(stripped.text);
  if (!match) return { problem: places ? "Enter an amount in dollars, like 400, 1,000 or 400.50" : "Enter a whole number of yen, like 5000 or 5,000" };
  const [, minus, digits, fraction = ""] = match;
  if (minus && !signed) return { problem: "Enter an amount without a minus sign" };
  if (fraction.length > places) return { problem: places ? `${currency} amounts have at most ${places} decimal places` : `${currency} amounts are whole numbers` };
  const whole = digits.replaceAll(",", "");
  const cur = currency as Currency;
  if (whole.length > 12 || Number(whole) > AMOUNT_LIMIT[cur]) return { problem: limitMessage(cur) };
  const minor = Number(whole + fraction.padEnd(places, "0"));
  if (minor > AMOUNT_LIMIT[cur] * minorPerUnit(cur)) return { problem: limitMessage(cur) };
  return { minor: minus ? 0 - minor : minor };
}

/** "" when the text is a good amount for the field, otherwise the message (used by the input's own check). */
export function amountProblem(text: string, currency: string, signed = false): string {
  const read = readAmount(text, currency, signed);
  return "problem" in read ? read.problem : "";
}

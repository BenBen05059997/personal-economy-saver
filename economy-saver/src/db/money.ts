import { AMOUNT_LIMIT, limitMessage, readAmount } from "@/lib/money/amount";
import { MINOR_PLACES, minorPerUnit } from "@/lib/money/format";
import { InputError } from "./input-error";

// Money in the database is an integer count of the currency's smallest unit (JPY: yen, USD: cents).
// The engine works in whole major units, so these two functions are the only bridge between them.

function digits(currency: string): number {
  const d = MINOR_PLACES[currency];
  if (d === undefined) throw new Error(`Unknown currency: ${currency}`);
  return d;
}

export function toMinor(amount: number, currency: string): number {
  const minor = Math.round(amount * 10 ** digits(currency));
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: ${amount} ${currency}`);
  return minor;
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** digits(currency);
}

// FX rates are stored as integers scaled by 1e6 ("rate_micro"): 150 yen per dollar is 150_000_000.
// A float rate would drift when it is multiplied back in; this keeps the stored rate exact to 6 places.
const RATE_SCALE = 1_000_000;

export const toRateMicro = (rate: number): number => Math.round(rate * RATE_SCALE);
export const fromRateMicro = (micro: number): number => micro / RATE_SCALE;

/** Convert between the two currencies we hold. `perUsd` is units of the non-USD currency per 1 USD. */
export function convertMinor(minor: number, from: string, to: string, perUsd: number): number {
  if (from === to) return minor;
  const major = fromMinor(minor, from);
  if (from === "USD") return toMinor(major * perUsd, to);
  if (to === "USD") return toMinor(major / perUsd, to);
  throw new Error(`No conversion from ${from} to ${to}`);
}

/**
 * Parses an amount typed by a person ("3800", "1,000.50", "-12.50", full-width digits) into signed integer minor units
 * of `currency`, by the same reading the amount inputs use in the browser (lib/money/amount.ts). Thousands separators
 * are fine; a plus sign is not. Over ¥100,000,000 or $1,000,000 is refused. Zero is allowed here; callers that need a sign check the result.
 */
export function parseMinor(text: string, currency: string): number {
  digits(currency);
  const read = readAmount(text, currency);
  if ("problem" in read) throw new InputError(read.problem);
  return read.minor;
}

/** An amount that must be more than zero (an invoice, a bill, a charge). */
export function parseAmountMinor(text: string, currency: string): number {
  const minor = parseMinor(text, currency);
  if (minor <= 0) throw new InputError("The amount must be more than zero");
  return minor;
}

/** Checks an amount that is already in minor units (a bill's missing amount filled in later) like a typed one: whole, more than zero, within the limit. */
export function checkAmountMinor(minor: number, currency: string): number {
  digits(currency);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new InputError("The amount must be more than zero");
  const cur = currency as "JPY" | "USD";
  if (minor > AMOUNT_LIMIT[cur] * minorPerUnit(cur)) throw new InputError(limitMessage(cur));
  return minor;
}

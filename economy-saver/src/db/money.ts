import { InputError } from "./input-error";

// Money in the database is an integer count of the currency's smallest unit (JPY: yen, USD: cents).
// The engine works in whole major units, so these two functions are the only bridge between them.

const MINOR_DIGITS: Record<string, number> = { JPY: 0, USD: 2 };

function digits(currency: string): number {
  const d = MINOR_DIGITS[currency];
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
 * Parses an amount typed by a person ("3800", "-12.50") into signed integer minor units of `currency`.
 * Plain digits with an optional leading minus and a decimal part no longer than the currency allows;
 * no plus sign, no thousands separators. Zero is allowed here; callers that need a sign check the result.
 */
export function parseMinor(text: string, currency: string): number {
  const places = digits(currency);
  const match = /^(-?)(\d{1,12})(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new InputError("Enter the amount as a plain number, such as 3800" + (places ? ".50" : ""));
  const [, minus, whole, fraction = ""] = match;
  if (fraction.length > places) throw new InputError(places ? `${currency} amounts have at most ${places} decimal places` : `${currency} amounts are whole numbers`);
  const minor = Number(whole + fraction.padEnd(places, "0"));
  if (!Number.isSafeInteger(minor)) throw new InputError("That amount is too large");
  return minus ? 0 - minor : minor;
}

/** An amount that must be more than zero (an invoice, a bill, a charge). */
export function parseAmountMinor(text: string, currency: string): number {
  const minor = parseMinor(text, currency);
  if (minor <= 0) throw new InputError("The amount must be more than zero");
  return minor;
}

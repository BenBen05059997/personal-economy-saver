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

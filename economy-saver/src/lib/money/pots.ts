// The share of a payment a pot's fill rule sets aside (D43). Pure; integer minor units.

/** `fillBp` basis points of `creditedMinor`, rounded half up, exact beyond 2^53. */
export function fillShare(creditedMinor: number, fillBp: number): number {
  return Number((BigInt(creditedMinor) * BigInt(fillBp) * BigInt(2) + BigInt(10_000)) / BigInt(20_000));
}

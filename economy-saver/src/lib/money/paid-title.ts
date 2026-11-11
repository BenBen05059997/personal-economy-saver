import { minorMoney } from "./format";

/** The one wording of a payment that arrived: "Acme paid $200", and "(outside PayPal)" when the person recorded it. */
export function paidTitle(clientName: string, amountMinor: number, currency: string, how?: "outside"): string {
  if (currency !== "USD" && currency !== "JPY") throw new Error("Unsupported currency " + currency);
  return `${clientName} paid ${minorMoney(amountMinor, currency)}${how === "outside" ? " (outside PayPal)" : ""}`;
}

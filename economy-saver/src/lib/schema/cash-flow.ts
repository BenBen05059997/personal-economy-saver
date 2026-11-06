// One dated in or out of money, as the engine's `timeline()` returns it (D57), version 1. The `timeline` tool's items are this shape.
// Money is a signed integer count of minor units of the household's home currency: negative goes out, positive comes in.
import { z } from "zod";

export const CASH_FLOW_VERSION = 1;

export const CashFlowEvent = z.object({
  date: z.string().date().describe("The day it happens, YYYY-MM-DD."),
  label: z.string().min(1).describe("Who it is with: a biller, a card statement, a client."),
  kind: z.enum(["bill", "statement", "arrival"]).describe("bill = a stored bill, statement = a card statement paid from the bank, arrival = a client payment expected."),
  amountMinor: z.number().int().safe().describe("Signed integer minor units: negative goes out, positive comes in."),
  currency: z.string().regex(/^[A-Z]{3}$/).describe("ISO 4217 code of the amount."),
  direction: z.enum(["in", "out"]).describe("in = money comes in, out = money goes out; follows the sign of amountMinor."),
  balanceAfterMinor: z.number().int().safe().optional().describe("The running balance after this event, in the same currency. A pending bill is not counted."),
  estimated: z.boolean().optional().describe("true = the amount is an estimate (an amount-varies bill)."),
  pending: z.boolean().optional().describe("true = a bill still waiting in To check; judged as if it were confirmed."),
  uncounted: z.boolean().optional().describe("true = the amount is not known and nothing can estimate it; the event counts as 0."),
}).strict().describe("Version 1 of a dated cash-flow event.");
export type CashFlowEvent = z.infer<typeof CashFlowEvent>;

/** `in` or `out` for a signed amount (zero counts as `in`). */
export const directionOf = (amountMinor: number): "in" | "out" => (amountMinor < 0 ? "out" : "in");

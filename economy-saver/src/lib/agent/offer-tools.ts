import { z } from "zod";
import { InputError } from "@/db/input-error";
import { readAmount } from "@/lib/money/amount";
import { SECRET_REFUSAL } from "@/lib/schema/memory";
import { keepOffer, offerHasLongNumber, type KeepOffer } from "./keep-offer";
import type { Tool, ToolContext } from "./tools";

export const MAX_KEEP_OFFERS = 3;

const input = z.object({ offer: keepOffer }).strict();

/** Check the proposed data with the household's currency and return its numeric value, in minor units for money. */
export function offerValue(offer: KeepOffer, currency: string): number | null {
  if (offerHasLongNumber(offer)) throw new InputError(SECRET_REFUSAL);
  if (offer.kind === "memory") return null;
  if (offer.kind === "goal") return positiveAmount(offer.target, currency);

  const { ruleKind, value, enabled } = offer;
  if (ruleKind === "goal_behind") {
    if (value !== null) throw new InputError("This rule uses on or off.");
    return null;
  }
  if (value === null) {
    if (enabled) throw new InputError("This rule needs a number.");
    return null;
  }
  if (ruleKind === "safe_below") return positiveAmount(value, currency);
  const limit = ruleKind === "cost_up" ? 100 : 30;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > limit) {
    throw new InputError(`Use a whole number from 1 to ${limit} for this rule.`);
  }
  return Number(value);
}

function positiveAmount(text: string, currency: string): number {
  const result = readAmount(text, currency, false);
  if ("problem" in result || result.minor <= 0) throw new InputError("Enter a positive amount in the household's home currency.");
  return result.minor;
}

export const offerTools: Tool[] = [{
  name: "offer_keep", scope: "ask", input,
  description: "Offer one useful thing to keep after the answer, up to three per question. Writes nothing. Use kind memory with memoryKind and the person's own words as text (up to 400 characters), kind goal with name, target (a positive amount in the home currency) and targetDate (YYYY-MM-DD), or kind rule with ruleKind, enabled and value (plain whole days, whole percent, or a home-currency amount as text; null for goal_behind or for turning a rule off without a number). Do not repeat existing memory, goals, or rules, or include a key, password, card or account number.",
  run: async (ctx: ToolContext, { offer }: z.infer<typeof input>) => {
    if (!ctx.onOffer) throw new InputError("Keep offers are available in Ask.");
    ctx.onOffer(offer);
    return "Offered for the person to choose. Nothing was saved.";
  },
}];

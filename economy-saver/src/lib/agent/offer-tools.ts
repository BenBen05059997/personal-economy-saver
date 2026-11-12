import { z } from "zod";
import { InputError } from "@/db/input-error";
import type { Currency } from "@/lib/catalogue/types";
import { readRule } from "@/lib/money/rules";
import { readAmount } from "@/lib/money/amount";
import { SECRET_REFUSAL } from "@/lib/schema/memory";
import { keepOffer, offerHasLongNumber, type KeepOffer } from "./keep-offer";
import type { Tool, ToolContext } from "./tools";

export const MAX_KEEP_OFFERS = 3;

const input = z.object({ offer: keepOffer }).strict();

/** Check the proposed data with the household's currency and return its numeric value, in minor units for money. */
export function offerValue(offer: KeepOffer, currency: Currency): number | null {
  if (offerHasLongNumber(offer)) throw new InputError(SECRET_REFUSAL);
  if (offer.kind === "memory") return null;
  if (offer.kind === "goal") return positiveAmount(offer.target, currency);

  const rule = readRule(offer.ruleKind, offer.enabled, offer.value, currency);
  if ("problem" in rule) throw new InputError(rule.problem);
  return rule.threshold;
}

function positiveAmount(text: string, currency: string): number {
  const result = readAmount(text, currency, false);
  if ("problem" in result || result.minor <= 0) throw new InputError("Enter a positive amount in the household's home currency.");
  return result.minor;
}

export const offerTools: Tool[] = [{
  name: "offer_keep", scope: "ask", input,
  description: "Offer up to three memory items, goals or standing rules, in the person’s words. A rule value is days, percent or an amount.",
  run: async (ctx: ToolContext, { offer }: z.infer<typeof input>) => {
    if (!ctx.onOffer) throw new InputError("Keep offers are available in Ask.");
    ctx.onOffer(offer);
    return "Offered for the person to choose. Nothing was saved.";
  },
}];

import { z } from "zod";
import { RULE_KINDS } from "@/lib/money/suggestion-types";
import { MemoryKind, MemoryText, hasLongNumber } from "@/lib/schema/memory";

const shortText = (max: number) => z.string().trim().min(1).max(max);
const ruleKind = z.enum(RULE_KINDS);

export const keepOffer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("memory"), memoryKind: MemoryKind, text: MemoryText }).strict(),
  z.object({ kind: z.literal("goal"), name: shortText(60), target: shortText(30), targetDate: z.string().date() }).strict(),
  z.object({ kind: z.literal("rule"), ruleKind, enabled: z.boolean(), value: shortText(30).nullable() }).strict(),
]);
type Offer = z.infer<typeof keepOffer>;
export type KeepOffer = Extract<Offer, { kind: "goal" }> | (Exclude<Offer, { kind: "goal" }> & { spaceId?: string });

export function offerHasLongNumber(offer: KeepOffer): boolean {
  switch (offer.kind) {
    case "memory": return hasLongNumber(offer.text);
    case "goal": return [offer.name, offer.target, offer.targetDate].some(hasLongNumber);
    case "rule": return offer.value !== null && hasLongNumber(offer.value);
  }
}

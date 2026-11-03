// The one category list (D46): thirteen keys, the same in every country, with their labels in display order.
// Stored as the key on bills.category and charges.category; every input is validated with the zod enum built from this list.
// A category and a business share move no money: the runway, safe to spend and the sentence never read them.
import { z } from "zod";

export const CATEGORIES = [
  { key: "housing", label: "Housing" },
  { key: "utilities", label: "Utilities" },
  { key: "phone_internet", label: "Phone & internet" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "food", label: "Food" },
  { key: "transport", label: "Transport" },
  { key: "health", label: "Health" },
  { key: "insurance", label: "Insurance" },
  { key: "family_shared", label: "Family & shared" },
  { key: "government_tax", label: "Government & tax" },
  { key: "business_tools", label: "Business tools" },
  { key: "debt", label: "Debt" },
  { key: "other", label: "Other" },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = CATEGORIES.map(c => c.key) as [CategoryKey, ...CategoryKey[]];

/** Validates a category key; the message is shown to the user when a wrong key is refused. */
export const CategoryKeySchema = z.enum(CATEGORY_KEYS, { errorMap: () => ({ message: "Choose a category from the list." }) });

/** A business share in basis points: 0 = personal, 10000 = business, between = mixed (3000 = 30% business). */
export const BusinessBp = z.number({ invalid_type_error: "Enter the business share as a percentage from 0 to 100." })
  .int().min(0, "Enter the business share as a percentage from 0 to 100.").max(10_000, "Enter the business share as a percentage from 0 to 100.");

export const categoryLabel = (key: CategoryKey): string => CATEGORIES.find(c => c.key === key)!.label;

/** The business part of an amount in minor units; the rest is personal, so the two always add up. */
export const businessPart = (amountMinor: number, businessBp: number): number => Math.round(amountMinor * businessBp / 10_000);

/** "30% business", "Business", "Personal". */
export function shareLabel(businessBp: number): string {
  if (businessBp === 0) return "Personal";
  if (businessBp === 10_000) return "Business";
  return `${businessBp / 100}% business`;
}

/**
 * The business share a bill or charge form sends: a choice (personal, business or mixed) and, for mixed, a percentage such as
 * "30" or "12.5". Returns basis points, or null when the choice or the percentage is not valid.
 */
export function businessBpFromForm(choice: FormDataEntryValue | null, percent: FormDataEntryValue | null): number | null {
  if (choice === null || choice === "personal") return 0;
  if (choice === "business") return 10_000;
  if (choice !== "mixed") return null;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(percent ?? "").trim());
  const bp = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : -1;
  return bp < 0 || bp > 10_000 ? null : bp;
}

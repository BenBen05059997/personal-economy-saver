// Own categories (D75): the person's own names under the fixed fourteen categories. Pure text rules shared by the data layer and the screens.
// A category, an own category and a business share move no money: the runway, safe to spend and the sentence never read them.
import { looksLikeApiKey, KEY_TEXT_WORDS } from "@/lib/ai/key-text";
import { CATEGORIES, categoryLabel, type CategoryKey } from "./categories";
import { nameKey, normalise } from "./name-key";

export const OWN_CATEGORY_CAP = 40; // own categories a household may keep
export const OWN_NAME_MAX = 40; // characters in a name

/** An own category as an item carries it. */
export type OwnRef = { id: string; name: string };

export const OWN_CAP_WORDS = `You can keep up to ${OWN_CATEGORY_CAP} of your own categories. Remove one first.`;
export const OWN_NAME_LENGTH_WORDS = `Give your category a name of 1 to ${OWN_NAME_MAX} characters.`;

/** "Food › Coffee", or "Food" for an item with no own category. */
export const ownLabel = (category: CategoryKey, own?: { name: string } | null): string =>
  own ? `${categoryLabel(category)} › ${own.name}` : categoryLabel(category);

/**
 * Why `name` cannot be an own category of `kind`, in the person's words; null when it can. `existing` are the household's own categories
 * of that kind except the one being renamed. Rules: 1 to 40 characters after trimming, no key-shaped text, not one of the fourteen labels,
 * not a second one with the same normalised name under the same kind.
 */
export function ownNameProblem(name: string, kind: CategoryKey, existing: readonly { name: string }[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > OWN_NAME_MAX) return OWN_NAME_LENGTH_WORDS;
  if (looksLikeApiKey(trimmed)) return KEY_TEXT_WORDS;
  const label = CATEGORIES.find(c => normalise(c.label) === normalise(trimmed));
  if (label) return `${label.label} is already a category.`;
  const key = nameKey(trimmed);
  const same = existing.find(e => nameKey(e.name) === key);
  if (same) return `You already have ${same.name} under ${categoryLabel(kind)}.`;
  return null;
}

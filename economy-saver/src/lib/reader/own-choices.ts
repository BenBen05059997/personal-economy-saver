// Own categories on the forms (D75): what the browser holds to offer "Your category", and how a posted form says which one. Pure text, safe in the browser.
import { nameKey } from "@/lib/money/name-key";

/** One own category as a form offers it. */
type OwnOption = { id: string; kind: string; name: string; businessBp: number | null };
/** The household's own categories and, for each category and name key, the own category of the latest confirmed item that has one ("it files itself"). */
export type OwnChoices = { categories: OwnOption[]; guesses: Record<string, string> };

export const NEW_OWN = "new"; // the select's value for "New…"
const guessKey = (kind: string, name: string): string => `${kind}|${nameKey(name)}`;

/** The own category a typed name files itself under, or null (the name matches the latest confirmed item of the same category that has one). */
export function guessedOwn(own: OwnChoices | undefined, kind: string, name: string): OwnOption | null {
  if (!own || name.trim() === "" || kind === "") return null;
  const id = own.guesses[guessKey(kind, name)];
  return own.categories.find(c => c.id === id && c.kind === kind) ?? null;
}

/**
 * The choice a posted form carries: the select `ownCategory` ("" = none, an id, or `new` with the name in `ownCategoryNew`).
 * A form without the select says nothing (`{}`), so a write that does not show it leaves an item's own category as it is.
 */
export function ownChoiceFromForm(form: FormData): { ownCategoryId?: string | null; ownCategoryNew?: string } {
  const picked = form.get("ownCategory");
  if (typeof picked !== "string") return {};
  if (picked === "") return { ownCategoryId: null };
  if (picked === NEW_OWN) {
    const name = form.get("ownCategoryNew");
    return typeof name === "string" && name.trim() !== "" ? { ownCategoryNew: name } : { ownCategoryId: null };
  }
  return { ownCategoryId: picked };
}

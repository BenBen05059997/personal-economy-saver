// D36 and D58: the one line the review card offers to tell the assistant when the person changed what was read. Pure: the card
// (in the browser) and the confirm (on the server) both call it. Only the name, the category, the work share and the card are
// ever offered; an amount or a date changes this document only.
import { categoryLabel, type CategoryKey } from "@/lib/money/categories";
import { MEMORY_TEXT_MAX, hasLongNumber } from "@/lib/schema/memory";

const sharePhrase = (bp: number) => bp === 0 ? "personal" : bp === 10_000 ? "all for work" : `${bp / 100}% for work`;

export type Correctable = { kind: "bill" | "charge"; name: string | null; category: CategoryKey | null; businessBp: number | null; cardId: string | null };

/**
 * What to remember when `confirmed` differs from `read` in name, category, work share or card; null when it does not, or when
 * the line would be too long or would hold a long number. `cardLabel` is the name of the confirmed card, for a charge.
 */
export function correctionText(read: Correctable, confirmed: Correctable, cardLabel?: string | null): string | null {
  const name = confirmed.name?.trim();
  const from = read.name?.trim();
  if (!name || !from) return null;
  const changed = name !== from || read.category !== confirmed.category || (read.businessBp ?? 0) !== (confirmed.businessBp ?? 0) || read.cardId !== confirmed.cardId;
  if (!changed) return null;
  const parts = [name];
  if (confirmed.category) parts.push(categoryLabel(confirmed.category));
  if (confirmed.businessBp !== null && confirmed.category) parts.push(sharePhrase(confirmed.businessBp));
  if (confirmed.kind === "charge" && confirmed.cardId && cardLabel) parts.push(`on ${cardLabel}`);
  const text = `${confirmed.kind === "charge" ? "Charges" : "Bills"} from “${from}” are ${parts.join(", ")}.`;
  return text.length > MEMORY_TEXT_MAX || hasLongNumber(text) ? null : text;
}

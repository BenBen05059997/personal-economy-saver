// D61: the card Ask draws for a file attached there. Pure: no I/O. Code writes every word on it (no model sentence); the numbers come from
// the reader's own extraction and the engine (checks, the canvas), never from a model's reply.
import type { Check, Proposal } from "@/lib/money/checks";
import { checksFor, readingProposal } from "@/lib/money/checks";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { AMOUNT_NOT_KNOWN, DATE_NOT_KNOWN } from "@/lib/money/gaps";
import { categoryLabel } from "@/lib/money/categories";
import { monthByCategory } from "@/lib/money/month";
import { addDays, daysBetween, WINDOW_DAYS } from "@/lib/money/runway";
import { HISTORY_MONTHS, monthBounds, monthName, monthsBack, spendingItems } from "@/lib/money/spending";
import type { LinkPreview } from "@/lib/money/varies";
import type { Extracted, Whose } from "@/lib/reader/extract";
import { CanvasError, resolveRecipe, type CanvasContext, type ResolvedBlock } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";

/** The fixed words of a file attached in Ask (D61). Code writes all of them; no model words the card. */
export const DOCUMENT_WORDS = {
  question: "Here's my bill", // the turn's question when the person typed nothing
  sent: "Got your file. Nothing is added until you confirm.", // the turn's stored reply (never changes)
  reading: "Reading your bill…",
  stillReading: "Still reading. It will be waiting in To check.", // the page's words after 60 s of polling
  read: "Read from your bill:",
  nothing: "Nothing to add was found in this file.",
  failed: (reason: string) => `This file could not be read: ${reason}`,
  deleted: "This file was deleted.",
  notKept: "This file is not kept here. Import brings back the conversation, not the files.", // a turn with no documentId (imported)
  confirmed: "Confirmed. Here is your month with it.",
  added: "Added.",
  notAdded: "Not added.",
  answerFirst: (words: string) => `Answer the question first: ${words}`,
} as const;

export type DocumentCardItem = {
  readingId: string;
  status: "to_check" | "confirmed" | "rejected";
  read: string; // readLine(value, cards): "Kawa Gym · ¥6,000 · due Dec 27"
  value: Extracted; // the confirmed value once confirmed, otherwise as proposed (stored rules applied)
  link: LinkPreview | null; // D54's line, for a to_check one-off bill only (from readerInbox); else null
  checks: Check[]; // checksFor(readingProposal(...), state, waiting); [] unless to_check
  target: { kind: "bill" | "charge"; id: string } | null; // the saved bill or charge once confirmed (readings.extracted.targetId); else null
  saved: SavedCard | null; // where the confirmed item now lives; null unless confirmed (and the money state was loaded)
};

/** What a confirmed item shows instead of "Added.": one line and the pages it can be found on. */
export type SavedCard = { words: string; links: { label: string; href: string }[] };

export type DocumentCard = {
  documentId: string;
  status: "reading" | "failed" | "read" | "gone"; // queued|reading → reading; no row (deleted, or another household's) → gone
  words: string;
  error: string | null; // the reader's own words when failed (documents.error); else null
  items: DocumentCardItem[]; // reading order: readings.created_at, then id
  canvas: { recipe: Recipe; blocks: ResolvedBlock[] } | null; // once an item is confirmed; else null
};

/** Whether the card must open the full form: something Confirm needs is missing, including a currency for an amount that was read without one. */
export const needsForm = (value: Extracted): boolean =>
  !value.category || !value.name || (value.kind === "charge" && !value.cardId) || (value.amountMinor !== null && !value.currency);

/** The read line: name (or "Bill" / "Card charge"), amount (or AMOUNT_NOT_KNOWN), "due <day>" for a bill or "<day>" for a charge (or DATE_NOT_KNOWN), then "every month" / "every year" when the bill repeats, then the card's label for a charge when known. Joined with " · ". */
export function readLine(value: Extracted, cards: readonly { id: string; label: string }[]): string {
  const bill = value.kind === "bill";
  const parts = [
    value.name ?? (bill ? "Bill" : "Card charge"),
    value.amountMinor !== null && value.currency !== null ? minorMoney(value.amountMinor, value.currency) : AMOUNT_NOT_KNOWN,
    value.date === null ? DATE_NOT_KNOWN : bill ? `due ${dayLabel(value.date)}` : dayLabel(value.date),
  ];
  if (bill && value.repeat !== null) parts.push(value.repeat === "month" ? "every month" : "every year");
  if (!bill) { const card = cards.find(c => c.id === value.cardId); if (card) parts.push(card.label); }
  return parts.join(" · ");
}

/**
 * D61: the line and the links under a confirmed item. Code writes the line from the stored record and D53's month view (the same
 * `monthByCategory` Spending draws, so the two agree to the yen). A part that is unknown is left out, and so is the month when Spending cannot
 * show it (it shows the last HISTORY_MONTHS months up to the current one). `seriesId` is the repeating series the bill is, or joined (D54).
 */
export function savedCard(
  item: { value: Extracted; target: { kind: "bill" | "charge"; id: string }; seriesId: string | null },
  context: Pick<CanvasContext, "state" | "spending">,
): SavedCard {
  const { value, target } = item, { today, cards } = context.state;
  const bill = target.kind === "bill", date = value.date, category = value.category;
  const current = today.slice(0, 7), month = date?.slice(0, 7) ?? null;
  const shown = month !== null && month >= monthsBack(current, HISTORY_MONTHS) && month <= current ? month : null;
  // The stored row (in the home currency), found by id and day; absent when Spending cannot show that month.
  const stored = shown !== null && date !== null ? spendingItems(context.spending, monthBounds(shown).first, monthBounds(shown).last).find(i => i.id === target.id && i.date === date) : undefined;
  const amount = stored ? (stored.uncounted ? null : minorMoney(stored.amountMinor, context.spending.homeCurrency))
    : value.amountMinor !== null && value.currency !== null ? minorMoney(value.amountMinor, value.currency) : null;
  const name = value.name ?? (bill ? "Bill" : "Card charge");
  const cardLabel = bill ? undefined : cards.find(c => c.id === value.cardId)?.label;
  const parts = [amount ? `${name} ${amount}` : name];
  const whose = whoseWords(target.kind, value.whose, context.state.split.members, bill ? undefined : context.state.cards.find(c => c.id === value.cardId)?.ownerId ?? null);
  if (whose) parts.push(whose);
  if (category) parts.push(categoryLabel(category));
  if (date) parts.push(bill ? `due ${dayLabel(date)}` : cardLabel ? `${cardLabel}, ${dayLabel(date)}` : dayLabel(date));
  const total = shown !== null && category && amount !== null && stored
    ? monthByCategory(context.spending, today, shown).categories.find(c => c.category === category)?.totalMinor : undefined;
  if (category && shown !== null && total !== undefined) parts.push(`${categoryLabel(category)} in ${monthName(shown)}: ${minorMoney(total, context.spending.homeCurrency)} with this ${bill ? "bill" : "charge"}`);

  const links: SavedCard["links"] = [];
  const mark = item.seriesId ? `series-${item.seriesId}` : `bill-${target.id}`;
  links.push(bill ? { label: "See it in Bills", href: `/bills#${mark}` } : { label: "See it in Cards", href: `/cards/${value.cardId}#charge-${target.id}` });
  if (shown !== null && category) links.push({ label: `${categoryLabel(category)} in ${monthName(shown)}`, href: `${shown === current ? "/spending" : `/spending?month=${shown}`}#category-${category}` });
  if (bill && date && date >= today && date <= addDays(today, WINDOW_DAYS)) links.push({ label: "Coming up on Home", href: `/#${mark}` });
  return { words: `Saved: ${parts.join(" · ")}${parts.length > 1 ? "." : ""}`, links };
}

/**
 * D45: whose a reading is, in words: "Aki's", "Shared, Aki pays", "Shared". A charge not marked shared is the card's owner's, so it has none (null).
 * `payerId` is who pays: a shared bill's payer, or a shared charge's card owner.
 */
export function whoseWords(kind: "bill" | "charge", whose: Whose | null | undefined, members: readonly { id: string; name: string }[], payerId: string | null = whose?.paidByMemberId ?? null): string | null {
  if (!whose || members.length < 2) return null;
  const name = (id: string | null) => members.find(member => member.id === id)?.name;
  if (kind === "bill" && whose.memberId) { const owner = name(whose.memberId); return owner ? `${owner}\u2019s` : null; }
  if (!whose.shared) return null;
  const payer = name(payerId);
  return payer ? `Shared, ${payer} pays` : "Shared";
}

/** D45: the Whose select's choice for a stored whose: a bill's owner or "shared"; a charge's "shared" or "own" (the card's owner). */
export const whoseChoice = (kind: "bill" | "charge", whose: Whose | null | undefined): string =>
  kind === "charge" ? (whose?.shared ? "shared" : "own") : whose?.memberId ?? "shared";

const later = (a: string, b: string) => (a > b ? a : b);

/** The canvas drawn after Confirm: what the item changed first (a bill or a card charge), then the sentence, the chart and the timeline over the days to the month end (or the bill), the bill marked. */
export function documentCanvas(today: string, item: { name: string; billId: string | null; chargeId?: string | null; due: string | null }): Recipe {
  const end = later(monthBounds(today.slice(0, 7)).last, item.due ?? today);
  const days = Math.min(60, Math.max(7, daysBetween(today, end) + 1));
  const mark = item.billId ? { mark: item.billId } : {};
  return {
    version: 1, title: `${item.name.slice(0, 64)} in your month`,
    blocks: [
      ...(item.billId ?? item.chargeId ? [{ type: "view" as const, view: "what_changed" as const, args: { itemId: (item.billId ?? item.chargeId)! } }] : []),
      { type: "sentence", query: { q: "sentence" } },
      { type: "flow_chart", query: { q: "flow", days }, ...mark },
      { type: "timeline", query: { q: "events", days }, ...mark },
    ],
  };
}

/** One reading of this document, as `src/db/document-card.ts` loads it. */
export type CardReading = { id: string; status: "to_check" | "confirmed" | "rejected"; value: Extracted; link: LinkPreview | null; targetId: string | null; seriesId?: string | null; confirmedAt: string | null };

/** The card. `context` is null only when nothing needs the money state (no readings, or `draw: false`); `waiting` is every to_check reading of the household as proposals. */
export function buildCard(
  input: { documentId: string; doc: { status: "queued" | "reading" | "read" | "failed"; error: string | null } | null; readings: CardReading[] },
  context: CanvasContext | null, waiting: readonly Proposal[] = [],
): DocumentCard {
  const { documentId, doc, readings } = input;
  if (doc === null) return { documentId, status: "gone", words: DOCUMENT_WORDS.deleted, error: null, items: [], canvas: null };
  if (doc.status === "queued" || doc.status === "reading") return { documentId, status: "reading", words: DOCUMENT_WORDS.reading, error: null, items: [], canvas: null };
  if (doc.status === "failed") return { documentId, status: "failed", words: DOCUMENT_WORDS.failed(doc.error ?? "Try again."), error: doc.error, items: [], canvas: null };
  const cards = context?.state.cards ?? [];
  const items = readings.map((reading): DocumentCardItem => ({
    readingId: reading.id, status: reading.status, read: readLine(reading.value, cards), value: reading.value,
    link: reading.status === "to_check" ? reading.link : null,
    checks: reading.status === "to_check" && context ? checksFor(readingProposal({ id: reading.id, value: reading.value }), context.state, waiting) : [],
    target: reading.status === "confirmed" && reading.targetId ? { kind: reading.value.kind, id: reading.targetId } : null,
    saved: null,
  }));
  if (context) for (const [index, item] of items.entries()) if (item.target) item.saved = savedCard({ value: item.value, target: item.target, seriesId: readings[index].seriesId ?? null }, context);
  let canvas: DocumentCard["canvas"] = null;
  if (context) {
    const last = readings.map((reading, index) => ({ reading, index })).filter(({ reading }) => reading.status === "confirmed")
      .sort((a, b) => (b.reading.confirmedAt ?? "").localeCompare(a.reading.confirmedAt ?? "") || b.index - a.index)[0];
    if (last) {
      const item = items[last.index];
      const recipe = documentCanvas(context.state.today, { name: item.value.name ?? (item.value.kind === "bill" ? "Bill" : "Card charge"), billId: item.target?.kind === "bill" ? item.target.id : null, chargeId: item.target?.kind === "charge" ? item.target.id : null, due: item.value.date });
      // What it changed needs the item in the money state; an item the state no longer holds (a charge long past) leaves the month as it was drawn before.
      const target = item.target, held = target !== null && (target.kind === "bill"
        ? context.state.bills.some(bill => bill.id === target.id || bill.id.split("@")[0] === target.id) || context.state.storedBills.some(bill => bill.id === target.id)
        : context.state.charges.some(charge => charge.id === target.id));
      const drawn = held ? recipe : { ...recipe, blocks: recipe.blocks.filter(block => block.type !== "view") };
      try { canvas = { recipe: drawn, blocks: resolveRecipe(drawn, context) }; } catch (error) { if (!(error instanceof CanvasError)) throw error; }
    }
  }
  const words = items.length === 0 ? DOCUMENT_WORDS.nothing : canvas ? DOCUMENT_WORDS.confirmed : DOCUMENT_WORDS.read;
  return { documentId, status: "read", words, error: null, items, canvas };
}

/** The text a document turn stands for in the conversation context (ask.ts): the card's words, then each item's read line with "waiting for the user's OK" / "added" / "not added". Never an amount source. */
export function cardContext(card: DocumentCard): string {
  const state = { to_check: "waiting for the user's OK", confirmed: "added", rejected: "not added" } as const;
  return [card.words, ...card.items.map(item => `${item.read} (${state[item.status]})`)].join("\n");
}

import type { KeepOffer } from "./keep-offer";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import type { TurnKind, TurnSource } from "@/lib/schema/turn";
import type { ViewResult } from "@/lib/views/types";

/** What a turn's drafts are now, read from the rows (D60): waiting in To check, confirmed, or removed (not added). */
export type DraftState = "waiting" | "confirmed" | "not_added";
export type DraftKind = "bill" | "charge" | "pot" | "balance";
/** One thing the turn drafted, as the thread draws it. Every word is written by code from the rows and the engine (D40); `result` is the what_changed view, drawn through ViewCard. */
export type DraftView = {
  id: string; kind: DraftKind; state: DraftState;
  kindLabel: string; // "Card charge"
  name: string; // "Groceries ¥8,400"
  fields: { label: string; value: string }[];
  saved: { day: string | null; line: string } | null; // confirmed: the day it counts from and the one line of what was saved
  result: ViewResult | null; // pending: "If you confirm"; confirmed: "What changed"; null when the engine cannot compare it
  title: string; // "What changed: Groceries ¥8,400 on Card B"
  places: { label: string; href: string }[]; // the See it buttons
  edit: string | null; // where the item is edited
  remove: "/api/remove" | "/api/pots/remove" | null; // the route behind Don't add; none for a balance, which To check cannot remove either
  removeKind: "bill" | "charge" | null;
};

export type TurnView = {
  id: string; question: string; kind: TurnKind; text: string; choices: string[] | null;
  sources: TurnSource[]; links: { label: string; href: string }[]; thumb: 1 | -1 | null; documentId: string | null; offers?: KeepOffer[];
  incognito?: boolean; openSpace?: { name: string };
  /** What this turn drafted. Set when the thread is loaded; a turn answered just now has none until the thread asks. */
  drafts?: DraftView[];
};
export type Drawn = { key: string; title: string; recipe: Recipe; blocks: ResolvedBlock[] };

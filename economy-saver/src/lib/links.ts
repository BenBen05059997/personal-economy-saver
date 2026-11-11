import type { AddKind } from "@/components/add/context";
/** Where a thing lives in the app. Pure: every link to an invoice, bill, card, client, pot or setting is built here. */
export const HOUSEHOLD_PEOPLE = "/household/people";

/** The Add page for one kind of thing, the no-JS twin of the Add dialog; `back` is the page to return to. */
export function addHref(kind: AddKind, back: string): string {
  return `/add/${kind}?back=${encodeURIComponent(back)}`;
}

/** Where an old Settings #anchor lives now, or null when the anchor is not one that moved (it stays on /settings). */
export function movedAnchor(hash: string): string | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  switch (id) {
    case "people":
    case "add-person": return HOUSEHOLD_PEOPLE;
    case "family-view": return `${HOUSEHOLD_PEOPLE}#family-view`;
    case "cards": return "/cards";
    case "forwarding": return "/bills#forwarding";
    case "categories": return "/spending/categories";
    case "ai-model": return "/settings/ai-model";
    case "mcp": return "/settings/ai-model#mcp";
    case "your-data": return "/settings/data";
  }
  const bill = /^bill-([0-9a-f-]{36})$/.exec(id);
  return bill ? `/bills/${bill[1]}` : null;
}

type LinkTarget = {
  type: "invoice" | "bill" | "charge" | "pot" | "card" | "client" | "statement" | "settings";
  id?: string;
};

/** A bill opens its page under Bills; a statement is its card's page (id = card id); a charge has no page of its own, so it opens the cards list (an event for a charge carries its card, which has one). */
export function hrefFor({ type, id }: LinkTarget): string {
  if (type === "settings") return "/settings";
  if (type === "charge") return "/cards";
  if (id === undefined) throw new Error(`A ${type} link needs an id`);
  switch (type) {
    case "invoice": return `/invoices/${id}`;
    case "bill": return `/bills/${id}`;
    case "pot": return `/saving/${id}`;
    case "card":
    case "statement": return `/cards/${id}`;
    case "client": return `/clients/${id}`;
  }
}

/** The page an event row (ref_type, ref_id) is about, or null when there is nothing to open. */
export function hrefForRef(refType: string | null, refId: string | null): string | null {
  if (!refType) return null;
  if (refType === "invoice" || refType === "bill" || refType === "pot" || refType === "client") return refId ? hrefFor({ type: refType, id: refId }) : null;
  if (refType === "card") return refId ? hrefFor({ type: "card", id: refId }) : null;
  if (refType === "charge") return hrefFor({ type: "charge" });
  if (refType === "member" || refType === "balance") return refType === "member" ? HOUSEHOLD_PEOPLE : "/#bank-balance";
  if (refType === "reading") return refId ? `/to-check#reading-${refId}` : "/to-check";
  return null;
}

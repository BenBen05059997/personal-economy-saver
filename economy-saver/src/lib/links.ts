/** Where a thing lives in the app. Pure: every link to an invoice, bill, card, client, pot or setting is built here. */
export const ADD_BILL = "/#add-bill";
export const ADD_CHARGE = "/#add-charge";
export const SETTINGS_CARDS = "/settings#cards";
export const SETTINGS_PEOPLE = "/settings#people";

export type LinkTarget = {
  type: "invoice" | "bill" | "charge" | "pot" | "card" | "client" | "statement" | "settings";
  id?: string;
};

/** A bill opens its row in Settings; a statement is its card's page (id = card id); a charge has no page of its own, so it opens the cards list. */
export function hrefFor({ type, id }: LinkTarget): string {
  if (type === "settings") return "/settings";
  if (type === "charge") return "/cards";
  if (id === undefined) throw new Error(`A ${type} link needs an id`);
  switch (type) {
    case "invoice": return `/invoices/${id}`;
    case "bill": return `/settings#bill-${id}`;
    case "pot": return `/plan#pot-${id}`;
    case "card":
    case "statement": return `/cards/${id}`;
    case "client": return `/clients/${id}`;
  }
}

/** The page an event row (ref_type, ref_id) is about, or null when there is nothing to open. */
export function hrefForRef(refType: string | null, refId: string | null): string | null {
  if (!refType) return null;
  if (refType === "invoice" || refType === "bill" || refType === "pot" || refType === "client") return refId ? hrefFor({ type: refType, id: refId }) : null;
  if (refType === "charge") return hrefFor({ type: "charge" });
  if (refType === "member" || refType === "balance") return refType === "member" ? SETTINGS_PEOPLE : hrefFor({ type: "settings" });
  if (refType === "reading") return refId ? `/to-check#reading-${refId}` : "/to-check";
  return null;
}

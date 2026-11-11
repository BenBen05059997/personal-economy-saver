import { appUrl } from "@/lib/supabase-auth";

/** A payment link's token: 32 random bytes, base64url. */
export function newPayToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** The permanent fipa address of a payment link. */
export function payLinkUrl(token: string): string {
  return `${appUrl().origin}/pay/${token}`;
}

/** Why a link cannot be made for this invoice, or null when it can. A link is made for a positive USD amount only. */
export function payLinkRefusal(invoice: { currency: string; amountMinor: number }): "not USD" | "no positive amount" | null {
  if (invoice.currency !== "USD") return "not USD";
  return invoice.amountMinor > 0 ? null : "no positive amount";
}

export const canHavePayLink = (invoice: { currency: string; amountMinor: number }) => payLinkRefusal(invoice) === null;

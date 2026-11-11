import { appUrl } from "@/lib/supabase-auth";

/** A payment link's token: 32 random bytes, base64url. */
export function newPayToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** The permanent fipa address of a payment link. */
export function payLinkUrl(token: string): string {
  return `${appUrl().origin}/pay/${token}`;
}

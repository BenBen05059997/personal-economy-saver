import { z } from "zod";
import { env } from "@/lib/env";
import { appUrl } from "@/lib/supabase-auth";
import { PayPalError } from "@/lib/paypal/client";
import type { PayPalCall } from "@/lib/paypal/contracts";

/** What fipa asks the person to allow: take payments for them, see their account details, search their transactions. */
export const REFERRAL_FEATURES = ["PAYMENT", "ACCESS_MERCHANT_INFORMATION", "ADVANCED_TRANSACTIONS_SEARCH"] as const;

/** Where PayPal sends the person after sign-up. The tracking id the owner just started rides on it and is checked against the stored one. */
export function returnUrl(trackingId: string): string {
  return `${appUrl().origin}/api/paypal/connect/return?tracking_id=${encodeURIComponent(trackingId)}`;
}

export function referralBody(trackingId: string) {
  return {
    tracking_id: trackingId,
    partner_config_override: { return_url: returnUrl(trackingId) },
    operations: [{
      operation: "API_INTEGRATION",
      api_integration_preference: { rest_api_integration: {
        integration_method: "PAYPAL",
        integration_type: "THIRD_PARTY",
        third_party_details: { features: [...REFERRAL_FEATURES] },
      } },
    }],
    products: ["EXPRESS_CHECKOUT"],
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
  };
}

const referralResponse = z.object({ links: z.array(z.object({ rel: z.string(), href: z.string() })) });

/** Asks PayPal for the sign-up link tied to a tracking id. The link works once. */
export async function createReferral(call: PayPalCall, trackingId: string): Promise<string> {
  const parsed = referralResponse.safeParse(await call({ method: "POST", path: "/v2/customer/partner-referrals", body: referralBody(trackingId) }));
  const href = parsed.success ? parsed.data.links.find(link => link.rel === "action_url")?.href : undefined;
  if (!href) throw new PayPalError("PayPal did not return a sign-up link");
  const url = new URL(href);
  if (url.protocol !== "https:" || !(url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"))) throw new PayPalError("PayPal returned an unexpected sign-up link");
  return url.toString();
}

export type SellerStatus =
  | { found: false }
  | { found: true; merchantId: string; email: string | null; ready: boolean; missing: string[] };

const lookup = z.object({ merchant_id: z.string().min(1) }).passthrough();
const status = z.object({
  merchant_id: z.string().optional(),
  primary_email: z.string().optional(),
  primary_email_confirmed: z.boolean().optional(),
  payments_receivable: z.boolean().optional(),
  oauth_integrations: z.array(z.object({
    oauth_third_party: z.array(z.object({ partner_client_id: z.string().optional() }).passthrough()).optional(),
  }).passthrough()).optional(),
}).passthrough();

/**
 * Asks PayPal who signed up under a tracking id, then for that account's status. PayPal answering 404 means it does not
 * know the sign-up yet. Ready only when the account can receive payments, its email is confirmed and fipa's permission
 * is granted (matched on the partner client id, never on the integration type's spelling).
 */
export async function sellerStatus(call: PayPalCall, trackingId: string): Promise<SellerStatus> {
  const partner = env().PAYPAL_PARTNER_MERCHANT_ID;
  const base = `/v1/customer/partners/${encodeURIComponent(partner)}/merchant-integrations`;
  let found;
  try {
    found = await call({ method: "GET", path: `${base}?tracking_id=${encodeURIComponent(trackingId)}` });
  } catch (error) {
    if (error instanceof PayPalError && error.status === 404) return { found: false };
    throw error;
  }
  const merchant = lookup.safeParse(found);
  if (!merchant.success) return { found: false };
  const merchantId = merchant.data.merchant_id;
  const detail = status.parse(await call({ method: "GET", path: `${base}/${encodeURIComponent(merchantId)}` }));
  const granted = (detail.oauth_integrations ?? []).some(item => (item.oauth_third_party ?? []).some(third => third.partner_client_id === env().PAYPAL_CLIENT_ID));
  const missing: string[] = [];
  if (detail.payments_receivable !== true) missing.push("PayPal says this account can't receive payments yet. Finish setting up payments in PayPal.");
  if (detail.primary_email_confirmed !== true) missing.push("Confirm your email address in PayPal.");
  if (!granted) missing.push("fipa's permission isn't granted yet. Connect again and allow it in PayPal.");
  return { found: true, merchantId, email: detail.primary_email ?? null, ready: missing.length === 0, missing };
}

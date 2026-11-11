import { env } from "@/lib/env";
import { paypalRead } from "@/lib/paypal/client";

export type PayPalWebhookEvent = {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  resource?: { id?: string; [key: string]: unknown };
  summary?: string;
};

type WebhookVerification =
  | { verified: true; event: PayPalWebhookEvent }
  | { verified: false; reason: string; event?: PayPalWebhookEvent };

const REQUIRED_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

// Asks PayPal to verify the signature of a delivery. `rawBody` is the untouched request text.
export async function verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookVerification> {
  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PayPalWebhookEvent;
  } catch {
    return { verified: false, reason: "Body is not valid JSON" };
  }
  if (typeof event !== "object" || event === null || Array.isArray(event)) return { verified: false, reason: "Body is not a webhook event" };

  let webhookId: string | undefined;
  try {
    webhookId = env().PAYPAL_WEBHOOK_ID;
  } catch (error) {
    return { verified: false, reason: errorMessage(error), event };
  }
  if (!webhookId) {
    return { verified: false, reason: "PAYPAL_WEBHOOK_ID is not set", event };
  }

  const signed: Record<string, string> = {};
  const missing: string[] = [];
  for (const [field, header] of Object.entries(REQUIRED_HEADERS)) {
    const value = headers.get(header);
    if (value) signed[field] = value;
    else missing.push(header);
  }
  if (missing.length > 0) {
    return { verified: false, reason: `Missing headers: ${missing.join(", ")}`, event };
  }

  try {
    const result = await paypalRead({
      method: "POST",
      path: "/v1/notifications/verify-webhook-signature",
      bodyText: verificationBody(signed, webhookId, rawBody),
    }) as { verification_status?: string } | undefined;
    if (result?.verification_status === "SUCCESS") return { verified: true, event };
    return {
      verified: false,
      reason: `PayPal verification status: ${result?.verification_status ?? "unknown"}`,
      event,
    };
  } catch (error) {
    return { verified: false, reason: `Verification call failed: ${errorMessage(error)}`, event };
  }
}

/**
 * The verify call's body with the event exactly as PayPal sent it: re-serialising a parsed event can change its number
 * formatting or escapes and fail a genuine delivery. `rawBody` has already parsed as a JSON object.
 */
export function verificationBody(signed: Record<string, string>, webhookId: string, rawBody: string): string {
  const head = JSON.stringify({ ...signed, webhook_id: webhookId });
  return `${head.slice(0, -1)},"webhook_event":${rawBody}}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

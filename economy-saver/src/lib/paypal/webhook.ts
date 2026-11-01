import { env } from "@/lib/env";
import { paypalFetch } from "@/lib/paypal/client";

export type PayPalWebhookEvent = {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  resource?: { id?: string; [key: string]: unknown };
  summary?: string;
};

export type WebhookVerification =
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
    const result = await paypalFetch<{ verification_status?: string }>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: JSON.stringify({ ...signed, webhook_id: webhookId, webhook_event: event }),
      },
    );
    if (result.verification_status === "SUCCESS") return { verified: true, event };
    return {
      verified: false,
      reason: `PayPal verification status: ${result.verification_status ?? "unknown"}`,
      event,
    };
  } catch (error) {
    return { verified: false, reason: `Verification call failed: ${errorMessage(error)}`, event };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

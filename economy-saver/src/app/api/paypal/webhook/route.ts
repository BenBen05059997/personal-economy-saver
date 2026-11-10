import { db, MissingDatabaseUrl } from "@/db/client";
import { withHousehold } from "@/db/household";
import { ClientIpError, clientIp, consumeIpRequest } from "@/db/rate-limit";
import { env } from "@/lib/env";
import { applyVerifiedDelivery, recentDeliveries } from "@/lib/events";
import { verifyWebhook } from "@/lib/paypal/webhook";
import { boundedText, NO_STORE, text, tooMany } from "@/lib/door";
import { currentHouseholdId } from "@/lib/session";

/** A PayPal event is a few KB; anything over this is refused before it is read in full. */
const MAX_WEBHOOK_BYTES = 64 * 1024;
/** Deliveries one client address may send in a minute, counted before any call to PayPal. */
const WEBHOOKS_PER_MINUTE = 120;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) return text("Body too large", 413);
  try {
    if (!await consumeIpRequest(db(), clientIp(request), "webhook", WEBHOOKS_PER_MINUTE, "minute")) return tooMany("Too many requests");
  } catch (error) {
    if (error instanceof ClientIpError || error instanceof MissingDatabaseUrl) return text(error.message, error instanceof ClientIpError ? error.status : 503);
    throw error;
  }
  const raw = await boundedText(request, MAX_WEBHOOK_BYTES);
  if (raw === null) return text("Body too large", 413);
  const result = await verifyWebhook(raw, request.headers);
  if (!result.verified) {
    // The reason stays in the server log; an anonymous caller learns nothing about our settings.
    console.warn(`[webhook] rejected: ${result.reason}`);
    return Response.json({ received: false }, { status: 400 });
  }
  await applyVerifiedDelivery(db(), result.event);
  return Response.json({ received: true });
}

// Sandbox diagnostics: only the caller's deliveries, without any raw PayPal payload. Incomplete PayPal settings are a 503 that names the setting.
export async function GET() {
  try { env(); } catch (error) { return text((error as Error).message, 503); }
  const hid = await currentHouseholdId();
  if (!hid) return Response.json({ error: "Household session required" }, { status: 401 });
  return Response.json({ events: await withHousehold(db(), hid, async tx => recentDeliveries(tx, hid)) }, { headers: NO_STORE });
}

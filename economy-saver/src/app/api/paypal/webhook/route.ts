import { db } from "@/db/client";
import { applyVerifiedDelivery } from "@/lib/events";
import { captureOrder } from "@/lib/paypal/send";
import { verifyWebhook } from "@/lib/paypal/webhook";
import { boundedText, ipLimited, text } from "@/lib/door";

/** A PayPal event is a few KB; anything over this is refused before it is read in full. */
const MAX_WEBHOOK_BYTES = 64 * 1024;
/** Deliveries one client address may send in a minute, counted before any call to PayPal. */
const WEBHOOKS_PER_MINUTE = 120;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) return text("Body too large", 413);
  const busy = await ipLimited(request, "webhook", WEBHOOKS_PER_MINUTE, "minute", "Too many requests");
  if (busy) return busy;
  const raw = await boundedText(request, MAX_WEBHOOK_BYTES);
  if (raw === null) return text("Body too large", 413);
  const result = await verifyWebhook(raw, request.headers);
  if (!result.verified) {
    // The reason stays in the server log; an anonymous caller learns nothing about our settings.
    console.warn(`[webhook] rejected: ${result.reason}`);
    return Response.json({ received: false }, { status: 400 });
  }
  try {
    await applyVerifiedDelivery(db(), result.event, captureOrder);
  } catch (error) {
    // Nothing was kept for this delivery, so PayPal sends it again. If PayPal stops retrying, this line is what finds the
    // payment by hand: PayPal's event id, its type and the order (no amounts, no people, no secrets).
    const event = result.event;
    const resource = (event.resource ?? {}) as { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
    const order = event.event_type.startsWith("CHECKOUT.ORDER.") ? resource.id : resource.supplementary_data?.related_ids?.order_id;
    console.error(`[webhook] not applied, PayPal will resend: event ${event.id} ${event.event_type} resource ${resource.id ?? "none"} order ${order ?? "none"}: ${String((error as Error).message).slice(0, 200)}`);
    return Response.json({ received: false }, { status: 500 });
  }
  return Response.json({ received: true });
}

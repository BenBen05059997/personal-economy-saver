import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { env } from "@/lib/env";
import { applyVerifiedDelivery, recentDeliveries } from "@/lib/events";
import { verifyWebhook } from "@/lib/paypal/webhook";
import { NO_STORE } from "@/lib/door";
import { currentHouseholdId } from "@/lib/session";

export async function POST(request: Request) {
  const result = await verifyWebhook(await request.text(), request.headers);
  if (!result.verified) {
    // The reason stays in the server log; an anonymous caller learns nothing about our settings.
    console.warn(`[webhook] rejected: ${result.reason}`);
    return Response.json({ received: false }, { status: 400 });
  }
  await applyVerifiedDelivery(db(), result.event);
  return Response.json({ received: true });
}

// Sandbox diagnostics: only the caller's deliveries, without any raw PayPal payload.
export async function GET() {
  env();
  const hid = await currentHouseholdId();
  if (!hid) return Response.json({ error: "Household session required" }, { status: 401 });
  return Response.json({ events: await withHousehold(db(), hid, async tx => recentDeliveries(tx, hid)) }, { headers: NO_STORE });
}

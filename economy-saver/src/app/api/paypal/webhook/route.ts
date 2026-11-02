import { db } from "@/db/client";
import { env } from "@/lib/env";
import { applyVerifiedDelivery, recentDeliveries } from "@/lib/events";
import { verifyWebhook } from "@/lib/paypal/webhook";
import { currentHouseholdId } from "@/lib/session";

export async function POST(request: Request) {
  const result = await verifyWebhook(await request.text(), request.headers);
  if (!result.verified) return Response.json({ received: false, reason: result.reason }, { status: 400 });
  await applyVerifiedDelivery(db(), result.event);
  return Response.json({ received: true });
}

// Sandbox diagnostics: only the caller's deliveries, without any raw PayPal payload.
export async function GET() {
  env();
  const hid = await currentHouseholdId();
  if (!hid) return Response.json({ error: "Household session required" }, { status: 401 });
  return Response.json({ events: await recentDeliveries(db(), hid) }, { headers: { "Cache-Control": "private, no-store" } });
}

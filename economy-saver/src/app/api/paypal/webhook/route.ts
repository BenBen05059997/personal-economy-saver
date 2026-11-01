import { connection } from "next/server";
import { recordEvent, recentEvents } from "@/lib/events";
import { verifyWebhook } from "@/lib/paypal/webhook";

// Webhook deliveries. Verified against PayPal sandbox before anything is trusted.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const result = await verifyWebhook(rawBody, request.headers);

  recordEvent({
    id: result.event?.id ?? "unknown",
    type: result.event?.event_type ?? "unknown",
    verified: result.verified,
    reason: result.verified ? undefined : result.reason,
    resourceId: result.event?.resource?.id,
    receivedAt: new Date().toISOString(),
  });
  console.log(
    `[webhook] ${result.event?.event_type ?? "unknown"} ${result.event?.id ?? "-"} ` +
      (result.verified ? "verified" : `rejected: ${result.reason}`),
  );

  if (result.verified) return Response.json({ received: true });
  return Response.json({ received: false, reason: result.reason }, { status: 400 });
}

// Lists recent deliveries (sandbox only, no secrets) so we can watch them arrive.
export async function GET() {
  await connection();
  return Response.json({ events: recentEvents() });
}

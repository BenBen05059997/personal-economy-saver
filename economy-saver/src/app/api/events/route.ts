import { z } from "zod";
import { db } from "@/db/client";
import { eventFeed, publicEvent } from "@/db/event-feed";
import { listEvents, markRead } from "@/db/household";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401, headers });
  const input = new URL(request.url).searchParams.get("since");
  if (input !== null && !z.string().datetime({ offset: true }).safeParse(input).success) {
    return new Response("since must be an ISO timestamp", { status: 400, headers });
  }
  const [rows, feed] = await Promise.all([listEvents(db(), hid, input ? new Date(input) : undefined), eventFeed(db(), hid)]);
  return Response.json({ events: rows.map(publicEvent), feed }, { headers });
}

const readItems = z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional() }).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401 });
  const input = readItems.safeParse(await request.json().catch(() => null));
  if (!input.success) return new Response("Expected an object with optional event ids", { status: 400 });
  const changed = await markRead(db(), hid, input.data.ids);
  return Response.json({ changed, feed: await eventFeed(db(), hid) }, { headers });
}

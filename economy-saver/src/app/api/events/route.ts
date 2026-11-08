import { z } from "zod";
import { db } from "@/db/client";
import { eventFeed, publicEvent } from "@/db/event-feed";
import { listEvents, markRead, withHousehold } from "@/db/household";
import { NO_STORE } from "@/lib/door";
import { currentHouseholdId, householdRequest } from "@/lib/session";

export async function GET(request: Request) {
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401, headers: NO_STORE });
  const input = new URL(request.url).searchParams.get("since");
  if (input !== null && !z.string().datetime({ offset: true }).safeParse(input).success) {
    return new Response("since must be an ISO timestamp", { status: 400, headers: NO_STORE });
  }
  const [rows, feed] = await withHousehold(db(), hid, tx => Promise.all([listEvents(tx, hid, input ? new Date(input) : undefined), eventFeed(tx, hid)]));
  return Response.json({ events: rows.map(publicEvent), feed }, { headers: NO_STORE });
}

const readItems = z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional() }).strict();

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const input = readItems.safeParse(await request.json().catch(() => null));
  if (!input.success) return new Response("Expected an object with optional event ids", { status: 400 });
  const result = await withHousehold(db(), hid, async tx => {
    const changed = await markRead(tx, hid, input.data.ids);
    return { changed, feed: await eventFeed(tx, hid) };
  });
  return Response.json(result, { headers: NO_STORE });
}

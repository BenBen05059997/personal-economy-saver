import { z } from "zod";
import { db } from "@/db/client";
import { eventFeed, publicEvent } from "@/db/event-feed";
import { listEvents, markRead, withHousehold } from "@/db/household";
import { NO_STORE, text } from "@/lib/door";
import { currentHouseholdId, householdRequest } from "@/lib/session";

/**
 * `since` (an ISO time) returns what happened after it; `before` (an event id) returns what is older than that event, newest first;
 * `limit` is 1 to 100 (default 100). `next` is the id to pass as `before` for the following page, or null at the end.
 */
export async function GET(request: Request) {
  const hid = await currentHouseholdId();
  if (!hid) return text("Household session required", 401);
  const params = new URL(request.url).searchParams;
  const input = params.get("since");
  if (input !== null && !z.string().datetime({ offset: true }).safeParse(input).success) {
    return text("since must be an ISO timestamp", 400);
  }
  const query = z.object({ before: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(100) })
    .safeParse({ before: params.get("before") ?? undefined, limit: params.get("limit") ?? undefined });
  if (!query.success) return text("before must be an event id and limit a number from 1 to 100", 400);
  const { before, limit } = query.data;
  const [rows, feed] = await withHousehold(db(), hid, tx => Promise.all([listEvents(tx, hid, input ? new Date(input) : undefined, limit + 1, before), eventFeed(tx, hid)]));
  const page = rows.slice(0, limit);
  return Response.json({ events: page.map(publicEvent), next: rows.length > limit ? page[limit - 1].id : null, feed }, { headers: NO_STORE });
}

const readItems = z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional() }).strict();

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const input = readItems.safeParse(await request.json().catch(() => null));
  if (!input.success) return text("Expected an object with optional event ids", 400);
  const result = await withHousehold(db(), hid, async tx => {
    const changed = await markRead(tx, hid, input.data.ids);
    return { changed, feed: await eventFeed(tx, hid) };
  });
  return Response.json(result, { headers: NO_STORE });
}

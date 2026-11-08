import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { InputError } from "@/db/input-error";
import { itemsToMove, MOVABLE, moveToCloud, moveToDevice } from "@/db/place";
import { consumeRequest } from "@/db/rate-limit";
import { NO_STORE, text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

// Memory, canvases or conversations with a year of use stay well under this; a body over it is not a move.
const MAX_BODY = 2 * 1024 * 1024;
const What = z.enum(MOVABLE);
const Body = z.discriminatedUnion("step", [
  /** To this device, step 1: the browser takes the items. Nothing changes here. */
  z.object({ step: z.literal("read"), what: What }).strict(),
  /** To this device, step 2: the browser has stored the items with these ids and confirms; the server deletes its copies and sets the place. */
  z.object({ step: z.literal("to_device"), what: What, ids: z.array(z.string().uuid()).max(200) }).strict(),
  /** Back to the cloud: the browser posts the items; the server checks each against its schema, inserts them and sets the place. */
  z.object({ step: z.literal("to_cloud"), what: What, items: z.array(z.unknown()).max(200) }).strict(),
]);

/** Where memory, canvases and conversations are kept (D59). JSON in, JSON out; a real move, never a copy. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return text("That is more than can be moved in one go.", 413);
  let json: unknown = null;
  try { json = JSON.parse(raw); } catch { /* refused below */ }
  const body = Body.safeParse(json);
  if (!body.success) return text("Choose what to move and where.", 400);
  try {
    if (!await withHousehold(db(), hid, tx => consumeRequest(tx, hid, "move", 10))) return tooMany("Too many requests. Try again in a minute.");
    const by = { madeBy: "form" } as const;
    const data = body.data;
    if (data.step === "read") return Response.json({ items: await withHousehold(db(), hid, tx => itemsToMove(tx, hid, data.what)) }, { headers: NO_STORE });
    const moved = await withHousehold(db(), hid, tx => data.step === "to_device"
      ? moveToDevice(tx, hid, data.what, data.ids, by) : moveToCloud(tx, hid, data.what, data.items, by));
    return Response.json({ moved }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof InputError) return text(error.message, 400);
    return text("Couldn’t move that. Nothing was changed; try again.", 503);
  }
}

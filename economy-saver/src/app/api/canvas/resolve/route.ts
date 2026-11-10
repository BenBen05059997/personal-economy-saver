import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { resolveCanvasRequest } from "@/lib/canvas/request";
import { CanvasError } from "@/lib/canvas/resolve";
import { limited, NO_STORE, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const MAX_BODY = 100_000;

/** Draws a canvas recipe for the signed-in household (D57): `{ recipe, scenario? }` in, the resolved blocks out. It reads and writes nothing. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const busy = await limited(hid, "canvas", 120, "Too many canvas requests. Try again in a minute.");
  if (busy) return busy;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return text("This canvas is too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return text("This is not a canvas request.", 400);
  }
  try {
    const blocks = await withHousehold(db(), hid, tx => resolveCanvasRequest(tx, hid, body),
      { isolationLevel: "repeatable read", accessMode: "read only" });
    return Response.json({ blocks }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CanvasError) return text(error.message, 400);
    return text("The canvas could not be drawn. Try again.", 503);
  }
}

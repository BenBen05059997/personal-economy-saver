import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { resolveCanvasRequest } from "@/lib/canvas/request";
import { CanvasError } from "@/lib/canvas/resolve";
import { NO_STORE, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const MAX_BODY = 100_000;
// A person dragging a slider sends a few a second at most; 120 a minute stops a loop.
const PER_MINUTE = 120;

/** Draws a canvas recipe for the signed-in household (D57): `{ recipe, scenario? }` in, the resolved blocks out. It reads and writes nothing. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  if (!await consumeRequest(db(), hid, "canvas", PER_MINUTE)) return text("Too many canvas requests. Try again in a minute.", 429, { "Retry-After": "60" });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return text("This canvas is too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return text("This is not a canvas request.", 400);
  }
  try {
    return Response.json({ blocks: await resolveCanvasRequest(db(), hid, body) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CanvasError) return text(error.message, 400);
    return text("The canvas could not be drawn. Try again.", 503);
  }
}

import { z } from "zod";
import { db } from "@/db/client";
import { setThumb } from "@/db/conversation";
import { readPlaces } from "@/db/place";
import { consumeRequest } from "@/db/rate-limit";
import { logThumb } from "@/lib/agent/log";
import { text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const Thumb = z.object({ id: z.string().uuid(), thumb: z.enum(["up", "down"]).nullable(), device: z.literal(true).optional() }).strict();

/** A thumb on one reply (D60): `{ id, thumb: "up" | "down" | null, device? }`; `device` (conversations kept on this device, D59) only writes the log line. One log line with the ids and the thumb, never the question or the answer. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const data = Thumb.safeParse(await request.json().catch(() => null));
  if (!data.success) return text("Choose Helpful or Not helpful.", 400);
  if (!await consumeRequest(db(), hid, "thumb", 30)) return text("Too many requests. Try again in a minute.", 429, { "Retry-After": "60" });
  const { id, thumb, device } = data.data;
  const onDevice = (await readPlaces(db(), hid)).journal === "device";
  if (onDevice !== (device === true)) return text("Reload the page and try again.", 409);
  // Conversations kept on the device: the browser keeps the thumb; the server only writes the content-free log line.
  if (device) { logThumb({ at: "thumb", householdId: hid, askId: id, thumb }); return text("Saved", 200); }
  if (!await setThumb(db(), hid, id, thumb === "up" ? 1 : thumb === "down" ? -1 : null)) return text("That answer is no longer here.", 404);
  logThumb({ at: "thumb", householdId: hid, askId: id, thumb });
  return text("Saved", 200);
}

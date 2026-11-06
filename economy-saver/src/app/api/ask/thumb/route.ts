import { z } from "zod";
import { db } from "@/db/client";
import { setThumb } from "@/db/conversation";
import { consumeRequest } from "@/db/rate-limit";
import { logThumb } from "@/lib/agent/log";
import { text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const Thumb = z.object({ id: z.string().uuid(), thumb: z.enum(["up", "down"]).nullable() }).strict();

/** A thumb on one reply (D60): `{ id, thumb: "up" | "down" | null }`. One log line with the ids and the thumb, never the question or the answer. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const data = Thumb.safeParse(await request.json().catch(() => null));
  if (!data.success) return text("Choose Helpful or Not helpful.", 400);
  if (!await consumeRequest(db(), hid, "thumb", 30)) return text("Too many requests. Try again in a minute.", 429, { "Retry-After": "60" });
  const { id, thumb } = data.data;
  if (!await setThumb(db(), hid, id, thumb === "up" ? 1 : thumb === "down" ? -1 : null)) return text("That answer is no longer here.", 404);
  logThumb({ at: "thumb", householdId: hid, askId: id, thumb });
  return text("Saved", 200);
}

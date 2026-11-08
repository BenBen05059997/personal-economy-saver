import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { setThumb } from "@/db/conversation";
import { readPlaces } from "@/db/place";
import { consumeRequest } from "@/db/rate-limit";
import { logThumb } from "@/lib/agent/log";
import { text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const Thumb = z.object({ id: z.string().uuid(), thumb: z.enum(["up", "down"]).nullable(), device: z.literal(true).optional() }).strict();

/** A thumb on one reply (D60): `{ id, thumb: "up" | "down" | null, device? }`; `device` (conversations kept on this device, D59) only writes the log line. One log line with the ids and the thumb, never the question or the answer. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const data = Thumb.safeParse(await request.json().catch(() => null));
  if (!data.success) return text("Choose Helpful or Not helpful.", 400);
  if (!await withHousehold(db(), hid, tx => consumeRequest(tx, hid, "thumb", 30))) return tooMany("Too many requests. Try again in a minute.");
  const { id, thumb, device } = data.data;
  const status = await withHousehold(db(), hid, async tx => {
    const onDevice = (await readPlaces(tx, hid)).journal === "device";
    if (onDevice !== (device === true)) return 409;
    // Conversations kept on the device only write the content-free log line below.
    if (!device && !await setThumb(tx, hid, id, thumb === "up" ? 1 : thumb === "down" ? -1 : null)) return 404;
    return 200;
  });
  if (status === 409) return text("Reload the page and try again.", status);
  if (status === 404) return text("That answer is no longer here.", status);
  logThumb({ at: "thumb", householdId: hid, askId: id, thumb });
  return text("Saved", 200);
}

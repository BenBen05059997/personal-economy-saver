import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { MOVABLE, requireCloud } from "@/db/place";
import { consumeRequest } from "@/db/rate-limit";
import { restoreHousehold } from "@/db/restore";
import { failure, NO_STORE, text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const MAX_BYTES = 1_000_000;

/** Import (D59): a version 2 or 3 household file as the JSON body, at most 1 MB, into a household that has nothing in it yet. The answer is JSON `{ imported: counts }`, or a sentence on a refusal. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return text("This file is over 1 MB, which is more than Import takes.", 413);
  try {
    if (!await withHousehold(db(), hid, tx => consumeRequest(tx, hid, "restore", 2))) return tooMany("Import limit reached. Try again in a minute.");
    const body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BYTES) return text("This file is over 1 MB, which is more than Import takes.", 413);
    let file: unknown;
    try { file = JSON.parse(body); } catch { return text("This is not a JSON file.", 400); }
    // The file's memory, canvases and conversations go to the cloud, so a household that keeps any of them on this device (D59) moves them back first.
    const counts = await withHousehold(db(), hid, async tx => {
      for (const kind of MOVABLE) await requireCloud(tx, hid, kind);
      return restoreHousehold(tx, hid, file);
    });
    return new Response(JSON.stringify({ imported: counts }), { headers: { ...NO_STORE, "Content-Type": "application/json" } });
  } catch (error) {
    return failure(error);
  }
}

import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { MOVABLE, requireCloud } from "@/db/place";
import { restoreHousehold } from "@/db/restore";
import { boundedText, failure, limited, text } from "@/lib/door";
import { NO_STORE } from "@/lib/form-fetch";
import { IMPORT_FILE_MAX_BYTES, IMPORT_FILE_TOO_BIG } from "@/lib/app-info";
import { householdRequest } from "@/lib/session";

/** Import (D44): a household file of an earlier or the current version as the JSON body, at most 1 MB, into a household that has nothing in it yet. The answer is JSON `{ imported: counts }`, or a sentence on a refusal. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > IMPORT_FILE_MAX_BYTES) return text(IMPORT_FILE_TOO_BIG, 413);
  try {
    const busy = await limited(hid, "restore", 2, "Import limit reached. Try again in a minute.");
    if (busy) return busy;
    const body = await boundedText(request, IMPORT_FILE_MAX_BYTES);
    if (body === null) return text(IMPORT_FILE_TOO_BIG, 413);
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

import { askSpaceId, loadAskView } from "@/db/ask-view";
import { db } from "@/db/client";
import { CANVAS_REQUEST_LIMIT } from "@/db/rate-limit";
import { limited, text, TOO_MANY_CANVAS_REQUESTS } from "@/lib/door";
import { NO_STORE, noStore } from "@/lib/form-fetch";
import { hasHouseholdOwnerAccess, householdRequest } from "@/lib/session";

export async function GET(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) {
    noStore(hid);
    return hid;
  }
  const connection = db();
  const busy = await limited(hid, "canvas", CANVAS_REQUEST_LIMIT, TOO_MANY_CANVAS_REQUESTS, connection);
  if (busy) return busy;
  const param = new URL(request.url).searchParams.get("space");
  const space = askSpaceId.optional().safeParse(param ?? undefined);
  if (!space.success) return text("That space could not be found.", 404);
  try {
    const view = await loadAskView(connection, hid, { spaceId: space.data, owner: await hasHouseholdOwnerAccess(hid) });
    return view ? Response.json(view, { headers: NO_STORE }) : text("That space could not be found.", 404);
  } catch {
    return text("Ask could not be opened. Try again.", 503);
  }
}

import { askSpaceId, loadAskView } from "@/db/ask-view";
import { db } from "@/db/client";
import { limited, NO_STORE, text } from "@/lib/door";
import { hasHouseholdOwnerAccess, householdRequest } from "@/lib/session";

export async function GET(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) {
    hid.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return hid;
  }
  const connection = db();
  const busy = await limited(hid, "canvas", 120, "Too many canvas requests. Try again in a minute.", connection);
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

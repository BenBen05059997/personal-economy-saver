import { askSpaceId, loadAskView } from "@/db/ask-view";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { consumeCanvasRequest } from "@/db/rate-limit";
import { NO_STORE, text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function GET(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) {
    hid.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return hid;
  }
  const connection = db();
  if (!await withHousehold(connection, hid, tx => consumeCanvasRequest(tx, hid))) {
    return tooMany("Too many canvas requests. Try again in a minute.");
  }
  const param = new URL(request.url).searchParams.get("space");
  const space = askSpaceId.optional().safeParse(param ?? undefined);
  if (!space.success) return text("That space could not be found.", 404);
  try {
    const view = await loadAskView(connection, hid, { spaceId: space.data });
    return view ? Response.json(view, { headers: NO_STORE }) : text("That space could not be found.", 404);
  } catch {
    return text("Ask could not be opened. Try again.", 503);
  }
}

import { loadAddView } from "@/db/add-view";
import { db } from "@/db/client";
import { limited, NO_STORE, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function GET(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) {
    hid.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return hid;
  }
  const connection = db();
  const busy = await limited(hid, "add-view", 120, "Too many requests. Try again in a minute.", connection);
  if (busy) return busy;
  try {
    const view = await loadAddView(connection, hid);
    return view ? Response.json(view, { headers: NO_STORE }) : text("This household could not be found.", 404);
  } catch {
    return text("The form could not be opened. Try again.", 503);
  }
}

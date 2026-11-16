import { loadAddView } from "@/db/add-view";
import { db } from "@/db/client";
import { limited, text, TOO_MANY_REQUESTS } from "@/lib/door";
import { NO_STORE, noStore } from "@/lib/form-fetch";
import { householdRequest } from "@/lib/session";

export async function GET(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) {
    noStore(hid);
    return hid;
  }
  const connection = db();
  const busy = await limited(hid, "add-view", 120, TOO_MANY_REQUESTS, connection);
  if (busy) return busy;
  try {
    const view = await loadAddView(connection, hid);
    return view ? Response.json(view, { headers: NO_STORE }) : text("This household could not be found.", 404);
  } catch {
    return text("The form could not be opened. Try again.", 503);
  }
}

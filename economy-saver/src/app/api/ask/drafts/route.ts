import { z } from "zod";
import { db } from "@/db/client";
import { draftsOfTurns } from "@/db/ask-drafts";
import { withHousehold } from "@/db/household";
import { loadViewContext } from "@/lib/views/load";
import { NO_STORE, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const ids = z.string().transform(value => value.split(",")).pipe(z.array(z.string().uuid()).min(1).max(40));

/** What the turns drafted, read from the rows now (D60): the card under each draft and the chip on the reply. Read only; Confirm and Don't add go through their own routes (D39). */
export async function GET(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) { hid.headers.set("Cache-Control", NO_STORE["Cache-Control"]); return hid; }
  const asked = ids.safeParse(new URL(request.url).searchParams.get("ids") ?? "");
  if (!asked.success) return text("Invalid turns", 400);
  const connection = db();
  try {
    const context = await loadViewContext(connection, hid, ["spending"]);
    const drafts = await withHousehold(connection, hid, tx => draftsOfTurns(tx, hid, asked.data.map(id => id.toLowerCase()), { state: context.state, spending: context.spending! }), { isolationLevel: "repeatable read", accessMode: "read only" });
    return Response.json({ drafts }, { headers: NO_STORE });
  } catch {
    return text("The drafts could not be read. Try again.", 503);
  }
}

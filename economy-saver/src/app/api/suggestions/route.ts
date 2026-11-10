import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { dismiss, notNow } from "@/db/suggestions";
import { badFields, formOf, limited, redirectTo, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const input = z.object({ id: z.string().uuid(), kind: z.enum(["dismiss", "not_now"]) });

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const connection = db();
  const busy = await limited(hid, "suggestions", 30, "Suggestion limit reached. Try again in a minute.", connection);
  if (busy) return busy;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return badFields();
  const change = parsed.data.kind === "dismiss" ? dismiss : notNow;
  if (!await withHousehold(connection, hid, tx => change(tx, hid, parsed.data.id))) return text("Suggestion is no longer available.", 404);
  return redirectTo("/", request);
}

import { z } from "zod";
import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { dismiss, notNow } from "@/db/suggestions";
import { badFields, formOf, redirectTo, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const input = z.object({ id: z.string().uuid(), kind: z.enum(["dismiss", "not_now"]) });

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const connection = db();
  if (!await consumeRequest(connection, hid, "suggestions", 30)) {
    return new Response("Suggestion limit reached. Try again in a minute.", { status: 429, headers: { "Retry-After": "60" } });
  }
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return badFields();
  const change = parsed.data.kind === "dismiss" ? dismiss : notNow;
  if (!await change(connection, hid, parsed.data.id)) return text("Suggestion is no longer available.", 404);
  return redirectTo("/", request);
}

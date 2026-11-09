import { db } from "@/db/client";
import { advanceTryItDate } from "@/db/demo";
import { badFields, failure, formOf, NO_STORE, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_QA_TOOLS !== "1") return text("Not found", 404);
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const date = form.get("date");
  if (typeof date !== "string" || form.getAll("date").length !== 1) return badFields();
  try {
    const today = await advanceTryItDate(db(), hid, date);
    return today ? Response.json({ today }, { headers: NO_STORE }) : text("Try it session required", 403);
  } catch (error) {
    return failure(error);
  }
}

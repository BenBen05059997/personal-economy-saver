import { db } from "@/db/client";
import { advanceTryItDate } from "@/db/demo";
import { badFields, failure, householdForm, NO_STORE, text } from "@/lib/door";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_QA_TOOLS !== "1") return text("Not found", 404);
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const date = form.get("date");
  if (typeof date !== "string" || form.getAll("date").length !== 1) return badFields();
  try {
    const today = await advanceTryItDate(db(), hid, date);
    return today ? Response.json({ today }, { headers: NO_STORE }) : text("Try it session required", 403);
  } catch (error) {
    return failure(error);
  }
}

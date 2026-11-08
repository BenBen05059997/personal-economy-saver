import { db } from "@/db/client";
import { potInput, savePot } from "@/db/pots";
import { badFields, failure, redirectTo, returnPath, formOf } from "@/lib/door";
import { householdRequest } from "@/lib/session";

/** Add a pot, or edit one by its id (D43). A field left empty is not set. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const field = (name: string) => String(form.get(name) ?? "").trim() || null;
  const data = potInput.safeParse({
    id: form.get("id"), name: form.get("name"), target: field("target"), targetDate: field("targetDate"),
    saved: field("saved") ?? "0", fillPct: field("fillPct"), memberId: field("memberId"),
  });
  if (!data.success) return badFields();
  try {
    await savePot(db(), hid, data.data, "confirmed", { madeBy: "form" });
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

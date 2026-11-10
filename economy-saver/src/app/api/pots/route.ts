import { db } from "@/db/client";
import { potInput, savePot } from "@/db/pots";
import { badFields, failure, householdForm, redirectTo, returnPath } from "@/lib/door";

/** Add a pot, or edit one by its id (D43). A field left empty is not set. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
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

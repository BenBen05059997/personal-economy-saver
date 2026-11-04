import { db } from "@/db/client";
import { chargeInput, insertCharge } from "@/db/charges";
import { badFields, failure, redirectTo, returnPath, text } from "@/lib/door";
import { businessBpFromForm, CategoryKeySchema } from "@/lib/money/categories";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await request.formData();
  const category = CategoryKeySchema.safeParse(form.get("category"));
  if (!category.success) return text(category.error.issues[0].message, 400);
  const businessBp = businessBpFromForm(form.get("businessShare"), form.get("businessPercent"));
  if (businessBp === null) return text("Enter the business share as a percentage from 0 to 100.", 400);
  const data = chargeInput.safeParse({ ...Object.fromEntries(form), category: category.data, businessBp, shared: form.get("shared") === "on" });
  if (!data.success) return badFields();
  try {
    await insertCharge(db(), hid, data.data, "confirmed", "manual", { madeBy: "form" });
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

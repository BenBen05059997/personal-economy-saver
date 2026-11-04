import { db } from "@/db/client";
import { billInput, insertBill } from "@/db/bills";
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
  const data = billInput.safeParse({ ...Object.fromEntries(form), category: category.data, businessBp, memberId: form.get("memberId") || null, paidByMemberId: form.get("paidByMemberId") || null, monthly: form.get("monthly") === "on" });
  if (!data.success) return badFields();
  try {
    await insertBill(db(), hid, data.data, "confirmed");
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

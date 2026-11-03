import { db } from "@/db/client";
import { billInput, insertBill } from "@/db/bills";
import { badFields, failure, redirectTo, returnPath } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await request.formData();
  const data = billInput.safeParse({ ...Object.fromEntries(form), memberId: form.get("memberId") || null });
  if (!data.success) return badFields();
  try {
    await insertBill(db(), hid, data.data, "confirmed");
    return redirectTo(returnPath(form.get("returnTo")));
  } catch (error) {
    return failure(error);
  }
}

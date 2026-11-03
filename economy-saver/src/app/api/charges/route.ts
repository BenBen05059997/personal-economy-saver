import { db } from "@/db/client";
import { chargeInput, insertCharge } from "@/db/charges";
import { badFields, failure, redirectTo, returnPath } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await request.formData();
  const data = chargeInput.safeParse(Object.fromEntries(form));
  if (!data.success) return badFields();
  try {
    await insertCharge(db(), hid, data.data, "confirmed", "manual");
    return redirectTo(returnPath(form.get("returnTo")));
  } catch (error) {
    return failure(error);
  }
}

import { db } from "@/db/client";
import { bankBalanceInput, setBankBalance } from "@/db/bank-balance";
import { badFields, failure, redirectTo, returnPath } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await request.formData();
  const data = bankBalanceInput.safeParse(Object.fromEntries(form));
  if (!data.success) return badFields();
  try {
    await setBankBalance(db(), hid, data.data, "confirmed", { madeBy: "form" });
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

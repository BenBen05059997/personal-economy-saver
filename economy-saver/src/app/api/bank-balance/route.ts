import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { bankBalanceInput, setBankBalance } from "@/db/bank-balance";
import { badFields, failure, householdForm, redirectTo, returnPath } from "@/lib/door";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const data = bankBalanceInput.safeParse(Object.fromEntries(form));
  if (!data.success) return badFields();
  try {
    await withHousehold(db(), hid, tx => setBankBalance(tx, hid, data.data, "confirmed", { madeBy: "form" }));
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

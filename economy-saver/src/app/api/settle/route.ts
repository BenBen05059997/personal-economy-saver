import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { settleUp } from "@/db/settle";
import { failure, householdForm, limited, redirectTo, returnPath } from "@/lib/door";

/** Mark settled (D45): records what is owed now as paid, from the stored rows; the browser sends no amounts. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  try {
    const busy = await limited(hid, "settle", 10, "Too many settlements. Try again in a minute.");
    if (busy) return busy;
    await withHousehold(db(), hid, tx => settleUp(tx, hid));
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

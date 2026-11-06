import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { settleUp } from "@/db/settle";
import { failure, formOf, redirectTo, returnPath, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

/** Mark settled (D45): records what is owed now as paid, from the stored rows; the browser sends no amounts. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  try {
    if (!await consumeRequest(db(), hid, "settle", 10)) return tooMany("Too many settlements. Try again in a minute.");
    await settleUp(db(), hid);
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

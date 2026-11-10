import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { clientInput, insertClient } from "@/db/clients";
import { badFields, failure, householdForm, redirectTo, returnPath } from "@/lib/door";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form: body } = ctx;
  const data = clientInput.safeParse(Object.fromEntries(body));
  if (!data.success) return badFields();
  try {
    const id = await withHousehold(db(), hid, tx => insertClient(tx, hid, data.data));
    const back = returnPath(body.get("returnTo")); // the setup steps keep the person on their step
    return redirectTo(back === "/" ? `/clients/${id}` : back, request);
  } catch (error) {
    return failure(error);
  }
}

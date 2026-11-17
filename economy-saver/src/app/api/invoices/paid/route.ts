import { householdDate } from "@/db/account";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { markPaidOutside } from "@/db/invoice-paid";
import { badFields, failure, householdForm, limited, text, TOO_MANY_REQUESTS } from "@/lib/door";
import { redirectTo } from "@/lib/form-redirect";
import { Uuid } from "@/lib/stable-id";
import { hrefFor } from "@/lib/links";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form: body } = ctx;
  const busy = await limited(hid, "invoice-paid", 20, TOO_MANY_REQUESTS);
  if (busy) return busy;
  const id = Uuid.safeParse(body.get("id"));
  if (!id.success) return badFields();
  try {
    const today = await withHousehold(db(), hid, tx => householdDate(tx, hid));
    if (!await markPaidOutside(db(), hid, id.data, today)) {
      return text("This invoice cannot be marked paid here.", 409);
    }
    return redirectTo(hrefFor({ type: "invoice", id: id.data }));
  } catch (error) {
    return failure(error);
  }
}

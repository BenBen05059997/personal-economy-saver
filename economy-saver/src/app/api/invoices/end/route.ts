import { db } from "@/db/client";
import { endPaymentLink } from "@/db/invoice-end";
import { badFields, failure, limited, ownerForm, text, TOO_MANY_REQUESTS } from "@/lib/door";
import { redirectTo } from "@/lib/form-fetch";
import { Uuid } from "@/lib/stable-id";
import { hrefFor } from "@/lib/links";

/** Ends an invoice's payment link. Same permission as Approve: the household owner. */
export async function POST(request: Request) {
  const ctx = await ownerForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const busy = await limited(hid, "approve", 10, TOO_MANY_REQUESTS);
  if (busy) return busy;
  const id = Uuid.safeParse(form.get("id"));
  if (!id.success) return badFields();
  try {
    if (!await endPaymentLink(db(), hid, id.data)) return text("This link cannot be ended.", 409);
    return redirectTo(hrefFor({ type: "invoice", id: id.data }), request);
  } catch (error) {
    return failure(error);
  }
}

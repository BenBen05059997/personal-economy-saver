import { db } from "@/db/client";
import { InvoiceMatchError, settleReadPayment } from "@/db/invoice-match";
import { badFields, failure, householdForm, limited, text, TOO_MANY_REQUESTS } from "@/lib/door";
import { redirectTo } from "@/lib/form-fetch";
import { Uuid } from "@/lib/stable-id";
import { hrefFor } from "@/lib/links";

/** "Yes, that's this invoice": settles an open invoice with a payment the PayPal read found. Same permission as marking paid by hand. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const busy = await limited(hid, "invoice-match", 20, TOO_MANY_REQUESTS);
  if (busy) return busy;
  const id = Uuid.safeParse(form.get("id"));
  const paymentId = Uuid.safeParse(form.get("paymentId"));
  if (!id.success || !paymentId.success) return badFields();
  try {
    await settleReadPayment(db(), hid, id.data, paymentId.data);
    return redirectTo(hrefFor({ type: "invoice", id: id.data }), request);
  } catch (error) {
    if (error instanceof InvoiceMatchError) return text(error.message, error.status);
    return failure(error);
  }
}

import { z } from "zod";
import { db } from "@/db/client";
import { endPaymentLink } from "@/db/invoice-end";
import { badFields, failure, limited, ownerForm, redirectTo, text } from "@/lib/door";

/** Ends an invoice's payment link. Same permission as Approve: the household owner. */
export async function POST(request: Request) {
  const ctx = await ownerForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const busy = await limited(hid, "approve", 10, "Too many requests. Try again in a minute.");
  if (busy) return busy;
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return badFields();
  try {
    if (!await endPaymentLink(db(), hid, id.data)) return text("This link cannot be ended.", 409);
    return redirectTo(`/invoices/${id.data}`, request);
  } catch (error) {
    return failure(error);
  }
}

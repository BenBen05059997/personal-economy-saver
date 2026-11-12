import { z } from "zod";
import { db } from "@/db/client";
import { requestFromMember } from "@/db/member-request";
import { badFields, failure, limited, ownerForm, redirectTo } from "@/lib/door";

/** Request by PayPal (D45): drafts the request for what a member owes the owner, from the stored rows; the browser sends no amount. Approve is the owner's tap on the invoice page. */
export async function POST(request: Request) {
  const ctx = await ownerForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const busy = await limited(hid, "approve", 10, "Too many requests. Try again in a minute.");
  if (busy) return busy;
  const from = z.string().uuid().safeParse(form.get("fromMemberId"));
  if (!from.success) return badFields();
  try {
    const id = await requestFromMember(db(), hid, from.data);
    return redirectTo(`/invoices/${id}`, request);
  } catch (error) {
    return failure(error);
  }
}

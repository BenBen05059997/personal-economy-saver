import { z } from "zod";
import { householdDate } from "@/db/account";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { markPaidOutside } from "@/db/invoice-paid";
import { badFields, failure, householdForm, limited, redirectTo, text } from "@/lib/door";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form: body } = ctx;
  const busy = await limited(hid, "invoice-paid", 20, "Too many requests. Try again in a minute.");
  if (busy) return busy;
  const id = z.string().uuid().safeParse(body.get("id"));
  if (!id.success) return badFields();
  try {
    const today = await withHousehold(db(), hid, tx => householdDate(tx, hid));
    if (!await markPaidOutside(db(), hid, id.data, today)) {
      return text("This invoice cannot be marked paid here.", 409);
    }
    return redirectTo(`/invoices/${id.data}`);
  } catch (error) {
    return failure(error);
  }
}

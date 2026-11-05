import { z } from "zod";
import { householdDate } from "@/db/account";
import { db } from "@/db/client";
import { markPaidOutside } from "@/db/invoice-paid";
import { badFields, failure, redirectTo, text, formOf } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const id = z.string().uuid().safeParse(body.get("id"));
  if (!id.success) return badFields();
  try {
    if (!await markPaidOutside(db(), hid, id.data, await householdDate(db(), hid))) {
      return text("This invoice cannot be marked paid here.", 409);
    }
    return redirectTo(`/invoices/${id.data}`);
  } catch (error) {
    return failure(error);
  }
}

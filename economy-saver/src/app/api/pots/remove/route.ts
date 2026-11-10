import { z } from "zod";
import { db } from "@/db/client";
import { removePot } from "@/db/pots";
import { badFields, failure, householdForm, redirectTo, returnPath } from "@/lib/door";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return badFields();
  try {
    await removePot(db(), hid, id.data);
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

import { z } from "zod";
import { db } from "@/db/client";
import { removePot } from "@/db/pots";
import { badFields, failure, redirectTo, returnPath } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await request.formData();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return badFields();
  try {
    await removePot(db(), hid, id.data);
    return redirectTo(returnPath(form.get("returnTo")));
  } catch (error) {
    return failure(error);
  }
}

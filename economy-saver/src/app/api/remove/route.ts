import { z } from "zod";
import { db } from "@/db/client";
import { removeBill } from "@/db/bills";
import { removeCharge } from "@/db/charges";
import { consumeRequest } from "@/db/rate-limit";
import { badFields, failure, formOf, redirectTo, returnPath, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const input = z.object({ kind: z.enum(["bill", "charge"]), id: z.string().uuid() });

/** Remove a bill (a monthly bill goes as a whole series) or a card charge. A second tap finds nothing to remove and is not an error. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const data = input.safeParse({ kind: form.get("kind"), id: form.get("id") });
  if (!data.success) return badFields();
  try {
    if (!await consumeRequest(db(), hid, "remove", 20)) return tooMany("Too many removals. Try again in a minute.");
    if (data.data.kind === "bill") await removeBill(db(), hid, data.data.id);
    else await removeCharge(db(), hid, data.data.id);
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { removeBill } from "@/db/bills";
import { removeCharge } from "@/db/charges";
import { consumeRequest } from "@/db/rate-limit";
import { badFields, failure, formOf, redirectTo, returnPath, text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const input = z.object({ kind: z.enum(["bill", "charge"]), id: z.string().uuid() });

/** Remove a bill (a monthly bill goes as a whole series) or a card charge. A missing row gets the same refusal whether the id is unused, removed, or belongs elsewhere. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const data = input.safeParse({ kind: form.get("kind"), id: form.get("id") });
  if (!data.success) return badFields();
  try {
    if (!await withHousehold(db(), hid, tx => consumeRequest(tx, hid, "remove", 20))) return tooMany("Too many removals. Try again in a minute.");
    const { kind, id } = data.data;
    const removed = await (kind === "bill" ? removeBill : removeCharge)(db(), hid, id);
    if (!removed) return text(`Choose a ${kind} of this household`, 400);
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

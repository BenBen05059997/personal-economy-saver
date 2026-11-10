import { z } from "zod";
import { db } from "@/db/client";
import { removeBill } from "@/db/bills";
import { removeCharge } from "@/db/charges";
import { badFields, failure, householdForm, limited, redirectTo, returnPath, text } from "@/lib/door";

const input = z.object({ kind: z.enum(["bill", "charge"]), id: z.string().uuid() });

/** Remove a bill (a monthly bill goes as a whole series) or a card charge. A missing row gets the same refusal whether the id is unused, removed, or belongs elsewhere. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const data = input.safeParse({ kind: form.get("kind"), id: form.get("id") });
  if (!data.success) return badFields();
  try {
    const busy = await limited(hid, "remove", 20, "Too many removals. Try again in a minute.");
    if (busy) return busy;
    const { kind, id } = data.data;
    const removed = await (kind === "bill" ? removeBill : removeCharge)(db(), hid, id);
    if (!removed) return text(`Choose a ${kind} of this household`, 400);
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

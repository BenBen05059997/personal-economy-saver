import { z } from "zod";
import { db } from "@/db/client";
import { keepFoundWin, withdrawChoice } from "@/db/choices";
import { withHousehold } from "@/db/household";
import { InputError } from "@/db/input-error";
import { closeByRef } from "@/db/suggestions";
import { badFields, failure, householdForm, returnPath } from "@/lib/door";
import { redirectTo } from "@/lib/form-redirect";
import { currentMemberId } from "@/lib/session";
import { Uuid } from "@/lib/stable-id";

const fields = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep"), foundKey: z.string().trim().min(1).max(200), potId: z.union([Uuid, z.literal("")]).optional().transform(value => value || null) }),
  z.object({ kind: z.literal("withdraw"), id: Uuid }),
]);

/** Keep a saving the app found, with or without a pot to put it in, or withdraw a choice (D81). The amount is worked out again on the server. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const parsed = fields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return badFields();
  try {
    if (parsed.data.kind === "withdraw") {
      if (!await withdrawChoice(db(), hid, parsed.data.id)) throw new InputError("That choice isn't on your record, or it is already withdrawn.");
    } else {
      const memberId = await currentMemberId(hid);
      const { foundKey, potId } = parsed.data;
      // Keeping it answers the finding about it, in the same transaction, so a refused keep leaves the finding open.
      await withHousehold(db(), hid, async tx => {
        await closeByRef(tx, hid, foundKey, ["keep_win"]);
        await keepFoundWin(tx, hid, { foundKey, potId }, { madeBy: "form", ...(memberId && { memberId }) });
      });
    }
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

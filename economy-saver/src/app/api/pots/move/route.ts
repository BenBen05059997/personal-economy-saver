import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { InputError } from "@/db/input-error";
import { parseAmountMinor } from "@/db/money";
import { markPotDone, movePot, type MoveInput } from "@/db/pots";
import { households } from "@/db/schema";
import { badFields, failure, householdForm, returnPath } from "@/lib/door";
import { redirectTo } from "@/lib/form-redirect";
import { currentMemberId } from "@/lib/session";
import { Uuid } from "@/lib/stable-id";

const text = (max: number) => z.string().trim().max(max).optional().transform(value => value || null);
const fields = z.object({
  kind: z.enum(["put_in", "take_out", "paid_for", "move_to", "done"]),
  potId: Uuid,
  amount: text(40),
  purchase: text(120), // `charge:<id>`, or `bill:<id>|<YYYY-MM-DD>` for a one-off bill; empty when only an amount is typed
  toPotId: Uuid.optional(),
  reason: text(200),
  done: z.literal("on").optional().transform(value => value === "on"),
});

/** The Saving page's pot forms (D81): money put in, taken out, paid for a purchase, moved to another pot, or the pot marked done. Every amount is parsed here from what was typed; the writers refuse in words. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const parsed = fields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return badFields();
  const data = parsed.data;
  try {
    if (data.kind === "done") {
      if (!await markPotDone(db(), hid, data.potId)) throw new InputError("That pot is already done, or isn't one of yours.");
      return redirectTo(returnPath(form.get("returnTo")), request);
    }
    const [household] = await withHousehold(db(), hid, tx => tx.select({ currency: households.homeCurrency }).from(households).where(eq(households.id, hid)), { isolationLevel: "repeatable read", accessMode: "read only" });
    if (!household) throw new InputError("Household not found");
    let purchase: MoveInput["purchase"] = null;
    if (data.kind === "paid_for") {
      if (data.purchase !== null) {
        const [kind, rest = ""] = data.purchase.split(":"), [id, on] = rest.split("|");
        const day = z.string().date().safeParse(on);
        if ((kind !== "charge" && kind !== "bill") || !Uuid.safeParse(id).success || (kind === "bill" && !day.success)) throw new InputError("Choose the purchase it paid for");
        purchase = { kind, id, on: kind === "bill" ? day.data! : null };
      }
    }
    if (data.kind === "move_to" && !data.toPotId) throw new InputError("Choose the pot to move the money to");
    const input: MoveInput = {
      id: randomUUID(), potId: data.potId, kind: data.kind === "put_in" ? "add" : data.kind === "take_out" ? "take_out" : data.kind === "paid_for" ? "spend" : "carry",
      amountMinor: data.amount === null ? null : parseAmountMinor(data.amount, household.currency), toPotId: data.kind === "move_to" ? data.toPotId! : null,
      purchase, choiceId: null, reason: data.reason, memberId: null, done: data.kind === "paid_for" && data.done,
    };
    const memberId = await currentMemberId(hid);
    await movePot(db(), hid, input, "confirmed", { madeBy: "form", ...(memberId && { memberId }) });
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}

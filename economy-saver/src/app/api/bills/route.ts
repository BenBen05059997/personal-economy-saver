import { db } from "@/db/client";
import { billEditInput, billInput, fillGapFromText, insertBill, updateBill } from "@/db/bills";
import { badFields, categoryFieldsFromForm, failure, householdForm, redirectTo, returnPath, text } from "@/lib/door";

/**
 * Adds a bill (no `kind`, or `kind=add`), or edits one from Settings → Bills (`kind=edit`: name, amount, due date, category, business
 * share, whose, who pays and, for a repeating bill, `amountFrom`; `cancelBy`, empty to remove it). D54: `amountVaries=on` marks a monthly bill whose amount changes
 * every month (the edit form says it shows the box with `variesShown`, so an unticked box turns it off); `seriesBillId` ("" = none)
 * is the edit form's "Part of" select for a one-off, sent only when the form shows it. D55: `amountUnknown=on` and `dueUnknown=on` save a
 * bill whose amount or date is not known yet (the field itself is then ignored). `kind=fill` gives a bill its missing `amount` and/or `due`.
 */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const kind = form.get("kind") ?? "add";
  if (kind !== "add" && kind !== "edit" && kind !== "fill") return badFields();
  if (kind === "fill") {
    const id = form.get("id");
    if (typeof id !== "string") return badFields();
    try {
      const amount = form.get("amount"), due = form.get("due");
      const saved = await fillGapFromText(db(), hid, id, { ...(typeof amount === "string" && { amount }), ...(typeof due === "string" && { due }) }, { madeBy: "form" });
      if (!saved) return text("Choose a bill of this household", 400);
      return redirectTo(returnPath(form.get("returnTo")), request);
    } catch (error) {
      return failure(error);
    }
  }
  const categoryFields = categoryFieldsFromForm(form);
  if (categoryFields instanceof Response) return categoryFields;
  const dueUnknown = form.get("dueUnknown") === "on";
  const fields = { ...Object.fromEntries(form), ...categoryFields, /* D75: "Your category" */ amountUnknown: form.get("amountUnknown") === "on", dueUnknown, due: dueUnknown ? null : form.get("due") || null, memberId: form.get("memberId") || null, paidByMemberId: form.get("paidByMemberId") || null };
  try {
    if (kind === "edit") {
      const data = billEditInput.safeParse({
        ...fields, amountFrom: form.get("amountFrom") || null,
        amountVaries: form.has("variesShown") ? form.get("amountVaries") === "on" : undefined,
        seriesBillId: form.has("seriesBillId") ? form.get("seriesBillId") || null : undefined,
        cancelBy: form.has("cancelBy") ? form.get("cancelBy") || null : undefined,
        repeatUntil: form.has("repeatUntil") ? form.get("repeatUntil") || null : undefined,
        periodStart: form.has("periodStart") ? form.get("periodStart") || null : undefined,
        periodEnd: form.has("periodEnd") ? form.get("periodEnd") || null : undefined,
      });
      if (!data.success) return badFields();
      const saved = await updateBill(db(), hid, data.data, { madeBy: "form" });
      if (!saved) return text("Choose a bill of this household", 400);
      return redirectTo(returnPath(form.get("returnTo")), request);
    }
    const data = billInput.safeParse({
      ...fields, repeat: form.get("repeat") || null, nextAmount: form.get("nextAmount") || null, nextAmountFrom: form.get("nextAmountFrom") || null, cancelBy: form.get("cancelBy") || null, repeatUntil: form.get("repeatUntil") || null,
      amountVaries: form.get("amountVaries") === "on",
    });
    if (!data.success) return badFields();
    await insertBill(db(), hid, data.data, "confirmed", { madeBy: "form" });
    // Home names what was saved at the top of Coming up (D51): only the id travels in the address; the page looks it up.
    const back = returnPath(form.get("returnTo"));
    return redirectTo(back === "/" ? `/?added=${data.data.id}#coming-up` : back, request);
  } catch (error) {
    return failure(error);
  }
}

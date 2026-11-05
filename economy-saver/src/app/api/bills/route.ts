import { db } from "@/db/client";
import { billEditInput, billInput, insertBill, updateBill } from "@/db/bills";
import { badFields, failure, formOf, redirectTo, returnPath, text } from "@/lib/door";
import { businessBpFromForm, CategoryKeySchema } from "@/lib/money/categories";
import { householdRequest } from "@/lib/session";

/**
 * Adds a bill (no `kind`, or `kind=add`), or edits one from Settings → Bills (`kind=edit`: name, amount, due date, category, business
 * share, whose, who pays and, for a repeating bill, `amountFrom`; `cancelBy`, empty to remove it). D54: `amountVaries=on` marks a monthly bill whose amount changes
 * every month (the edit form says it shows the box with `variesShown`, so an unticked box turns it off); `seriesBillId` ("" = none)
 * is the edit form's "Part of" select for a one-off, sent only when the form shows it.
 */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const kind = form.get("kind") ?? "add";
  if (kind !== "add" && kind !== "edit") return badFields();
  const category = CategoryKeySchema.safeParse(form.get("category"));
  if (!category.success) return text(category.error.issues[0].message, 400);
  const businessBp = businessBpFromForm(form.get("businessShare"), form.get("businessPercent"));
  if (businessBp === null) return text("Enter the business share as a percentage from 0 to 100.", 400);
  const fields = { ...Object.fromEntries(form), category: category.data, businessBp, memberId: form.get("memberId") || null, paidByMemberId: form.get("paidByMemberId") || null };
  try {
    if (kind === "edit") {
      const data = billEditInput.safeParse({
        ...fields, amountFrom: form.get("amountFrom") || null,
        amountVaries: form.has("variesShown") ? form.get("amountVaries") === "on" : undefined,
        seriesBillId: form.has("seriesBillId") ? form.get("seriesBillId") || null : undefined,
        cancelBy: form.has("cancelBy") ? form.get("cancelBy") || null : undefined,
      });
      if (!data.success) return badFields();
      if (!await updateBill(db(), hid, data.data, { madeBy: "form" })) return text("Choose a bill of this household", 400);
      return redirectTo(returnPath(form.get("returnTo")), request);
    }
    const data = billInput.safeParse({
      ...fields, repeat: form.get("repeat") || null, nextAmount: form.get("nextAmount") || null, nextAmountFrom: form.get("nextAmountFrom") || null, cancelBy: form.get("cancelBy") || null,
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

import { db } from "@/db/client";
import { chargeInput, insertCharge } from "@/db/charges";
import { badFields, categoryFieldsFromForm, failure, householdForm, redirectTo, returnPath } from "@/lib/door";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const categoryFields = categoryFieldsFromForm(form);
  if (categoryFields instanceof Response) return categoryFields;
  // D62: both original fields travel only when an amount was typed; an amount with no currency stays, so insertCharge refuses it.
  const fields = Object.fromEntries(form);
  if (String(fields.originalAmount ?? "").trim() === "") { delete fields.originalAmount; delete fields.originalCurrency; }
  else if (String(fields.originalCurrency ?? "") === "") delete fields.originalCurrency;
  const data = chargeInput.safeParse({ ...fields, ...categoryFields, shared: form.get("shared") === "on" });
  if (!data.success) return badFields();
  try {
    await insertCharge(db(), hid, data.data, "confirmed", "manual", { madeBy: "form" });
    // Home names what was saved at the top of Coming up (D51): only the id travels in the address; the page looks it up.
    const back = returnPath(form.get("returnTo"));
    return redirectTo(back === "/" ? `/?added=${data.data.id}#coming-up` : back, request);
  } catch (error) {
    return failure(error);
  }
}

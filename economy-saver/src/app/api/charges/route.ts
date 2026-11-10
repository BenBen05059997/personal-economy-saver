import { db } from "@/db/client";
import { chargeInput, insertCharge } from "@/db/charges";
import { badFields, failure, formOf, redirectTo, returnPath, text } from "@/lib/door";
import { businessBpFromForm, CategoryKeySchema } from "@/lib/money/categories";
import { ownChoiceFromForm } from "@/lib/reader/own-choices";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const category = CategoryKeySchema.safeParse(form.get("category"));
  if (!category.success) return text(category.error.issues[0].message, 400);
  const businessBp = businessBpFromForm(form.get("businessShare"), form.get("businessPercent"));
  if (businessBp === null) return text("Enter the business share as a percentage from 0 to 100.", 400);
  // D62: both original fields travel only when an amount was typed; an amount with no currency stays, so insertCharge refuses it.
  const fields = Object.fromEntries(form);
  if (String(fields.originalAmount ?? "").trim() === "") { delete fields.originalAmount; delete fields.originalCurrency; }
  else if (String(fields.originalCurrency ?? "") === "") delete fields.originalCurrency;
  const data = chargeInput.safeParse({ ...fields, category: category.data, businessBp, ...ownChoiceFromForm(form), shared: form.get("shared") === "on" });
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

import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { householdForm, redirectTo, returnPath, text } from "@/lib/door";
import { InputError } from "@/db/input-error";
import { settingsInput, updateSettings } from "@/db/settings";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form: body } = ctx;
  const data = settingsInput.safeParse(Object.fromEntries(body));
  if (!data.success) return text("Check the required fields and amounts", 400);
  try {
    await withHousehold(db(), hid, tx => updateSettings(tx, hid, data.data));
    if (body.has("returnTo")) return redirectTo(returnPath(body.get("returnTo")), request); // the setup steps move on after a save
    return text("Settings saved", 200);
  } catch (error) {
    return text(error instanceof InputError ? error.message : "Settings could not be saved", 400);
  }
}

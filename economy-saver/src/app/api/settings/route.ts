import { db } from "@/db/client";
import { settingsInput, SettingsError, updateSettings } from "@/db/settings";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401 });
  const data = settingsInput.safeParse(Object.fromEntries(await request.formData()));
  if (!data.success) return new Response("Check the required fields and amounts", { status: 400 });
  try {
    await updateSettings(db(), hid, data.data);
    return new Response("Settings saved");
  } catch (error) {
    return new Response(error instanceof SettingsError ? error.message : "Settings could not be saved", { status: 400 });
  }
}

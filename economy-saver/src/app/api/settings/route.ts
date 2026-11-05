import { db } from "@/db/client";
import { formOf } from "@/lib/door";
import { InputError } from "@/db/input-error";
import { settingsInput, updateSettings } from "@/db/settings";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const data = settingsInput.safeParse(Object.fromEntries(body));
  if (!data.success) return new Response("Check the required fields and amounts", { status: 400 });
  try {
    await updateSettings(db(), hid, data.data);
    return new Response("Settings saved");
  } catch (error) {
    return new Response(error instanceof InputError ? error.message : "Settings could not be saved", { status: 400 });
  }
}

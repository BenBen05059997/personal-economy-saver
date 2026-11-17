import { HOUSEHOLD_COOKIE, UPGRADE_DEMO_COOKIE } from "@/lib/supabase-auth";
import { cookies } from "next/headers";
import { formOf, NO_REFERRER, sameOriginOnly, settingFailure, text } from "@/lib/door";
import { redirectTo } from "@/lib/form-redirect";
import { finishSetup, setupForm } from "@/db/account";
import { db } from "@/db/client";
import { verifiedUid } from "@/lib/auth-request";
import { demoHouseholdForToken } from "@/db/demo";
import { InputError } from "@/db/input-error";

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const uid = await verifiedUid();
  if (!uid) return text("A verified email session is required", 401);
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const form = setupForm.safeParse(Object.fromEntries(body));
  if (!form.success) return text("Check your name, currency and time zone.", 400);
  const store = await cookies();
  const original = store.get(UPGRADE_DEMO_COOKIE)?.value;
  const demo = original && original === store.get(HOUSEHOLD_COOKIE)?.value ? await demoHouseholdForToken(db(), original) : null;
  try { await finishSetup(db(), uid, form.data, demo); }
  catch (error) {
    if (error instanceof InputError) return text(error.message, 400);
    return settingFailure(error, "Household setup could not finish. Your existing household is retained; try again.");
  }
  const response = redirectTo("/setup?step=bank", request, NO_REFERRER);
  response.cookies.delete(HOUSEHOLD_COOKIE);
  response.cookies.delete(UPGRADE_DEMO_COOKIE);
  return response;
}

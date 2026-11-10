import { cookies } from "next/headers";
import { formOf, NO_REFERRER, redirectTo, sameOriginOnly, text } from "@/lib/door";
import { finishSetup, setupForm } from "@/db/account";
import { db } from "@/db/client";
import { verifiedUid } from "@/lib/auth-request";
import { demoHouseholdForToken } from "@/db/demo";
import { AiKeyError } from "@/db/ai-key";
import { InputError } from "@/db/input-error";
import { ReaderError } from "@/lib/reader/settings";

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const uid = await verifiedUid();
  if (!uid) return text("A verified email session is required", 401);
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const form = setupForm.safeParse(Object.fromEntries(body));
  if (!form.success) return text("Check your name, timezone, balance and card settings.", 400);
  const store = await cookies();
  const original = store.get("upgrade-demo")?.value;
  const demo = original && original === store.get("household")?.value ? await demoHouseholdForToken(db(), original) : null;
  try { await finishSetup(db(), uid, form.data, demo); }
  catch (error) {
    if (error instanceof InputError) return text(error.message, 400);
    return text(error instanceof AiKeyError || error instanceof ReaderError ? error.message : "Household setup could not finish. Your existing household is retained; try again.", 503);
  }
  const response = redirectTo("/", request, NO_REFERRER);
  response.cookies.delete("household");
  response.cookies.delete("upgrade-demo");
  return response;
}

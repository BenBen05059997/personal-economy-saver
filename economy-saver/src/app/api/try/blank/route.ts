import { cookies } from "next/headers";
import { createHousehold, setupForm } from "@/db/account";
import { db, MissingDatabaseUrl } from "@/db/client";
import { InputError } from "@/db/input-error";
import { verifiedUid } from "@/lib/auth-request";
import { formOf, NO_REFERRER, redirectTo, sameOriginOnly, text } from "@/lib/door";
import { demoResponse } from "@/lib/session";
import { demoHouseholdForToken } from "@/db/demo";

/** Start with my numbers (D47): the setup form makes a demo household under the demo cookie, with no Ben data. Unlike /api/try it never reuses the cookie household: it makes a new one and deletes the visitor's old demo in the same transaction (a non-demo household is never touched). */
export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  try {
    if (await verifiedUid()) return redirectTo("/account", request, NO_REFERRER);
    const body = await formOf(request);
    if (body instanceof Response) return body;
    const form = setupForm.safeParse(Object.fromEntries(body));
    if (!form.success) return text("Check your name, currency and time zone.", 400);
    const old = (await cookies()).get("household")?.value;
    const replaceDemo = old ? await demoHouseholdForToken(db(), old) : null; // createHousehold deletes it only if it is a demo household
    return await demoResponse(await createHousehold(db(), crypto.randomUUID(), form.data, { isDemo: true, replaceDemo }), request, "/setup?step=bank");
  } catch (error) {
    if (error instanceof MissingDatabaseUrl) return text(error.message, 503);
    if (error instanceof InputError) return text(error.message, 400);
    return text("Setup could not finish. Try again.", 503);
  }
}

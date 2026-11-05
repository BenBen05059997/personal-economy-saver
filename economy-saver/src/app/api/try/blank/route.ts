import { cookies } from "next/headers";
import { z } from "zod";
import { createHousehold, setupForm } from "@/db/account";
import { db, MissingDatabaseUrl } from "@/db/client";
import { InputError } from "@/db/input-error";
import { demoCreationAllowed } from "@/db/rate-limit";
import { privateRedirect, verifiedUid } from "@/lib/auth-request";
import { text, formOf } from "@/lib/door";
import { demoResponse, sameOrigin } from "@/lib/session";

/** Start with my numbers (D47): the setup form makes a demo household under the demo cookie, with no Ben data. Unlike /api/try it never reuses the cookie household: it makes a new one and deletes the visitor's old demo in the same transaction (a non-demo household is never touched). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return text("Same-origin request required", 403);
  try {
    if (await verifiedUid()) return privateRedirect("/account", request);
    const body = await formOf(request);
    if (body instanceof Response) return body;
    const form = setupForm.safeParse(Object.fromEntries(body));
    if (!form.success) return text("Check your name, timezone, balance and card settings.", 400);
    if (!await demoCreationAllowed(db())) return text("Too many new demos right now. Try again in a few minutes.", 429, { "Retry-After": "300" });
    const old = (await cookies()).get("household")?.value;
    const replaceDemo = z.string().uuid().safeParse(old).success ? old : null; // createHousehold deletes it only if it is a demo household
    return demoResponse(await createHousehold(db(), crypto.randomUUID(), form.data, { isDemo: true, replaceDemo }), request);
  } catch (error) {
    if (error instanceof MissingDatabaseUrl) return text(error.message, 503);
    if (error instanceof InputError) return text(error.message, 400);
    return text("Setup could not finish. Try again.", 503);
  }
}

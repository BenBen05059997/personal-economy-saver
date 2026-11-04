import { cookies } from "next/headers";
import { z } from "zod";
import { finishSetup, setupForm } from "@/db/account";
import { db } from "@/db/client";
import { privateRedirect, verifiedUid } from "@/lib/auth-request";
import { sameOrigin } from "@/lib/session";
import { AiKeyError } from "@/db/ai-key";
import { InputError } from "@/db/input-error";
import { ReaderError } from "@/lib/reader/settings";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const uid = await verifiedUid();
  if (!uid) return new Response("A verified email session is required", { status: 401 });
  const form = setupForm.safeParse(Object.fromEntries(await request.formData()));
  if (!form.success) return new Response("Check your name, timezone, balance and card settings.", { status: 400 });
  const store = await cookies();
  const original = store.get("upgrade-demo")?.value;
  const demo = original === store.get("household")?.value && z.string().uuid().safeParse(original).success ? original! : null;
  try { await finishSetup(db(), uid, form.data, demo); }
  catch (error) {
    if (error instanceof InputError) return new Response(error.message, { status: 400 });
    return new Response(error instanceof AiKeyError || error instanceof ReaderError ? error.message : "Household setup could not finish. Your existing household is retained; try again.", { status: 503 });
  }
  const response = privateRedirect("/", request);
  response.cookies.delete("household");
  response.cookies.delete("upgrade-demo");
  return response;
}

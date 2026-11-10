import { db } from "@/db/client";
import { formOf, NO_REFERRER, redirectTo, sameOriginOnly, text } from "@/lib/door";
import { deleteOwnedHousehold } from "@/db/account";
import { verifiedUid } from "@/lib/auth-request";
import { cookies } from "next/headers";
import { AUTH_COOKIE } from "@/lib/supabase-auth";
import { AiKeyError } from "@/db/ai-key";
import { ReaderError } from "@/lib/reader/settings";

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const uid = await verifiedUid();
  if (!uid) return text("Authenticated owner required", 403);
  const body = await formOf(request);
  if (body instanceof Response) return body;
  if (body.get("confirmation") !== "delete") return text("Confirm household deletion", 400);
  try {
    if (!await deleteOwnedHousehold(db(), uid)) return text("Household owner required", 403);
  } catch (error) {
    return text(error instanceof AiKeyError || error instanceof ReaderError ? error.message : "Could not finish household deletion. Try again.", 503);
  }
  // With the membership gone no session can read household data; clear this browser's session.
  const response = redirectTo("/", request, NO_REFERRER);
  for (const cookie of (await cookies()).getAll()) {
    if (cookie.name === AUTH_COOKIE || cookie.name.startsWith(AUTH_COOKIE + ".") || ["household", "upgrade-demo"].includes(cookie.name)) response.cookies.delete(cookie.name);
  }
  return response;
}

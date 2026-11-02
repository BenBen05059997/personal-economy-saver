import { db } from "@/db/client";
import { deleteOwnedHousehold } from "@/db/account";
import { privateRedirect, verifiedUid } from "@/lib/auth-request";
import { sameOrigin } from "@/lib/session";
import { cookies } from "next/headers";
import { AUTH_COOKIE } from "@/lib/supabase-auth";
import { AiKeyError } from "@/db/ai-key";
import { ReaderError } from "@/lib/reader/settings";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const uid = await verifiedUid();
  if (!uid) return new Response("Authenticated owner required", { status: 403 });
  if ((await request.formData()).get("confirmation") !== "delete") return new Response("Confirm household deletion", { status: 400 });
  try {
    if (!await deleteOwnedHousehold(db(), uid)) return new Response("Household owner required", { status: 403 });
  } catch (error) {
    return new Response(error instanceof AiKeyError || error instanceof ReaderError ? error.message : "Could not finish household deletion. Try again.", { status: 503 });
  }
  // With the membership gone no session can read household data; clear this browser's session.
  const response = privateRedirect("/");
  for (const cookie of (await cookies()).getAll()) {
    if (cookie.name === AUTH_COOKIE || cookie.name.startsWith(AUTH_COOKIE + ".") || ["household", "upgrade-demo"].includes(cookie.name)) response.cookies.delete(cookie.name);
  }
  return response;
}

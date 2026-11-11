import { db } from "@/db/client";
import { formOf, NO_REFERRER, redirectTo, sameOriginOnly, text } from "@/lib/door";
import { verifiedUid } from "@/lib/auth-request";
import { cookies } from "next/headers";
import { AUTH_COOKIE, MissingAuthSetting } from "@/lib/supabase-auth";
import { AiKeyError } from "@/db/ai-key";
import { ReaderError } from "@/lib/reader/settings";
import { authLoginRemover, deleteAccount, LoginRemovalError } from "@/lib/delete-account";
import { logSettingProblem } from "@/lib/operator-log";

/** Delete my account: the household (owner) or the membership (member), then the sign-in email. Only the verified caller's own login is removed. */
export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const uid = await verifiedUid();
  if (!uid) return text("Sign in to continue.", 401);
  const body = await formOf(request);
  if (body instanceof Response) return body;
  if (body.get("confirmation") !== "delete") return text("Confirm account deletion", 400);
  let removeLogin;
  try { removeLogin = authLoginRemover(); }
  catch (error) {
    if (!(error instanceof MissingAuthSetting)) throw error;
    logSettingProblem("account_delete_not_set_up", error.message);
    return text("Deleting accounts isn’t set up on this server.", 503);
  }
  try {
    if (await deleteAccount(db(), uid, removeLogin) === "refused") return text("Could not delete the account. Reload and try again.", 409);
  } catch (error) {
    if (error instanceof LoginRemovalError) return text("Your data is deleted, but your sign-in could not be removed. Try again.", 502);
    return text(error instanceof AiKeyError || error instanceof ReaderError ? error.message : "Could not finish account deletion. Try again.", 503);
  }
  // With the login gone no session can be used; clear this browser's session.
  const response = redirectTo("/", request, NO_REFERRER);
  for (const cookie of (await cookies()).getAll()) {
    if (cookie.name === AUTH_COOKIE || cookie.name.startsWith(AUTH_COOKIE + ".") || ["household", "upgrade-demo"].includes(cookie.name)) response.cookies.delete(cookie.name);
  }
  return response;
}

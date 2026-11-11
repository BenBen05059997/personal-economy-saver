import { createClient } from "@supabase/supabase-js";
import { accountMembership, deleteOwnedHousehold } from "@/db/account";
import type { Db } from "@/db/household";
import { leaveHousehold } from "@/db/invites";
import { MissingAuthSetting } from "./supabase-auth";

/** Removes one sign-in email at Supabase Auth. Passed into `deleteAccount` so tests use a fake. */
export type RemoveLogin = (uid: string) => Promise<void>;

export class LoginRemovalError extends Error {}

/** The service-role call that deletes a login. Reads its settings when built, so a missing one stops the request before any data is touched. */
export function authLoginRemover(): RemoveLogin {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new MissingAuthSetting("SUPABASE_URL is not set");
  if (!key) throw new MissingAuthSetting("SUPABASE_SERVICE_ROLE_KEY is not set");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).auth.admin;
  return async uid => {
    const { error } = await admin.deleteUser(uid);
    // A login that is already gone is what a retry wants.
    if (error && error.status !== 404 && error.code !== "user_not_found") throw new LoginRemovalError("Supabase Auth refused to delete the login");
  };
}

/**
 * Deleting one person's account: the household's data first (the whole household for its owner, the person's membership for a member),
 * then that person's own login. Only the verified caller's uid is ever passed. It is safe to repeat: with no membership left it
 * only removes the login. If removing the login fails the data work stays done and the error is thrown for the retry.
 */
export async function deleteAccount(db: Db, verifiedUid: string, removeLogin: RemoveLogin): Promise<"household" | "membership" | "login-only" | "refused"> {
  const membership = await accountMembership(db, verifiedUid);
  let outcome: "household" | "membership" | "login-only" = "login-only";
  if (membership?.role === "owner") {
    if (!await deleteOwnedHousehold(db, verifiedUid)) return "refused";
    outcome = "household";
  } else if (membership) {
    if (!await leaveHousehold(db, membership.householdId, verifiedUid)) return "refused";
    outcome = "membership";
  }
  await removeLogin(verifiedUid);
  return outcome;
}

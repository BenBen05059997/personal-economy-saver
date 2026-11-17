import { cookies } from "next/headers";
import { formOf, ipLimited, missingDatabase, NO_REFERRER, sameOriginOnly, text, tooMany } from "@/lib/door";
import { redirectTo } from "@/lib/form-redirect";
import { db } from "@/db/client";
import { INVITE_TOKEN, inviteMatchesEmail } from "@/db/invites";
import { z } from "zod";
import { routeAuth, verifiedUid } from "@/lib/auth-request";
import { INVITE_COOKIE, INVITE_COOKIE_AGE, inviteCookiePolicy } from "@/lib/invite-auth";
import { appUrl, cookiePolicy, HOUSEHOLD_COOKIE, MissingAuthSetting, UPGRADE_DEMO_COOKIE } from "@/lib/supabase-auth";
import { SETTINGS_ACCOUNT } from "@/lib/links";

/** Sign-in links one client address may ask for in an hour. */
const LINKS_PER_HOUR = 5;

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const email = z.string().trim().max(254).email().safeParse(body.get("email"));
  if (!email.success) return text("Enter a valid email address", 400);
  const rawInvite = body.get("invite");
  if (rawInvite !== null && (typeof rawInvite !== "string" || !INVITE_TOKEN.test(rawInvite))) {
    return text("This invitation is no longer available.", 400);
  }
  const invite = rawInvite;
  const join = invite === null ? null : "/join/" + invite;
  const jar = await cookies();
  if (!join) jar.set(INVITE_COOKIE, "", { ...inviteCookiePolicy, maxAge: 0 });
  if (await verifiedUid()) return redirectTo(join ?? SETTINGS_ACCOUNT, request, NO_REFERRER);
  const response = redirectTo(join ? join + "?sent=1" : "/login?sent=1", request, NO_REFERRER);
  try {
    const store = db();
    const busy = await ipLimited(request, "magic-link", LINKS_PER_HOUR, "hour", "Too many sign-in links requested from this connection. Try again in an hour.", store);
    if (busy) return busy;
    if (invite !== null && !await inviteMatchesEmail(store, invite, email.data)) {
      return text("This invitation does not match that email, or has expired.", 400);
    }
    const client = await routeAuth(response);
    // PKCE binds the callback to the browser which requested this particular link.
    const redirect = new URL("/api/auth/callback", appUrl());
    const { error } = await client.auth.signInWithOtp({ email: email.data, options: { emailRedirectTo: redirect.href } });
    if (error?.status === 429) return tooMany("Too many sign-in links requested. Try again in a minute.");
    if (error) return text("Unable to send a sign-in link. Please try again later.", 502);
    if (invite !== null) {
      response.cookies.set(INVITE_COOKIE, invite, { ...inviteCookiePolicy, maxAge: INVITE_COOKIE_AGE });
      response.cookies.delete(UPGRADE_DEMO_COOKIE);
    } else {
      const demo = jar.get(HOUSEHOLD_COOKIE);
      if (demo) response.cookies.set(UPGRADE_DEMO_COOKIE, demo.value, { ...cookiePolicy, maxAge: INVITE_COOKIE_AGE });
      else response.cookies.delete(UPGRADE_DEMO_COOKIE);
    }
    return response;
  } catch (error) {
    const missing = missingDatabase(error);
    if (missing) return missing;
    if (error instanceof MissingAuthSetting) return text(error.message, 503);
    throw error;
  }
}

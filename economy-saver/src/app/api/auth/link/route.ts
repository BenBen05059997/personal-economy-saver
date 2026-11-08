import { cookies } from "next/headers";
import { formOf, text, tooMany } from "@/lib/door";
import { db, MissingDatabaseUrl } from "@/db/client";
import { INVITE_TOKEN, inviteMatchesEmail } from "@/db/invites";
import { ClientIpError, clientIp, consumeIpRequest } from "@/db/rate-limit";
import { z } from "zod";
import { privateRedirect, routeAuth, verifiedUid } from "@/lib/auth-request";
import { INVITE_COOKIE, INVITE_COOKIE_AGE, inviteCookiePolicy } from "@/lib/invite-auth";
import { sameOrigin } from "@/lib/session";
import { appUrl, cookiePolicy, MissingAuthSetting } from "@/lib/supabase-auth";

/** Sign-in links one client address may ask for in an hour. */
const LINKS_PER_HOUR = 5;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
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
  if (await verifiedUid()) return privateRedirect(join ?? "/account", request);
  const response = privateRedirect(join ? join + "?sent=1" : "/login?sent=1", request);
  try {
    const store = db();
    if (!await consumeIpRequest(store, clientIp(request), "magic-link", LINKS_PER_HOUR)) return tooMany("Too many sign-in links requested from this connection. Try again in an hour.");
    if (invite !== null && !await inviteMatchesEmail(store, invite, email.data)) {
      return text("This invitation does not match that email, or has expired.", 400);
    }
    const client = await routeAuth(response);
    // PKCE binds the callback to the browser which requested this particular link.
    const redirect = new URL("/api/auth/callback", appUrl());
    const { error } = await client.auth.signInWithOtp({ email: email.data, options: { emailRedirectTo: redirect.href } });
    if (error?.status === 429) return new Response("Too many sign-in links requested. Try again in a minute.", { status: 429, headers: { "Retry-After": "60" } });
    if (error) return new Response("Unable to send a sign-in link. Please try again later.", { status: 502 });
    if (invite !== null) {
      response.cookies.set(INVITE_COOKIE, invite, { ...inviteCookiePolicy, maxAge: INVITE_COOKIE_AGE });
      response.cookies.delete("upgrade-demo");
    } else {
      const demo = jar.get("household");
      if (demo) response.cookies.set("upgrade-demo", demo.value, { ...cookiePolicy, maxAge: 3600 });
      else response.cookies.delete("upgrade-demo");
    }
    return response;
  } catch (error) {
    if (error instanceof ClientIpError) return new Response(error.message, { status: error.status });
    if (error instanceof MissingDatabaseUrl) return new Response(error.message, { status: 503 });
    if (error instanceof MissingAuthSetting) return new Response(error.message, { status: 503 });
    throw error;
  }
}

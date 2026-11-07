import { cookies } from "next/headers";
import { formOf, tooMany } from "@/lib/door";
import { db, MissingDatabaseUrl } from "@/db/client";
import { ClientIpError, clientIp, consumeIpRequest } from "@/db/rate-limit";
import { z } from "zod";
import { privateRedirect, routeAuth, verifiedUid } from "@/lib/auth-request";
import { sameOrigin } from "@/lib/session";
import { appUrl, cookiePolicy, MissingAuthSetting } from "@/lib/supabase-auth";

/** Sign-in links one client address may ask for in an hour. */
const LINKS_PER_HOUR = 5;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const email = z.string().trim().max(254).email().safeParse(body.get("email"));
  if (!email.success) return new Response("Enter a valid email address", { status: 400 });
  if (await verifiedUid()) return privateRedirect("/account");
  const response = privateRedirect("/login?sent=1");
  try {
    if (!await consumeIpRequest(db(), clientIp(request), "magic-link", LINKS_PER_HOUR)) return tooMany("Too many sign-in links requested from this connection. Try again in an hour.");
    const client = await routeAuth(response);
    // PKCE binds the callback to the browser which requested this particular link.
    const redirect = new URL("/api/auth/callback", appUrl());
    const { error } = await client.auth.signInWithOtp({ email: email.data, options: { emailRedirectTo: redirect.href } });
    if (error?.status === 429) return new Response("Too many sign-in links requested. Try again in a minute.", { status: 429, headers: { "Retry-After": "60" } });
    if (error) return new Response("Unable to send a sign-in link. Please try again later.", { status: 502 });
    const demo = (await cookies()).get("household");
    if (demo) response.cookies.set("upgrade-demo", demo.value, { ...cookiePolicy, maxAge: 3600 });
    else response.cookies.delete("upgrade-demo");
    return response;
  } catch (error) {
    if (error instanceof ClientIpError) return new Response(error.message, { status: error.status });
    if (error instanceof MissingDatabaseUrl) return new Response(error.message, { status: 503 });
    if (error instanceof MissingAuthSetting) return new Response(error.message, { status: 503 });
    throw error;
  }
}

import { cookies } from "next/headers";
import { z } from "zod";
import { privateRedirect, routeAuth, verifiedUid } from "@/lib/auth-request";
import { sameOrigin } from "@/lib/session";
import { cookiePolicy, MissingAuthSetting } from "@/lib/supabase-auth";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const email = z.string().trim().max(254).email().safeParse((await request.formData()).get("email"));
  if (!email.success) return new Response("Enter a valid email address", { status: 400 });
  if (await verifiedUid()) return privateRedirect("/account");
  const response = privateRedirect("/login?sent=1");
  try {
    const client = await routeAuth(response);
    // PKCE binds the callback to the browser which requested this particular link.
    const redirect = new URL("/api/auth/callback", request.headers.get("origin")!);
    const { error } = await client.auth.signInWithOtp({ email: email.data, options: { emailRedirectTo: redirect.href } });
    if (error) return new Response("Unable to send a sign-in link. Please try again later.", { status: error.status === 429 ? 429 : 502 });
    const demo = (await cookies()).get("household");
    if (demo) response.cookies.set("upgrade-demo", demo.value, { ...cookiePolicy, maxAge: 3600 });
    else response.cookies.delete("upgrade-demo");
    return response;
  } catch (error) {
    if (error instanceof MissingAuthSetting) return new Response(error.message, { status: 503 });
    throw error;
  }
}

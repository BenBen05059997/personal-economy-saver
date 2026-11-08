import { cache } from "react";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FORM_REDIRECT_HEADER, postedByForm } from "./form-fetch";
import { authCookieOptions, hasAuthCookie, supabaseAuth } from "./supabase-auth";

/** A 303 redirect; to a post made by `ApiForm` (pass the request) it answers 204 with the destination in a header instead. */
export function privateRedirect(location: string, request?: Request) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  if (request && postedByForm(request)) return new NextResponse(null, { status: 204, headers: { ...headers, [FORM_REDIRECT_HEADER]: location } });
  return new NextResponse(null, { status: 303, headers: { ...headers, Location: location } });
}

export async function routeAuth(response: NextResponse) {
  const store = await cookies();
  return supabaseAuth({
    getAll: () => store.getAll(),
    setAll(changes, headers) {
      for (const cookie of changes) {
        response.cookies.set(cookie.name, cookie.value, authCookieOptions(cookie.options));
      }
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    },
  });
}

export const verifiedIdentity = cache(async () => {
  const store = await cookies();
  if (!hasAuthCookie(store.getAll())) return null;
  // Middleware has already refreshed the request cookies. getUser checks revocation
  // with Auth and never authorizes using the cookie's unverified session data.
  const auth = supabaseAuth({ getAll: () => store.getAll() });
  const { data, error } = await auth.auth.getUser();
  if (error && (!error.status || error.status >= 500)) throw new Error("Supabase Auth is unavailable");
  return data.user ? { uid: data.user.id, email: data.user.email_confirmed_at ? data.user.email ?? null : null } : null;
});

export async function verifiedUid() {
  return (await verifiedIdentity())?.uid ?? null;
}

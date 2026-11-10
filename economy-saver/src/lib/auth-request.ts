import { cache } from "react";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authCookieOptions, hasAuthCookie, supabaseAuth } from "./supabase-auth";

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

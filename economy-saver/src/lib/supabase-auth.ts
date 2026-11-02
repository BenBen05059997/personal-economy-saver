import { createServerClient, type CookieMethodsServer, type CookieOptions } from "@supabase/ssr";

export const AUTH_COOKIE = "pes-auth";
export const COOKIE_AGE = 30 * 86400;
export const cookiePolicy = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

// SSR splits a session into multiple cookies if it exceeds the browser's per-cookie limit.
export function hasAuthCookie(cookies: { name: string }[]) {
  return cookies.some(({ name }) => name === AUTH_COOKIE || /^pes-auth\.\d+$/.test(name));
}

export function authCookieOptions(opts: CookieOptions) {
  return { ...opts, ...cookiePolicy, maxAge: opts.maxAge === 0 ? 0 : COOKIE_AGE };
}

export class MissingAuthSetting extends Error {}
export function supabaseAuth(cookies: CookieMethodsServer) {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url) throw new MissingAuthSetting("SUPABASE_URL is not set");
  if (!key) throw new MissingAuthSetting("SUPABASE_ANON_KEY is not set");
  return createServerClient(url, key, {
    cookieOptions: { ...cookiePolicy, name: AUTH_COOKIE, maxAge: COOKIE_AGE },
    cookies: { ...cookies, encode: "tokens-only" },
  });
}

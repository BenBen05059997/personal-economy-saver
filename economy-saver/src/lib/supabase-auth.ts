import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieMethodsServer, type CookieOptions } from "@supabase/ssr";
import { setting } from "./env";

export const AUTH_COOKIE = "pes-auth";
export const HOUSEHOLD_COOKIE = "household";
export const UPGRADE_DEMO_COOKIE = "upgrade-demo";
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

/** The app's own address, from settings rather than a request header, so a sign-in link can't be pointed elsewhere. */
export function appUrl(): URL {
  const value = setting("APP_URL");
  if (!value) throw new MissingAuthSetting("APP_URL is not set");
  try {
    return new URL(value);
  } catch {
    throw new MissingAuthSetting("APP_URL is not a valid URL");
  }
}
/** A client for Supabase's service role: it keeps no session, so it is only for server-side admin and storage calls. */
export function supabaseService(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export function supabaseAuth(cookies: CookieMethodsServer) {
  const url = setting("SUPABASE_URL");
  const key = setting("SUPABASE_ANON_KEY");
  if (!url) throw new MissingAuthSetting("SUPABASE_URL is not set");
  if (!key) throw new MissingAuthSetting("SUPABASE_ANON_KEY is not set");
  return createServerClient(url, key, {
    cookieOptions: { ...cookiePolicy, name: AUTH_COOKIE, maxAge: COOKIE_AGE },
    cookies: { ...cookies, encode: "tokens-only" },
  });
}

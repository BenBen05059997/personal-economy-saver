// OpenNext supports Edge middleware. Run refresh before rendering so a rotated refresh
// token reaches both the server component and its browser in the same response.
import { NextResponse, type NextRequest } from "next/server";
import { RAY_COOKIE } from "@/lib/ray";
import { authCookieOptions, hasAuthCookie, supabaseAuth } from "@/lib/supabase-auth";

/** The error pages quote the request's Cloudflare ray: a client boundary can't read headers, so a page request leaves it in a cookie it can (src/components/shell/ErrorReference.tsx). */
function pageHeaders(request: NextRequest, response: NextResponse) {
  if (/^\/(?:join|signing-in)(?:\/|$)/i.test(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  const ray = request.headers.get("cf-ray");
  if (ray && !request.nextUrl.pathname.startsWith("/api/")) response.cookies.set(RAY_COOKIE, ray, { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  return response;
}

export async function middleware(request: NextRequest) {
  if (!hasAuthCookie(request.cookies.getAll())) return pageHeaders(request, NextResponse.next());
  let response = NextResponse.next({ request });
  const supabase = supabaseAuth({
    getAll: () => request.cookies.getAll(),
    setAll(changes, headers) {
      for (const cookie of changes) request.cookies.set(cookie.name, cookie.value);
      response = NextResponse.next({ request });
      for (const cookie of changes) response.cookies.set(cookie.name, cookie.value, authCookieOptions(cookie.options));
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    },
  });
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return pageHeaders(request, response);
}
export const config = {
  matcher: ["/((?!_next/|fonts/|favicon.ico|push-sw.js|api/paypal/webhook|pay/|api/cron|api/mcp|api/inbound).*)"],
};

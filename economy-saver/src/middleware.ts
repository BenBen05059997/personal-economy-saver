// OpenNext supports Edge middleware. Run refresh before rendering so a rotated refresh
// token reaches both the server component and its browser in the same response.
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, hasAuthCookie, supabaseAuth } from "@/lib/supabase-auth";

export async function middleware(request: NextRequest) {
  if (!hasAuthCookie(request.cookies.getAll())) return NextResponse.next();
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
  return response;
}
export const config = {
  matcher: ["/((?!_next/|fonts/|favicon.ico|api/paypal/webhook|api/cron|api/mcp|api/inbound).*)"],
};

import { accountHousehold } from "@/db/account";
import { verifiedUid } from "./auth-request";
import { FORM_REDIRECT_HEADER, postedByForm } from "./form-fetch";
import { hasAuthCookie } from "./supabase-auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { findDemoHousehold } from "@/db/demo";

// The UUID cookie is a bearer credential only for anonymous Try it households.
export async function currentHouseholdId(): Promise<string | null> {
  const store = await cookies();
  if (hasAuthCookie(store.getAll())) {
    const uid = await verifiedUid();
    return uid ? accountHousehold(db(), uid) : null;
  }
  const id = store.get("household")?.value;
  if (!id) return null;
  return findDemoHousehold(db(), id);
}

/** The guard for household-scoped mutating routes: the household id, or the 403/401 response to return as is. */
export async function householdRequest(request: Request): Promise<string | Response> {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  return await currentHouseholdId() ?? new Response("Household session required", { status: 401 });
}

/** Sets the demo cookie and sends the visitor Home: a 303, or, to a post made by `ApiForm` (pass the request), 204 with the destination in a header. */
export function demoResponse(id: string, request?: Request) {
  const response = request && postedByForm(request)
    ? new NextResponse(null, { status: 204, headers: { [FORM_REDIRECT_HEADER]: "/" } })
    : new NextResponse(null, { status: 303, headers: { Location: "/" } });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set("household", id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 86400,
    path: "/",
  });
  return response;
}

export function sameOrigin(request: Request): boolean {
  // Next dev normalises request.url to localhost even when the browser used 127.0.0.1.
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (host) url.host = host;
  const origin = url.origin;
  const header = request.headers.get("origin");
  if (header !== null) return header === origin;
  // Browsers omit Origin on ordinary same-origin GET navigations.
  if (request.method !== "GET") return false;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const referer = request.headers.get("referer");
  return !!referer && URL.canParse(referer) && new URL(referer).origin === origin;
}

import { cache } from "react";
import { accountHousehold, accountMembership } from "@/db/account";
import { verifiedUid } from "./auth-request";
import { FORM_REDIRECT_HEADER, postedByForm } from "./form-fetch";
import { hasAuthCookie } from "./supabase-auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { demoHouseholdForToken, issueDemoToken } from "@/db/demo";
import { noteHousehold } from "./request-log";

// The household cookie holds a Try it token (a bearer credential for that anonymous household only); the id is never in it.
export async function currentHouseholdId(): Promise<string | null> {
  const id = await householdForRender();
  if (id) noteHousehold(id);
  return id;
}

async function resolveHouseholdId(): Promise<string | null> {
  const store = await cookies();
  if (hasAuthCookie(store.getAll())) {
    const uid = await verifiedUid();
    return uid ? accountHousehold(db(), uid) : null;
  }
  const token = store.get("household")?.value;
  if (!token) return null;
  return demoHouseholdForToken(db(), token);
}

const householdForRender = cache(resolveHouseholdId);

/** The guard for household-scoped mutating routes: the household id, or the 403/401 response to return as is. */
export async function householdRequest(request: Request): Promise<string | Response> {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  return await currentHouseholdId() ?? new Response("Household session required", { status: 401 });
}

/** An authenticated owner or the anonymous owner of the current Try it household. */
export async function hasHouseholdOwnerAccess(hid: string): Promise<boolean> {
  const uid = await verifiedUid();
  if (!uid) return await householdForRender() === hid;
  const member = await withHousehold(db(), hid, tx => accountMembership(tx, uid));
  return member?.householdId === hid && member.role === "owner";
}

export async function ownerRequest(request: Request): Promise<string | Response> {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  return await hasHouseholdOwnerAccess(hid) ? hid : new Response("Household owner required", { status: 403 });
}

/**
 * Gives the demo household a fresh cookie token, sets it and sends the visitor Home: a 303, or, to a post made by `ApiForm`
 * (pass the request), 204 with the destination in a header.
 */
export async function demoResponse(id: string, request?: Request, to = "/") {
  const token = await issueDemoToken(db(), id);
  if (!token) return new NextResponse("Demo session has expired", { status: 409, headers: { "Cache-Control": "private, no-store" } });
  const response = request && postedByForm(request)
    ? new NextResponse(null, { status: 204, headers: { [FORM_REDIRECT_HEADER]: to } })
    : new NextResponse(null, { status: 303, headers: { Location: to } });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set("household", token, {
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

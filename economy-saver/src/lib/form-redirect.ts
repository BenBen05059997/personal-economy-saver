import { NextResponse } from "next/server";
import { FORM_REDIRECT_HEADER, NO_STORE, postedByForm } from "./form-fetch";

// The redirect a route answers a post with; server code only, so the header names stay importable from the browser.

/**
 * Where a successful post goes next. A native post gets the 303 redirect. A post made by `ApiForm` (pass the request) gets
 * 204 with the destination in a header, so the page can navigate without fetching the destination twice. `noReferrer`
 * (the sign-in and account doors) adds `Referrer-Policy: no-referrer`.
 */
export function redirectTo(location: string, request?: Request, options: { noReferrer?: boolean } = {}) {
  const headers: Record<string, string> = { ...NO_STORE, ...(options.noReferrer ? { "Referrer-Policy": "no-referrer" } : {}) };
  if (request && postedByForm(request)) return new NextResponse(null, { status: 204, headers: { ...headers, [FORM_REDIRECT_HEADER]: location } });
  return new NextResponse(null, { status: 303, headers: { ...headers, Location: location } });
}

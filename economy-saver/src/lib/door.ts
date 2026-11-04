// Shared by the route handlers under src/app/api: the no-store header, redirects and plain-text answers,
// the return-target check and the typed-in-data failure and bad-fields responses.
import { InputError } from "@/db/input-error";
import { StatementChargeError } from "@/db/statement-charge";
import { FORM_REDIRECT_HEADER, postedByForm } from "./form-fetch";

export const NO_STORE = { "Cache-Control": "private, no-store" };

export const BAD_FIELDS = "Check the required fields and try again.";

/**
 * Where a successful post goes next. A native post gets the 303 redirect. A post made by `ApiForm` (pass the request) gets
 * 204 with the destination in a header, so the page can navigate without fetching the destination twice.
 */
export function redirectTo(location: string, request?: Request) {
  if (request && postedByForm(request)) return new Response(null, { status: 204, headers: { [FORM_REDIRECT_HEADER]: location, ...NO_STORE } });
  return new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } });
}

/** A plain-text answer that is never cached; `headers` adds to the no-store header (for example Retry-After). */
export function text(message: string, status: number, headers: Record<string, string> = {}) {
  return new Response(message, { status, headers: { ...NO_STORE, ...headers } });
}

/** Only the pages that offer a form are valid return targets. */
export function returnPath(value: FormDataEntryValue | null) {
  return value === "/to-check" || value === "/plan" || value === "/settings" || (typeof value === "string" && /^\/cards\/[0-9a-f-]{36}$/.test(value)) ? String(value) : "/";
}

/** Plain-text failure: a request problem is 400 with its user-facing message, anything else is 503 with no detail. */
export function failure(error: unknown) {
  if (error instanceof InputError || error instanceof StatementChargeError) return text(error.message, 400);
  return text("This could not be saved. Try again.", 503);
}

export function badFields() {
  return text(BAD_FIELDS, 400);
}
